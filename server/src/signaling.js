// WebSocket signaling: small JSON request/response protocol.
// Client sends {id, method, data}; server replies {id, ok, data|error}.
// Server-initiated events are {event, data} with no id.
import { WebSocketServer } from "ws";
import { createWebRtcTransport } from "./media.js";
import {
  getOrCreateRoom, addPeer, removePeer, peerSummary, broadcast
} from "./rooms.js";
import { iceServers } from "./turn.js";
import { isAuthedRequest } from "./auth.js";
import { getSettings, updateSettings, findSession } from "./settings.js";
import { notifyUser } from "./push.js";
import {
  startRecording, stopRecording, activeRecording,
  addPeerToRecording, uploadCreds, markPeerDone
} from "./recording/manager.js";
import { capturePeer } from "./recording/serverRecorder.js";
import { startStream, stopStream, isStreaming, refreshStream } from "./streaming.js";

const ROOM_ID_RE = /^[a-zA-Z0-9_-]{4,32}$/;
const NAME_MAX = 40;

export function attachSignaling(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", async (socket, req) => {
    const url = new URL(req.url, "http://localhost");
    const roomId = url.searchParams.get("room") || "";
    if (!ROOM_ID_RE.test(roomId)) {
      socket.close(4400, "bad room id");
      return;
    }

    // Created on join, not here: awaiting router creation before attaching
    // the message listener would drop messages from fast clients.
    let room = null;
    let peer = null;

    socket.on("message", async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      const { id, method, data = {} } = msg;
      const reply = (payload) => socket.send(JSON.stringify({ id, ok: true, data: payload }));
      const fail = (error) => socket.send(JSON.stringify({ id, ok: false, error }));

      try {
        switch (method) {
          case "join": {
            if (peer) return fail("already joined");
            // Only sessions created in a dashboard exist
            const session = await findSession(roomId);
            if (!session) return fail("This session link doesn't exist.");
            room = await getOrCreateRoom(roomId);
            room.ownerId = session.ownerId;
            const name = String(data.name || "").trim().slice(0, NAME_MAX) || "Guest";
            const tagline = String(data.tagline || "").trim().slice(0, 60);
            // Host role needs a dashboard login AND ownership of this
            // session — never client-claimed. Admins manage the system;
            // they don't host shows.
            const auth = isAuthedRequest(req);
            const canHost = auth && auth.uid === session.ownerId;
            const role = canHost && data.role === "host" ? "host" : "guest";
            peer = addPeer(room, { name, tagline, role, socket });
            const settings = await getSettings(room.ownerId);
            if (!room.control.bannerColor) room.control.bannerColor = settings.accent;
            const { findById } = await import("./users.js");
            const canServerRecord = role === "host" &&
              !!(await findById(room.ownerId))?.allowServerRecording;
            reply({
              peerId: peer.id,
              role,
              canServerRecord,
              routerRtpCapabilities: room.router.rtpCapabilities,
              iceServers: iceServers(),
              control: room.control,
              streaming: isStreaming(room.id),
              theme: {
                podcastName: settings.podcastName,
                accent: settings.accent,
                wallpaper: settings.wallpaper ? `/api/wallpaper/${room.ownerId}` : null
              },
              peers: [...room.peers.values()]
                .filter((p) => p.id !== peer.id)
                .map(peerSummary)
            });
            broadcast(room, peer.id, { event: "peerJoined", data: peerSummary(peer) });
            if (role === "guest" && room.peers.size === 1) {
              notifyUser(room.ownerId, "Guest waiting", `${name} just joined session ${room.id}.`).catch(() => {});
            }
            // Someone joining mid-recording starts recording too
            const rec = activeRecording(room.id);
            if (rec && addPeerToRecording(rec, peer)) {
              socket.send(JSON.stringify({
                event: "recordingStarted",
                data: {
                  mode: rec.mode,
                  upload: rec.mode === "browser" ? uploadCreds(rec, peer.id) : null
                }
              }));
            }
            break;
          }

          case "selfMute": {
            if (!peer) return fail("not joined");
            room.control.muted[peer.id] = !!data.muted;
            for (const prod of peer.producers.values()) {
              if (prod.kind === "audio") {
                data.muted ? await prod.pause() : await prod.resume();
              }
            }
            reply({});
            broadcast(room, null, { event: "control", data: room.control });
            break;
          }

          case "hostControl": {
            if (!peer || peer.role !== "host") return fail("host only");
            const c = room.control;
            switch (data.action) {
              case "layout":
                c.layout = data.layout === "spotlight" ? "spotlight" : "grid";
                c.spotlightPeerId = c.layout === "spotlight" ? String(data.peerId || "") : null;
                break;
              case "volume": {
                const v = Math.min(1.5, Math.max(0, Number(data.volume)));
                if (room.peers.has(data.peerId) && Number.isFinite(v)) c.volumes[data.peerId] = v;
                break;
              }
              case "autoGain":
                c.autoGain = !!data.enabled;
                break;
              case "bannerColor":
                if (/^#[0-9a-fA-F]{6}$/.test(String(data.color || ""))) {
                  c.bannerColor = String(data.color).toLowerCase();
                }
                break;
              case "mute": {
                const target = room.peers.get(data.peerId);
                if (!target) return fail("no such guest");
                c.muted[target.id] = !!data.muted;
                for (const prod of target.producers.values()) {
                  if (prod.kind === "audio") {
                    data.muted ? await prod.pause() : await prod.resume();
                  }
                }
                break;
              }
              case "muteAll": {
                for (const p2 of room.peers.values()) {
                  if (p2.id === peer.id) continue; // not the host themself
                  c.muted[p2.id] = true;
                  for (const prod of p2.producers.values()) {
                    if (prod.kind === "audio") await prod.pause();
                  }
                }
                break;
              }
              case "stream": {
                if (data.start) {
                  const settings = await getSettings(room.ownerId);
                  if (!settings.streamKey) {
                    return fail("Add your YouTube stream key in the dashboard first.");
                  }
                  const url = `${settings.streamUrl.replace(/\/$/, "")}/${settings.streamKey}`;
                  await startStream(room, url);
                  broadcast(room, null, { event: "streaming", data: { live: true } });
                } else {
                  broadcast(room, null, { event: "streaming", data: { live: false } });
                  await stopStream(room.id);
                }
                return reply({});
              }
              case "record": {
                if (data.start) {
                  // Server-side mode is a per-host permission; the host
                  // picks it per session when starting the recording.
                  const { findById } = await import("./users.js");
                  const allowed = !!(await findById(room.ownerId))?.allowServerRecording;
                  const mode = data.mode === "server" && allowed ? "server" : "browser";
                  const rec = await startRecording(room, mode);
                  for (const p of room.peers.values()) {
                    if (p.socket.readyState === 1) {
                      p.socket.send(JSON.stringify({
                        event: "recordingStarted",
                        data: {
                          mode: rec.mode,
                          upload: rec.mode === "browser" ? uploadCreds(rec, p.id) : null
                        }
                      }));
                    }
                  }
                } else {
                  // Tell everyone first; ffmpeg teardown can take seconds
                  broadcast(room, null, { event: "recordingStopped", data: {} });
                  await stopRecording(room);
                }
                return reply({});
              }
              default:
                return fail("unknown control action");
            }
            reply({});
            broadcast(room, null, { event: "control", data: c });
            break;
          }

          case "createTransport": {
            if (!peer) return fail("not joined");
            const transport = await createWebRtcTransport(room.router);
            peer.transports.set(transport.id, transport);
            transport.on("dtlsstatechange", (s) => {
              if (s === "closed") peer.transports.delete(transport.id);
            });
            reply({
              id: transport.id,
              iceParameters: transport.iceParameters,
              iceCandidates: transport.iceCandidates,
              dtlsParameters: transport.dtlsParameters
            });
            break;
          }

          case "connectTransport": {
            if (!peer) return fail("not joined");
            const transport = peer.transports.get(data.transportId);
            if (!transport) return fail("no such transport");
            await transport.connect({ dtlsParameters: data.dtlsParameters });
            reply({});
            break;
          }

          case "produce": {
            if (!peer) return fail("not joined");
            const transport = peer.transports.get(data.transportId);
            if (!transport) return fail("no such transport");
            const producer = await transport.produce({
              kind: data.kind,
              rtpParameters: data.rtpParameters,
              appData: { source: String(data.source || data.kind).slice(0, 20) }
            });
            peer.producers.set(producer.id, producer);
            producer.on("transportclose", () => peer.producers.delete(producer.id));
            reply({ producerId: producer.id });
            broadcast(room, peer.id, {
              event: "newProducer",
              data: { peerId: peer.id, producerId: producer.id, kind: producer.kind }
            });
            // Live stream picks up new members (debounced relaunch)
            if (isStreaming(room.id) && peer.producers.size >= 2) refreshStream(room.id);
            // Server-mode recording: start piping this peer once their
            // mic + camera are both up
            const recNow = activeRecording(room.id);
            if (recNow?.mode === "server" &&
                peer.producers.size >= 2 &&
                !(recNow.captures || []).some((c) => c.peerId === peer.id)) {
              capturePeer(recNow, room, peer).catch((e) =>
                console.error("mid-session capture failed:", e.message));
            }
            break;
          }

          case "closeProducer": {
            if (!peer) return fail("not joined");
            const producer = peer.producers.get(data.producerId);
            if (producer) {
              producer.close();
              peer.producers.delete(producer.id);
              broadcast(room, peer.id, {
                event: "producerClosed",
                data: { peerId: peer.id, producerId: data.producerId }
              });
            }
            reply({});
            break;
          }

          case "consume": {
            if (!peer) return fail("not joined");
            const transport = peer.transports.get(data.transportId);
            if (!transport) return fail("no such transport");
            if (!room.router.canConsume({
              producerId: data.producerId,
              rtpCapabilities: data.rtpCapabilities
            })) return fail("cannot consume");
            const consumer = await transport.consume({
              producerId: data.producerId,
              rtpCapabilities: data.rtpCapabilities,
              paused: true
            });
            peer.consumers.set(consumer.id, consumer);
            consumer.on("transportclose", () => peer.consumers.delete(consumer.id));
            consumer.on("producerclose", () => {
              peer.consumers.delete(consumer.id);
              if (socket.readyState === 1) {
                socket.send(JSON.stringify({
                  event: "consumerClosed", data: { consumerId: consumer.id }
                }));
              }
            });
            reply({
              consumerId: consumer.id,
              producerId: data.producerId,
              kind: consumer.kind,
              rtpParameters: consumer.rtpParameters
            });
            break;
          }

          case "resumeConsumer": {
            if (!peer) return fail("not joined");
            const consumer = peer.consumers.get(data.consumerId);
            if (!consumer) return fail("no such consumer");
            await consumer.resume();
            reply({});
            break;
          }

          default:
            fail(`unknown method: ${String(method).slice(0, 40)}`);
        }
      } catch (err) {
        if (err.code === "ROOM_FULL") return fail("session full");
        console.error(`signaling error in ${method}:`, err.message);
        fail("server error");
      }
    });

    socket.on("close", () => {
      if (!peer) return;
      const rec = activeRecording(room.id);
      if (rec) markPeerDone(rec.id, peer.id);
      removePeer(room, peer.id);
      broadcast(room, null, { event: "peerLeft", data: { peerId: peer.id } });
      if (isStreaming(room.id)) refreshStream(room.id);
      // Last one out stops the tape
      if (rec && room.peers.size === 0) {
        stopRecording(room).catch((e) => console.error("auto-stop failed:", e.message));
      }
    });
  });

  return wss;
}
