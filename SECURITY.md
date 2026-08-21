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
  recordings and settings. The admin panel and the host dashboards are
  separate sessions with separate cookies, so signing in to one grants
  nothing in the other and logging out of one leaves the other
  untouched. Host powers in a session are granted from the
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
- **Transport**: HTTPS everywhere (via the bundled Caddy with TLS
  1.2/1.3 and HSTS, or your own TLS-terminating proxy); WebRTC media is
  DTLS-SRTP encrypted end-to-server; the app binds to loopback behind
  the proxy by default (`BIND_HOST` can widen this for private-network
  setups such as Tailscale, and must never expose the app port to the
  open internet). A strict Content-Security-Policy, X-Frame-Options,
  nosniff and Referrer-Policy are set by the app on every response, so
  they hold regardless of which proxy sits in front; HSTS is the one
  header your own proxy must add itself.
- **Least privilege**: the application container runs as a non-root
  user; data files holding credentials are stored owner-only (0600).
  Deployment is a dedicated SSH key, used nowhere else, that is itself
  forced-command restricted server-side to a fixed set of deploy
  actions (upload a release, switch to it, start it, health-check,
  prune old releases, roll back) - the key cannot open a shell or run
  any other command, even though the account it logs into is root.
  File uploads through it (the release itself) are confined to the
  releases directory by `rrsync`; the key also has no PTY, agent
  forwarding, or port forwarding.
- **No third parties**: no CDNs, trackers, or external calls from any
  page; fonts and libraries are self-hosted.
- **Data deletion**: deleting a recording, sound, intro, wallpaper, logo
  or ad-banner removes the stored file from disk, not just the database
  record. Deleting a host account purges everything that account owned -
  its recordings and their files, sessions, uploaded media and push
  subscription. (Rotating local backups may retain snapshots until they
  age out of the retention window - 5 backups by default, admin-set
  between 1 and 100.)
- **Secrets** live in the server's `.env` and the data directory -
  never in the repository. That includes the optional FOSSCast
  publisher token: publishing runs server-side, so the token is never
  sent to any browser.
- **Unauthenticated endpoints** are deliberately few: `/healthz` (up
  or not), `/render-status` (a count of recordings currently
  rendering), `/diagnostics` (the setup check: the configured domain,
  the announced media IP, and the port ranges the media engine uses -
  no login by design, because a misconfigured install often cannot log
  in at all), `/tls-allowed` (a yes/no answer Caddy consults before
  fetching a certificate on demand; it approves only the panel domains
  derived from `DOMAIN` and hosts' saved channel domains, so a stranger
  pointing their name at the server can never mint a certificate. A
  channel domain is host-entered, but only a logged-in host can save
  one, each domain can belong to only one host, the studio's own names
  are refused, and a certificate is only ever actually issued if the
  domain's DNS really points at this server - the ACME challenge fails
  otherwise), and the audience-facing live
  layer: `/live/<session>`
  (the watch page and its HLS media, which exists only while that
  session streams) plus its chat socket. The watch page carries the
  same trust as a session link - session ids are unguessable and the
  page can only ever receive. A host's permanent channel page
  (`/live/<username>`) is public and guessable on purpose - it is the
  link they hand to an audience. It answers only what an audience is
  meant to see: whether that host is streaming right now and the title
  of the show, and it resolves to the live session's media only while
  one is running. It does mean a valid host username can be confirmed
  from the outside (a real one answers, an unknown one 404s); usernames
  are public-facing identifiers here, not a second secret, and login
  still needs the password and any second factor. Admin accounts have
  no channel page at all.
- **Live chat** is nickname-only with no accounts: rate-limited per
  address, messages capped and filtered server-side, and moderation
  (hiding a message, blocking by name and address) restricted to
  logged-in hosts. Every ban, unban and hide is appended to a
  server-side moderation log (`data/chat-modlog.json`, owner-only)
  with the moment, name and address; the log is never served by any
  endpoint. Viewer IP addresses are stored server-side only
  (owner-only files) and are never exposed by any endpoint, including
  to hosts.
- **Headers**: `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, and a restrictive `Permissions-Policy`.
