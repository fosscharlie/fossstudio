# Changelog

All notable changes to FOSSStudio are documented here.

## Unreleased

- The offline watch page wears the show's own logo when the host has
  uploaded one (the stock icon stays for everyone else), and asks the
  visitor to check back for the next show.
- The watch page off air is now a waiting room instead of a dead end:
  the chat is gone until the show actually starts (it used to sit
  there saying "not connected" if you typed), and in its place there's
  Asteroids: arrow keys turn and thrust, space fires, rocks split,
  the screen wraps, waves build - and on a phone the corners grow
  steer/thrust/fire buttons. Drawn in the page's own look, no assets,
  no storage, nothing leaves the page. The moment the stream starts
  the game steps aside and the player and chat take over.
- A host can put their channel page on their own domain: enter it under
  Live streaming ("Channel domain", for example `live.fossnerds.org`),
  point the domain's DNS at the server, done - the certificate is
  fetched on demand exactly like the panel domains, and the audience
  watches at the domain itself, no path needed. The `/live/<username>`
  link keeps working, the dashboard's copy button hands out the custom
  address once one is set, and clearing the field releases the domain.
  A domain can only be claimed by one host, and the studio's own names
  are off limits.

## 1.6.0 - 2026-08-20

- Both colour palettes now share one layout: fifteen colours in three
  rows of six, with the hex box filling the right half of the third
  row - the banner and title tools were laid out differently before.
  The palette grew from eight to fifteen colours (guests picking their
  own banner colour get the full set too).
- The guest-card controls (noise reduction, microphone, spotlight) are
  now icons; hovering shows a plain name for each - no more "click to
  turn off" instructions.
- Going live is now two independent buttons: "Go live" runs your own
  channel page (video, chat, and the saved copy), "YouTube" pushes the
  RTMP stream - either alone or both at once, on one shared encode,
  each with its own running clock in the host controls.
- Every host has a permanent channel link: `/live/<username>` (for
  example `/live/fossnerds`). It never changes between shows - share it
  once, and it switches itself on whenever one of your sessions goes
  live on the channel, back to "not live" when it ends. Session-id
  watch links keep working; the dashboard's copy button now hands out
  the channel link.
- While live on the channel, the chat docks into the left side of the
  host's session view: read the room, reply under your banner name,
  and block people straight from their messages - without leaving the
  studio. (The pop-out chat window button is gone; this replaces it.)
- The logo/title block's controls moved into a right-click menu on the
  block itself - the hover toolbar kept vanishing before the pointer
  could reach it, and the "drag to move" tooltip pill is gone too
  (dragging still works, left button). The menu also gained logo
  placement: left of the title (the new default), right, above or
  below - mirrored exactly in recordings and streams.
- The logo/title block's background colour is now pickable (host
  controls, "Title colour"): swatches or a hex code, light backgrounds
  flip the text dark automatically, and recordings and streams follow.
- Host controls redesigned at half the width: active states are calm
  grays instead of bright yellow (Mute all, NR, per-guest mute and
  spotlight - the raised hand keeps its yellow, and recording/live
  keep their red), the colour tools sit behind two small buttons
  instead of always-open swatch rows, and Record / Go live / YouTube
  are stacked full-width so their clocks never squeeze.
- Intro videos are now bounded at 720p H.264: an upload above that (or
  in a heavy codec like VP9/HEVC/AV1) is converted once at upload, and
  intros uploaded before this are converted automatically at the next
  start-up. Uploads already within bounds keep their video untouched,
  so the server only spends encode time when a file would otherwise be
  expensive for guests. The whole pipeline is 720p (the stream and the
  recording canvas both), so nothing visible is lost - what is gained
  is that a fullscreen intro can no longer pin every core on a
  participant's machine, which is exactly what froze a real host's
  computer mid-test: the intro video decoding in software on top of
  WebRTC and noise suppression.
- Dedicated panel domains, zero configuration: point the DNS of
  admin.<your-domain> and host.<your-domain> at the server and each
  front door leads straight to its own login - the fleet panel on one,
  host dashboards on the other. The bundled Caddy fetches their
  certificates on demand, gated by an allowlist the app derives from
  `DOMAIN` (so no other name pointed at the server can ever mint a
  certificate). `ADMIN_DOMAIN`/`HOST_DOMAIN` exist only to override
  the derived names with something custom.
