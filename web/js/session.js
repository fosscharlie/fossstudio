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
    camSelect: $("camSelect"), micSelect: $("micSelect"), noiseSelect: $("noiseSelect"),
    spkSelect: $("spkSelect"), spkRow: $("spkRow"), spkTestBtn: $("spkTestBtn"),
    zoomSlider: $("zoomSlider"), zoomValue: $("zoomValue"), mirrorToggle: $("mirrorToggle"),
    nameInput: $("nameInput"), joinBtn: $("joinBtn"),
    previewError: $("previewError"), micMeterFill: $("micMeterFill"),
    session: $("session"), banner: $("banner"), grid: $("grid"),
    muteBtn: $("muteBtn"), camBtn: $("camBtn"), leaveBtn: $("leaveBtn"),
    hostPanelBtn: $("hostPanelBtn"), hostPanel: $("hostPanel"),
    hpGridBtn: $("hpGridBtn"), hpSpotSelfBtn: $("hpSpotSelfBtn"),
    hpAutoGain: $("hpAutoGain"), hpGuests: $("hpGuests"),
    hpRecordBtn: $("hpRecordBtn"), hpStreamBtn: $("hpStreamBtn")
  };

  let previewStream = null;
  let audioCtx = null;

  // ---------- Remembered choices ----------

  const PREFS_KEY = "fossstudio-prefs";
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
    catch { return {}; }
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        cam: els.camSelect.value,
        mic: els.micSelect.value,
        spk: els.spkSelect.value,
        noise: els.noiseSelect.value,
        mirror: els.mirrorToggle.checked,
        name: els.nameInput.value.trim()
      }));
    } catch { /* private browsing */ }
  }

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
    setupZoom();
  }

  // ---------- Camera zoom ----------
  // Real lens zoom when the camera supports it; otherwise a digital
  // crop-and-scale through a canvas, which everyone else sees too.

  const zoom = { hw: false, level: 1, canvas: null, canvasTrack: null, rawVideo: null, raf: 0 };

  function setupZoom() {
    stopDigitalZoom();
    zoom.level = 1;
    els.zoomSlider.value = 1;
    els.zoomValue.textContent = "1.0×";
    const track = previewStream?.getVideoTracks()[0];
    const caps = track?.getCapabilities?.() || {};
    zoom.hw = !!caps.zoom;
    if (zoom.hw) {
      els.zoomSlider.min = caps.zoom.min || 1;
      els.zoomSlider.max = caps.zoom.max || 3;
      els.zoomSlider.step = caps.zoom.step || 0.1;
      els.zoomSlider.value = track.getSettings().zoom || caps.zoom.min || 1;
    } else {
      els.zoomSlider.min = 1;
      els.zoomSlider.max = 3;
      els.zoomSlider.step = 0.1;
    }
  }

  function applyZoom() {
    const level = Number(els.zoomSlider.value);
    zoom.level = level;
    els.zoomValue.textContent = `${level.toFixed(1)}×`;
    const track = previewStream?.getVideoTracks()[0];
    if (!track) return;
    if (zoom.hw) {
      track.applyConstraints({ advanced: [{ zoom: level }] }).catch(() => {});
    } else if (level > 1.01) {
      startDigitalZoom();
    } else {
      stopDigitalZoom();
    }
  }
  els.zoomSlider.oninput = applyZoom;

  function startDigitalZoom() {
    if (zoom.canvas) return; // draw loop already running
    const raw = previewStream.getVideoTracks()[0];
    const { width = 1280, height = 720 } = raw.getSettings();
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([raw]);
    video.play().catch(() => {});
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx2d = canvas.getContext("2d");
    const draw = () => {
      if (!zoom.canvas) return;
      if (video.readyState >= 2) {
        const z = Math.max(1, zoom.level);
        const sw = video.videoWidth / z;
        const sh = video.videoHeight / z;
        ctx2d.drawImage(video,
          (video.videoWidth - sw) / 2, (video.videoHeight - sh) / 2, sw, sh,
          0, 0, canvas.width, canvas.height);
      }
      zoom.raf = requestAnimationFrame(draw);
    };
    zoom.canvas = canvas;
    zoom.rawVideo = video;
    zoom.canvasTrack = canvas.captureStream(30).getVideoTracks()[0];
    els.previewVideo.srcObject = new MediaStream([zoom.canvasTrack]);
    draw();
  }

  function stopDigitalZoom() {
    if (!zoom.canvas) return;
    cancelAnimationFrame(zoom.raf);
    zoom.canvasTrack?.stop();
    zoom.rawVideo?.remove();
    zoom.canvas = null;
    zoom.canvasTrack = null;
    zoom.rawVideo = null;
    if (previewStream) els.previewVideo.srcObject = previewStream;
  }

  // The track we actually send: canvas track when digitally zoomed
  function outgoingVideoTrack() {
    return zoom.canvasTrack || previewStream.getVideoTracks()[0];
  }

  // ---------- Speaker pick + test sound ----------

  const sinkSupported = "setSinkId" in HTMLMediaElement.prototype;
  if (!sinkSupported) els.spkRow.style.display = "none";

  els.spkTestBtn.onclick = async () => {
    const ctx = ensureAudioCtx();
    if (ctx.state === "suspended") await ctx.resume();
    const dest = ctx.createMediaStreamDestination();
    // A friendly two-note chime
    for (const [freq, at] of [[523.25, 0], [783.99, 0.35]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.6);
      osc.connect(gain).connect(dest);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.7);
    }
    const audio = new Audio();
    audio.srcObject = dest.stream;
    try { if (els.spkSelect.value) await audio.setSinkId(els.spkSelect.value); } catch { /* default */ }
    audio.play().catch(() => {});
    setTimeout(() => { audio.srcObject = null; }, 1500);
  };

  // ---------- Mirror ----------

  function applyMirror() {
    els.previewVideo.style.transform = els.mirrorToggle.checked ? "scaleX(-1)" : "none";
    const self = tiles.get(selfId);
    if (self) self.video.style.transform = els.mirrorToggle.checked ? "scaleX(-1)" : "none";
  }
  els.mirrorToggle.onchange = applyMirror;

  function stopPreview() {
    if (previewStream) {
      for (const t of previewStream.getTracks()) t.stop();
      previewStream = null;
    }
  }

  // RNNoise works on 10ms frames at 48kHz, so pin the context rate
  function ensureAudioCtx() {
    if (!audioCtx) audioCtx = new AudioContext({ sampleRate: 48000 });
    return audioCtx;
  }

  // Route the mic through the RNNoise worklet; returns the cleaned track
  let noiseNode = null;
  async function noiseProcessedTrack(rawTrack) {
    const ctx = ensureAudioCtx();
    if (!noiseNode) {
      await ctx.audioWorklet.addModule("/assets/noise-worklet.js");
    }
    const src = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
    noiseNode = new AudioWorkletNode(ctx, "rnnoise");
    const dest = ctx.createMediaStreamDestination();
    src.connect(noiseNode).connect(dest);
    return dest.stream.getAudioTracks()[0];
  }

  function startMicMeter(stream) {
    ensureAudioCtx();
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
    fill(els.spkSelect, "audiooutput", "Speaker");
  }

  async function initPreview() {
    try {
      await startPreview();          // ask permission first so labels appear
      await populateDevices();
      // Bring back last time's choices where the devices still exist
      const prefs = loadPrefs();
      if (prefs.name && !els.nameInput.value) els.nameInput.value = prefs.name;
      if (prefs.noise) els.noiseSelect.value = prefs.noise;
      if (typeof prefs.mirror === "boolean") els.mirrorToggle.checked = prefs.mirror;
      applyMirror();
      if (prefs.spk && [...els.spkSelect.options].some((o) => o.value === prefs.spk)) {
        els.spkSelect.value = prefs.spk;
      }
      const camBack = prefs.cam && [...els.camSelect.options].some((o) => o.value === prefs.cam);
      const micBack = prefs.mic && [...els.micSelect.options].some((o) => o.value === prefs.mic);
      if (camBack) els.camSelect.value = prefs.cam;
      if (micBack) els.micSelect.value = prefs.mic;
      if (camBack || micBack) await startPreview();
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

  // ---------- Recording (browser mode records self and uploads) ----------

  let recorders = [];
  let recUpload = null;
  let recording = false;

  function setRecIndicator(on) {
    recording = on;
    els.banner.classList.toggle("recording", on);
    if (isHost) {
      els.hpRecordBtn.textContent = on ? "■ Stop recording" : "● Start recording";
      els.hpRecordBtn.classList.toggle("rec-on", on);
    }
  }

  function startSelfRecording(upload) {
    recUpload = upload;
    const base = `/api/rec/chunk?rec=${encodeURIComponent(upload.recId)}&peer=${encodeURIComponent(upload.peerId)}&token=${encodeURIComponent(upload.token)}`;
    recorders = [];

    const startOne = (track, kind, mime, bitrate) => {
      if (!track) return;
      let type = mime.find((m) => MediaRecorder.isTypeSupported(m));
      if (!type) return;
      const recorder = new MediaRecorder(new MediaStream([track]), {
        mimeType: type,
        ...(bitrate ? { videoBitsPerSecond: bitrate } : {})
      });
      let seq = 0;
      let queue = Promise.resolve();
      recorder.ondataavailable = (e) => {
        if (!e.data.size) return;
        const n = seq++;
        // Chunks must land in order — chain the uploads
        queue = queue.then(() =>
          fetch(`${base}&kind=${kind}&seq=${n}`, { method: "POST", body: e.data })
        ).catch(() => {});
      };
      recorder.start(5000);
      recorders.push({ recorder, getQueue: () => queue });
    };

    // Audio: PCM when the browser can (true lossless), else opus
    startOne(micProducer?.track, "audio",
      ["audio/webm;codecs=pcm", "audio/webm;codecs=opus", "audio/webm"]);
    startOne(camProducer?.track, "video",
      ["video/webm;codecs=vp8", "video/webm"], 2_500_000);
    setRecIndicator(true);
  }

  async function stopSelfRecording() {
    const done = recorders.map(({ recorder, getQueue }) =>
      new Promise((resolve) => {
        recorder.onstop = () => resolve(getQueue());
        try { recorder.stop(); } catch { resolve(); }
      }).then(() => getQueue())
    );
    recorders = [];
    await Promise.all(done);
    if (recUpload) {
      const { recId, peerId, token } = recUpload;
      await fetch(`/api/rec/done?rec=${encodeURIComponent(recId)}&peer=${encodeURIComponent(peerId)}&token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
      recUpload = null;
    }
    setRecIndicator(false);
  }

  els.hostPanelBtn.onclick = () => { els.hostPanel.hidden = !els.hostPanel.hidden; };
  els.hpGridBtn.onclick = () => request("hostControl", { action: "layout", layout: "grid" });
  els.hpSpotSelfBtn.onclick = () =>
    request("hostControl", { action: "layout", layout: "spotlight", peerId: selfId });
  els.hpAutoGain.onchange = () =>
    request("hostControl", { action: "autoGain", enabled: els.hpAutoGain.checked });
  els.hpRecordBtn.onclick = () =>
    request("hostControl", { action: "record", start: !recording })
      .catch((e) => console.error("record toggle failed:", e.message));

  let live = false;
  function setLiveIndicator(on) {
    live = on;
    els.banner.classList.toggle("live", on);
    els.hpStreamBtn.textContent = on ? "■ End stream" : "📡 Go live";
    els.hpStreamBtn.classList.toggle("rec-on", on);
  }
  els.hpStreamBtn.onclick = () =>
    request("hostControl", { action: "stream", start: !live })
      .catch((e) => alert(e.message));

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

      savePrefs();
      const audioTrack = previewStream.getAudioTracks()[0];
      const videoTrack = outgoingVideoTrack();
      const sendAudio = els.noiseSelect.value === "rnnoise"
        ? await noiseProcessedTrack(audioTrack)
        : audioTrack;
      micProducer = await sendTransport.produce({ track: sendAudio, appData: { source: "mic" } });
      camProducer = await sendTransport.produce({
        track: videoTrack,
        encodings: [{ maxBitrate: 1_200_000 }],
        appData: { source: "camera" }
      });

      // Route everyone's audio to the chosen speaker where supported
      if (sinkSupported && els.spkSelect.value && audioCtx?.setSinkId) {
        audioCtx.setSinkId(els.spkSelect.value).catch(() => {});
      }

      const selfTile = makeTile(selfId, selfName, true);
      selfTile.stream.addTrack(videoTrack);
      applyMirror();
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
      eventHandlers.recordingStarted = ({ mode, upload }) => {
        if (mode === "browser" && upload) startSelfRecording(upload);
        else setRecIndicator(true);
      };
      eventHandlers.recordingStopped = () => {
        recorders.length ? stopSelfRecording() : setRecIndicator(false);
      };
      eventHandlers.streaming = ({ live: isLive }) => setLiveIndicator(isLive);
      if (info.streaming) setLiveIndicator(true);

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
    if (recorders.length) stopSelfRecording();
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

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");

  initPreview();
})();
