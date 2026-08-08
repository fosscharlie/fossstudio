const token = new URLSearchParams(location.search).get("token") || "";
const err = document.getElementById("err");
let username = "";

fetch(`/api/invite/${encodeURIComponent(token)}`).then(async (r) => {
  const data = await r.json();
  if (!r.ok) {
    document.getElementById("welcome").textContent = data.error;
    return;
  }
  username = data.username;
  document.getElementById("welcome").textContent =
    `Welcome, ${username}! Pick a password and you're in.`;
  document.getElementById("goBtn").disabled = false;
});

document.getElementById("inviteForm").onsubmit = async (e) => {
  e.preventDefault();
  err.hidden = true;
  const pw = document.getElementById("password").value;
  if (pw !== document.getElementById("password2").value) {
    err.textContent = "Those two don't match - try again.";
    err.hidden = false;
    return;
  }
  const res = await fetch("/api/invite/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password: pw })
  });
  const data = await res.json();
  if (!res.ok) { err.textContent = data.error; err.hidden = false; return; }
  // Log them straight in with their new password
  await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: pw })
  });
  location.href = "/host/";
};
