const form = document.getElementById("loginForm");
const errEl = document.getElementById("loginError");
form.onsubmit = async (e) => {
  e.preventDefault();
  errEl.hidden = true;
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: document.getElementById("username").value,
      password: document.getElementById("password").value,
      totp: document.getElementById("totp").value
    })
  });
  if (res.ok) {
    // Admins run the fleet at /admin/, hosts run shows at /host/ -
    // separate sessions, so both can be open at once
    const { role } = await res.json();
    location.href = role === "admin" ? "/admin/" : "/host/";
    return;
  }
  const { error } = await res.json();
  // If 2FA is on, reveal the code field for the next try
  if (/2FA/.test(error)) document.getElementById("totpField").hidden = false;
  errEl.textContent = error;
  errEl.hidden = false;
};
