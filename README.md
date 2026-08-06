# FOSSStudio

Self-hosted video podcast studio — a StreamYard replacement for everyone.
Guests join by link with no account; the host runs everything from a web
dashboard. Live at https://app.fossstudio.org.

## What it does

- **Guest flow:** open link → preview screen (camera/mic/speaker pick,
  speaker test sound, mic meter, **camera zoom** — real lens zoom where
  supported, digital crop-zoom everywhere else — mirror toggle, name,
  noise suppression on by default) → join, arriving muted so there are
  no accidental hot mics. Up to 10 people; choices are remembered for
  next time.
- **Roles:** admins create and manage **hosts** (email invites — each
  host sets their own password) and look after the system; each host
  owns their sessions, recordings, branding and stream key.
- **In-session host controls:** spotlight/grid layout, per-guest volume,
  per-session auto level balancing, start/stop recording, go live.
- **Recording:** browser-side per-person (PCM, best for big sessions) or
  server-side (a per-host permission, picked per session — locked while
  recording or live). Output: one combined MKV + a lossless FLAC per
  participant, named after the episode. The combined video matches the
  screen: everyone's tile, their lower-third name banners, the episode
  title top-centre, and any subscribe/ad overlays you triggered, at the
  moment you triggered them.
- **Streaming:** server-composited RTMP out to YouTube, with the same
  lower-third banners and overlays as the session view.
- **Noise suppression:** RNNoise in the guest's browser (WASM worklet).
- **Email:** SMTP configured in the dashboard; all outgoing mail uses a
  branded HTML template with a plain-text fallback.

See [CHANGELOG.md](CHANGELOG.md) for release history and
[SECURITY.md](SECURITY.md) for the security policy. FOSSStudio is free
software under the [GNU GPL v3](LICENSE).

## Stack

Node.js + [mediasoup](https://mediasoup.org) SFU, Caddy (automatic
HTTPS), coturn (TURN relay), ffmpeg (recording/streaming), flat JSON
files — no database. One Docker Compose stack, everything self-hosted,
no external calls from any page.

## Layout

- `server/` — the app: signaling, media, auth, recording, streaming, ops
- `server/client/` — sources for the two bundled browser assets
- `server/test/` — end-to-end tests (Playwright, fake camera/mic)
- `web/` — everything the browser loads (guest pages, host dashboard)
- `scripts/` — server setup, deploy, rollback
- `docs/runbook.md` — plain-language operations guide
- `data/` — settings, recordings, backups (created at runtime; not in git)

## Running it

Copy `.env.example` to `.env`, fill it in, then:

```bash
docker compose up -d --build
```

Deploys from a dev machine: `FOSSSTUDIO_HOST=root@<ip> scripts/deploy.sh`
(release folders with instant rollback via `scripts/rollback.sh`).

## Tests

```bash
cd server
node test/call-test.mjs <url> <guests>   # multi-guest video flows
node test/host-controls-test.mjs <url> <password>
node test/recording-test.mjs <url> <password> browser|server
node test/streaming-test.mjs             # local only (file: destination)
node test/audio-energy-test.mjs          # noise suppression audio flows
```

Day-to-day operations are dashboard buttons — see the
[runbook](docs/runbook.md) for the rare terminal cases.
