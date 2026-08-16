// Browser half of the setup check. The server can report what it was
// configured with, but only a browser can answer the question that
// actually matters: can a guest sitting here reach the parts a call
// needs? These run the same connections a real join makes, one at a
// time, so a failure points at one thing rather than "it didn't work".
const ICONS = {
  ok: '<path d="M20 6L9 17l-5-5"/>',
  warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 16.5h.01"/>',
  fail: '<path d="M18 6 6 18M6 6l12 12"/>',
  pending: '<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/>'
};

function icon(level) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[level]}</svg>`;
}

const LABEL = { ok: "Passed", warn: "Worth checking", fail: "Failed", pending: "Checking" };

function render(li, check) {
  li.dataset.level = check.level;
  li.className = "check";
  li.innerHTML = `${icon(check.level)}<div>
    <b>${check.title}</b>
    <p>${check.detail}</p>
    ${check.fix ? `<p class="fix">${check.fix}</p>` : ""}
  </div>`;
  li.setAttribute("aria-label", `${LABEL[check.level]}: ${check.title}`);
}

function addRow(list, title) {
  const li = document.createElement("li");
  render(li, { level: "pending", title, detail: "Checking…", fix: "" });
  list.appendChild(li);
  return li;
}

// ---------- browser-side checks ----------

function secureContextCheck() {
  if (window.isSecureContext && navigator.mediaDevices?.getUserMedia) {
    return {
      level: "ok",
      title: "This page is a secure context",
      detail: "Camera and microphone access is allowed here.",
      fix: ""
    };
  }
  return {
    level: "fail",
    title: "This page is not a secure context",
    detail: "The browser will not hand over the camera or microphone, so nobody can join with video or audio. This is the browser refusing, not the app failing.",
    fix: "Serve the site over HTTPS. Terminate TLS at your reverse proxy (certbot for Nginx), or use <code>tailscale serve</code> on a tailnet."
  };
}

// The signaling socket is what a stock Nginx config breaks: it proxies
// the page fine but drops the upgrade headers, so this is the check
// that separates "proxy misconfigured" from "media not reachable".
function socketCheck() {
  return new Promise((resolve) => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    let ws;
    const finish = (result) => {
      clearTimeout(timer);
      try { ws?.close(); } catch { /* already closing */ }
      resolve(result);
    };
    // A reverse proxy that forwards the request but drops the upgrade
    // headers accepts the connection and then never replies, so this
    // hang is the usual shape of the problem, not the error below.
    const timer = setTimeout(() => finish({
      level: "fail",
      title: "Live connection timed out",
      detail: `The signaling socket at <code>${url}</code> accepted the connection and then never completed it, so nobody can join a session. That is what a reverse proxy forwarding the page but not the WebSocket upgrade looks like.`,
      fix: "In Nginx, add to the location block: <code>proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection \"upgrade\";</code> then reload. If there is no proxy in front, check the app is running."
    }), 8000);

    try {
      ws = new WebSocket(url);
    } catch {
      return finish({
        level: "fail",
        title: "Live connection could not be opened",
        detail: "The browser refused to open the signaling socket.",
        fix: ""
      });
    }

    ws.onopen = () => finish({
      level: "ok",
      title: "Live connection works",
      detail: "The signaling socket opened, so your proxy is forwarding WebSocket upgrades correctly.",
      fix: ""
    });
    ws.onerror = () => finish({
      level: "fail",
      title: "Live connection was refused",
      detail: `The signaling socket at <code>${url}</code> would not open. Guests get as far as the join screen and then cannot get in. This is what a reverse proxy that does not forward WebSocket upgrades looks like.`,
      fix: "In Nginx, add to the location block: <code>proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection \"upgrade\";</code> then reload."
    });
  });
}

// A server-reflexive candidate only comes back if the STUN request got
// out and the reply got back, which means the relay's port really is
// reachable from where this browser is sitting.
function stunCheck(host, port) {
  return new Promise((resolve) => {
    const url = `stun:${host}:${port}`;
    if (!window.RTCPeerConnection) {
      return resolve({
        level: "fail",
        title: "This browser has no WebRTC support",
        detail: "Calls cannot run in this browser at all.",
        fix: "Use a current version of Firefox, Chrome, Edge or Safari."
      });
    }
    const pc = new RTCPeerConnection({ iceServers: [{ urls: url }] });
    const finish = (result) => {
      clearTimeout(timer);
      pc.close();
      resolve(result);
    };
    const timer = setTimeout(() => finish({
      level: "fail",
      title: "Relay did not answer",
      detail: `No reply from <code>${url}</code> within 10 seconds. Guests behind a strict home or office firewall rely on the relay, so for them the call connects and then shows a black screen with no sound.`,
      fix: "Check coturn is running (<code>docker compose ps</code>) and that UDP port " + port + " reaches this machine. On a home server, forward it on your router."
    }), 10000);

    pc.onicecandidate = (e) => {
      if (!e.candidate) {
        return finish({
          level: "fail",
          title: "Relay did not answer",
          detail: `Candidate gathering finished without a reply from <code>${url}</code>. Guests behind a strict firewall will connect and then see a black screen with no sound.`,
          fix: "Check coturn is running and that UDP port " + port + " reaches this machine."
        });
      }
      const type = / typ (\w+)/.exec(e.candidate.candidate)?.[1];
      if (type === "srflx") {
        finish({
          level: "ok",
          title: "Relay is reachable",
          detail: `The relay answered on <code>${host}:${port}</code> and reported this browser's public address, so the relay port is open.`,
          fix: ""
        });
      }
    };
    pc.createDataChannel("probe");
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => finish({
      level: "fail",
      title: "Could not start a test connection",
      detail: "The browser refused to begin gathering network candidates.",
      fix: ""
    }));
  });
}

