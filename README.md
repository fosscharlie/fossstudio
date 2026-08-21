# FOSSStudio

Self-hosted video podcast studio, a StreamYard replacement for everyone.
Guests join by link with no account; the host runs everything from a web
dashboard.

## What it does

- **Guest flow:** open link → preview screen (camera/mic/speaker pick,
  speaker test sound, mic meter, **camera zoom** (real lens zoom where
  supported, digital crop-zoom everywhere else), mirror toggle, name,
  noise suppression on by default) → join, arriving muted so there are
  no accidental hot mics. Up to 10 people; choices are remembered for
  next time.
- **Roles:** admins create and manage **hosts** (email invites; each
  host sets their own password) and look after the system; each host
  owns their sessions, recordings, branding and stream key. The admin
  panel (`/admin/`) and host dashboards (`/host/`) are separate
  sessions, so both can be open in one browser at once - each panel can
  also have its own domain: point admin.<your-domain> and
  host.<your-domain> at the server and they just work, certificates
  included.
- **In-session host controls:** spotlight/grid layout, per-guest volume,
  per-session auto level balancing, start/stop recording, go live.
- **Soundboard:** upload short clips (laughs, applause, stings) in the
  dashboard - auto-levelled to speech loudness so nothing blasts - then
  fire them one-click in-session - played over everyone,
  or with all mics muted for the clip's length and then restored.
  Carried on an always-on audio channel so a clip never interrupts the
  live stream; mixed into the recording and saved as a separate track.
