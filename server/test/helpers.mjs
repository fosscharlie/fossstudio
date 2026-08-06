// Shared test helpers. Admins can't host or own sessions, so tests
// run through a dedicated "testhost" host account, created on demand
// with the admin credentials.
export const TEST_HOST = { username: "testhost", password: "testhostpass123" };

export async function apiLogin(base, password, username = "admin") {
  const res = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) throw new Error(`test login failed for ${username}: ${res.status}`);
  return res.headers.get("set-cookie").split(";")[0];
}

export async function hostLogin(base, adminPassword) {
  const admin = await apiLogin(base, adminPassword);
  await fetch(`${base}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: admin },
    body: JSON.stringify(TEST_HOST)
  }); // "username taken" on reruns is fine
  return apiLogin(base, TEST_HOST.password, TEST_HOST.username);
}

export async function makeRoom(base, adminPassword, title = "Automated test") {
  const cookie = await hostLogin(base, adminPassword);
  const res = await fetch(`${base}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ title })
  });
  const session = await res.json();
  if (!session.id) throw new Error(`session create failed: ${JSON.stringify(session)}`);
  return session.id;
}

export async function setServerRecPermission(base, adminPassword, allowed) {
  const admin = await apiLogin(base, adminPassword);
  const users = await fetch(`${base}/api/users`, { headers: { Cookie: admin } }).then((r) => r.json());
  const th = users.find((u) => u.username === TEST_HOST.username);
  await fetch(`${base}/api/users/${th.id}/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: admin },
    body: JSON.stringify({ allowServerRecording: allowed })
  });
}
