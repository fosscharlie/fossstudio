// Shared test helpers: session links must be created by a logged-in
// user now, so tests mint one through the API first.
export async function apiLogin(base, password = "testpass123", username = "charlie") {
  const res = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) throw new Error(`test login failed: ${res.status}`);
  return res.headers.get("set-cookie").split(";")[0];
}

export async function makeRoom(base, password, title = "Automated test") {
  const cookie = await apiLogin(base, password);
  const res = await fetch(`${base}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ title })
  });
  const session = await res.json();
  return session.id;
}
