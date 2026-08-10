# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub's private vulnerability reporting](https://github.com/lightmorphic/fossstudio/security/advisories/new)
on this repository. You'll get a response as soon as possible, normally
within a few days. Please don't open public issues for security problems
before they're fixed.

## Supported versions

Only the latest release (what `main` deploys) is supported. FOSSStudio
is self-hosted: run the newest version.

## Security design notes

For self-hosters assessing the project:

- **Authentication**: scrypt password hashing, HMAC-signed HttpOnly
  cookies (`Secure`, `SameSite=Lax`), per-IP login rate limiting with
  lockout, optional TOTP two-factor per account.
- **Roles**: admins never host; hosts only ever see their own sessions,
  recordings and settings. Host powers in a session are granted from the
  server-side session ownership check, never from client claims.
- **Session links** must exist in the session registry - arbitrary room
  IDs are rejected. The OBS clean feed (`?output=1`) carries the same
  trust as the link itself: anyone holding the link could join and
  listen as a guest anyway, so the view-only feed grants nothing extra.
  Feed connections are receive-only at the server (they cannot publish
  media), are capped separately from guests, and never enter recordings.
- **Uploads**: recording chunks are gated by per-peer HMAC tokens;
  wallpaper, ad-banner, soundboard-clip and intro-video uploads are
  login-gated, content-type and size limited, and written under
  server-controlled names (never a client-supplied path). Banner snapshots
  (the lower-third images baked into recordings/streams) are host-only,
  PNG-only, size-capped, and written under server-controlled names for
  peers that actually exist in the room.
- **Transport**: HTTPS everywhere via Caddy (TLS 1.2/1.3, HSTS); WebRTC
  media is DTLS-SRTP encrypted end-to-server; the app binds to loopback
  behind the proxy. A strict Content-Security-Policy, X-Frame-Options,
  nosniff and Referrer-Policy are set on every response.
- **Least privilege**: the application container runs as a non-root
  user; data files holding credentials are stored owner-only (0600).
- **No third parties**: no CDNs, trackers, or external calls from any
  page; fonts and libraries are self-hosted.
- **Data deletion**: deleting a recording, sound, intro, wallpaper, logo
  or ad-banner removes the stored file from disk, not just the database
  record. Deleting a host account purges everything that account owned -
  its recordings and their files, sessions, uploaded media and push
  subscription. (Rotating local backups may retain snapshots until they
  age out of the last-14 window.)
- **Secrets** live in the server's `.env` and the data directory -
  never in the repository.
- **Headers**: `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, and a restrictive `Permissions-Policy`.
