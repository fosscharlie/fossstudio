/* FOSS Studio host dashboard. */
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

  document.querySelectorAll(".nav button").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll("section[id^=sec-]").forEach((s) => {
        s.hidden = s.id !== `sec-${btn.dataset.section}`;
      });
    };
  });

  $("logoutBtn").onclick = async () => {
    await apiFetch("/api/logout", { method: "POST" });
    location.href = "/host/login.html";
  };

  // ---------- icons ----------

  const ICONS = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M21 3l-9 9M9 21H5a2 2 0 0 1-2-2V7"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12l5 5L20 7"/></svg>'
  };

  function iconBtn(icon, label, onClick) {
    const b = document.createElement("button");
    b.className = "iconbtn";
    b.innerHTML = ICONS[icon];
    b.title = label;
    b.setAttribute("aria-label", label);
    b.onclick = onClick;
    return b;
  }

  // Delete confirms inline: first click turns the icon into a tick,
  // second click (within 4s) actually deletes. No popups.
  function deleteBtn(label, onConfirm) {
    const b = iconBtn("del", label, () => {
      if (b.classList.contains("confirm")) { onConfirm(); return; }
      b.classList.add("confirm");
      b.innerHTML = ICONS.tick;
      b.title = "Click again to confirm";
      setTimeout(() => {
        b.classList.remove("confirm");
        b.innerHTML = ICONS.del;
        b.title = label;
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
      const del = deleteBtn("Delete session", async () => {
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

  // ---------- recordings ----------

  const STATUS_LABELS = {
    recording: "● recording now",
    processing: "⏳ processing…",
    ready: "✓ ready",
    failed: "! processing failed"
  };

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
      row.querySelector(".title").textContent = `Session ${r.roomId}`;
      row.querySelector(".meta").textContent =
        `${when}${mins ? ` · ${mins} min` : ""} · ${r.mode === "server" ? "server-side" : "browser-side"}`;
      const badge = row.querySelector(".badge");
      badge.textContent = STATUS_LABELS[r.status] || r.status;
      const filesEl = row.querySelector(".files");
      for (const f of r.files || []) {
        const a = document.createElement("a");
        a.href = `/api/recordings/${encodeURIComponent(r.id)}/files/${encodeURIComponent(f)}`;
        a.textContent = f;
        a.style.marginRight = "0.8rem";
        filesEl.appendChild(a);
      }
      row.appendChild(deleteBtn("Delete recording and its files", async () => {
        await apiFetch(`/api/recordings/${encodeURIComponent(r.id)}`, { method: "DELETE" });
        loadRecordings();
      }));
      list.appendChild(row);
    }
  }

  $("recModeToggle").onchange = async () => {
    await apiFetch("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ recordingMode: $("recModeToggle").checked ? "server" : "browser" })
    });
  };

  // ---------- theme ----------

  const PALETTE = [
    "#fbc711", "#f34236", "#e8207e", "#9b26ae", "#6639ab", "#3d51b4",
    "#2295f1", "#03a8f3", "#00bcd3", "#019587", "#4bae4f", "#8ac248",
    "#cbdc38", "#ffea3a", "#ffc006", "#fe9700", "#ff5721", "#795649",
    "#9e9d9e", "#607c8b"
  ];
  let currentAccent = PALETTE[0];

  function renderSwatches() {
    const wrap = $("swatches");
    wrap.innerHTML = "";
    for (const hex of PALETTE) {
      const b = document.createElement("button");
      b.className = "swatch" + (hex === currentAccent ? " active" : "");
      b.style.background = hex;
      b.title = hex;
      b.setAttribute("aria-label", `Accent ${hex}`);
      b.onclick = () => { currentAccent = hex; renderSwatches(); };
      wrap.appendChild(b);
    }
  }

  async function loadTheme() {
    const s = await apiFetch("/api/settings");
    $("recModeToggle").checked = s.recordingMode === "server";
    $("podcastName").value = s.podcastName;
    currentAccent = s.accent;
    $("autoGainToggle").checked = s.autoGain;
    renderSwatches();
    updateWallpaperPreview(s.wallpaper);
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

  $("saveThemeBtn").onclick = async () => {
    await apiFetch("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        podcastName: $("podcastName").value,
        accent: currentAccent,
        autoGain: $("autoGainToggle").checked
      })
    });
    $("themeMsg").hidden = false;
    setTimeout(() => { $("themeMsg").hidden = true; }, 2000);
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

  // ---------- boot ----------

  loadSessions();
  loadRecordings();
  loadTheme();
  load2fa();
  setInterval(loadSessions, 10000);   // keep the live badges fresh
  setInterval(loadRecordings, 15000); // pick up processing -> ready
})();
