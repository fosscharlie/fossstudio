# FOSSStudio

Self-hosted video podcast studio — a StreamYard replacement for everyone.
Guests join by link with no account; the host runs everything from a web
dashboard. Live at https://fossstudio.fosscharlie.uk.

## What it does

- **Guest flow:** open link → preview screen (pick camera/mic, test them,
  set a name, noise suppression on by default) → join. Up to 10 people.
- **Host dashboard** (`/host/`): sessions, theme (banner, accent,
  wallpaper), recordings, streaming settings, security (password + 2FA),
  system (restart, backups, logs, full export).
- **In-session host controls:** spotlight/grid layout, per-guest volume,
  auto level balancing, start/stop recording, go live.
- **Recording:** browser-side per-person (PCM, best for big sessions) or
  server-side (small sessions). Output: one combined MKV + a lossless
  FLAC per participant, downloadable from the dashboard.
- **Streaming:** server-composited RTMP out to YouTube.
- **Noise suppression:** RNNoise in the guest's browser (WASM worklet).

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