- The admin (fleet) panel and host dashboards are now separate
  sessions: admins sign in at `/admin/`, hosts at `/host/`, each with
  its own cookie - so the fleet panel and a host login can be open in
  the same browser at the same time, and logging out of one leaves the
  other signed in. The login page is shared and sends each account to
  its own panel. Existing host sessions carry over; admins sign in
  once more after updating.
- The site root now forwards to the host login (or straight into the
  host dashboard when signed in) - even when the admin panel is open
  in another tab. The old static landing page at / is gone - guests
  never saw it anyway, they arrive on session links.
- The bundled Caddy can now serve static sites for the other apps that
  share ports 80/443, not just proxy to them: `CADDY_WWW_PATH` mounts a
  folder of web roots at `/srv/www` (read-only), so an imported `.caddy`
  site file can use `root * /srv/www/<name>`. Companion to the existing
  `CADDY_SITES_PATH`; the default empty folder is a no-op. Mounts that
  were hand-added to a running compose file did not survive deploys -
  this one is in the repo, so it does.

## 1.5.0 - 2026-08-19

- Admin panel: setting a user's password now happens inline in the
  user's row - type it, press the tick - instead of a browser pop-up.
- Admin panel: the email settings show a green tick beside the password
  field once one is stored ("saved - leave blank to keep it"), instead
  of a note you had to read.
- Backups: how many to keep is now a setting (default 5, up to 100),
  in System - Backups. Lowering it prunes the oldest straight away,
  not just after the next backup. Previously a fixed 14 were kept.
- "Enable notifications" now says what actually went wrong instead of
  a blanket "couldn't enable notifications on this browser", and the
  push key is handed to the browser as bytes rather than text - some
  browsers refuse the text form, which is exactly the silent failure
  that made the button appear broken.
- The studio now has its own live watch page: "Go live" streams the
  composited show to `/live/<session>` on your domain, with an HLS
  player (self-hosted hls.js, native on Safari), a live viewer count,
  and chat beside the video - nobody needs YouTube, and nobody leaves
  the window. The page switches itself on when the stream starts and
  off when it ends. Each session row has a copy-the-watch-link button
  and the host controls get a chat window button while live. YouTube
  (or any RTMP destination) can ride along on the same encode when
  configured; going live no longer requires a stream key at all. When
  the stream ends, the exact video the audience watched is stitched
  losslessly into a ready recording. This is the live layer FOSSCast
  handed over (its docs/live-handover.md): FOSSStudio owns everything
  live, FOSSCast is the episode archive and RSS half.
- Live chat: viewers pick a name and talk while they watch, no
  accounts. Words on the banned list are masked, never deleted - first
  and last letter kept, stars between ("f\*\*\*k"), whole words only, so
  ordinary words containing them are untouched. A default English list
  ships in `server/assets/banned-words.txt` (copy to
  `data/banned-words.txt` to customise). Hosts appear under their own
  name and can block anyone from their messages: blocking bans the
  username AND the address, the person's messages vanish for everyone
  instantly, and the dashboard's block list is visible and reversible,
  for when a block was a mistake or an apology is accepted. Viewer
  addresses never reach any client, hosts included.
- Publish to FOSSCast: a button on each finished recording (live
  streams included) uploads the video and creates a draft episode over
  FOSSCast's publish API, with the publisher token kept server-side.
- Spotlight now reaches the recording and the stream. It changed the
  session view only: the compositors never read it, so a show where the
  host spotlit someone recorded as a plain even grid. Both now lay the
  featured person above a strip of everyone else, the same as the
  screen. A recording renders once, when it ends, so a mid-take change
  applies to the whole take; the stream follows changes as they happen.
- Fixed: tiles were a different size and spacing in the video than on
  screen. The live grid used fixed 50px padding and gaps while the
  compositors used 24 and 20 of a 1280px frame, so recordings came out
  noticeably tighter and more zoomed in than the session people were
  looking at, with corners a different roundness too. All three now come
  from one set of frame-relative fractions in `server/src/composite.js`,
  which the browser mirrors. Phone layout is deliberately left alone:
  two columns and tighter spacing, so faces stay big enough to see.
- Fixed: in spotlight the strip tiles hide each person's subtitle on
  screen, but the banner baked into the video still carried it.
- Fixed: `test/streaming-test.mjs` wrote to one machine's scratch
  directory, like `banner-test.mjs` did.
- Every field on the join screen now has an "i" beside it that explains,
  on hover or keyboard focus, what the field is for. The two banner
  fields say what they actually end up as: the title is the big line
  under your video, the subtitle is the smaller line under it and a good
  place for a website, an email address or a social handle.
