// Watch page: HLS player plus the chat beside it. The page flips
// between live and offline by itself - the chat socket carries the
// stream state, so nobody ever needs to refresh.
(() => {
  const $ = (id) => document.getElementById(id);
  // The page's slug is a session id or a host's permanent channel name;
  // the status endpoint says which room actually carries the show
  const slug = location.pathname.split("/").filter(Boolean).pop();
  let roomId = null;
  const els = {
    title: $("showTitle"), badge: $("liveBadge"), viewers: $("viewerCount"),
    player: $("player"), offline: $("offline"),
    list: $("chatList"), joinBox: $("joinBox"), nameInput: $("nameInput"),
    joinBtn: $("joinBtn"), sendBox: $("sendBox"), msgInput: $("msgInput"),
    error: $("chatError")
  };

  // ---------- player ----------

  const src = () => `/live/${roomId}/media/live.m3u8`;
  let hls = null;
  let playing = false;

  function startPlayer() {
    if (playing) return;
    playing = true;
    els.offline.hidden = true;
    els.player.hidden = false;
    els.badge.hidden = false;
    if (els.player.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari plays HLS natively
      els.player.src = src();
    } else if (window.Hls && Hls.isSupported()) {
      hls = new Hls({ liveSyncDurationCount: 3, enableWorker: false });
      hls.loadSource(src());
      hls.attachMedia(els.player);
      hls.on(Hls.Events.ERROR, (_, data) => {
        // The playlist appears a few seconds after "live" flips on, so
        // early network errors just mean "try again shortly"
        if (data.fatal) {
          hls.destroy();
          hls = null;
          playing = false;
          if (liveNow) setTimeout(startPlayer, 3000);
          else stopPlayer();
        }
      });
    }
    els.player.muted = true; // autoplay policy: start muted, controls unmute
    els.player.play().catch(() => { /* the user presses play */ });
  }

  function stopPlayer() {
    playing = false;
    if (hls) { hls.destroy(); hls = null; }
    els.player.removeAttribute("src");
    els.player.hidden = true;
    els.badge.hidden = true;
    els.offline.hidden = false;
  }

  // ---------- chat ----------

  let ws = null;
  let isHost = false;
  let joined = false;
  let liveNow = false;
  let reconnectDelay = 1000;

  function note(text) {
    const d = document.createElement("div");
    d.className = "chat-note";
    d.textContent = text;
    els.list.appendChild(d);
    els.list.scrollTop = els.list.scrollHeight;
  }

  function showError(msg) {
    els.error.textContent = msg;
    els.error.hidden = false;
    clearTimeout(showError.t);
    showError.t = setTimeout(() => { els.error.hidden = true; }, 4000);
  }

  function addMessage(m) {
    const row = document.createElement("div");
    row.className = "chat-msg" + (m.host ? " host" : "");
    row.dataset.name = m.name.toLowerCase();
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = m.name;
    const text = document.createElement("span");
    text.textContent = m.text;
    row.append(who, text);
    // Hosts moderate right from the message: two clicks blocks the
    // person (name and address) and removes everything they said
    if (isHost && !m.host) {
      const block = document.createElement("button");
      block.className = "block";
      block.title = "Block this person";
      block.setAttribute("aria-label", `Block ${m.name}`);
      block.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>';
      block.onclick = () => {
        if (!block.classList.contains("confirm")) {
          block.classList.add("confirm");
          block.title = "Click again to block";
          setTimeout(() => { block.classList.remove("confirm"); block.title = "Block this person"; }, 4000);
          return;
        }
        request("block", { name: m.name }).catch((e) => showError(e.message));
      };
      row.appendChild(block);
    }
    els.list.appendChild(row);
    while (els.list.children.length > 200) els.list.firstChild.remove();
    els.list.scrollTop = els.list.scrollHeight;
  }

  let nextId = 1;
  const pending = new Map();
  function request(method, data) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== 1) return reject(new Error("Not connected."));
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, data }));
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error("No reply."));
      }, 10000);
    });
  }

  function setViewers(n) {
    els.viewers.hidden = n == null;
    if (n != null) els.viewers.textContent = n === 1 ? "1 watching" : `${n} watching`;
  }

  function connect() {
    if (!roomId) return; // channel page before its first show
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/chat?room=${roomId}`);

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.id) {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error));
        }
        return;
      }
      const { event, data } = msg;
      if (event === "hello") {
        reconnectDelay = 1000;
        isHost = data.isHost;
        liveNow = data.live;
        setViewers(data.viewers);
        els.list.innerHTML = "";
        for (const m of data.history || []) addMessage(m);
        data.live ? startPlayer() : stopPlayer();
      } else if (event === "message") {
        addMessage(data);
      } else if (event === "live") {
        liveNow = data.live;
        data.live ? startPlayer() : stopPlayer();
        note(data.live ? "The show is live." : "The show has ended.");
      } else if (event === "viewers") {
        setViewers(data.viewers);
      } else if (event === "blocked") {
        for (const el of els.list.querySelectorAll(`[data-name="${CSS.escape(data.name.toLowerCase())}"]`)) {
          el.remove();
        }
        setViewers(data.viewers);
      }
    };

    ws.onclose = (e) => {
      if (e.code === 4403) {
        els.joinBox.hidden = true;
        els.sendBox.hidden = true;
        note("You have been blocked from this chat.");
        return;
      }
      joined = false;
      els.sendBox.hidden = true;
      els.joinBox.hidden = false;
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(15000, reconnectDelay * 2);
    };
  }

  async function join() {
    const name = els.nameInput.value.trim();
    if (!name) return;
    try {
      await request("join", { name });
      joined = true;
      try { localStorage.setItem("fossstudio-chat-name", name); } catch { /* private browsing */ }
      els.joinBox.hidden = true;
      els.sendBox.hidden = false;
      els.msgInput.focus();
    } catch (err) {
      showError(err.message);
    }
  }
  els.joinBtn.onclick = join;
  els.nameInput.onkeydown = (e) => { if (e.key === "Enter") join(); };

  els.sendBox.onsubmit = async (e) => {
    e.preventDefault();
    const text = els.msgInput.value.trim();
    if (!text) return;
    try {
      await request("message", { text });
      els.msgInput.value = "";
    } catch (err) {
      showError(err.message);
    }
  };

  // ---------- boot ----------

  try {
    const saved = localStorage.getItem("fossstudio-chat-name");
    if (saved) els.nameInput.value = saved;
  } catch { /* private browsing */ }

  // The channel page has no room until a show is live, so it polls the
  // status until one appears, then joins that room's chat and player
  let polling = null;
  function applyStatus(s) {
    if (s.title) {
      els.title.textContent = s.title;
      document.title = `${s.title} - live`;
      $("offlineTitle").textContent = `${s.title} isn't live right now`;
    }
    liveNow = !!s.live;
    const room = s.roomId || null;
    if (room && room !== roomId) {
      roomId = room;
      connect();
    }
    if (s.live) {
      clearInterval(polling);
      polling = null;
      startPlayer();
    } else if (!polling && !ws) {
      polling = setInterval(() => {
        fetch(`/api/live/${slug}`).then((r) => r.json()).then(applyStatus).catch(() => {});
      }, 5000);
    }
  }
  fetch(`/api/live/${slug}`).then((r) => r.json()).then(applyStatus)
    .catch(() => { /* a later poll or the chat socket catches up */ });
})();