async function mediaCheck() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const video = stream.getVideoTracks().length;
    const audio = stream.getAudioTracks().length;
    stream.getTracks().forEach((t) => t.stop());
    return {
      level: video && audio ? "ok" : "warn",
      title: "Camera and microphone",
      detail: `The browser gave up ${video} camera and ${audio} microphone track${audio === 1 ? "" : "s"}.`,
      fix: video && audio ? "" : "Check the device is plugged in and not in use by another app."
    };
  } catch (err) {
    return {
      level: "fail",
      title: "Camera and microphone were refused",
      detail: `The browser would not hand them over (${err.name}).`,
      fix: "Allow camera and microphone for this site, and check no other app is holding the device."
    };
  }
}

// ---------- run ----------

const serverList = document.getElementById("serverChecks");
const browserList = document.getElementById("browserChecks");
const verdict = document.getElementById("verdict");
const results = [];

function updateVerdict(done) {
  const worst = results.some((r) => r.level === "fail") ? "fail"
    : results.some((r) => r.level === "warn") ? "warn" : "ok";
  verdict.dataset.level = done ? worst : "pending";
  if (!done) return;
  verdict.textContent = worst === "fail"
    ? "Something here will stop calls working. The failed checks below say what and how to fix it."
    : worst === "warn"
      ? "Nothing is outright broken, but the items below are worth reading before you rely on this."
      : "Everything checks out. Guests should be able to join, see and hear each other.";
}

async function run() {
  let info;
  try {
    const res = await fetch("/diagnostics.json");
    info = await res.json();
  } catch {
    verdict.dataset.level = "fail";
    verdict.textContent = "Could not reach the app to run the checks. It may not be running, or your proxy is not forwarding to it.";
    return;
  }

  for (const check of info.checks) {
    const li = addRow(serverList, check.title);
    render(li, check);
    results.push(check);
  }

  document.getElementById("portRows").innerHTML = info.ports
    .map((p) => `<tr><td>${p.label}</td><td><code>${p.range}</code></td><td>${p.protocol}</td></tr>`)
    .join("");

  const secureRow = addRow(browserList, "Secure context");
  const socketRow = addRow(browserList, "Live connection to the server");
  const stunRow = addRow(browserList, "Relay reachability");

  const secure = secureContextCheck();
  render(secureRow, secure);
  results.push(secure);
  updateVerdict(false);

  const socket = await socketCheck();
  render(socketRow, socket);
  results.push(socket);
  updateVerdict(false);

  const stun = await stunCheck(info.turnHost, info.turnPort);
  render(stunRow, stun);
  results.push(stun);
  updateVerdict(true);
}

document.getElementById("mediaBtn").addEventListener("click", async (e) => {
  e.target.disabled = true;
  const row = addRow(browserList, "Camera and microphone");
  const result = await mediaCheck();
  render(row, result);
  results.push(result);
  updateVerdict(true);
  e.target.remove();
});

run();