- The episode logo/title block can now be resized as well as dragged,
  and the host can drop either the logo or the title for a session
  without changing the saved settings. The controls appear on the block
  itself when the host hovers it. Dropping both leaves the host a faint
  handle to bring them back; guests, the recording and the stream see
  nothing at all.
- Fixed: the block was a different size on screen than in the recording.
  It was sized in viewport units while the compositors used a fixed
  fraction of the video frame, so the two drifted apart by up to 38% on
  a wide screen, and further again for the host, whose video area is
  narrower because of the sidebar. Both now use the same fraction, so
  the block is the same size on every screen and in the video.
- Fixed: the block was also up to 2.7x taller in the video than on
  screen, because the uploaded PNG reserved a fixed height for the title
  whatever the text did. It is now content-height, like the block on
  screen.
- Fixed: a session with no logo and no episode title left an empty box
  floating over the video. The rule meant to hide it was outranked by
  the rule that lays it out, so it never applied.
- Fixed: `test/banner-test.mjs` pointed at one machine's scratch
  directory for its fake cameras and a hard-coded port, so it only ever
  ran for whoever wrote it. It now generates its own cameras and takes
  the URL like the other tests.
- New setup check at `/diagnostics` for anyone self-hosting this. It
  reports whether the page arrived over HTTPS, whether `PUBLIC_IP` is
  an address guests can actually reach, whether the signaling socket
  connects (the check that catches a reverse proxy not forwarding
  WebSocket upgrades), whether the TURN relay answers, and which UDP
  ports still need to reach the machine directly. Every failure says
  what to change rather than only that something is wrong. It needs no
  login on purpose: a broken install often cannot log in at all, since
  the session cookie is Secure-only and plain HTTP never stores it. It
  takes no input and reports only what a guest already learns on
  joining, so no secrets are exposed.
- A session that connects but carries no video or audio now says so.
  Previously the tiles just sat black and silent with nothing on screen
  explaining why, which is indistinguishable from the app being broken;
  the media transports are now watched and a banner explains what
  happened, with a link to the setup check for the host.
- Self-hosting behind your own reverse proxy (Nginx, Apache, etc.)
  instead of the bundled Caddy is now a documented, first-class path:
  a new `docker-compose.byo-proxy.yml` runs the app + coturn without
  Caddy, and the README explains the two things a non-Caddy proxy must
  set up itself - WebSocket upgrade headers and TLS termination -
  with a working Nginx example.
- Two new optional env vars for setups beyond a same-host proxy:
  `BIND_HOST` (the address the app listens on; still 127.0.0.1 by
  default, settable to e.g. a Tailscale IP) and `TURN_HOST` (where
  guests reach the TURN relay; defaults to `DOMAIN`, needed when
  DOMAIN sits behind Cloudflare, whose edge doesn't forward the TURN
  port). The README now documents Cloudflare Tunnel and fully-private
  Tailscale setups, including the parts that can't change: WebRTC
  media can't ride an HTTP tunnel, and browsers require HTTPS for
  camera/mic access.
- Bumped the app image from Node 20 to Node 22. mediasoup 3.24 (the
  version this project already runs) declares Node >=22 as its own
  minimum - Node 20 happened to still work, but was already outside
  what upstream tests against and supports.
- Firefox: added a compatibility test that runs the core flows (join,
  camera/mic, WebRTC call, RNNoise noise suppression, speaker-selector
  graceful degradation, browser-side recording and processing) through
  a real Firefox engine rather than assuming Chrome-family coverage is
  enough. Confirmed clean: no console errors anywhere in the app, and a
  Firefox-recorded session processes to a correct mono `combined.mp4` /
  `combined.flac` / per-person FLAC exactly like Chrome. Speaker
  selection already degraded correctly for browsers without `setSinkId`.
- Deploys now wait (up to 3 minutes) for any in-flight recording render
  to finish before restarting the app - a new `/render-status` endpoint
  reports whether one is running, and `scripts/deploy.sh` checks it
  before recreating the container. Belt-and-braces alongside the
  auto-resume above: this avoids the interruption happening at all in
  the common case, deploy time permitting; if a render is still going
  after 3 minutes, or the check is unreachable, the deploy proceeds
  anyway and the resume mechanism covers it either way.
