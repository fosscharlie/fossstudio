/* FOSSStudio host dashboard: main menu -> sub-menu -> content. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  // Which of the two separate sessions this page runs as: the fleet
  // panel lives at /admin/, host dashboards at /host/. Every API call
  // names its panel so the server answers with the right identity even
  // when both sessions are open in one browser.
  const PANEL = location.pathname.startsWith("/admin") ? "admin" : "host";

  async function apiFetch(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: {
        "X-Panel": PANEL,
        ...(opts.body && !(opts.body instanceof Blob) ? { "Content-Type": "application/json" } : {}),
        ...(opts.headers || {})
      }
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
  // Whether publishing recordings to FOSSCast is configured
  let canPublish = false;
  let channelDomain = "";
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
    const subs = visibleSubs(currentMenu);
    // One section only: the main-menu item is enough - no submenu bar
    const single = subs.length <= 1;
    nav.hidden = single;
    document.querySelector(".layout").classList.toggle("no-sub", single);
    for (const sub of subs) {
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
    tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12l5 5L20 7"/></svg>',
    obs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><circle cx="12" cy="10.5" r="3"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    live: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1a10 10 0 0 1 0-14.2M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M16.2 7.8a6 6 0 0 1 0 8.4"/><circle cx="12" cy="12" r="2"/></svg>',
    publish: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/></svg>'
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
    let reset = null;
    const b = iconBtn(icon, label, () => {
      // Once confirmed the action owns the button's state - the armed
      // timeout must not reset it mid-action
      if (b.classList.contains("confirm")) {
        clearTimeout(reset);
        b.classList.remove("confirm");
        onConfirm();
        return;
      }
      b.classList.add("confirm");
      b.innerHTML = ICONS.tick;
      b.dataset.tip = "Click again to confirm";
      reset = setTimeout(() => {
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
      list.innerHTML = '<p class="hint">No sessions yet - create one above and send the link to your guests.</p>';
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

      const edit = iconBtn("pencil", "Rename the episode", () => {
        if (row.querySelector(".title-edit")) return;
        const titleEl = row.querySelector(".title");
        const input = document.createElement("input");
        input.className = "title-edit";
        input.maxLength = 80;
        input.value = s.title;
        titleEl.replaceWith(input);
        input.focus();
        input.select();
        let finished = false;
        const done = async (save) => {
          if (finished) return;
          finished = true;
          const t = input.value.trim();
          if (save && t && t !== s.title) {
            await apiFetch(`/api/sessions/${s.id}/title`, {
              method: "POST",
              body: JSON.stringify({ title: t })
            }).catch(() => {});
          }
          loadSessions();
        };
        input.onkeydown = (e) => {
          if (e.key === "Enter") done(true);
          if (e.key === "Escape") done(false);
        };
        input.onblur = () => done(true);
      });
      const copy = iconBtn("copy", "Copy guest link", async () => {
        await navigator.clipboard.writeText(link);
        copy.classList.add("done");
        copy.innerHTML = ICONS.tick;
        setTimeout(() => { copy.classList.remove("done"); copy.innerHTML = ICONS.copy; }, 1500);
      });
      const obs = iconBtn("obs", "Copy OBS clean-feed link - add it as a Browser Source and stream from OBS to anywhere", async () => {
        await navigator.clipboard.writeText(`${link}?output=1`);
        obs.classList.add("done");
        obs.innerHTML = ICONS.tick;
        setTimeout(() => { obs.classList.remove("done"); obs.innerHTML = ICONS.obs; }, 1500);
      });
      const open = iconBtn("open", "Open studio as host", () => {
        window.open(`/s/${s.id}?as=host`, "_blank");
      });
      const del = confirmBtn("del", "Delete session", async () => {
        await apiFetch(`/api/sessions/${s.id}`, { method: "DELETE" });
        loadSessions();
      });
      const liveBtn = iconBtn("live", "Copy your channel link - one permanent page where the audience watches and chats whenever you go live", async () => {
        await navigator.clipboard.writeText(channelDomain ? `https://${channelDomain}/` : `${location.origin}/live/${me.username}`);
        liveBtn.classList.add("done");
        liveBtn.innerHTML = ICONS.tick;
        setTimeout(() => { liveBtn.classList.remove("done"); liveBtn.innerHTML = ICONS.live; }, 1500);
      });
      row.append(edit, copy, obs, liveBtn, open, del);
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
      // Set a new password inline in the row: no browser pop-up
      const reset = iconBtn("key", "Set a new password for this user", () => {
        if (row.querySelector(".pw-inline")) return;
        const wrap = document.createElement("span");
        wrap.className = "pw-inline";
        const input = document.createElement("input");
        input.type = "password";
        input.placeholder = "New password (10+ characters)";
        input.autocomplete = "new-password";
        const done = () => wrap.remove();
        const save = async () => {
          if (!input.value) return done();
          try {
            await apiFetch(`/api/users/${u.id}/password`, {
              method: "POST", body: JSON.stringify({ password: input.value })
            });
            done();
            reset.classList.add("done");
            reset.innerHTML = ICONS.tick;
            setTimeout(() => { reset.classList.remove("done"); reset.innerHTML = ICONS.key; }, 1500);
          } catch (err) { showUserMsg(err.message); input.focus(); }
        };
        const ok = iconBtn("tick", "Save the new password", save);
        input.onkeydown = (e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") done();
        };
        wrap.append(input, ok);
        row.insertBefore(wrap, reset);
        input.focus();
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
        showUserMsg("✓ Invite emailed - they have 7 days to accept.", true);
      } else {
        await navigator.clipboard.writeText(r.inviteUrl).catch(() => {});
        showUserMsg("Email isn't set up, so the invite link was copied to your clipboard instead - send it to them yourself.", true);
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
    $("smtpPassHint").innerHTML = s.hasPass
      ? '<span class="msg ok" style="display:inline">\u2713 saved</span> - leave blank to keep it'
      : "";
  }

  // Settings save themselves when a field changes - no Save buttons.
  // 'change' fires on blur (or enter), so nothing saves mid-keystroke.
  function autoSave(ids, save) {
    for (const id of ids) {
      $(id).addEventListener("change", () => { save().catch(() => {}); });
    }
  }

  async function saveSmtp() {
    const hadPass = !!$("smtpPass").value;
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
    // Don't reload the form here - a reload mid-tab would overwrite
    // whatever field the user is typing in next
    if (hadPass) {
      $("smtpPass").value = "";
      $("smtpPassHint").innerHTML =
        '<span class="msg ok" style="display:inline">\u2713 saved</span> - leave blank to keep it';
    }
    smtpMsg("✓ Saved");
  }
  autoSave(["smtpHost", "smtpPort", "smtpUser", "smtpPass", "smtpFrom", "smtpAlertTo"], saveSmtp);

  $("testSmtpBtn").onclick = async () => {
    try {
      const { to } = await apiFetch("/api/smtp/test", { method: "POST" });
      smtpMsg(`✓ Test email sent to ${to} - check the inbox.`);
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
      badge.dataset.tip = "Processing failed - the raw files are kept";
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
      const card = document.createElement("div");
      card.className = "rec-card";
      const when = new Date(r.startedAt).toLocaleString();
      const mins = r.endedAt ? Math.max(1, Math.round((r.endedAt - r.startedAt) / 60000)) : null;
      card.innerHTML = `
        <div class="rec-head">
          <div class="rec-head-text">
            <div class="title"></div>
            <div class="meta"></div>
          </div>
          <div class="rec-head-actions">
            <span class="badge"></span>
          </div>
        </div>
        <div class="files"></div>`;
      card.querySelector(".title").textContent = r.title || `Session ${r.roomId}`;
      card.querySelector(".meta").textContent =
        `${when}${mins ? ` · ${mins} min` : ""} · ${r.mode === "live" ? "live stream" : r.mode === "server" ? "server-side" : "browser-side"}`;
      setStatusBadge(card.querySelector(".badge"), r.status);
      const filesEl = card.querySelector(".files");
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
        fileRow.appendChild(confirmBtn("del", "Delete this file", async () => {
          await apiFetch(url, { method: "DELETE" });
          loadRecordings();
        }));
        filesEl.appendChild(fileRow);
      }
      // Bottom action row under the files: the two zip downloads, then
      // the whole-recording delete in line with the per-file deletes
      const actions = document.createElement("div");
      actions.className = "rec-actions";
      const zipBase = `/api/recordings/${encodeURIComponent(r.id)}/zip`;
      const hasAudio = (r.files || []).some((f) => /\.(flac|wav|mp3|ogg|m4a|aac)$/i.test(f));
      if (hasAudio) {
        const dlAudio = downloadLink(`${zipBase}?audio=1`);
        dlAudio.innerHTML = ICO.downloadAudio;
        dlAudio.dataset.tip = "Download all audio (the FLACs, zipped)";
        dlAudio.setAttribute("aria-label", "Download all audio");
        actions.appendChild(dlAudio);
      }
      if ((r.files || []).length) {
        const dlAll = downloadLink(zipBase);
        dlAll.innerHTML = ICO.downloadAll;
        dlAll.dataset.tip = "Download all files (zipped)";
        dlAll.setAttribute("aria-label", "Download all files");
        actions.appendChild(dlAll);
      }
      // Publish the combined video to FOSSCast as a draft episode. Two
      // clicks like every outward action: publishing is the point of no
      // return only on FOSSCast's side (drafts are reviewed there), but
      // an accidental multi-GB upload is still worth a confirm.
      const videoFile = (r.files || []).find((f) => /\.(mp4|webm|mkv|mov)$/i.test(f));
      if (canPublish && r.status === "ready" && videoFile) {
        const pub = confirmBtn("publish", "Publish to FOSSCast as a draft episode (click again to confirm)", async () => {
          pub.disabled = true;
          pub.dataset.tip = "Uploading to FOSSCast…";
          try {
            const out = await apiFetch(`/api/recordings/${encodeURIComponent(r.id)}/publish`, {
              method: "POST",
              body: JSON.stringify({ file: videoFile })
            });
            pub.classList.add("done");
            pub.innerHTML = ICONS.tick;
            pub.dataset.tip = out.draft
              ? "Uploaded - review the draft in your FOSSCast dashboard"
              : "Published to FOSSCast";
          } catch (err) {
            pub.dataset.tip = err.message || "Publish failed";
            pub.innerHTML = ICONS.publish;
            pub.disabled = false;
          }
        });
        actions.appendChild(pub);
      }
      actions.appendChild(
        confirmBtn("del", "Delete recording and its files", async () => {
          await apiFetch(`/api/recordings/${encodeURIComponent(r.id)}`, { method: "DELETE" });
          loadRecordings();
        }));
      card.appendChild(actions);
      list.appendChild(card);
    }
  }

  async function saveStream() {
    $("streamErr").hidden = true;
    try {
      const s = await apiFetch("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          streamUrl: $("streamUrl").value.trim() || "rtmp://a.rtmp.youtube.com/live2",
          streamKey: $("streamKey").value.trim(),
          channelDomain: $("channelDomain").value.trim()
        })
      });
      channelDomain = s.channelDomain || "";
      $("channelDomain").value = channelDomain;
      $("streamMsg").hidden = false;
      setTimeout(() => { $("streamMsg").hidden = true; }, 2000);
    } catch (err) {
      if (err.message === "logged out") throw err;
      $("streamErr").textContent = err.message;
      $("streamErr").hidden = false;
    }
  }
  autoSave(["streamUrl", "streamKey", "channelDomain"], saveStream);

  // ---------- chat block list ----------

  async function loadBlocked() {
    const list = $("blockedList");
    if (!list) return;
    const blocked = await apiFetch("/api/chat/blocked");
    list.innerHTML = "";
    if (blocked.length === 0) {
      list.innerHTML = '<p class="hint">Nobody is blocked. Block someone from the chat on the watch page while live.</p>';
      return;
    }
    for (const b of blocked) {
      const row = document.createElement("div");
      row.className = "session-row";
      const name = document.createElement("span");
      name.className = "session-title";
      name.textContent = b.name;
      const when = document.createElement("span");
      when.className = "hint";
      when.textContent = `blocked ${new Date(b.blockedAt).toLocaleString()}`;
      row.append(name, when);
      row.appendChild(confirmBtn("del", "Unblock - lets them back into the chat", async () => {
        await apiFetch(`/api/chat/blocked/${encodeURIComponent(b.id)}`, { method: "DELETE" });
        loadBlocked();
      }));
      list.appendChild(row);
    }
  }

  async function saveFosscast() {
    await apiFetch("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        fosscastUrl: $("fosscastUrl").value.trim(),
        fosscastToken: $("fosscastToken").value.trim()
      })
    });
    canPublish = !!($("fosscastUrl").value.trim() && $("fosscastToken").value.trim());
    loadRecordings().catch(() => {});
    $("fosscastMsg").hidden = false;
    setTimeout(() => { $("fosscastMsg").hidden = true; }, 2000);
  }
  autoSave(["fosscastUrl", "fosscastToken"], saveFosscast);

  // ---------- theme ----------

  const PALETTE = [
    "#f34236", "#fe9700", "#fbc711", "#4bae4f", "#019587",
    "#2295f1", "#3d51b4", "#9b26ae", "#e8207e", "#795649", "#9e9d9e"
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
    channelDomain = s.channelDomain || "";
    $("channelDomain").value = channelDomain;
    $("fosscastUrl").value = s.fosscastUrl || "";
    $("fosscastToken").value = s.fosscastToken || "";
    canPublish = !!(s.fosscastUrl && s.fosscastToken);
    currentBg = s.bg || null;
    renderBgSwatches();
    $("bgHex").value = currentBg || "";
    updateWallpaperPreview(s.wallpaper);
    updateLogoPreview(!!s.logo);
    updateAdPreview(!!s.adBanner);
    initLogoBg().catch(() => {});
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
      const del = confirmBtn("del", "Delete sound", async () => {
        play.stopPreview();
        await apiFetch(`/api/sounds/${clip.id}`, { method: "DELETE" });
        loadSounds();
      });
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
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 11l4 4 4-4M5 20h14"/></svg>',
    downloadAudio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 15V4l9-2v10"/><circle cx="5.5" cy="15" r="2.5"/><circle cx="14.5" cy="12" r="2.5"/><path d="M19 15v6M16.5 18.5L19 21l2.5-2.5"/></svg>',
    downloadAll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h8a2 2 0 0 1 2 2v8M4 7h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM8 11v6M5.5 14.5L8 17l2.5-2.5"/></svg>'
  };
  function iconState(btn, icon, tip) {
    btn.innerHTML = ICO[icon];
    btn.dataset.tip = tip;
    btn.setAttribute("aria-label", tip);
  }

  // One button that toggles audio in place - no separate stop, no reflow
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
      const del = confirmBtn("del", "Delete intro", async () => {
        await apiFetch(`/api/intros/${clip.id}`, { method: "DELETE" });
        loadIntros();
      });
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
    initLogoBg().catch(() => {});
  };
  $("logoRemove").onclick = async () => {
    await apiFetch("/api/logo", { method: "DELETE" });
    updateLogoPreview(false);
    initLogoBg().catch(() => {});
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
  // ---------- logo background: the collage generator ----------
  // The host's logo scattered in dozens of ghosted, tilted positions
  // over their background colour - drawn here in the browser, saved
  // through the ordinary wallpaper slot so the whole pipeline
  // (pinning, recordings, streams) treats it as any other wallpaper.
  function drawLogoCollage(canvas, img, baseColour) {
    const x = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.filter = "none";
    x.globalAlpha = 1;
    x.fillStyle = baseColour;
    x.fillRect(0, 0, W, H);
    const ar = img.width / img.height;
    // Back layer: a few enormous, blurred, barely-there copies for depth
    const place = (count, minS, maxS, minA, maxA, blur) => {
      for (let i = 0; i < count; i++) {
        const w = minS + Math.random() * (maxS - minS);
        const h = w / ar;
        const px = Math.random() * W, py = Math.random() * H;
        const rot = (Math.random() - 0.5) * 1.6;           // up to ~46 deg
        const tiltX = (Math.random() - 0.5) * 0.7;         // skew = the 3D lean
        const tiltY = (Math.random() - 0.5) * 0.7;
        const squash = 0.55 + Math.random() * 0.45;        // foreshortening
        x.setTransform(1, 0, 0, 1, px, py);
        x.rotate(rot);
        x.transform(1, tiltY, tiltX, squash, 0, 0);
        x.globalAlpha = minA + Math.random() * (maxA - minA);
        x.filter = blur ? `blur(${blur + Math.random() * blur}px)` : "none";
        x.drawImage(img, -w / 2, -h / 2, w, h);
      }
    };
    place(5, 700, 1300, 0.02, 0.04, 6);   // deep, huge, soft
    place(14, 220, 520, 0.03, 0.06, 2);   // middle distance
    place(16, 80, 220, 0.04, 0.08, 0);    // near, small, crisp-ish
    // Gentle vignette so tiles sit on a calmer centre
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.filter = "none";
    x.globalAlpha = 1;
    const g = x.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.22)");
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  }

  let logoBgImg = null;
  async function initLogoBg() {
    const canvas = $("logoBgCanvas");
    const s = await apiFetch("/api/settings");
    const base = s.bg || "#14161a";
    if (!s.logo) {
      $("logoBgHint").hidden = false;
      $("logoBgShuffle").disabled = true;
      $("logoBgUse").disabled = true;
      const x = canvas.getContext("2d");
      x.fillStyle = base;
      x.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    $("logoBgHint").hidden = true;
    $("logoBgShuffle").disabled = false;
    $("logoBgUse").disabled = false;
    logoBgImg = new Image();
    logoBgImg.onload = () => drawLogoCollage(canvas, logoBgImg, base);
    logoBgImg.src = `/api/logo?${Date.now()}`;
  }
  $("logoBgShuffle").onclick = async () => {
    if (!logoBgImg) return;
    const s = await apiFetch("/api/settings");
    drawLogoCollage($("logoBgCanvas"), logoBgImg, s.bg || "#14161a");
  };
  $("logoBgUse").onclick = () => {
    $("logoBgCanvas").toBlob(async (blob) => {
      if (!blob) return;
      await fetch("/api/wallpaper", { method: "POST", headers: { "Content-Type": "image/png" }, body: blob });
      updateWallpaperPreview(true);
      $("logoBgMsg").hidden = false;
      setTimeout(() => { $("logoBgMsg").hidden = true; }, 2200);
    }, "image/png");
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

  $("saveUsernameBtn").onclick = async () => {
    const ok = $("usernameMsg"), err = $("usernameErr");
    ok.hidden = true; err.hidden = true;
    try {
      const res = await apiFetch("/api/username", {
        method: "POST",
        body: JSON.stringify({ username: $("accountUsername").value })
      });
      me.username = res.username;
      $("accountUsername").value = res.username;
      $("accountName").textContent = res.username;
      $("whoami").textContent = `${me.username} (${me.role === "admin" ? "admin" : "host"})`;
      ok.hidden = false;
    } catch (e) {
      err.textContent = e.message; err.hidden = false;
    }
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
    sysMsg("Restarting - back in a few seconds…");
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

  // ---------- backup retention ----------

  async function loadBackupKeep() {
    if (me.role !== "admin") return;
    const { keep } = await apiFetch("/api/ops/backup-keep");
    $("backupKeep").value = keep;
  }

  async function saveBackupKeep() {
    try {
      const { keep } = await apiFetch("/api/ops/backup-keep", {
        method: "PUT", body: JSON.stringify({ keep: Number($("backupKeep").value) })
      });
      $("backupKeep").value = keep;
      $("backupKeepMsg").hidden = false;
      setTimeout(() => { $("backupKeepMsg").hidden = true; }, 2000);
      loadBackups();
    } catch (err) { sysMsg(err.message, false); }
  }
  autoSave(["backupKeep"], saveBackupKeep);

  // ---------- push notifications ----------

  // pushManager.subscribe wants the VAPID key as bytes: some browsers
  // accept the base64url string directly, others throw - which is what
  // made "Enable notifications" fail with no explanation
  function vapidKeyBytes(b64url) {
    const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
    const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  $("pushBtn").onclick = async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      return sysMsg("This browser doesn't support notifications.", false);
    }
    if (!("PushManager" in window)) {
      return sysMsg("This browser doesn't support push notifications (Safari needs the app added to the Home Screen first).", false);
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return sysMsg("Notifications were blocked in the browser.", false);
      const reg = await navigator.serviceWorker.ready;
      const { key } = await apiFetch("/api/push/key");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyBytes(key)
      });
      await apiFetch("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub) });
      sysMsg("✓ You'll get a notification when a guest arrives or a recording is ready.");
    } catch (err) {
      // Say what actually went wrong - "couldn't" with no reason made
      // this undebuggable from the other side of a bug report
      sysMsg(`Couldn't enable notifications: ${err.message || err.name || "unknown error"}`, false);
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
    $("accountUsername").value = me.username;
    $("accountRole").textContent = me.role === "admin"
      ? "Admin - creates and manages hosts, and looks after the system. Hosting shows is what host accounts are for."
      : "Host - your own sessions, recordings and settings.";
    if (!applyHash()) {
      currentMenu = visibleMenus()[0];
      renderMainMenu();
      showSub(visibleSubs(currentMenu)[0].id);
    }
    load2fa();
    if (me.role === "admin") {
      loadUsers();
      loadBackups();
      loadBackupKeep();
      loadLogs();
      loadSmtp();
    } else {
      // Settings first: session rows and recording cards read the
      // FOSSCast fields (live link button, publish button) as they render
      loadSettings().then(() => {
        loadSessions();
        loadRecordings();
      });
      loadBlocked();
      loadSounds();
      loadIntros();
      setInterval(loadSessions, 10000);   // keep the live badges fresh
      setInterval(loadRecordings, 15000); // pick up processing -> ready
    }
  })();
})();
