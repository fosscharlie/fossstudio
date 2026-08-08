/* FOSSStudio host dashboard: main menu -> sub-menu -> content. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  async function apiFetch(url, opts = {}) {
    const res = await fetch(url, {
      headers: opts.body && !(opts.body instanceof Blob)
        ? { "Content-Type": "application/json" } : undefined,
      ...opts
    });
    if (res.status === 401) { location.href = "/host/login.html"; throw new Error("logged out"); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  // ---------- navigation ----------

  // Admins manage hosts and the system; hosts run shows.
  const MENUS = [
    { id: "sessions", label: "Sessions", hostOnly: true, subs: [{ id: "sessions", label: "Your sessions" }] },
    { id: "recordings", label: "Recordings", hostOnly: true, subs: [
      { id: "library", label: "Library" }
    ] },
    { id: "media", label: "Effects", hostOnly: true, subs: [
      { id: "sounds", label: "Sounds" },
      { id: "intros", label: "Intros" }
    ] },
    { id: "users", label: "Hosts", adminOnly: true, subs: [{ id: "users", label: "Manage hosts" }] },
    { id: "settings", label: "Settings", subs: [
      { id: "themes", label: "Themes", hostOnly: true },
      { id: "banner", label: "Ad Banner", hostOnly: true },
      { id: "streaming", label: "Streaming", hostOnly: true },
      { id: "account", label: "Account" },
      { id: "twofactor", label: "Two-factor" }
    ] },
    { id: "system", label: "System", adminOnly: true, subs: [
      { id: "service", label: "Service" },
      { id: "email", label: "Email" },
      { id: "backups", label: "Backups" },
      { id: "logs", label: "Logs" }
    ] }
  ];

  let me = { role: "subadmin", username: "" };
  let currentMenu = null;

  function visibleMenus() {
    return MENUS.filter((m) =>
      !(m.adminOnly && me.role !== "admin") &&
      !(m.hostOnly && me.role === "admin"));
  }

  function visibleSubs(menu) {
    return menu.subs.filter((s) => !(s.hostOnly && me.role === "admin"));
  }

  function renderMainMenu() {
    const nav = $("mainMenu");
    nav.innerHTML = "";
    for (const menu of visibleMenus()) {
      const b = document.createElement("button");
      b.textContent = menu.label;
      b.classList.toggle("active", menu === currentMenu);
      b.onclick = () => { currentMenu = menu; renderMainMenu(); showSub(visibleSubs(menu)[0].id); };
      nav.appendChild(b);
    }
  }

  function showSub(subId) {
    const nav = $("subMenu");
    nav.innerHTML = "";
    for (const sub of visibleSubs(currentMenu)) {
      const b = document.createElement("button");
      b.textContent = sub.label;
      b.classList.toggle("active", sub.id === subId);
      b.onclick = () => showSub(sub.id);
      nav.appendChild(b);
    }
    document.querySelectorAll("section[id^=pane-]").forEach((s) => {
      s.hidden = s.id !== `pane-${subId}`;
    });
    // Remember the spot in the URL so a refresh comes back here
    history.replaceState(null, "", `#${currentMenu.id}/${subId}`);
  }

  // Restore #menu/sub from the URL; false if it doesn't point anywhere
  function applyHash() {
    const [m, sub] = location.hash.replace(/^#/, "").split("/");
    const menu = visibleMenus().find((x) => x.id === m);
    if (!menu) return false;
    currentMenu = menu;
    renderMainMenu();
    const subs = visibleSubs(menu);
    showSub((subs.find((x) => x.id === sub) || subs[0]).id);
    return true;
  }
  window.addEventListener("hashchange", applyHash);

  $("logoutBtn").onclick = async () => {
    await apiFetch("/api/logout", { method: "POST" });
    location.href = "/host/login.html";
  };

  // ---------- icons ----------

  const ICONS = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M21 3l-9 9M9 21H5a2 2 0 0 1-2-2V7"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="15" r="4"/><path d="M11 12L21 2M16 7l3 3"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a7.97 7.97 0 0 0 .1-3l2-1.2-2-3.4-2.2.7a8 8 0 0 0-2.6-1.5L14.3 4h-4l-.4 2.6a8 8 0 0 0-2.6 1.5l-2.2-.7-2 3.4 2 1.2a7.97 7.97 0 0 0 .1 3l-2 1.2 2 3.4 2.2-.7a8 8 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a8 8 0 0 0 2.6-1.5l2.2.7 2-3.4z"/></svg>',
    tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12l5 5L20 7"/></svg>'
  };

  function iconBtn(icon, label, onClick) {
    const b = document.createElement("button");
    b.className = "iconbtn";
    b.innerHTML = ICONS[icon];
    b.dataset.tip = label;
    b.setAttribute("aria-label", label);
    b.onclick = onClick;
    return b;
  }

  // Destructive actions confirm inline: first click shows a tick,
  // second click (within 4s) does it. No popups.
  function confirmBtn(icon, label, onConfirm) {
    const b = iconBtn(icon, label, () => {
      if (b.classList.contains("confirm")) { onConfirm(); return; }
      b.classList.add("confirm");
      b.innerHTML = ICONS.tick;
      b.dataset.tip = "Click again to confirm";
      setTimeout(() => {
        b.classList.remove("confirm");
        b.innerHTML = ICONS[icon];
        b.dataset.tip = label;
      }, 4000);
    });
    return b;
  }

  // ---------- sessions ----------

  async function loadSessions() {
    const list = $("sessionList");
    const sessions = await apiFetch("/api/sessions");
    list.innerHTML = "";
    if (sessions.length === 0) {
      list.innerHTML = '<p class="hint">No sessions yet — create one above and send the link to your guests.</p>';
      return;
    }
    for (const s of sessions) {
      const row = document.createElement("div");
      row.className = "session-row";
      const link = `${location.origin}/s/${s.id}`;
      row.innerHTML = `
        <div>
          <div class="title"></div>
          <div class="meta"></div>
        </div>
        <span class="badge" ${s.live ? "" : "hidden"}>● live · ${s.participants}</span>
        <span class="spacer"></span>`;
      row.querySelector(".title").textContent = s.title;
      row.querySelector(".meta").textContent =
        `${link} · created ${new Date(s.createdAt).toLocaleDateString()}`;

      const copy = iconBtn("copy", "Copy guest link", async () => {
        await navigator.clipboard.writeText(link);
        copy.classList.add("done");
        copy.innerHTML = ICONS.tick;
        setTimeout(() => { copy.classList.remove("done"); copy.innerHTML = ICONS.copy; }, 1500);
      });
      const open = iconBtn("open", "Open studio as host", () => {
        window.open(`/s/${s.id}?as=host`, "_blank");
      });
      const del = confirmBtn("del", "Delete session", async () => {
        await apiFetch(`/api/sessions/${s.id}`, { method: "DELETE" });
        loadSessions();
      });
      row.append(copy, open, del);
      list.appendChild(row);
    }
  }

  $("newSessionForm").onsubmit = async (e) => {
    e.preventDefault();
    await apiFetch("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ title: $("newSessionTitle").value })
    });
    $("newSessionTitle").value = "";
    loadSessions();
  };

  // ---------- users (admin) ----------

  async function loadUsers() {
    if (me.role !== "admin") return;
    const list = $("userList");
    const users = await apiFetch("/api/users");
    list.innerHTML = "";
    for (const u of users) {
      const row = document.createElement("div");
      row.className = "session-row";
      row.innerHTML = `
        <div>
          <div class="title"></div>
          <div class="meta">${u.role === "admin" ? "admin" : "host"}${u.totpEnabled ? " · 2FA on" : ""}${u.invited ? " · ⏳ invite pending" : ""}</div>
        </div>
        <span class="spacer"></span>`;
      row.querySelector(".title").textContent = u.username;
      const reset = iconBtn("key", "Set a new password for this user", async () => {
        const pw = prompt(`New password for ${u.username} (10+ characters):`);
        if (!pw) return;
        try {
          await apiFetch(`/api/users/${u.id}/password`, {
            method: "POST", body: JSON.stringify({ password: pw })
          });
          reset.classList.add("done");
          reset.innerHTML = ICONS.tick;
          setTimeout(() => { reset.classList.remove("done"); reset.innerHTML = ICONS.key; }, 1500);
        } catch (err) { showUserMsg(err.message); }
      });
      row.appendChild(reset);
      if (u.username !== me.username) {
        row.appendChild(confirmBtn("del", "Delete user", async () => {
          try {
            await apiFetch(`/api/users/${u.id}`, { method: "DELETE" });
            loadUsers();
          } catch (err) { showUserMsg(err.message); }
        }));
      }
      list.appendChild(row);
    }
  }

  function showUserMsg(text, ok = false) {
    const m = $("userMsg");
    m.className = `msg ${ok ? "ok" : "err"}`;
    m.textContent = text;
    m.hidden = false;
    setTimeout(() => { m.hidden = true; }, 6000);
  }

  $("newUserForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await apiFetch("/api/users/invite", {
        method: "POST",
        body: JSON.stringify({
          username: $("newUserName").value,
          email: $("newUserEmail").value
        })
      });
      $("newUserName").value = "";
      $("newUserEmail").value = "";
      if (r.emailed) {
        showUserMsg("✓ Invite emailed — they have 7 days to accept.", true);
      } else {
        await navigator.clipboard.writeText(r.inviteUrl).catch(() => {});
        showUserMsg("Email isn't set up, so the invite link was copied to your clipboard instead — send it to them yourself.", true);
      }
      loadUsers();
    } catch (err) { showUserMsg(err.message); }
  };

  $("newUserPwForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await apiFetch("/api/users", {
        method: "POST",
        body: JSON.stringify({
          username: $("pwUserName").value,
          password: $("pwUserPass").value
        })
      });
      $("pwUserName").value = "";
      $("pwUserPass").value = "";
      loadUsers();
    } catch (err) { showUserMsg(err.message); }
  };

  // ---------- SMTP (admin) ----------

  const smtpMsg = (text, ok = true) => {
    const m = $("smtpMsg");
    m.className = `msg ${ok ? "ok" : "err"}`;
    m.textContent = text;
    m.hidden = false;
    setTimeout(() => { m.hidden = true; }, 5000);
  };

  async function loadSmtp() {
    if (me.role !== "admin") return;
    const s = await apiFetch("/api/smtp");
    $("smtpHost").value = s.host || "";
    $("smtpPort").value = s.port || 587;
    $("smtpUser").value = s.user || "";
    $("smtpFrom").value = s.from || "";
    $("smtpAlertTo").value = s.alertTo || "";
    $("smtpPassHint").textContent = s.hasPass ? "(saved — leave blank to keep)" : "";
  }

  $("saveSmtpBtn").onclick = async () => {
    await apiFetch("/api/smtp", {
      method: "PUT",
      body: JSON.stringify({
        host: $("smtpHost").value,
        port: Number($("smtpPort").value),
        user: $("smtpUser").value,
        pass: $("smtpPass").value || undefined,
        from: $("smtpFrom").value,
        alertTo: $("smtpAlertTo").value
      })
    });
    $("smtpPass").value = "";
    smtpMsg("✓ Saved");
    loadSmtp();
  };

  $("testSmtpBtn").onclick = async () => {
    try {
      const { to } = await apiFetch("/api/smtp/test", { method: "POST" });
      smtpMsg(`✓ Test email sent to ${to} — check the inbox.`);
    } catch (err) {
      smtpMsg(err.message, false);
    }
  };

  // ---------- recordings ----------

  // Ready recordings need no badge (their files are right there); the
  // rest show a small icon with a tooltip rather than a word
  function setStatusBadge(badge, status) {
    badge.className = "badge";
    badge.textContent = "";
    badge.removeAttribute("data-tip");
    if (status === "ready") { badge.hidden = true; return; }
    badge.hidden = false;
    if (status === "processing") {
      badge.classList.add("status-icon");
      badge.dataset.tip = "Processing";
      badge.innerHTML = '<span class="proc-spinner" aria-label="Processing"></span>';
    } else if (status === "recording") {
      badge.classList.add("status-icon");
      badge.dataset.tip = "Recording now";
      badge.innerHTML = '<span class="rec-live" aria-label="Recording now"></span>';
    } else if (status === "failed") {
      badge.classList.add("status-icon", "status-fail");
      badge.dataset.tip = "Processing failed — the raw files are kept";
      badge.textContent = "!";
    }
  }

  async function loadRecordings() {
    const list = $("recordingList");
    const recs = await apiFetch("/api/recordings");
    list.innerHTML = "";
    if (recs.length === 0) {
      list.innerHTML = '<p class="hint">Nothing recorded yet. Start one from the host controls inside a session.</p>';
      return;
    }
    for (const r of recs) {
      const row = document.createElement("div");
      row.className = "session-row";
      const when = new Date(r.startedAt).toLocaleString();
      const mins = r.endedAt ? Math.max(1, Math.round((r.endedAt - r.startedAt) / 60000)) : null;
      row.innerHTML = `
        <div>
          <div class="title"></div>
          <div class="meta"></div>
          <div class="files"></div>
        </div>
        <span class="badge"></span>
        <span class="spacer"></span>`;
      row.querySelector(".title").textContent = r.title || `Session ${r.roomId}`;
      row.querySelector(".meta").textContent =
        `${when}${mins ? ` · ${mins} min` : ""} · ${r.mode === "server" ? "server-side" : "browser-side"}`;
      setStatusBadge(row.querySelector(".badge"), r.status);
      const filesEl = row.querySelector(".files");
      for (const f of r.files || []) {
        const url = `/api/recordings/${encodeURIComponent(r.id)}/files/${encodeURIComponent(f)}`;
        const isVideo = /\.(mp4|webm|mkv|mov)$/i.test(f);
        const isAudio = /\.(flac|wav|mp3|ogg|m4a|aac)$/i.test(f);
        const fileRow = document.createElement("div");
        fileRow.className = "rec-file";
        const fname = document.createElement("span");
        fname.className = "rec-fname";
        fname.textContent = f;
        fileRow.appendChild(fname);
        if (isVideo) fileRow.appendChild(videoToggleButton(url));
        else if (isAudio) fileRow.appendChild(audioToggleButton(url));
        fileRow.appendChild(downloadLink(url));
        filesEl.appendChild(fileRow);
      }
      row.appendChild(confirmBtn("del", "Delete recording and its files", async () => {
        await apiFetch(`/api/recordings/${encodeURIComponent(r.id)}`, { method: "DELETE" });
        loadRecordings();
      }));
      list.appendChild(row);
    }
  }

  $("saveStreamBtn").onclick = async () => {
    await apiFetch("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        streamUrl: $("streamUrl").value.trim() || "rtmp://a.rtmp.youtube.com/live2",
        streamKey: $("streamKey").value.trim()
      })
    });
    $("streamMsg").hidden = false;
    setTimeout(() => { $("streamMsg").hidden = true; }, 2000);
  };

  // ---------- theme ----------

  const PALETTE = [
    "#fbc711", "#f34236", "#e8207e", "#9b26ae", "#6639ab", "#3d51b4",
    "#2295f1", "#03a8f3", "#00bcd3", "#019587", "#4bae4f", "#8ac248",
    "#cbdc38", "#ffc006", "#fe9700", "#ff5721", "#795649",
    "#9e9d9e", "#607c8b"
  ];

  let currentBg = null;
  function renderBgSwatches() {
    const wrap = $("bgSwatches");
    wrap.innerHTML = "";
    for (const hex of PALETTE) {
      const b = document.createElement("button");
      b.className = "swatch" + (hex === currentBg ? " active" : "");
      b.style.background = hex;
      b.dataset.tip = hex;
      b.setAttribute("aria-label", `Background ${hex}`);
      b.onclick = () => saveBg(hex);
      wrap.appendChild(b);
    }
  }
  async function saveBg(hex) {
    currentBg = hex;
    renderBgSwatches();
    if (document.activeElement !== $("bgHex")) $("bgHex").value = hex || "";
    await apiFetch("/api/settings", { method: "PUT", body: JSON.stringify({ bg: hex }) });
    $("bgMsg").hidden = false;
    clearTimeout(saveBg.timer);
    saveBg.timer = setTimeout(() => { $("bgMsg").hidden = true; }, 2000);
  }
  $("bgHex").onchange = () => {
    let v = $("bgHex").value.trim();
    if (/^[0-9a-fA-F]{6}$/.test(v)) v = `#${v}`;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) saveBg(v.toLowerCase());
  };

  async function loadSettings() {
    const s = await apiFetch("/api/settings");
    $("streamUrl").value = s.streamUrl || "";
    $("streamKey").value = s.streamKey || "";
    currentBg = s.bg || null;
    renderBgSwatches();
    $("bgHex").value = currentBg || "";
    updateWallpaperPreview(s.wallpaper);
    updateLogoPreview(!!s.logo);
    updateAdPreview(!!s.adBanner);
  }

  function updateWallpaperPreview(name) {
    const el = $("wallpaperPreview");
    if (name) {
      el.style.backgroundImage = `url(/api/wallpaper?${Date.now()})`;
      el.textContent = "";
    } else {
      el.style.backgroundImage = "";
      el.textContent = "No wallpaper set";
    }
  }


  function updateAdPreview(has) {
    const el = $("adPreview");
    if (has) {
      el.style.backgroundImage = `url(/api/adbanner?${Date.now()})`;
      el.textContent = "";
    } else {
      el.style.backgroundImage = "";
      el.textContent = "No banner uploaded";
    }
  }
  $("adPick").onclick = () => $("adFile").click();
  $("adFile").onchange = async () => {
    const file = $("adFile").files[0];
    if (!file) return;
    await fetch("/api/adbanner", {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file
    }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).error); });
    updateAdPreview(true);
  };
  $("adRemove").onclick = async () => {
    await apiFetch("/api/adbanner", { method: "DELETE" });
    updateAdPreview(false);
  };

  // ---------- soundboard clips ----------
  let pendingSound = null;
  function renderSounds(list) {
    $("soundCount").textContent = list.length ? `(${list.length}/20)` : "";
    const box = $("soundList");
    if (!list.length) { box.textContent = "No sounds uploaded yet."; return; }
    box.textContent = "";
    for (const clip of list) {
      const row = document.createElement("div");
      row.className = "sound-row";
      const name = document.createElement("span");
      name.className = "sound-name";
      name.textContent = clip.name;
      const play = audioToggleButton(`/api/sounds/${me.uid}/${clip.id}`);
      const del = document.createElement("button");
      del.className = "btn small danger";
      del.textContent = "Remove";
      del.onclick = async () => { play.stopPreview(); await apiFetch(`/api/sounds/${clip.id}`, { method: "DELETE" }); loadSounds(); };
      row.append(name, play, del);
      box.appendChild(row);
    }
  }
  async function loadSounds() {
    renderSounds(await apiFetch("/api/sounds").catch(() => []));
  }
  $("soundPick").onclick = () => $("soundFile").click();
  $("soundFile").onchange = () => {
    pendingSound = $("soundFile").files[0] || null;
    $("soundFileName").textContent = pendingSound ? pendingSound.name : "";
    if (pendingSound && !$("soundName").value.trim()) {
      $("soundName").value = pendingSound.name.replace(/\.[^.]+$/, "").slice(0, 40);
    }
    $("soundAdd").disabled = !pendingSound;
  };
  $("soundAdd").onclick = async () => {
    if (!pendingSound) return;
    $("soundMsg").hidden = true; $("soundErr").hidden = true;
    const name = $("soundName").value.trim() || pendingSound.name;
    try {
      const res = await fetch(`/api/sounds?name=${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "Content-Type": pendingSound.type || "audio/mpeg" },
        body: pendingSound
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Upload failed.");
      $("soundMsg").hidden = false;
      $("soundName").value = ""; $("soundFileName").textContent = "";
      $("soundFile").value = ""; pendingSound = null; $("soundAdd").disabled = true;
      loadSounds();
    } catch (err) {
      $("soundErr").textContent = err.message; $("soundErr").hidden = false;
    }
  };

  // ---------- video preview modal (intros) ----------
  let videoModalOnClose = null;
  function openVideoModal(url, onClose) {
    closeVideoModal();              // revert any button already showing a preview
    videoModalOnClose = onClose || null;
    const v = $("videoModalPlayer");
    v.src = url;
    $("videoModal").hidden = false;
    v.play().catch(() => {});
  }
  function closeVideoModal() {
    if ($("videoModal").hidden) return;
    $("videoModal").hidden = true;
    const v = $("videoModalPlayer");
    try { v.pause(); v.removeAttribute("src"); v.load(); } catch { /* ignore */ }
    const cb = videoModalOnClose; videoModalOnClose = null;
    if (cb) cb();
  }
  $("videoModalClose").onclick = closeVideoModal;
  $("videoModalBackdrop").onclick = closeVideoModal;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeVideoModal(); });

  // ---------- preview controls (icons + tooltips) ----------
  const ICO = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 11l4 4 4-4M5 20h14"/></svg>'
  };
  function iconState(btn, icon, tip) {
    btn.innerHTML = ICO[icon];
    btn.dataset.tip = tip;
    btn.setAttribute("aria-label", tip);
  }

  // One button that toggles audio in place — no separate stop, no reflow
  function audioToggleButton(url) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "iconbtn";
    let audio = null;
    const toPlay = () => { audio = null; iconState(btn, "play", "Play"); };
    iconState(btn, "play", "Play");
    btn.stopPreview = () => { if (audio) audio.pause(); toPlay(); };
    btn.onclick = () => {
      if (audio) { audio.pause(); toPlay(); return; }
      audio = new Audio(url);
      iconState(btn, "stop", "Stop");
      audio.onended = toPlay;
      audio.onerror = toPlay;
      audio.play().catch(toPlay);
    };
    return btn;
  }

  // One button that toggles the video modal in place
  function videoToggleButton(url) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "iconbtn";
    let active = false;
    iconState(btn, "play", "Play");
    btn.onclick = () => {
      if (active) { closeVideoModal(); return; }
      active = true;
      iconState(btn, "stop", "Close preview");
      openVideoModal(url, () => { active = false; iconState(btn, "play", "Play"); });
    };
    return btn;
  }

  function downloadLink(url) {
    const a = document.createElement("a");
    a.className = "iconbtn";
    a.href = url;
    a.setAttribute("download", "");
    a.dataset.tip = "Download";
    a.setAttribute("aria-label", "Download");
    a.innerHTML = ICO.download;
    return a;
  }

  // ---------- intro videos ----------
  let pendingIntro = null;
  function renderIntros(list) {
    $("introCount").textContent = list.length ? `(${list.length}/5)` : "";
    const box = $("introList");
    if (!list.length) { box.textContent = "No intros uploaded yet."; return; }
    box.textContent = "";
    for (const clip of list) {
      const row = document.createElement("div");
      row.className = "sound-row";
      const name = document.createElement("span");
      name.className = "sound-name";
      name.textContent = clip.name + (clip.durationMs ? ` · ${(clip.durationMs / 1000).toFixed(1)}s` : "");
      const play = videoToggleButton(`/api/intros/${me.uid}/${clip.id}`);
      const del = document.createElement("button");
      del.className = "btn small danger";
      del.textContent = "Remove";
      del.onclick = async () => { await apiFetch(`/api/intros/${clip.id}`, { method: "DELETE" }); loadIntros(); };
      row.append(name, play, del);
      box.appendChild(row);
    }
  }
  async function loadIntros() {
    renderIntros(await apiFetch("/api/intros").catch(() => []));
  }
  $("introPick").onclick = () => $("introFile").click();
  $("introFile").onchange = () => {
    pendingIntro = $("introFile").files[0] || null;
    $("introFileName").textContent = pendingIntro ? pendingIntro.name : "";
    if (pendingIntro && !$("introName").value.trim()) {
      $("introName").value = pendingIntro.name.replace(/\.[^.]+$/, "").slice(0, 40);
    }
    $("introAdd").disabled = !pendingIntro;
  };
  $("introAdd").onclick = async () => {
    if (!pendingIntro) return;
    $("introMsg").hidden = true; $("introErr").hidden = true;
    $("introAdd").disabled = true; $("introAdd").textContent = "Uploading…";
    const name = $("introName").value.trim() || pendingIntro.name;
    try {
      const res = await fetch(`/api/intros?name=${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "Content-Type": pendingIntro.type || "video/mp4" },
        body: pendingIntro
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Upload failed.");
      $("introMsg").hidden = false;
      $("introName").value = ""; $("introFileName").textContent = "";
      $("introFile").value = ""; pendingIntro = null;
      loadIntros();
    } catch (err) {
      $("introErr").textContent = err.message; $("introErr").hidden = false;
    } finally {
      $("introAdd").textContent = "Add intro";
    }
  };

  function updateLogoPreview(has) {
    const el = $("logoPreview");
    if (has) {
      el.style.backgroundImage = `url(/api/logo?${Date.now()})`;
      el.textContent = "";
    } else {
      el.style.backgroundImage = "";
      el.textContent = "No logo uploaded";
    }
  }
  $("logoPick").onclick = () => $("logoFile").click();
  $("logoFile").onchange = async () => {
    const file = $("logoFile").files[0];
    if (!file) return;
    await fetch("/api/logo", { method: "POST", headers: { "Content-Type": file.type }, body: file });
    updateLogoPreview(true);
  };
  $("logoRemove").onclick = async () => {
    await apiFetch("/api/logo", { method: "DELETE" });
    updateLogoPreview(false);
  };

  $("wallpaperPick").onclick = () => $("wallpaperFile").click();
  $("wallpaperFile").onchange = async () => {
    const file = $("wallpaperFile").files[0];
    if (!file) return;
    await fetch("/api/wallpaper", {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file
    }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).error); });
    updateWallpaperPreview("yes");
  };
  $("wallpaperRemove").onclick = async () => {
    await apiFetch("/api/wallpaper", { method: "DELETE" });
    updateWallpaperPreview(null);
  };

  // ---------- security ----------

  $("savePasswordBtn").onclick = async () => {
    const msg = $("passwordMsg");
    msg.hidden = true;
    try {
      await apiFetch("/api/password", {
        method: "POST",
        body: JSON.stringify({ password: $("newPassword").value })
      });
      msg.className = "msg ok";
      msg.textContent = "✓ Password changed";
      $("newPassword").value = "";
    } catch (err) {
      msg.className = "msg err";
      msg.textContent = err.message;
    }
    msg.hidden = false;
  };

  async function load2fa() {
    const { enabled } = await apiFetch("/api/2fa");
    $("tfaOff").hidden = enabled;
    $("tfaOn").hidden = !enabled;
    $("tfaSetup").hidden = true;
  }

  $("tfaSetupBtn").onclick = async () => {
    const { secret } = await apiFetch("/api/2fa/setup", { method: "POST" });
    $("tfaSecret").textContent = secret;
    $("tfaOff").hidden = true;
    $("tfaSetup").hidden = false;
  };
  $("tfaEnableBtn").onclick = async () => {
    const msg = $("tfaMsg");
    msg.hidden = true;
    try {
      await apiFetch("/api/2fa/enable", {
        method: "POST",
        body: JSON.stringify({ code: $("tfaCode").value })
      });
      load2fa();
    } catch (err) { msg.textContent = err.message; msg.hidden = false; }
  };
  $("tfaDisableBtn").onclick = async () => {
    const msg = $("tfaMsg");
    msg.hidden = true;
    try {
      await apiFetch("/api/2fa/disable", {
        method: "POST",
        body: JSON.stringify({ code: $("tfaDisableCode").value })
      });
      load2fa();
    } catch (err) { msg.textContent = err.message; msg.hidden = false; }
  };

  // ---------- system (admin) ----------

  const sysMsg = (text, ok = true) => {
    const m = $("systemMsg");
    m.className = `msg ${ok ? "ok" : "err"}`;
    m.textContent = text;
    m.hidden = false;
    setTimeout(() => { m.hidden = true; }, 4000);
  };

  $("restartBtn").onclick = async () => {
    await apiFetch("/api/ops/restart", { method: "POST" });
    sysMsg("Restarting — back in a few seconds…");
    setTimeout(() => location.reload(), 6000);
  };

  $("backupNowBtn").onclick = async () => {
    const { name } = await apiFetch("/api/ops/backup", { method: "POST" });
    loadBackups();
  };

  async function loadBackups() {
    if (me.role !== "admin") return;
    const list = $("backupList");
    const backups = await apiFetch("/api/ops/backups");
    list.innerHTML = backups.length ? "" : '<p class="hint">No backups yet.</p>';
    for (const b of backups) {
      const row = document.createElement("div");
      row.className = "session-row";
      row.innerHTML = `<div><div class="title" style="font-size:0.85rem"></div>
        <div class="meta">${(b.size / 1024).toFixed(0)} KB</div></div><span class="spacer"></span>`;
      row.querySelector(".title").textContent = b.name;
      const dl = iconBtn("open", "Download backup", () => {
        location.href = `/api/ops/backups/${encodeURIComponent(b.name)}`;
      });
      const restore = confirmBtn("copy", "Restore this backup", async () => {
        await apiFetch("/api/ops/restore", { method: "POST", body: JSON.stringify({ name: b.name }) });
      });
      row.append(dl, restore);
      list.appendChild(row);
    }
  }

  $("refreshLogsBtn").onclick = loadLogs;
  async function loadLogs() {
    if (me.role !== "admin") return;
    const { lines } = await apiFetch("/api/ops/logs");
    $("logBox").textContent = lines.slice(-200).join("\n") || "No log lines yet.";
    $("logBox").scrollTop = $("logBox").scrollHeight;
  }

  // ---------- push notifications ----------

  $("pushBtn").onclick = async () => {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return sysMsg("Notifications were blocked in the browser.", false);
      const reg = await navigator.serviceWorker.ready;
      const { key } = await apiFetch("/api/push/key");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key
      });
      await apiFetch("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub) });
      sysMsg("✓ You'll get a notification when a guest arrives or a recording is ready.");
    } catch {
      sysMsg("Couldn't enable notifications on this browser.", false);
    }
  };

  if ("serviceWorker" in navigator) {
    // Register AND force an update check, so a stale worker can't pin
    // old dashboard code
    navigator.serviceWorker.register("/sw.js")
      .then((reg) => reg.update())
      .catch(() => {});
  }

  // ---------- boot ----------

  (async () => {
    me = await apiFetch("/api/me");
    if (!me.authed) { location.href = "/host/login.html"; return; }
    $("whoami").textContent = `${me.username} (${me.role === "admin" ? "admin" : "host"})`;
    $("accountName").textContent = me.username;
    $("accountRole").textContent = me.role === "admin"
      ? "Admin — creates and manages hosts, and looks after the system. Hosting shows is what host accounts are for."
      : "Host — your own sessions, recordings and settings.";
    if (!applyHash()) {
      currentMenu = visibleMenus()[0];
      renderMainMenu();
      showSub(visibleSubs(currentMenu)[0].id);
    }
    load2fa();
    if (me.role === "admin") {
      loadUsers();
      loadBackups();
      loadLogs();
      loadSmtp();
    } else {
      loadSessions();
      loadRecordings();
      loadSettings();
      loadSounds();
      loadIntros();
      setInterval(loadSessions, 10000);   // keep the live badges fresh
      setInterval(loadRecordings, 15000); // pick up processing -> ready
    }
  })();
})();
