/* FOSS Studio session: preview -> join -> live grid.
   Guests and the host share this page; the host (dashboard login +
   ?as=host) additionally gets the control panel. */
(() => {
  "use strict";

  const roomId = location.pathname.split("/")[2];
  const wantHost = new URLSearchParams(location.search).get("as") === "host";
  const $ = (id) => document.getElementById(id);

  const els = {
    preview: $("preview"), previewVideo: $("previewVideo"),
    camSelect: $("camSelect"), micSelect: $("micSelect"),
    nameInput: $("nameInput"), joinBtn: $("joinBtn"),
    previewError: $("previewError"), micMeterFill: $("micMeterFill"),
    session: $("session"), banner: $("banner"), grid: $("grid"),
    muteBtn: $("muteBtn"), camBtn: $("camBtn"), leaveBtn: $("leaveBtn"),
    hostPanelBtn: $("hostPanelBtn"), hostPanel: $("hostPanel"),
    hpGridBtn: $("hpGridBtn"), hpSpotSelfBtn: $("hpSpotSelfBtn"),
    hpAutoGain: $("hpAutoGain"), hpGuests: $("hpGuests")
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
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws?room=${roomId}`);
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

  // ---------- Session state ----------

  let device, sendTransport, recvTransport;
  let micProducer, camProducer;
  let selfId = null;
  let selfName = "";
  let isHost = false;
  let joined = false;
  let control = { layout: "grid", spotlightPeerId: null, volumes: {} };
  const tiles = new Map();     // peerId -> {el, video, stream, name, gain}
  const consumers = new Map(); // consumerId -> {consumer, peerId}

  // ---------- Theme ----------

  function applyTheme(theme) {
    document.title = `${theme.podcastName} — live`;
    els.banner.textContent = theme.podcastName;
    document.documentElement.style.setProperty("--accent", theme.accent);
    els.banner.style.borderBottom = `2px solid ${theme.accent}`;
    if (theme.wallpaper) {
      els.grid.style.backgroundImage = `url(${theme.wallpaper})`;
      els.session.classList.add("wallpapered");
    } else {
      els.grid.style.backgroundImage = "";
      els.session.classList.remove("wallpapered");
    }
    els.hpAutoGain.checked = !!theme.autoGain;
    applyAutoGain(!!theme.autoGain);
  }

  function applyAutoGain(enabled) {
    const track = previewStream?.getAudioTracks()[0];
    if (track) track.applyConstraints({ autoGainControl: enabled }).catch(() => {});
  }

  // ---------- Tiles & audio routing ----------
  // Remote audio plays through a per-guest GainNode so the host's
  // volume sliders affect what everyone hears, including recordings.

  function makeTile(peerId, name, isSelf) {
    const el = document.createElement("div");
    el.className = "tile" + (isSelf ? " self" : "");
    el.dataset.peerId = peerId;
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // audio goes through the gain graph, not the element
    const nameEl = document.createElement("div");
    nameEl.className = "name";
    nameEl.textContent = name;
    el.append(video, nameEl);
    els.grid.appendChild(el);
    const stream = new MediaStream();
    video.srcObject = stream;
    tiles.set(peerId, { el, video, stream, name, gain: null });
    applyLayout();
    if (isHost) renderHostGuests();
    return tiles.get(peerId);
  }

  function attachAudio(peerId, track) {
    if (!audioCtx) audioCtx = new AudioContext();
    const tile = tiles.get(peerId);
    if (!tile) return;
    // Chrome quirk: a remote track must be attached to a media element
    // before WebAudio receives data — the muted tile <video> does that.
    tile.stream.addTrack(track);
    const src = audioCtx.createMediaStreamSource(new MediaStream([track]));
    const gain = audioCtx.createGain();
    gain.gain.value = control.volumes[peerId] ?? 1;
    src.connect(gain).connect(audioCtx.destination);
    tile.gain = gain;
  }

  function removeTile(peerId) {
    const tile = tiles.get(peerId);
    if (!tile) return;
    tile.el.remove();
    tiles.delete(peerId);
    if (control.spotlightPeerId === peerId) {
      control.layout = "grid";
      control.spotlightPeerId = null;
    }
    applyLayout();
    if (isHost) renderHostGuests();
  }

  function applyLayout() {
    const spot = control.layout === "spotlight" && tiles.has(control.spotlightPeerId);
    els.grid.classList.toggle("spotlight", spot);
    for (const [peerId, tile] of tiles) {
      tile.el.classList.toggle("featured", spot && peerId === control.spotlightPeerId);
    }
    if (!spot) {
      const mobile = matchMedia("(max-width: 700px)").matches;
      const n = mobile ? Math.max(1, tiles.size - 1) : Math.max(1, tiles.size);
      const cols = mobile ? (n > 1 ? 2 : 1) : Math.ceil(Math.sqrt(n));
      els.grid.style.setProperty("--cols", cols);
    }
    if (isHost) {
      els.hpGridBtn.classList.toggle("active", !spot);
      els.hpSpotSelfBtn.classList.toggle("active", spot && control.spotlightPeerId === selfId);
    }
  }
  matchMedia("(max-width: 700px)").addEventListener("change", applyLayout);

  function applyControl(next) {
    control = next;
    for (const [peerId, tile] of tiles) {
      if (tile.gain) tile.gain.gain.value = control.volumes[peerId] ?? 1;
    }
    applyLayout();
    if (isHost) renderHostGuests();
  }

  // ---------- Host panel ----------

  function renderHostGuests() {
    els.hpGuests.innerHTML = "";
    for (const [peerId, tile] of tiles) {
      if (peerId === selfId) continue;
      const row = document.createElement("div");
      row.className = "hp-guest";
      const vol = Math.round((control.volumes[peerId] ?? 1) * 100);
      row.innerHTML = `
        <div class="hp-name">
          <span></span>
          <button class="hp-btn spot">Spotlight</button>
        </div>
        <input type="range" min="0" max="150" value="${vol}" aria-label="Volume">
        <span class="hp-vol">${vol}%</span>`;
      row.querySelector("span").textContent = tile.name;
      const spotBtn = row.querySelector(".spot");
      spotBtn.classList.toggle(
        "active",
        control.layout === "spotlight" && control.spotlightPeerId === peerId
      );
      spotBtn.onclick = () => {
        const active = control.layout === "spotlight" && control.spotlightPeerId === peerId;
        request("hostControl", active
          ? { action: "layout", layout: "grid" }
          : { action: "layout", layout: "spotlight", peerId });
      };
      const slider = row.querySelector("input");
      const volLabel = row.querySelector(".hp-vol");
      let sendTimer = null;
      slider.oninput = () => {
        volLabel.textContent = `${slider.value}%`;
        clearTimeout(sendTimer);
        sendTimer = setTimeout(() => {
          request("hostControl", {
            action: "volume", peerId, volume: slider.value / 100
          });
        }, 120);
      };
      els.hpGuests.appendChild(row);
    }
    if (els.hpGuests.children.length === 0) {
      els.hpGuests.innerHTML = '<p class="hp-vol">No guests yet.</p>';
    }
  }

  els.hostPanelBtn.onclick = () => { els.hostPanel.hidden = !els.hostPanel.hidden; };
  els.hpGridBtn.onclick = () => request("hostControl", { action: "layout", layout: "grid" });
  els.hpSpotSelfBtn.onclick = () =>
    request("hostControl", { action: "layout", layout: "spotlight", peerId: selfId });
  els.hpAutoGain.onchange = () =>
    request("hostControl", { action: "autoGain", enabled: els.hpAutoGain.checked });

  // ---------- Consuming ----------

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
    if (kind === "audio") {
      attachAudio(peerId, consumer.track);
    } else {
      const tile = tiles.get(peerId);
      if (tile) tile.stream.addTrack(consumer.track);
    }
    await request("resumeConsumer", { consumerId });
  }

  function dropConsumer(consumerId) {
    const c = consumers.get(consumerId);
    if (!c) return;
    const tile = tiles.get(c.peerId);
    if (tile) tile.stream.removeTrack(c.consumer.track);
    c.consumer.close();
    consumers.delete(consumerId);
  }

  // ---------- Join / leave ----------

  async function join() {
    els.joinBtn.disabled = true;
    els.joinBtn.textContent = "Joining…";
    try {
      await connectWs();
      selfName = els.nameInput.value.trim() || "Guest";
      const info = await request("join", {
        name: selfName,
        role: wantHost ? "host" : "guest"
      });
      selfId = info.peerId;
      isHost = info.role === "host";
      control = info.control;
      applyTheme(info.theme);
      els.hostPanelBtn.hidden = !isHost;

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

      const audioTrack = previewStream.getAudioTracks()[0];
      const videoTrack = previewStream.getVideoTracks()[0];
      micProducer = await sendTransport.produce({ track: audioTrack, appData: { source: "mic" } });
      camProducer = await sendTransport.produce({
        track: videoTrack,
        encodings: [{ maxBitrate: 1_200_000 }],
        appData: { source: "camera" }
      });

      const selfTile = makeTile(selfId, selfName, true);
      selfTile.stream.addTrack(videoTrack);
      for (const p of info.peers) {
        makeTile(p.id, p.name, false);
        for (const prod of p.producers) await consumeProducer(p.id, prod.id);
      }

      eventHandlers.peerJoined = (p) => makeTile(p.id, p.name, false);
      eventHandlers.peerLeft = ({ peerId }) => removeTile(peerId);
      eventHandlers.newProducer = ({ peerId, producerId }) =>
        consumeProducer(peerId, producerId).catch(console.error);
      eventHandlers.producerClosed = ({ producerId }) => {
        for (const [cid, c] of consumers) {
          if (c.consumer.producerId === producerId) dropConsumer(cid);
        }
      };
      eventHandlers.consumerClosed = ({ consumerId }) => dropConsumer(consumerId);
      eventHandlers.control = (c) => applyControl(c);
      eventHandlers.autoGain = ({ enabled }) => {
        applyAutoGain(enabled);
        els.hpAutoGain.checked = enabled;
      };

      joined = true;
      els.preview.hidden = true;
      els.session.hidden = false;
      if (audioCtx?.state === "suspended") audioCtx.resume();
      applyLayout();
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
    els.hostPanel.hidden = true;
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