- **Intro videos:** upload short videos (soundtracks auto-levelled to
  speech loudness, video bounded at 720p H.264 - oversized or
  heavy-codec uploads are converted once so they play smoothly on
  every guest's machine) and fire one from the same bar -
  it takes over every screen fullscreen (in the session, the recording
  and on the stream), mutes everyone while it plays, then crossfades back
  to the grid.
- **Recording:** browser-side per-person (PCM, best for big sessions) or
  server-side (a host-panel switch, picked per session, locked while
  recording or live). Output: one combined MP4 (H.264/AAC, plays in any
  browser), a lossless `combined.flac` mixdown of everyone, and a
  lossless FLAC per participant (plus a `soundboard.flac` when clips
  were fired), named after the episode. Recordings can be
  previewed and downloaded from the dashboard - per file, or zipped
  bundles of all audio or all files in one click. The combined video matches the
  screen: everyone's tile, their lower-third name banners, the podcast
  logo + episode title block (the host drags it anywhere, resizes it,
  and right-clicks it for the rest: put the logo left of the title,
  right, above or below, pick the block's background colour, or drop
  the logo or the title for a session), spotlight when the
  host has spotlit someone, and any subscribe/ad overlays you triggered,
  at the moment you triggered them. Tile sizes, spacing and corners all
  come from one set of frame-relative fractions shared by the browser
  and the compositors, so the video is the picture people were on - the
  exception is a phone, which deliberately uses a two-column layout so
  faces stay big enough to see.
- **Your own channel:** every host has a permanent watch page at
  `/live/<username>` - one link to share, forever. Or put it on your
  own domain: enter it under Live streaming (say `live.fossnerds.org`),
  point the DNS at the server, and your audience watches right at your
  address - certificate included, nothing else to configure. "Go live" switches
  it on (HLS player, self-hosted hls.js, native on Safari, live viewer
  count); it shows "not live" between shows, switching itself without
  anyone refreshing. A separate "YouTube" button pushes RTMP too -
  either output alone or both at once, one shared encode, each with
  its own clock. When the channel stream ends, the exact video the
  audience watched is stitched losslessly into a ready recording.
  While live, the chat docks into the host's session view so the host
  reads and answers the room under their banner name without leaving
  the studio.
- **Live chat:** beside the video on the watch page - it appears when
  the show does. Off air, the page is a little waiting room instead:
  a built-in Asteroids (arrow keys and space, touch buttons on
  phones) keeps early arrivals company until the stream starts. Viewers pick a
  name and join in - no accounts, and nobody leaves the window. Words
  on the banned list are masked, never deleted: first and last letter
  kept, stars between ("f\*\*\*k"), whole words only, so ordinary words
  containing them are never touched. A default English list ships in
  `server/assets/banned-words.txt`; copy it to `data/banned-words.txt`
  to customise. Hosts appear under their own name and can block anyone
  from their messages - blocking bans the username AND the address, the
  person's messages vanish for everyone instantly, and the block list
  in the dashboard is visible and reversible (a mistake, or an accepted
  apology, is one click to undo). Viewer addresses never reach any
  client.
- **Publish to FOSSCast:** one click on a finished recording (live
  streams included) pushes the video to your
  [FOSSCast](https://github.com/lightmorphic/fosscast) instance as a
  draft episode - reviewed there before it goes public - using
  FOSSCast's publish API. The publisher token stays on the server; it
  never reaches a browser. FOSSCast is the episode archive and RSS
  half; the studio owns everything live.
- **OBS clean feed:** every session also has a view-only output link
  (`?output=1`) with no join screen and no controls - add it as an OBS
  Browser Source and stream the show from OBS to any platform. The feed
  is invisible to everyone in the session and can never appear in the
  recording. Copy it from the session row in the dashboard.
- **One look per show:** the theme (wallpaper, background colour, logo,
  episode title) is pinned the moment the first person joins and holds
  until the session empties - everyone, the recording and the stream see
  the same thing, even if settings change or the session is renamed
  mid-show.
- **Noise suppression:** RNNoise in the guest's browser (WASM worklet).
- **Email:** SMTP configured in the dashboard; all outgoing mail uses a
  branded HTML template with a plain-text fallback.

See [CHANGELOG.md](CHANGELOG.md) for release history and
[SECURITY.md](SECURITY.md) for the security policy. FOSSStudio is free
software under the [GNU GPL v3](LICENSE).

## Stack

Node.js + [mediasoup](https://mediasoup.org) SFU, Caddy (automatic
HTTPS, optional - bring your own reverse proxy instead if you
prefer), coturn (TURN relay), ffmpeg (recording/streaming), flat JSON
files, no database. One Docker Compose stack, everything self-hosted,
no external calls from any page.

## Layout

- `server/`: the app, signaling, media, auth, recording, streaming, ops
- `server/client/`: sources for the two bundled browser assets
- `server/test/`: end-to-end tests (Playwright, fake camera/mic)
- `web/`: everything the browser loads (guest pages, host dashboard)
- `scripts/`: server setup, deploy, rollback
- `docs/runbook.md`: plain-language operations guide
- `data/`: settings, recordings, backups (created at runtime; not in git)

## Running it

You need a Linux server with a public IP, a domain pointed at it, and
ports 80/443 (TCP) plus the media ranges 40000-40100 and 49160-49200
(UDP) open. There is no prebuilt image; the app container is built
from this repo.

1. On a fresh server, `bash scripts/server-setup.sh` installs Docker,
   sets the firewall and creates the folder layout.
2. Copy `.env.example` to `.env` and fill it in (domain, public IP,
   secrets; each value is explained in the file).
3. Start the stack:

```bash
docker compose up -d --build
```

Caddy fetches HTTPS certificates for your domain automatically. If
other apps on the same host need to share ports 80/443, point
`CADDY_SITES_PATH` at a folder of extra `.caddy` site files and the
bundled Caddy serves those too (set `CADDY_WWW_PATH` as well for their
static files - a site file then uses `root * /srv/www/<name>`). To
deploy updates from a dev machine instead of building on the server:
`FOSSSTUDIO_HOST=root@<ip> scripts/deploy.sh` (release folders with
instant rollback via `scripts/rollback.sh`).

### Bring your own reverse proxy (Nginx, Apache, etc.)

Already running Nginx or another proxy on your server and don't want
a second one? Use `docker-compose.byo-proxy.yml` instead of
`docker-compose.yml` - it's the same stack minus Caddy:

```bash
docker compose -f docker-compose.byo-proxy.yml up -d --build
```

This still binds the app to `127.0.0.1:${HTTP_PORT}` (3000 by
default), exactly like the Caddy stack does - your proxy just needs to
run on the same host (or in another host-networked container) and
point at that address. Two things Nginx doesn't do automatically that
Caddy does, both required or the app silently breaks:

1. **WebSocket upgrade headers.** The app's live signaling runs over
   `/ws`; without these headers the page loads but nothing ever
   connects.
2. **TLS termination.** Browsers only allow camera and microphone
   access on HTTPS pages, and session cookies are sent `Secure`-only,
   so the app requires HTTPS end-to-end. Terminate TLS in Nginx (e.g.
   with certbot) - plain HTTP cannot work.

Example server block:

```nginx
server {
    listen 443 ssl http2;
    server_name studio.example.com;

    ssl_certificate     /etc/letsencrypt/live/studio.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/studio.example.com/privkey.pem;

    # The app sets its own security headers (CSP etc.); HSTS belongs
    # here at the TLS terminator, matching the bundled Caddy setup.
    add_header Strict-Transport-Security "max-age=31536000" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name studio.example.com;
    return 301 https://$host$request_uri;
}
```

Everything else - the media ports (40000-40100/udp), coturn
(3478 + 49160-49200/udp), `PUBLIC_IP`/`DOMAIN` in `.env` - is
identical to the Caddy path; only the HTTP(S) front door changes.

### Cloudflare Tunnel

The web side works through a Cloudflare Tunnel (`cloudflared` pointing
at `http://127.0.0.1:3000`), with two things to know:

- **Media cannot go through the tunnel.** WebRTC video/audio is UDP
  straight between guests and your server, so the media ports
  (40000-40100/udp) and coturn ports (3478 + 49160-49200/udp) must
  still be open to the internet directly, and `PUBLIC_IP` set to your
  server's real public IP. A tunnel hides the web pages, not the
  media.
- **Set `TURN_HOST`.** With Cloudflare in front, `DOMAIN` resolves to
  Cloudflare's edge, which does not forward the TURN port. Point
  `TURN_HOST` in `.env` at an unproxied (grey-cloud) hostname or your
  raw server IP so guests behind strict NATs can still connect.

### Tailscale (private, no open ports at all)

For a studio reachable only inside your tailnet - nothing exposed to
the internet - run the `byo-proxy` stack and:

1. Set `BIND_HOST` in `.env` to your machine's Tailscale IP (the
   `100.x.y.z` address).
2. Serve it over HTTPS with `tailscale serve` (browsers refuse
   camera/microphone access on plain HTTP):
   `tailscale serve --bg https / http://100.x.y.z:3000`
3. Set `DOMAIN` to your machine's tailnet name (the
   `machine.tailnet-name.ts.net` one `tailscale serve` prints) and
   `PUBLIC_IP` to the Tailscale IP, so the media engine hands out an
   address every tailnet member can reach.

