/* FOSS Studio guest session: preview -> join -> live grid. */
(() => {
  "use strict";

  const roomId = location.pathname.split("/")[2];
  const $ = (id) => document.getElementById(id);

  const els = {
    preview: $("preview"), previewVideo: $("previewVideo"),
    camSelect: $("camSelect"), micSelect: $("micSelect"),
    nameInput: $("nameInput"), joinBtn: $("joinBtn"),
    previewError: $("previewError"), micMeterFill: $("micMeterFill"),
    session: $("session"), banner: $("banner"), grid: $("grid"),
    muteBtn: $("muteBtn"), camBtn: $("camBtn"), leaveBtn: $("leaveBtn")
  };

  let previewStream = null;
  let audioCtx = null;

  // ---------- Preview ----------

  function showError(msg) {
    els.previewError.textContent = msg;
    els.previewError.hidden = false;
  }

  async function startPreview() {
    stopPreview();
    const constraints = {
      video: els.camSelect.value
        ? { deviceId: { exact: els.camSelect.value }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: els.micSelect.value ? { deviceId: { exact: els.micSelect.value } } : true
    };
    previewStream = await navigator.mediaDevices.getUserMedia(constraints);
    els.previewVideo.srcObject = previewStream;
    startMicMeter(previewStream);
  }

  function stopPreview() {
    if (previewStream) {
      for (const t of previewStream.getTracks()) t.stop();
      previewStream = null;
    }
  }

  function startMicMeter(stream) {
    if (!audioCtx) audioCtx = new AudioContext();
    const src = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    (function tick() {
      if (!previewStream && els.preview.hidden) return;
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      els.micMeterFill.style.width = `${Math.min(100, (peak / 128) * 300)}%`;
      requestAnimationFrame(tick);
    })();
  }

  async function populateDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const fill = (select, kind, label) => {
      const current = select.value;
      select.innerHTML = "";
      devices.filter((d) => d.kind === kind).forEach((d, i) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || `${label} ${i + 1}`;
        select.appendChild(opt);
      });
      if (current) select.value = current;
    };
    fill(els.camSelect, "videoinput", "Camera");
    fill(els.micSelect, "audioinput", "Microphone");
  }

  async function initPreview() {
    try {
      await startPreview();          // ask permission first so labels appear
      await populateDevices();
      els.joinBtn.disabled = false;
    } catch (err) {
      showError(
        err.name === "NotAllowedError"
          ? "Camera and microphone access was blocked. Allow access in your browser and reload this page."
          : "Couldn't start your camera or microphone. Check nothing else is using them, then reload."
      );
    }
  }

  els.camSelect.onchange = () => startPreview().catch(() => showError("Couldn't switch camera."));
  els.micSelect.onchange = () => startPreview().catch(() => showError("Couldn't switch microphone."));
  navigator.mediaDevices.addEventListener("devicechange", populateDevices);

  // ---------- Signaling ----------

  let ws = null;
  let reqId = 0;
  const pending = new Map();
  const eventHandlers = {};

  function connectWs() {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(`wss://${location.host}/ws?room=${roomId}`);
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("connection failed"));
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id !== undefined) {
          const p = pending.get(msg.id);
          if (!p) return;
          pending.delete(msg.id);
          msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error));
        } else if (msg.event && eventHandlers[msg.event]) {
          eventHandlers[msg.event](msg.data);
        }
      };
      ws.onclose = () => { if (joined) leaveToPreview("The connection dropped. Rejoin when you're ready."); };
    });
  }

  function request(method, data = {}) {
    return new Promise((resolve, reject) => {
      const id = ++reqId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, data }));
    });
  }

  // ---------- Media session ----------

  let device, sendTransport, recvTransport;
  let micProducer, camProducer;
  let selfId = null;
  let joined = false;
  const tiles = new Map();     // peerId -> {el, video, stream, name}
  const consumers = new Map(); // consumerId -> {consumer, peerId}

  function makeTile(peerId, name, isSelf) {
    const el = document.createElement("div");
    el.className = "tile" + (isSelf ? " self" : "");
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    if (isSelf) video.muted = true;
    const nameEl = document.createElement("div");
    nameEl.className = "name";
    nameEl.textContent = name;
    el.append(video, nameEl);
    els.grid.appendChild(el);
    const stream = new MediaStream();
    video.srcObject = stream;
    tiles.set(peerId, { el, video, stream, name });
    layoutGrid();
    return tiles.get(peerId);
  }

  function removeTile(peerId) {
    const tile = tiles.get(peerId);
    if (!tile) return;
    tile.el.remove();
    tiles.delete(peerId);
    layoutGrid();
  }

  function layoutGrid() {
    const mobile = matchMedia("(max-width: 700px)").matches;
    const n = mobile
      ? Math.max(1, tiles.size - 1)  // self floats as a thumbnail on mobile
      : Math.max(1, tiles.size);
    const cols = mobile ? (n > 1 ? 2 : 1) : Math.ceil(Math.sqrt(n));
    els.grid.style.setProperty("--cols", cols);
  }
  matchMedia("(max-width: 700px)").addEventListener("change", layoutGrid);

  async function consumeProducer(peerId, producerId) {
    const { consumerId, kind, rtpParameters } = await request("consume", {
      transportId: recvTransport.id,
      producerId,
      rtpCapabilities: device.rtpCapabilities
    });
    const consumer = await recvTransport.consume({
      id: consumerId, producerId, kind, rtpParameters
    });
    consumers.set(consumerId, { consumer, peerId });
    const tile = tiles.get(peerId);
    if (tile) tile.stream.addTrack(consumer.track);
    await request("resumeConsumer", { consumerId });
  }

  async function join() {
    els.joinBtn.disabled = true;
    els.joinBtn.textContent = "Joining…";
    try {
      await connectWs();
      const name = els.nameInput.value.trim() || "Guest";
      const info = await request("join", { name });
      selfId = info.peerId;

      device = new mediasoupClient.Device();
      await device.load({ routerRtpCapabilities: info.routerRtpCapabilities });

      const makeTransport = async (direction) => {
        const params = await request("createTransport", { direction });
        const opts = { ...params, iceServers: info.iceServers };
        const transport = direction === "send"
          ? device.createSendTransport(opts)
          : device.createRecvTransport(opts);
        transport.on("connect", ({ dtlsParameters }, cb, eb) => {
          request("connectTransport", { transportId: transport.id, dtlsParameters })
            .then(cb).catch(eb);
        });
        if (direction === "send") {
          transport.on("produce", ({ kind, rtpParameters, appData }, cb, eb) => {
            request("produce", {
              transportId: transport.id, kind, rtpParameters, source: appData.source
            }).then(({ producerId }) => cb({ id: producerId })).catch(eb);
          });
        }
        return transport;
      };

      sendTransport = await makeTransport("send");
      recvTransport = await makeTransport("recv");

      // Publish our mic and camera (reusing the preview's tracks)
      const audioTrack = previewStream.getAudioTracks()[0];
      const videoTrack = previewStream.getVideoTracks()[0];
      micProducer = await sendTransport.produce({ track: audioTrack, appData: { source: "mic" } });
      camProducer = await sendTransport.produce({
        track: videoTrack,
        encodings: [{ maxBitrate: 1_200_000 }],
        appData: { source: "camera" }
      });

      // Show ourselves, then everyone already here
      const selfTile = makeTile(selfId, name, true);
      selfTile.stream.addTrack(videoTrack);
      for (const p of info.peers) {
        makeTile(p.id, p.name, false);
        for (const prod of p.producers) await consumeProducer(p.id, prod.id);
      }

      // Live events
      eventHandlers.peerJoined = (p) => makeTile(p.id, p.name, false);
      eventHandlers.peerLeft = ({ peerId }) => removeTile(peerId);
      eventHandlers.newProducer = ({ peerId, producerId }) =>
        consumeProducer(peerId, producerId).catch(console.error);
      eventHandlers.producerClosed = ({ producerId }) => {
        for (const [cid, c] of consumers) {
          if (c.consumer.producerId === producerId) {
            const tile = tiles.get(c.peerId);
            if (tile) tile.stream.removeTrack(c.consumer.track);
            c.consumer.close();
            consumers.delete(cid);
          }
        }
      };
      eventHandlers.consumerClosed = ({ consumerId }) => {
        const c = consumers.get(consumerId);
        if (!c) return;
        const tile = tiles.get(c.peerId);
        if (tile) tile.stream.removeTrack(c.consumer.track);
        c.consumer.close();
        consumers.delete(consumerId);
      };

      joined = true;
      els.preview.hidden = true;
      els.session.hidden = false;
      layoutGrid();
    } catch (err) {
      els.joinBtn.disabled = false;
      els.joinBtn.textContent = "Join session";
      showError(
        err.message === "session full"
          ? "This session is full (10 people max)."
          : "Couldn't join the session. Give it a moment and try again."
      );
      try { ws && ws.close(); } catch { /* ignore */ }
    }
  }

  function leaveToPreview(message) {
    joined = false;
    try { ws && ws.close(); } catch { /* ignore */ }
    for (const { consumer } of consumers.values()) consumer.close();
    consumers.clear();
    tiles.forEach((t) => t.el.remove());
    tiles.clear();
    sendTransport?.close(); recvTransport?.close();
    els.session.hidden = true;
    els.preview.hidden = false;
    els.joinBtn.disabled = false;
    els.joinBtn.textContent = "Join session";
    if (message) showError(message);
    initPreview();
  }

  // ---------- Controls ----------

  els.joinBtn.onclick = join;

  els.muteBtn.onclick = () => {
    if (!micProducer) return;
    const muting = !micProducer.paused;
    muting ? micProducer.pause() : micProducer.resume();
    micProducer.track.enabled = !muting;
    els.muteBtn.classList.toggle("off", muting);
    els.muteBtn.title = muting ? "Unmute microphone" : "Mute microphone";
  };

  els.camBtn.onclick = () => {
    if (!camProducer) return;
    const stopping = !camProducer.paused;
    stopping ? camProducer.pause() : camProducer.resume();
    camProducer.track.enabled = !stopping;
    els.camBtn.classList.toggle("off", stopping);
    els.camBtn.title = stopping ? "Turn camera on" : "Turn camera off";
  };

  els.leaveBtn.onclick = () => {
    stopPreview();
    leaveToPreview();
  };

  window.addEventListener("beforeunload", () => { try { ws && ws.close(); } catch { /* ignore */ } });

  initPreview();
})();