- Reliability: a recording interrupted mid-render (the server process
  dying before it finishes - a deploy recreating the container is
  exactly what did this once, and cost a real show its combined video)
  used to be stuck on "processing" forever with no active render behind
  it. The server now snapshots an in-progress recording's state to disk
  as it goes, and automatically resumes and finishes any interrupted
  one the moment it next starts up - no manual recovery needed. An
  alert email goes out when this happens so it's never silent.
- Recordings now include a `combined.flac`: every participant's voice
  (plus any soundboard clips and intro audio) mixed into one lossless
  file - the same mix as `combined.mp4`'s audio track, but full
  quality instead of AAC. Downloads and the "download all audio" zip
  bundle pick it up automatically.
- Caddy can now serve extra sites alongside FOSSStudio: the Caddyfile
  imports any `.caddy` files from a mounted sites folder (default
  `./caddy-sites`, override with `CADDY_SITES_PATH`). Lets other apps
  on the same host share ports 80/443 without their own reverse proxy.
  A no-op when the folder is empty, so existing setups are unaffected.
- Deploy hardening: GitHub access moved to a dedicated, repo-scoped SSH
  deploy key (no more shared credential). VPS deploy access moved to
  its own dedicated key, forced-command restricted server-side to
  exactly the deploy actions `deploy.sh`/`rollback.sh` need - upload,
  activate, start, health-check, prune, roll back - with no shell
  access even though the account is root. Verified end-to-end with a
  real deploy through the restricted key.

## 1.4.0 - 2026-08-10

OBS clean-feed links for streaming anywhere, a pinned per-session theme,
session renaming, true-mono audio, zip download bundles, auto-levelled
clips, elapsed timers on record/go-live, and two important fixes:
mid-recording joiners are no longer lost from recordings, and zoomed
cameras no longer freeze in background tabs. The app image is also a
much leaner two-stage Docker build.

- Fixed: anyone who joined (or rejoined) while a recording was already
  running was never captured - their tile went black in the combined
  video and they got no audio track, even though everyone saw and heard
  them live. The "start recording" signal could arrive a moment before
  the client was ready to listen and was silently dropped; such early
  events are now queued and replayed. New regression test covers a
  mid-recording joiner.
- The host's record and go-live buttons now show a running elapsed
  timer. Idle they read "Record" / "Go live"; active they show just a
  stop square and the clock ("12:34"), so the button never changes
  width and its neighbours never shift. The clock stops when you do,
  and survives a host reload mid-take (the true start time comes from
  the server). Tooltips spell out what a click does in each state.
- All audio output is now true mono: microphones are one channel, but
  captures arrived as stereo with the voice only in the left speaker.
  The per-person FLACs, the combined MP4, the soundboard track and the
  live stream all fold to mono (voices keep full level; clip and intro
  music is downmixed properly), so playback is centred everywhere.
- Leaner install: the app image is now a two-stage Docker build - the
  C++ toolchain that compiles the media engine never ships, and npm is
  removed from the running container (nothing installs at runtime, so a
  package manager in production is pure attack surface).
- Name banners slimmed down: text a touch smaller (85% of the old
  size), tighter padding, and the banner now hugs its text - just a
  touch wider than the words - instead of always spanning 38% of the
  tile. The recording and stream composites match.
- Sessions can be renamed: a pencil icon on each dashboard session row
  edits the episode title in place (Enter saves, Escape cancels).
- The theme is now pinned for the whole life of a session: wallpaper,
  background colour, logo and episode title are frozen the moment the
  first person joins, so everyone - including people who leave and come
  back, the recording and the live stream - sees the same thing even if
  the settings (or the session name) change meanwhile. New settings
  apply from the next gathering, once the room has fully emptied.
- Recordings: each card now has a bottom action row with two one-click
  bundles - download all audio (the FLACs, zipped) and download all
  files (everything, zipped) - and the whole-recording delete moved down
  there too, in line with the per-file deletes.
- Soundboard clips and intro videos are auto-levelled to speech loudness
  (EBU R128, -16 LUFS) when uploaded, so a hot music file no longer
  blasts over the guests - in the session, on the stream and in the
  recording alike. Already-uploaded clips can be re-uploaded to get the
  same treatment.
- Fixed: a zoomed camera froze for everyone whenever that guest switched
  to another tab (browsers suspend the drawing loop in hidden tabs; the
  zoom now draws on a worker clock that keeps ticking).
- OBS clean feed: every session now has a view-only output link
  (session link + `?output=1`) that skips the join screen and shows
  nothing but the show - the live grid, name banners, title block,
  overlays and intros, with all audio. Add it to OBS as a Browser
  Source and stream from OBS to any platform. Clean-feed viewers are
  invisible: no tile, no notification, never in the recording, and they
  don't use up guest slots (up to 4 feeds alongside the usual 10
  people). If the connection drops the feed reconnects by itself. A new
  camera-screen icon on each dashboard session row copies the link.