Guests then need to be on your tailnet (Tailscale's sharing features
cover inviting others). Everyone connects directly over the tailnet;
the TURN relay is rarely needed since Tailscale already handles
NAT traversal.

### Something not working? Run the setup check

Visit `https://your-domain/diagnostics` from the same browser and
network a guest would use. It checks the handful of things that
actually go wrong on a self-hosted install and says what to change:

- whether the page reached the browser over HTTPS (without it, browsers
  refuse camera and microphone access outright)
- whether `PUBLIC_IP` is set to an address guests can reach
- whether the live signaling socket connects, which is the check that
  catches a reverse proxy not forwarding WebSocket upgrades
- whether the TURN relay answers on its port
- which UDP ports still need to reach the machine directly

It needs no login, on purpose: a broken install often can't log in at
all (the session cookie is `Secure`-only, so plain HTTP never stores
it), and a check that needs a working install is no use. It takes no
input and reports only what a guest already learns on joining: the
domain, the announced IP and the port ranges. No secrets.

The most common cause of "everyone joins, nobody can see or hear
anything" is that the media ports never reach the server. Video and
audio go straight between guests and the server over UDP, so a reverse
proxy, a Cloudflare tunnel or an SSH tunnel carries the pages only.
On a home server, those UDP ranges need forwarding on the router.

## Tests

```bash
cd server
node test/call-test.mjs <url> <guests>   # multi-guest video flows
node test/host-controls-test.mjs <url> <password>
node test/recording-test.mjs <url> <password> browser|server
node test/streaming-test.mjs             # local only (file: destination)
node test/audio-energy-test.mjs          # noise suppression audio flows
node test/resume-orphaned-recording-test.mjs  # crash mid-render, self-heals on restart
node test/diagnostics-test.mjs           # setup check, incl. a proxy that drops WebSocket upgrades
node test/title-block-test.mjs <url> <password>  # logo/title block matches the video, host tools
node test/geometry-test.mjs <url> <password>     # live tile layout matches the compositors, grid and spotlight
node test/spotlight-record-test.mjs <url> <password>  # a spotlit session records as a spotlight
node test/fosscast-publish-test.mjs      # publish-to-FOSSCast flow against a stub instance
node test/live-watch-test.mjs            # watch page, chat, word filter, blocking, live DVR stitch
node test/channel-domain-test.mjs        # custom channel domains: claiming, TLS gate, page at the root
node test/firefox-compat-test.mjs <url> <password>  # same flows, real Firefox engine
```

The tests that need moving faces feed Chromium fake camera clips
(`.y4m`). They are generated locally rather than carried in the repo:
put them in `server/test/cams`, or point `CAMS_DIR` at wherever yours
live.

Day-to-day operations are dashboard buttons; see the
[runbook](docs/runbook.md) for the rare terminal cases.
