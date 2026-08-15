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
  owns their sessions, recordings, branding and stream key.
- **In-session host controls:** spotlight/grid layout, per-guest volume,
  per-session auto level balancing, start/stop recording, go live.
- **Soundboard:** upload short clips (laughs, applause, stings) in the
  dashboard - auto-levelled to speech loudness so nothing blasts - then
  fire them one-click in-session - played over everyone,
  or with all mics muted for the clip's length and then restored.
  Carried on an always-on audio channel so a clip never interrupts the
  live stream; mixed into the recording and saved as a separate track.
- **Intro videos:** upload short videos (soundtracks auto-levelled to
  speech loudness) and fire one from the same bar -
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
  logo + episode title block (draggable anywhere by the host), and any
  subscribe/ad overlays you triggered, at the moment you triggered
  them.
- **Streaming:** server-composited RTMP out to YouTube, with the same
  lower-third banners and overlays as the session view.
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
HTTPS), coturn (TURN relay), ffmpeg (recording/streaming), flat JSON
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
bundled Caddy serves those too. To
deploy updates from a dev machine instead of building on the server:
`FOSSSTUDIO_HOST=root@<ip> scripts/deploy.sh` (release folders with
instant rollback via `scripts/rollback.sh`).

## Tests

```bash
cd server
node test/call-test.mjs <url> <guests>   # multi-guest video flows
node test/host-controls-test.mjs <url> <password>
node test/recording-test.mjs <url> <password> browser|server
node test/streaming-test.mjs             # local only (file: destination)
node test/audio-energy-test.mjs          # noise suppression audio flows
node test/resume-orphaned-recording-test.mjs  # crash mid-render, self-heals on restart
node test/firefox-compat-test.mjs <url> <password>  # same flows, real Firefox engine
```

Day-to-day operations are dashboard buttons; see the
[runbook](docs/runbook.md) for the rare terminal cases.