- Account: you can now rename your account (your login name) from
  Settings -> Account - handy when repurposing it for a different podcast.
  The session is keyed on the account id, so a rename never logs you out.
- Recordings list redesigned: each recording is a card with its title and
  date, the status and delete button pinned top-right (no longer floating
  mid-row), and its files in a two-column grid of chips.
- Recordings: each file (a FLAC or the combined MP4) can now be deleted on
  its own, not just the whole recording.
- Delete controls are consistent everywhere - a trash icon that swaps to a
  tick on first click and deletes on the second (the session-delete style):
  now also on each recording file and on Sounds/Intros (was a "Remove"
  text button).
- Dashboard: a main-menu item with a single section (Sessions, Recordings,
  Hosts) no longer shows a one-button submenu - the menu item alone opens
  the pane, and the layout drops the empty submenu column. Menus with two
  or more sections (Effects, Settings, System) are unchanged.
- Settings: trimmed the background-colour picker to 11 swatches (one
  representative shade per hue, down from 19) and moved the hex code field
  next to the swatches instead of below them.

## 1.3.0 - 2026-08-08

Soundboard and fullscreen intro videos fired from the session, an
**Effects** menu in the dashboard, recordings and streams that match the
on-screen look (background, gaps, rounded corners), in-dashboard previews,
complete account deletion, and the earlier security hardening. Headline
fix: recordings no longer run away during processing.

### recording fixes

- **Fix: recordings could run away and never finish.** The new background
  is an endless looped source; with browser-recorded WebM (which carries
  no duration metadata) `-shortest` didn't reliably terminate the render,
  so `combined.mp4` grew without bound (seen as "processing" stuck for
  hours). The render is now **hard-capped with `-t`** at the real session
  length, probed from the per-participant FLACs.
- **Faster wallpaper backgrounds**: the wallpaper is scaled to the canvas
  **once** instead of being re-scaled on every frame - in both the
  recording and the live stream.

### recordings and stream look like the screen

- The combined recording **and the live stream** now **match the
  on-screen presentation**: the session **background** (the wallpaper if
  set, otherwise the background colour) shows behind and between the
  tiles, there are **gaps** between videos, and each tile has **subtly
  rounded corners** - instead of the old flat, gapless black grid.
  Lower-third banners and the title chip composite as before.
- Rounded corners use a generated alpha mask + `alphamerge` per tile; on
  the live stream that's a little extra real-time work, so very large
  (9-10 person) live grids are worth a CPU sanity-check on the VPS.

### complete deletion

- **Deleting a host account now purges all of its content** - recordings
  (and their files on disk), sessions, uploaded media (wallpaper, logo,
  ad-banner, sounds, intros) and its push subscription - not just the
  account record. Per-item deletes already removed their files; this
  closes the gap for account deletion, so nothing is left behind for
  privacy

### dashboard previews

- **Preview in the dashboard**: play/stop is a single **toggle icon**
  button (with a tooltip) that swaps in place - no separate Stop button and
  no reflow. Audio (sounds, recording tracks) plays inline; video (intros,
  the combined recording) opens in a **centred modal** (close with Esc, the
  ✕, or the backdrop)
- **Recordings library** lists each file with a play/stop toggle and a
  download icon, matching the Media layout, plus the per-recording Delete
- **Combined recording is now MP4** (H.264/AAC, `+faststart`) instead of
  MKV, so it previews in any browser and is a universal download; the
  per-participant FLACs and the `soundboard.flac` are unchanged

### media UI

- **Soundboard moved to the bottom control bar**: a dedicated button sits
  with mute / raise-hand / camera; it opens a **thin strip across the
  bottom of the video area** (Intros and Sounds side by side in one row)
  instead of a tall floating panel. Click the button again or the ✕ to
  close
- **Sounds and Intros now live under their own "Effects" main menu** in
  the dashboard, out of Settings
- **Recordings list**: ready recordings drop the status word (their files
  are right there); processing shows a small red spinner, recording a
  pulsing red dot

### intro videos

- **Intro videos**: upload short videos in Settings → Intros (up to 5,
  MP4 or WebM, 80 MB each), then fire one from the Soundboard bar. It
  **takes over every screen fullscreen**, mutes everyone while it plays,
  and returns to the grid when it ends, restoring mutes
