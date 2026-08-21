// Watch page: HLS player plus the chat beside it. The page flips
// between live and offline by itself - the chat socket carries the
// stream state, so nobody ever needs to refresh.
(() => {
  const $ = (id) => document.getElementById(id);
  // The page's slug is a session id or a host's permanent channel name;
  // the status endpoint says which room actually carries the show. On a
  // host's custom channel domain the page sits at the root with no slug
  // at all - the server resolves the domain instead.
  const slug = location.pathname.split("/").filter(Boolean).pop();
  const statusUrl = slug ? `/api/live/${slug}` : "/api/live-here";
  let roomId = null;
  const els = {
    title: $("showTitle"), badge: $("liveBadge"), viewers: $("viewerCount"),
    player: $("player"), offline: $("offline"), chat: $("chatPanel"),
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
    // The chat exists while the show does; off air, the page is the
    // waiting room and the game has the floor
    els.chat.hidden = false;
    OffAir.stop();
    if (els.player.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari plays HLS natively
      els.player.src = src();
    } else if (window.Hls && Hls.isSupported()) {
      // Two one-second segments behind the newest: ~2-3s from studio
      // to audience instead of the ~7s the old 2s x 3 buffer cost
      hls = new Hls({ liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 6, enableWorker: false });
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
    els.chat.hidden = true;
    OffAir.start($("game"));
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

  // Host moderation lives in a right-click menu on the message (a
  // plain click opens it too, for touch screens): hide the one
  // message, or ban the person outright
  let chatMenu = null;
  function hideChatMenu() { if (chatMenu) { chatMenu.remove(); chatMenu = null; } }
  document.addEventListener("pointerdown", (e) => {
    if (chatMenu && !chatMenu.contains(e.target)) hideChatMenu();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideChatMenu(); });

  function openChatMenu(e, m) {
    e.preventDefault();
    hideChatMenu();
    chatMenu = document.createElement("div");
    chatMenu.className = "chat-menu";
    const mk = (label, cls, fn) => {
      const b = document.createElement("button");
      b.textContent = label;
      if (cls) b.className = cls;
      b.onclick = fn;
      chatMenu.appendChild(b);
      return b;
    };
    mk("Hide this message", "", () => {
      request("hide", { id: m.id }).catch((err) => showError(err.message));
      hideChatMenu();
    });
    if (!m.host) {
      const ban = mk(`Ban ${m.name}`, "danger", () => {
        if (!ban.classList.contains("confirm")) {
          ban.classList.add("confirm");
          ban.textContent = `Ban ${m.name} - click again`;
          return;
        }
        request("block", { name: m.name }).catch((err) => showError(err.message));
        hideChatMenu();
      });
    }
    document.body.appendChild(chatMenu);
    const mw = chatMenu.offsetWidth, mh = chatMenu.offsetHeight;
    chatMenu.style.left = `${Math.min(e.clientX, window.innerWidth - mw - 8)}px`;
    chatMenu.style.top = `${Math.min(e.clientY, window.innerHeight - mh - 8)}px`;
  }

  function addMessage(m) {
    const row = document.createElement("div");
    row.className = "chat-msg" + (m.host ? " host" : "");
    row.dataset.name = m.name.toLowerCase();
    row.dataset.id = m.id;
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = m.name;
    const text = document.createElement("span");
    text.textContent = m.text;
    row.append(who, text);
    if (isHost) {
      row.classList.add("moderatable");
      row.addEventListener("contextmenu", (e) => openChatMenu(e, m));
      row.addEventListener("click", (e) => openChatMenu(e, m));
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
      } else if (event === "hidden") {
        els.list.querySelector(`[data-id="${CSS.escape(data.id)}"]`)?.remove();
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
    // The show's own logo on the offline page, when one is uploaded;
    // the stock icon stays for everyone else
    if (s.logo && $("offlineLogo").hidden) {
      $("offlineLogo").onload = () => {
        $("offlineLogo").hidden = false;
        // an <svg> has no .hidden property - the attribute is the API
        $("offlineIcon").setAttribute("hidden", "");
      };
      $("offlineLogo").src = s.logo;
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
        fetch(statusUrl).then((r) => r.json()).then(applyStatus).catch(() => {});
      }, 5000);
    }
  }
  fetch(statusUrl).then((r) => r.json()).then(applyStatus)
    .catch(() => { /* a later poll or the chat socket catches up */ });
  OffAir.start($("game")); // the page opens off air; going live swaps it out
})();
