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
    spkSelect: $("spkSelect"), spkRow: $("spkRow"), spkTestBtn: $("spkTestBtn"),
    zoomSlider: $("zoomSlider"), zoomValue: $("zoomValue"), mirrorBtn: $("mirrorBtn"),
    nameInput: $("nameInput"), taglineInput: $("taglineInput"), joinBtn: $("joinBtn"),
    previewError: $("previewError"), micMeterFill: $("micMeterFill"),
    session: $("session"), banner: $("banner"), grid: $("grid"),
    muteBtn: $("muteBtn"), camBtn: $("camBtn"), leaveBtn: $("leaveBtn"),
    dimBtn: $("dimBtn"), handBtn: $("handBtn"), hostPanel: $("hostPanel"),
    hpAutoGain: $("hpAutoGain"), hpGuests: $("hpGuests"),
    hpRecordBtn: $("hpRecordBtn"), hpStreamBtn: $("hpStreamBtn"),
    hpServerRec: $("hpServerRec"), hpServerRecRow: $("hpServerRecRow"),
    hpMuteAllBtn: $("hpMuteAllBtn"), hpSubBtn: $("hpSubBtn"), hpAdBtn: $("hpAdBtn"),
    hpBannerSwatches: $("hpBannerSwatches"), hpBannerHex: $("hpBannerHex"),
    hpBannerMulti: $("hpBannerMulti"), hpBannerChoice: $("hpBannerChoice"),
    myColorBtn: $("myColorBtn"), myColorPop: $("myColorPop")
  };

  // Inline SVG control icons (house rule: no icon fonts, no emoji)
  const ICONS = {
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    micOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9v5a3 3 0 0 0 5.1 2.1M15 10V6a3 3 0 0 0-5.6-1.5M5 11a7 7 0 0 0 11 5.7M19 11a7 7 0 0 1-.9 3.4M12 18v3M4 4l16 16"/></svg>',
    cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="12" height="12" rx="3"/><path d="M15 11l6-3.5v9L15 13"/></svg>',
    camOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 11l6-3.5v9l-2.2-1.3M15 13v2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h1M11 6h1a3 3 0 0 1 3 3v1M4 4l16 16"/></svg>',
    palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3 3h-2a2 2 0 0 0-1.5 3.3c.4.5.5 1.2 0 1.7a2.6 2.6 0 0 1-2.5 1z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/><circle cx="17.5" cy="11.5" r="1"/></svg>',
    dim: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z"/></svg>',
    hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11V6a1.5 1.5 0 0 1 3 0v4V4.5a1.5 1.5 0 0 1 3 0V10V6a1.5 1.5 0 0 1 3 0v5.5l1.6-2.2a1.5 1.5 0 0 1 2.5 1.6L17.5 17a6 6 0 0 1-5.6 4H11a6 6 0 0 1-6-6v-4z"/></svg>',
    leave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M15 16l4-4-4-4M19 12H9"/></svg>'
  };
  for (const [id, icon] of [["muteBtn", "mic"], ["camBtn", "cam"], ["dimBtn", "dim"], ["leaveBtn", "leave"], ["myColorBtn", "palette"], ["handBtn", "hand"]]) {
    document.getElementById(id).innerHTML = ICONS[icon];
  }

  let previewStream = null;
  let audioCtx = null;
  // Noise suppression defaults on; only the host can flip it per guest.
  // The crash-loop breaker can force it off for one retry.
  let noisePref = "rnnoise";

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
        mirror: mirrored,
        name: els.nameInput.value.trim(),
        tagline: els.taglineInput.value.trim()
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

  // Applied noise-suppression state; the host can flip it remotely
  let appliedNoise = false;
  async function setNoiseProcessing(enabled) {
    if (!micProducer || enabled === appliedNoise) return;
    try {
      if (enabled) {
        if (noiseNode) {
          noiseNode.port.postMessage({ enabled: true });
        } else {
          const processed = await noiseProcessedTrack(previewStream.getAudioTracks()[0]);
          await micProducer.replaceTrack({ track: processed });
        }
      } else if (noiseNode) {
        noiseNode.port.postMessage({ enabled: false });
      }
      appliedNoise = enabled;
      window.__noiseApplied = enabled;
    } catch (err) {
      console.error("noise toggle failed:", err.message);
    }
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

  let mirrored = true;
  function applyMirror() {
    els.previewVideo.style.transform = mirrored ? "scaleX(-1)" : "none";
    const self = tiles.get(selfId);
    if (self) self.video.style.transform = mirrored ? "scaleX(-1)" : "none";
    els.mirrorBtn.classList.toggle("active", mirrored);
    els.mirrorBtn.setAttribute("aria-pressed", String(mirrored));
    els.mirrorBtn.dataset.tip = mirrored ? "Stop mirroring my preview" : "Mirror my preview";
  }
  els.mirrorBtn.onclick = () => { mirrored = !mirrored; applyMirror(); };

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
      // Show the devices actually in use (the system defaults) so the
      // dropdowns always start on the default camera and microphone
      const micId = previewStream?.getAudioTracks()[0]?.getSettings().deviceId;
      if (micId && [...els.micSelect.options].some((o) => o.value === micId)) {
        els.micSelect.value = micId;
      }
      const camId = previewStream?.getVideoTracks()[0]?.getSettings().deviceId;
      if (camId && [...els.camSelect.options].some((o) => o.value === camId)) {
        els.camSelect.value = camId;
      }
      // Bring back last time's choices where the devices still exist
      const prefs = loadPrefs();
      if (prefs.name && !els.nameInput.value) els.nameInput.value = prefs.name;
      if (prefs.tagline && !els.taglineInput.value) els.taglineInput.value = prefs.tagline;
      if (typeof prefs.mirror === "boolean") mirrored = prefs.mirror;
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
    document.title = theme.title ? `${theme.title} — live` : "FOSSStudio — live";
    els.banner.textContent = theme.title || "";
    const top = document.getElementById("sessionTop");
    top.textContent = theme.title || "";
    top.hidden = !theme.title;
    if (theme.wallpaper) {
      els.grid.style.backgroundImage = `url(${theme.wallpaper})`;
      els.session.classList.add("wallpapered");
    } else {
      els.grid.style.backgroundImage = "";
      els.session.classList.remove("wallpapered");
    }
  }

  function applyAutoGain(enabled) {
    const track = previewStream?.getAudioTracks()[0];
    if (track) track.applyConstraints({ autoGainControl: enabled }).catch(() => {});
  }

  // ---------- Tiles & audio routing ----------
  // Remote audio plays through a per-guest GainNode so the host's
  // volume sliders affect what everyone hears, including recordings.

  function makeTile(peerId, name, isSelf, tagline = "") {
    const el = document.createElement("div");
    el.className = "tile" + (isSelf ? " self" : "");
    el.dataset.peerId = peerId;
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // audio goes through the gain graph, not the element
    const third = document.createElement("div");
    third.className = "lower-third";
    const nameEl = document.createElement("div");
    nameEl.className = "name";
    nameEl.textContent = name;
    third.appendChild(nameEl);
    if (tagline) {
      const tagEl = document.createElement("div");
      tagEl.className = "tagline";
      tagEl.textContent = tagline;
      third.appendChild(tagEl);
    }
    el.append(video, third);
    els.grid.appendChild(el);
    const stream = new MediaStream();
    video.srcObject = stream;
    tiles.set(peerId, { el, video, stream, name, gain: null });
    applyLayout();
    if (isHost) renderHostGuests();
    scheduleBannerSnapshots();
    return tiles.get(peerId);
  }

  let masterDest = null;
  let outputEl = null;

  function audioSink() {
    const ctx = ensureAudioCtx();
    if (!masterDest) {
      masterDest = ctx.createMediaStreamDestination();
      outputEl = new Audio();
      outputEl.srcObject = masterDest.stream;
      outputEl.autoplay = true;
      if (sinkSupported && els.spkSelect.value) {
        outputEl.setSinkId(els.spkSelect.value).catch(() => {});
      }
      outputEl.play().catch(() => {});
    }
    return masterDest;
  }

  function attachAudio(peerId, track) {
    ensureAudioCtx();
    const tile = tiles.get(peerId);
    if (!tile) return;
    // Chrome quirk: a remote track must be attached to a media element
    // before WebAudio receives data — the muted tile <video> does that.
    tile.stream.addTrack(track);
    const src = audioCtx.createMediaStreamSource(new MediaStream([track]));
    const gain = audioCtx.createGain();
    gain.gain.value = control.volumes[peerId] ?? 1;
    src.connect(gain).connect(audioSink());
    tile.gain = gain;
    const an = audioCtx.createAnalyser();
    an.fftSize = 256;
    src.connect(an);
    tile.analyser = an;
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
  }
  matchMedia("(max-width: 700px)").addEventListener("change", applyLayout);

  const BANNER_COLOURS = [
    "#fbc711", "#f34236", "#e8207e", "#9b26ae",
    "#3d51b4", "#2295f1", "#019587", "#4bae4f"
  ];

  function sendBannerColor(c) {
    request("hostControl", { action: "bannerColor", color: c })
      .catch(() => {});
  }

  function renderBannerSwatches() {
    els.hpBannerSwatches.innerHTML = "";
    for (const hex of BANNER_COLOURS) {
      const b = document.createElement("button");
      b.className = "hp-swatch" + (!control.bannerMulti && hex === control.bannerColor ? " active" : "");
      b.style.background = hex;
      b.dataset.tip = hex;
      b.setAttribute("aria-label", `Banner colour ${hex}`);
      b.onclick = () => sendBannerColor(hex);
      els.hpBannerSwatches.appendChild(b);
    }
  }

  els.hpBannerMulti.onclick = () =>
    request("hostControl", { action: "bannerMulti" }).catch(() => {});
  els.hpBannerChoice.onclick = () =>
    request("hostControl", { action: "bannerChoice" }).catch(() => {});

  // ---------- Everyone's own colour picker (when the host allows) ----------

  function renderMyColors() {
    els.myColorPop.innerHTML = "";
    for (const hex of BANNER_COLOURS) {
      const b = document.createElement("button");
      b.className = "hp-swatch" + (control.bannerColors?.[selfId] === hex ? " active" : "");
      b.style.background = hex;
      b.setAttribute("aria-label", `My banner colour ${hex}`);
      b.onclick = () => {
        request("myBannerColor", { color: hex }).catch(() => {});
        els.myColorPop.hidden = true;
      };
      els.myColorPop.appendChild(b);
    }
  }
  els.myColorBtn.onclick = () => {
    els.myColorPop.hidden = !els.myColorPop.hidden;
    if (!els.myColorPop.hidden) renderMyColors();
  };

  els.hpBannerHex.onchange = () => {
    let v = els.hpBannerHex.value.trim();
    if (/^[0-9a-fA-F]{6}$/.test(v)) v = "#" + v;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) sendBannerColor(v.toLowerCase());
    else els.hpBannerHex.value = control.bannerColor || "";
  };

  function bannerFg(c) {
    const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#14161a" : "#ffffff";
  }

  function applyBannerColor() {
    const c = control.bannerColor || "#1e2127";
    els.grid.style.setProperty("--banner-c", c);
    els.grid.style.setProperty("--banner-fg", bannerFg(c));
    // Per-person colours override the shared one on each tile
    for (const [peerId, tile] of tiles) {
      const mine = control.bannerMulti ? control.bannerColors?.[peerId] : null;
      if (mine) {
        tile.el.style.setProperty("--banner-c", mine);
        tile.el.style.setProperty("--banner-fg", bannerFg(mine));
      } else {
        tile.el.style.removeProperty("--banner-c");
        tile.el.style.removeProperty("--banner-fg");
      }
    }
    if (isHost) {
      if (document.activeElement !== els.hpBannerHex) els.hpBannerHex.value = c;
      renderBannerSwatches();
      els.hpBannerMulti.classList.toggle("active", !!control.bannerMulti && !control.bannerChoice);
      els.hpBannerChoice.classList.toggle("active", !!control.bannerChoice);
    }
    const myHand = !!control.hands?.[selfId];
    els.handBtn.classList.toggle("hand-on", myHand);
    els.handBtn.dataset.tip = myHand ? "Lower my hand" : "I want to talk";
    els.myColorBtn.hidden = !control.bannerChoice;
    if (!control.bannerChoice) els.myColorPop.hidden = true;
    else if (!els.myColorPop.hidden) renderMyColors();
  }

  function applyControl(next) {
    control = next;
    applyBannerColor();
    for (const [peerId, tile] of tiles) {
      if (tile.gain) tile.gain.gain.value = control.volumes[peerId] ?? 1;
      tile.el.classList.toggle("muted", !!control.muted?.[peerId]);
    }
    if (micProducer && selfId) {
      const mine = !!control.muted?.[selfId];
      if (mine !== micProducer.paused) setMicMuted(mine);
      if (control.noise && selfId in control.noise) {
        setNoiseProcessing(!!control.noise[selfId]);
      }
    }
    applyAutoGain(!!control.autoGain);
    els.hpAutoGain.classList.toggle("active", !!control.autoGain);
    if (isHost) {
      // Light up "Mute all" (and offer the way back) once every guest is muted
      const others = [...tiles.keys()].filter((id) => id !== selfId);
      const allMuted = others.length > 0 && others.every((id) => control.muted?.[id]);
      els.hpMuteAllBtn.classList.toggle("active", allMuted);
      els.hpMuteAllBtn.textContent = allMuted ? "Unmute all" : "Mute all";
      els.hpMuteAllBtn.dataset.tip = allMuted
        ? "Unmute every guest at once" : "Mute every guest at once";
    }
    applyLayout();
    if (isHost) renderHostGuests();
    scheduleBannerSnapshots();
  }

  // ---------- Banner snapshots ----------
  // The recording/stream compositors run ffmpeg, which can't draw text,
  // so the host's browser renders each lower-third to a PNG (same font,
  // same colours as on screen) and the server overlays those.

  let bannerSnapTimer = null;
  function scheduleBannerSnapshots() {
    if (!isHost || (!recording && !live)) return;
    clearTimeout(bannerSnapTimer);
    bannerSnapTimer = setTimeout(() => sendBannerSnapshots().catch(() => {}), 600);
  }

  let lastBannerPayload = "";
  async function sendBannerSnapshots(force) {
    if (!isHost || (!force && !recording && !live)) return;
    await document.fonts.ready;
    const images = {};
    for (const [peerId, tile] of tiles) {
      const third = tile.el.querySelector(".lower-third");
      if (!third) continue;
      const cs = getComputedStyle(third);
      const name = third.querySelector(".name")?.textContent || tile.name;
      const tagline = third.querySelector(".tagline")?.textContent || "";
      images[peerId] = drawBannerPng(name, tagline, cs.backgroundColor, cs.color);
    }
    const titleText = els.banner.textContent.trim();
    const title = titleText ? drawTitlePng(titleText) : null;
    // Only send when something actually changed — while live, the server
    // relaunches the stream to pick banners up, which costs a short blip
    const payload = JSON.stringify([images, title]);
    if (payload === lastBannerPayload || !Object.keys(images).length) return;
    lastBannerPayload = payload;
    await request("bannerSnapshots", { images, title });
  }

  // The episode-title chip, drawn for a 1280-wide composite: the same
  // solid dark chip that floats over the grid on screen
  function drawTitlePng(text) {
    const c = document.createElement("canvas");
    const x = c.getContext("2d");
    const font = "700 40px Manrope, sans-serif";
    x.font = font;
    const padX = 44, H = 78, r = 16;
    const tw = Math.min(x.measureText(text).width, 1000);
    const W = Math.ceil(tw + 2 * padX);
    c.width = W; c.height = H;
    x.font = font; // canvas resize resets the context
    x.beginPath();
    x.roundRect(0, 0, W, H, r);
    x.fillStyle = "#1e2127";
    x.fill();
    x.strokeStyle = "rgba(255, 255, 255, 0.18)";
    x.lineWidth = 2;
    x.stroke();
    x.fillStyle = "#ffffff";
    x.textBaseline = "middle";
    x.fillText(ellipsize(x, text, W - 2 * padX), padX, H / 2 + 2);
    return c.toDataURL("image/png");
  }

  function ellipsize(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    return t + "…";
  }

  // Mirrors .lower-third: sizes are the CSS cqw values × S pixels each,
  // so the PNG scaled to 38% of a tile lands exactly like the DOM one
  function drawBannerPng(name, tagline, bg, fg) {
    const S = 20;
    const W = 38 * S;
    const padX = 2.4 * S, padT = 1.2 * S, padB = 1.4 * S, r = 1.5 * S;
    const nameLh = 4.6 * S * 1.3, tagLh = 2.9 * S * 1.3;
    const H = Math.round(padT + nameLh + (tagline ? tagLh : 0) + padB);
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    x.beginPath();
    x.moveTo(0, 0);
    x.lineTo(W - r, 0);
    x.arcTo(W, 0, W, r, r);
    x.lineTo(W, H);
    x.lineTo(0, H);
    x.closePath();
    x.fillStyle = bg;
    x.fill();
    x.fillStyle = fg;
    x.textBaseline = "middle";
    x.font = `700 ${4.6 * S}px Manrope, sans-serif`;
    x.fillText(ellipsize(x, name, W - 2 * padX), padX, padT + nameLh / 2);
    if (tagline) {
      x.globalAlpha = 0.82;
      x.font = `400 ${2.9 * S}px Manrope, sans-serif`;
      x.fillText(ellipsize(x, tagline, W - 2 * padX), padX, padT + nameLh + tagLh / 2);
      x.globalAlpha = 1;
    }
    return c.toDataURL("image/png");
  }

  // ---------- Host panel ----------

  function renderHostGuests() {
    els.hpGuests.innerHTML = "";
    // Self first, then everyone else
    const order = [...tiles.keys()].sort((a, b) => (a === selfId ? -1 : b === selfId ? 1 : 0));
    for (const peerId of order) {
      const tile = tiles.get(peerId);
      const isSelf = peerId === selfId;
      const row = document.createElement("div");
      row.className = "hp-guest";
      const vol = Math.round((control.volumes[peerId] ?? 1) * 100);
      const muted = !!control.muted?.[peerId];
      const nrOn = !!control.noise?.[peerId];
      const hand = !!control.hands?.[peerId];
      row.dataset.peerId = peerId;
      row.classList.toggle("hand", hand);
      row.innerHTML = `
        <div class="hp-name-line"></div>
        <div class="hp-btns">
          <button class="hp-btn nr${nrOn ? " active" : ""}" data-tip="${nrOn ? "Noise reduction is on — click to turn off" : "Noise reduction is OFF — click to turn on"}">NR</button>
          <button class="hp-btn mute">${muted ? "Unmute" : "Mute"}</button>
          <button class="hp-btn spot">Spot</button>
          ${hand ? '<button class="hp-btn lower" data-tip="Lower their hand">Lower</button>' : ""}
        </div>
        <div class="hp-meter"><div class="hp-meter-fill"></div></div>
        <input type="range" min="0" max="150" value="${vol}" aria-label="Volume">
        <span class="hp-vol">${vol}%</span>`;
      const nameLine = row.querySelector(".hp-name-line");
      const nameSpan = document.createElement("span");
      nameSpan.textContent = tile.name;
      nameLine.appendChild(nameSpan);
      if (isSelf) {
        const you = document.createElement("span");
        you.className = "you-ico";
        you.dataset.tip = "This is you";
        you.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
        nameLine.appendChild(you);
      }
      if (hand) {
        row.querySelector(".lower").onclick = () =>
          request("hostControl", { action: "lowerHand", peerId });
      }
      row.querySelector(".nr").onclick = () => {
        request("hostControl", { action: "noise", peerId, enabled: !nrOn });
      };
      const muteBtn = row.querySelector(".mute");
      muteBtn.classList.toggle("active", muted);
      muteBtn.onclick = () => {
        request("hostControl", { action: "mute", peerId, muted: !muted });
      };
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
      updateServerRecLock();
      if (on) scheduleBannerSnapshots();
    }
  }

  // The browser/server capture pipeline is picked when recording starts,
  // so the switch has to lock while recording or live.
  function updateServerRecLock() {
    if (!isHost || !els.hpServerRec) return;
    const locked = recording || live;
    els.hpServerRec.disabled = locked;
    els.hpServerRecRow.classList.toggle("locked", locked);
    if (locked) {
      els.hpServerRecRow.dataset.tip = "Can't change while recording or live";
    } else {
      els.hpServerRecRow.dataset.tip = "Record on the server this session (best for 2-3 guests)";
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

  // ---------- In-session overlay playback (subscribe / ad) ----------

  function playDomOverlay({ kind, duration, url }) {
    document.querySelectorAll(".live-overlay").forEach((el) => el.remove());
    const el = document.createElement("div");
    el.className = `live-overlay ${kind}`;
    if (kind === "subscribe") {
      el.innerHTML = `
        <div class="lo-btn">SUBSCRIBE</div>
        <div class="lo-bell"><svg viewBox="0 0 24 24" fill="none" stroke="#5f4c06" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg></div>
        <div class="lo-msg">
          <div class="lo-t">Enjoying The Show?</div>
          <div class="lo-s">Subscribe And Turn On <b>All Notifications</b></div>
        </div>`;
    } else {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "Sponsor banner";
      el.appendChild(img);
    }
    els.grid.appendChild(el);
    requestAnimationFrame(() => el.classList.add("in"));
    setTimeout(() => el.classList.remove("in"), (duration - 0.6) * 1000);
    setTimeout(() => el.remove(), duration * 1000);
  }

  // Panel sound meters: read each analyser ~8x a second
  const meterBuf = new Uint8Array(128);
  setInterval(() => {
    if (!isHost || els.hostPanel.hidden) return;
    for (const [peerId, tile] of tiles) {
      if (!tile.analyser) continue;
      tile.analyser.getByteTimeDomainData(meterBuf);
      let peak = 0;
      for (const v of meterBuf) peak = Math.max(peak, Math.abs(v - 128));
      const fill = els.hpGuests.querySelector(`[data-peer-id="${peerId}"] .hp-meter-fill`);
      if (fill) fill.style.width = `${Math.min(100, (peak / 128) * 260)}%`;
    }
  }, 120);

  els.handBtn.onclick = () => {
    const raised = !els.handBtn.classList.contains("hand-on");
    request("raiseHand", { raised }).catch(() => {});
  };

  els.dimBtn.onclick = () => {
    const on = document.body.classList.toggle("dim-ui");
    els.dimBtn.classList.toggle("dim-on", on);
    els.dimBtn.dataset.tip = on ? "Brighten the controls" : "Dim the controls";
  };
  els.hpSubBtn.onclick = () =>
    request("hostControl", { action: "overlay", kind: "subscribe" })
      .catch((e) => alert(e.message));
  els.hpAdBtn.onclick = () =>
    request("hostControl", { action: "overlay", kind: "ad" })
      .catch((e) => alert(e.message));
  els.hpMuteAllBtn.onclick = () =>
    request("hostControl", {
      action: "muteAll",
      muted: !els.hpMuteAllBtn.classList.contains("active")
    })
      .catch((e) => console.error("mute all failed:", e.message));
  els.hpAutoGain.onclick = () =>
    request("hostControl", {
      action: "autoGain",
      enabled: !els.hpAutoGain.classList.contains("active")
    });
  els.hpRecordBtn.onclick = () =>
    request("hostControl", {
      action: "record",
      start: !recording,
      mode: els.hpServerRec.checked ? "server" : "browser"
    }).catch((e) => console.error("record toggle failed:", e.message));

  let live = false;
  function setLiveIndicator(on) {
    live = on;
    els.banner.classList.toggle("live", on);
    els.hpStreamBtn.textContent = on ? "■ End stream" : "📡 Go live";
    els.hpStreamBtn.classList.toggle("rec-on", on);
    updateServerRecLock();
    if (on) scheduleBannerSnapshots();
  }
  els.hpStreamBtn.onclick = async () => {
    try {
      // Banners must reach the server before launch: the stream graph is
      // fixed at start, and a late arrival would force a relaunch blip
      if (!live) await sendBannerSnapshots(true).catch(() => {});
      await request("hostControl", { action: "stream", start: !live });
    } catch (e) { alert(e.message); }
  };

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

  const JOINING_KEY = "fossstudio-joining";

  async function join() {
    if (!els.nameInput.value.trim()) {
      showError("Add a banner title first — that's the big text under your video.");
      els.nameInput.focus();
      return;
    }
    els.joinBtn.disabled = true;
    els.joinBtn.textContent = "Joining…";
    try { localStorage.setItem(JOINING_KEY, noisePref); } catch { /* ignore */ }
    try {
      await connectWs();
      selfName = els.nameInput.value.trim() || "Guest";
      const info = await request("join", {
        name: selfName,
        tagline: els.taglineInput.value.trim(),
        noiseOn: noisePref === "rnnoise",
        role: wantHost ? "host" : "guest"
      });
      selfId = info.peerId;
      isHost = info.role === "host";
      applyControl(info.control);
      applyTheme(info.theme);
      els.hostPanel.hidden = !isHost; // sidebar is always open for the host
      els.hpServerRecRow.hidden = !(isHost && info.canServerRecord);

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
      let sendAudio = audioTrack;
      appliedNoise = false;
      if (noisePref === "rnnoise") {
        try {
          sendAudio = await noiseProcessedTrack(audioTrack);
          appliedNoise = true;
        } catch (err) {
          console.error("noise suppression unavailable:", err.message);
        }
      }
      window.__noiseApplied = appliedNoise;
      micProducer = await sendTransport.produce({ track: sendAudio, appData: { source: "mic" } });
      camProducer = await sendTransport.produce({
        track: videoTrack,
        encodings: [{ maxBitrate: 1_200_000 }],
        appData: { source: "camera" }
      });

      const selfTile = makeTile(selfId, selfName, true, els.taglineInput.value.trim());
      selfTile.stream.addTrack(videoTrack);
      if (isHost) {
        const ctx = ensureAudioCtx();
        const selfAn = ctx.createAnalyser();
        selfAn.fftSize = 256;
        ctx.createMediaStreamSource(new MediaStream([sendAudio])).connect(selfAn);
        selfTile.analyser = selfAn;
      }
      applyMirror();
      for (const p of info.peers) {
        makeTile(p.id, p.name, false, p.tagline);
        for (const prod of p.producers) await consumeProducer(p.id, prod.id);
      }

      eventHandlers.peerJoined = (p) => makeTile(p.id, p.name, false, p.tagline);
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
      eventHandlers.recordingStarted = ({ mode, upload }) => {
        if (mode === "browser" && upload) startSelfRecording(upload);
        else setRecIndicator(true);
      };
      eventHandlers.recordingStopped = () => {
        recorders.length ? stopSelfRecording() : setRecIndicator(false);
      };
      eventHandlers.streaming = ({ live: isLive }) => setLiveIndicator(isLive);
      eventHandlers.overlay = playDomOverlay;
      if (info.streaming) setLiveIndicator(true);

      joined = true;
      try { localStorage.removeItem(JOINING_KEY); } catch { /* ignore */ }
      els.preview.hidden = true;
      els.session.hidden = false;
      if (audioCtx?.state === "suspended") audioCtx.resume();
      applyLayout();
    } catch (err) {
      try { localStorage.removeItem(JOINING_KEY); } catch { /* ignore */ }
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
    if (outputEl) { outputEl.pause(); outputEl.srcObject = null; outputEl = null; }
    masterDest = null;
    els.session.hidden = true;
    els.hostPanel.hidden = true;
    document.body.classList.remove("dim-ui");
    els.dimBtn.classList.remove("dim-on");
    els.preview.hidden = false;
    els.joinBtn.disabled = false;
    els.joinBtn.textContent = "Join session";
    if (message) showError(message);
    initPreview();
  }

  // ---------- Controls ----------

  els.joinBtn.onclick = join;

  function setMicMuted(muted, { send = false } = {}) {
    if (!micProducer) return;
    muted ? micProducer.pause() : micProducer.resume();
    micProducer.track.enabled = !muted;
    els.muteBtn.classList.toggle("off", muted);
    els.muteBtn.innerHTML = muted ? ICONS.micOff : ICONS.mic;
    els.muteBtn.dataset.tip = muted ? "Unmute microphone" : "Mute microphone";
    if (send) request("selfMute", { muted }).catch(() => {});
  }

  els.muteBtn.onclick = () => {
    if (!micProducer) return;
    setMicMuted(!micProducer.paused, { send: true });
  };

  els.camBtn.onclick = () => {
    if (!camProducer) return;
    const stopping = !camProducer.paused;
    stopping ? camProducer.pause() : camProducer.resume();
    camProducer.track.enabled = !stopping;
    els.camBtn.classList.toggle("off", stopping);
    els.camBtn.innerHTML = stopping ? ICONS.camOff : ICONS.cam;
    els.camBtn.dataset.tip = stopping ? "Turn camera on" : "Turn camera off";
  };

  els.leaveBtn.onclick = () => {
    stopPreview();
    leaveToPreview();
  };

  window.addEventListener("beforeunload", () => { try { ws && ws.close(); } catch { /* ignore */ } });

  // House style: custom pill tooltips, never the browser's native ones
  for (const el of document.querySelectorAll("[title]")) {
    el.dataset.tip = el.getAttribute("title");
    el.removeAttribute("title");
  }

  try {
    if (localStorage.getItem(JOINING_KEY) === "rnnoise") {
      localStorage.removeItem(JOINING_KEY);
      noisePref = "off";
      showError("Your last join didn't finish, so noise suppression is switched off for this try.");
    }
  } catch { /* ignore */ }

  if ("serviceWorker" in navigator) {
    // Register AND force an update check: an old worker with a stale
    // cache must never keep serving yesterday's session code
    navigator.serviceWorker.register("/sw.js")
      .then((reg) => reg.update())
      .catch(() => {});
  }

  initPreview();
})();