- **Crossfades** in the recording and in the live in-room view: the grid
  dissolves into the intro and back (~0.4s), with the audio fading to
  match. The live stream stays a cut (it relaunches to the file), masked
  by the takeover
- Baked into the recording (full-frame over its window, positioned at its
  trigger time, with its audio) and shown fullscreen on the live stream -
  the stream cuts to the file at full quality and back
- Length and whether the video has an audio track are measured on upload,
  so the stream and recording never mis-handle a silent intro

### soundboard

- **Soundboard**: the host uploads short audio clips (laughs, applause,
  transition stings) in Settings → Sounds, then fires them one-click from
  a new **Soundboard** bar in the session's host controls - up to 20 clips
  (MP3, WAV, OGG, AAC, M4A or WebM, 5 MB each)
- Each clip plays two ways: **▶ Play over** everyone (laughter under the
  chat), or **🔇 Mute + play** - every mic is silenced for the clip's
  length and then restored to exactly how it was (transition stings)
- Clips are carried on an always-on audio channel the host opens at join,
  so firing one **never relaunches the live stream** - no blip, no stall
- Everyone in the session hears clips live; they mix into the YouTube
  stream automatically
- Recordings get the clips **mixed into `combined.mp4` and exported as a
  separate `soundboard.flac` track**, straight from the source files, so
  the clip level can be remixed in post - works in both browser and
  server recording modes

### security hardening

- App container now runs as a non-root user (uid 1000) instead of root
- Content-Security-Policy header added (strict script-src 'self'; the
  two previously-inline dashboard scripts are now external files)
- Data files (password hashes, SMTP credentials, sessions) are written
  and stored owner-only (0600) instead of world-readable
- Docker image rebuilds with OS patches (`apt upgrade` + `--pull` each
  deploy); dependencies on patched node-tar/minimatch

### Repo and docs cleanup

- README rewritten for the public: no personal server links, and a
  truthful "Running it" section (prerequisites, ports, no prebuilt
  image, setup script, env file, compose)
- `.env.example` and the runbook use placeholder domains; the legacy
  redirect in the Caddyfile is now driven by an optional
  `LEGACY_DOMAIN` env var instead of a hard-coded personal domain

## 1.2.0 - 2026-08-06

A day of host-driven refinement: the session view, host panel and
recording pipeline all now match what is on screen.

- **Host panel tidied**: the browser/server recording switch is now an
  icon button beside Go live and Auto level (lit when server mode is
  picked, locked while recording or live), and divider lines separate
  the controls from the guest cards and the guest cards from the build
  number

- **The browser/server recording switch is available to every host**
  in the host panel (no admin permission needed any more - the
  per-host "allow server-side recording" setting is gone); it locks
  while recording or live

- Video spacing: 50px everywhere on desktop (was 80), a small 20px on
  tablets and 12px on phones - the videos themselves get bigger

- **Auto level is on by default** for every session
- The recording light no longer blinks - steady red while recording
- **While recording, guests' controls dim to half automatically** and
  brighten when the pointer (or finger) moves over them; no button -
  it follows the recording state

- Dim mode no longer fades the logo/title block (it stays at full
  brightness), and the dim button is host-only - guests don't see it

- **Recording light**: a round indicator in everyone's control row -
  grey normally, red and blinking while the session records, with a
  hover explanation. The "● REC" text on the logo/title block is gone

- **Accent colour selector removed** - the dashboard is fixed to the
  brand yellow; the menu highlight is a solid yellow-navy chip with
  white text
- Settings submenu order: Themes, Ad Banner, Streaming, Account,
  Two-factor

- Settings naming: the "Podcast banner" submenu and its
  "Advertising / support banner" panel are both now "Ad Banner"

- **Everyone joins muted** - the host too, even when alone; unmute
  yourself when you're ready to talk
- Themes pane order: Accent colour, Podcast logo, Background colour,
  Wallpaper

- **Background colour** in Settings → Themes: same palette as the
  accent plus a hex field for any custom colour, shown behind the
  video grid in sessions - a wallpaper overrides it; with no wallpaper
  the colour shows

- **New grid layout**: the host is always top-left; everyone is the
  same size; rows balance and centre themselves (2 side by side; 3 =
  two up, one centred below; 5 = 3+2; 7 = 3+2+2; 8 = 3+3+2; 9 = 3×3) -
  identical on screen, in recordings and on the live stream
