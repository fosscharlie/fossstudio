// WebSocket signaling: small JSON request/response protocol.
// Client sends {id, method, data}; server replies {id, ok, data|error}.
// Server-initiated events are {event, data} with no id.
import { WebSocketServer } from "ws";
import { createWebRtcTransport } from "./media.js";
import {
  getOrCreateRoom, addPeer, removePeer, peerSummary, broadcast
} from "./rooms.js";
import { iceServers } from "./turn.js";

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
            room = await getOrCreateRoom(roomId);
            const name = String(data.name || "").trim().slice(0, NAME_MAX) || "Guest";
            peer = addPeer(room, { name, role: data.role === "host" ? "host" : "guest", socket });
            reply({
              peerId: peer.id,
              routerRtpCapabilities: room.router.rtpCapabilities,
              iceServers: iceServers(),
              peers: [...room.peers.values()]
                .filter((p) => p.id !== peer.id)
                .map(peerSummary)
            });
            broadcast(room, peer.id, { event: "peerJoined", data: peerSummary(peer) });
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
      removePeer(room, peer.id);
      broadcast(room, null, { event: "peerLeft", data: { peerId: peer.id } });
    });
  });

  return wss;
}