- **Fix**: on the host's screen the logo/title block could jump to the
  middle-right - a stylesheet clash with its drag tooltip

- **Fix**: the logo/title block stretched to the height of a video row
  on the host's screen when a second participant joined
- The block now **scales down with the viewport** so tablets and
  phones lose less video space to it
- Video spacing set to **80px** - sides, top, bottom and between
  tiles - scaling down proportionally on smaller screens

- Episode title in the logo block never exceeds the 250px logo width:
  one ellipsised line beside a logo, up to three lines when text-only

- **Podcast logo block**: upload a logo in Settings → Themes (about
  250×50) and it appears above the episode title in a compact block
  floating over the video - text-only when there's no logo - baked
  into recordings and streams the same way. The host can **drag the
  block anywhere** on the video with the mouse; everyone's screen and
  the composited video follow (a live stream applies a new position at
  its next relaunch)
- The old page-top title bar is gone; the block replaces it
- **Mute now transmits silence instead of stopping audio packets** -
  fixes live streams stalling or failing to start when anyone (e.g. a
  join-muted guest) was muted
- Video grid spacing doubled (16px all round) so the wallpaper shows
  through

- The red muted badge on video tiles is gone - mute state shows in the
  host panel and on your own mic button only

- **Phones and tablets in portrait**: your own video now sits in the
  grid with everyone else (same size, same place as when held
  horizontally) instead of a small bottom-corner overlay - so you can
  see where you are in the video; the floating title chip shrinks to
  just the REC/LIVE indicator on small screens (the top bar still
  shows the episode title)

- **Guests join muted by default** - mic button starts muted, the tile
  shows the badge, and the mic only opens when the guest unmutes
  themselves (or the host unmutes them)

- Banner palette: the last swatch is now the default banner grey
  (#1e2127) instead of green, so the host can always click back to the
  default look

- Subscribe reminder casing: "Enjoying the show?" / "Subscribe and
  turn on" / "ALL NOTIFICATIONS"

- Portrait (vertical) camera feeds now crop to the **middle** of the
  frame instead of the top - in the live grid, the preview, recordings
  and streams alike

- **Speaker row always shows** - tablets and phones that hide their
  audio outputs get a "Default speaker" entry and a working test
  sound; a Bluetooth speaker still appears as a second choice where
  the browser allows switching
- Join screen: banner title on the left and subtitle on the right,
  sharing one line on every screen size

- Subscribe reminder text is now three lines: "Enjoying the show?" /
  "Subscribe and Turn on" / "All notifications" - in the session
  overlay and the animation baked into recordings and streams

- **Mute all now includes the host** - it mutes every single person in
  the session, you included, and Unmute all brings everyone back

- **Episode title, front and centre**: shown in a large chip floating
  over the video (plus a slim bar at the top of the page), and baked
  into the combined recording and the live stream, top-centre - so the
  published video is titled like the screen
- **Recordings are named after the episode** instead of the session
  code; episode titles are now required when creating a session
- **Better mute indicator**: a red round mic-off badge in the tile's
  corner replaces the 🔇 emoji
- **Subscribe overlay bell** is now a proper drawn bell that rings
  (fast decaying swing) - in the session overlay and in the video baked
  into recordings and streams
- Session pages and the service worker are served with no-store
  caching and force a worker update on load, and the host panel shows
  a small build number - ending stale-code confusion for good

- Dashboard main-menu highlight is now a solid accent chip with white
  text (the translucent accent wash made the label hard to read)

- Website: even spacing between the feature blocks (no double-height
  gaps); screenshot taglines shortened so nothing is cut off
- Session tagline text slightly smaller so realistic taglines fit the
  fixed-width banner without truncating (recordings/streams match)

- **Session banner shows the episode title** you typed when creating the
  session - the per-host "podcast name" setting is gone, so one system
  can run several different podcasts side by side
- **Accent colour is now the dashboard's own** (menus, buttons and
  highlights, applied and saved the moment you click a swatch - no save
  button); the session view no longer follows it
- **Mute all is now a real toggle**: it lights up and flips to "Unmute
  all" once every guest is muted, and clicking it again unmutes them
- **Auto level is a button** beside "Go live" (equaliser icon, lights up
  when on) instead of a toggle row
- Wallpaper settings now state the ideal size (1920×1080)

- **What you see is what you record**: the lower-third name banners are
  now baked into the combined recording and composited onto the live
  stream, exactly as they look on screen (colours, names, taglines).
  The host's browser renders each banner to an image and uploads it;
  changing colours while live causes a ~2-second stream blip while the
  compositor relaunches
- **Settings reorganised**: *Themes* (accent colour + wallpaper) and
  *Podcast banner* (the advertising/support banner upload, moved out of
  Streaming)
- **Compact host panel**: guests sit in boxed cards, two per row, with
  the name centred - ten guests fit without scrolling (verified by an
  automated ten-guest test); Mute all / Subscribe / Ad share one line;
  your own card is marked with a small person icon (hover: "This is
  you") instead of "(you)" text
- **Modern subscribe overlay**: floating rounded card with a red
  SUBSCRIBE button and bell - same look in the session, the recording
  and the live stream
- The browser/server recording switch lives in the host panel and
  **locks while recording or live** - the capture pipeline can't change
  mid-take
- Session pages now cache-bust their scripts and styles on every
  release, so browsers can't keep serving a stale session view

- **Overlays**: host-panel buttons play a subscribe/notification-bell
  animation or show an uploaded advertising banner (Settings →
  Streaming). They appear instantly in everyone's session view (no need
  to be live - test any time), are **baked into recordings** at the
  moment you pressed them, and composite onto the live stream when live
- Host panel rows: name on its own line (fits 24-char names), buttons
  beneath; hosts can **lower a raised hand**
- **Raise hand**: guests press a hand button when they want to talk;
  their row lights up in the host panel, and unmuting them lowers it
- Mute lights turn red; colour picker spacing fixed

- Portrait phone cameras crop like everyone else's tile, keeping the
  **top** of the frame - in the live grid, recordings and streams alike
- Banners are a fixed size: long text truncates instead of growing the
  banner; title capped at 24 letters, subtitle at 32 (limits shown on
  the join screen)

- Noise reduction is now controlled **per guest from the host panel**
  (small NR button beside Mute/Spotlight, state visible at a glance);
  the guest-facing option is gone and it defaults to on
- **Live sound meters** for every participant in the host panel, so the
  host can see who's making noise

- The host panel is a fixed sidebar, always open for the host - the
  video grid sizes itself around it; a **dim** button fades all controls
  (and brightens them on hover) instead of open/close
- Guests can pick their **own banner colour** from the palette when the
  host enables it - a palette button appears in everyone's controls

- Host panel: your own volume slider, per-guest **Mute/Unmute**, and a
  **Mute everyone** button; muted guests show a 🔇 on their tile, and
  mute state is shared so everyone's view agrees. Guests can still
  unmute themselves.
- Lower-third text doubled in size; accent stripe removed
- Lower-third banners overlay the bottom-left of each video, about a
  quarter of the tile wide and scaling with tile size (small tiles get
  small banners); the host picks the colour from nine swatches or a hex
  code, can give **everyone a different colour**, or let guests pick
  their own from the palette
- Host panel restyled to the Lightmorphic house look, with a close
  button; session controls swapped emoji for modern line icons
- Host panel simplified: every row (including your own) has Spotlight
  and Mute buttons - the separate layout buttons are gone; toggling the
  active Spotlight returns to the grid

- **Fix**: joining with noise suppression crashed some Chromium-based
  browsers (seen in Brave Origin) - session audio is now routed to the
  chosen speaker via an audio element instead of the AudioContext call
  that triggered the crash
- Crash safety: if a join attempt never finishes (e.g. the tab crashed
  while noise suppression was starting), the next visit turns noise
  suppression off automatically and says so
- Banner fields renamed on the join screen: **Banner title** (now
  required to join) and **Banner subtitle** (optional), no placeholder
  clutter; title and subtitle sit side by side on desktop
- Tooltips follow the house style everywhere: lozenge-shaped, matching
  the background with an outlined edge - replacing browser-native ones

## 1.1.0 - 2026-08-06

- **Lower thirds**: the small name pill became a full-width two-line
  banner on every tile - name plus an optional smaller line for a
  website, job or company, entered on the preview screen and remembered
  for next time
- **Bigger camera check**: the join card is wider on desktop with the
  preview video full-width and settings in two columns
- **Licence**: released under the GNU GPL v3
- **Fix**: deploys now always recreate containers whose files changed
  (a symlinked bind mount could previously leave stale files serving)
- **Fix**: long camera/microphone names no longer overflow the join card
- Website: full redesign with real product screenshots, per-feature
  accent colours, uniform spacing, and a Lightmorphic sponsorship

## 1.0.0 - 2026-08-06

First production release, live at [app.fossstudio.org](https://app.fossstudio.org).

#

