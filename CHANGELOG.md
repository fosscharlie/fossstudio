# Changelog

All notable changes to FOSSStudio are documented here.

## Unreleased

- **Phones and tablets in portrait**: your own video now sits in the
  grid with everyone else (same size, same place as when held
  horizontally) instead of a small bottom-corner overlay — so you can
  see where you are in the video; the floating title chip shrinks to
  just the REC/LIVE indicator on small screens (the top bar still
  shows the episode title)

- **Guests join muted by default** — mic button starts muted, the tile
  shows the badge, and the mic only opens when the guest unmutes
  themselves (or the host unmutes them)

- Banner palette: the last swatch is now the default banner grey
  (#1e2127) instead of green, so the host can always click back to the
  default look

- Subscribe reminder casing: "Enjoying the show?" / "Subscribe and
  turn on" / "ALL NOTIFICATIONS"

- Portrait (vertical) camera feeds now crop to the **middle** of the
  frame instead of the top — in the live grid, the preview, recordings
  and streams alike

- **Speaker row always shows** — tablets and phones that hide their
  audio outputs get a "Default speaker" entry and a working test
  sound; a Bluetooth speaker still appears as a second choice where
  the browser allows switching
- Join screen: banner title on the left and subtitle on the right,
  sharing one line on every screen size

- Subscribe reminder text is now three lines: "Enjoying the show?" /
  "Subscribe and Turn on" / "All notifications" — in the session
  overlay and the animation baked into recordings and streams

- **Mute all now includes the host** — it mutes every single person in
  the session, you included, and Unmute all brings everyone back

- **Episode title, front and centre**: shown in a large chip floating
  over the video (plus a slim bar at the top of the page), and baked
  into the combined recording and the live stream, top-centre — so the
  published video is titled like the screen
- **Recordings are named after the episode** instead of the session
  code; episode titles are now required when creating a session
- **Better mute indicator**: a red round mic-off badge in the tile's
  corner replaces the 🔇 emoji
- **Subscribe overlay bell** is now a proper drawn bell that rings
  (fast decaying swing) — in the session overlay and in the video baked
  into recordings and streams
- Session pages and the service worker are served with no-store
  caching and force a worker update on load, and the host panel shows
  a small build number — ending stale-code confusion for good

- Dashboard main-menu highlight is now a solid accent chip with white
  text (the translucent accent wash made the label hard to read)

- Website: even spacing between the feature blocks (no double-height
  gaps); screenshot taglines shortened so nothing is cut off
- Session tagline text slightly smaller so realistic taglines fit the
  fixed-width banner without truncating (recordings/streams match)

- **Session banner shows the episode title** you typed when creating the
  session — the per-host "podcast name" setting is gone, so one system
  can run several different podcasts side by side
- **Accent colour is now the dashboard's own** (menus, buttons and
  highlights, applied and saved the moment you click a swatch — no save
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
  the name centred — ten guests fit without scrolling (verified by an
  automated ten-guest test); Mute all / Subscribe / Ad share one line;
  your own card is marked with a small person icon (hover: "This is
  you") instead of "(you)" text
- **Modern subscribe overlay**: floating rounded card with a red
  SUBSCRIBE button and bell — same look in the session, the recording
  and the live stream
- The browser/server recording switch lives in the host panel and
  **locks while recording or live** — the capture pipeline can't change
  mid-take
- Session pages now cache-bust their scripts and styles on every
  release, so browsers can't keep serving a stale session view

- **Overlays**: host-panel buttons play a subscribe/notification-bell
  animation or show an uploaded advertising banner (Settings →
  Streaming). They appear instantly in everyone's session view (no need
  to be live — test any time), are **baked into recordings** at the
  moment you pressed them, and composite onto the live stream when live
- Host panel rows: name on its own line (fits 24-char names), buttons
  beneath; hosts can **lower a raised hand**
- **Raise hand**: guests press a hand button when they want to talk;
  their row lights up in the host panel, and unmuting them lowers it
- Mute lights turn red; colour picker spacing fixed

- Portrait phone cameras crop like everyone else's tile, keeping the
  **top** of the frame — in the live grid, recordings and streams alike
- Banners are a fixed size: long text truncates instead of growing the
  banner; title capped at 24 letters, subtitle at 32 (limits shown on
  the join screen)

- Noise reduction is now controlled **per guest from the host panel**
  (small NR button beside Mute/Spotlight, state visible at a glance);
  the guest-facing option is gone and it defaults to on
- **Live sound meters** for every participant in the host panel, so the
  host can see who's making noise

- The host panel is a fixed sidebar, always open for the host — the
  video grid sizes itself around it; a **dim** button fades all controls
  (and brightens them on hover) instead of open/close
- Guests can pick their **own banner colour** from the palette when the
  host enables it — a palette button appears in everyone's controls

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
  and Mute buttons — the separate layout buttons are gone; toggling the
  active Spotlight returns to the grid

- **Fix**: joining with noise suppression crashed some Chromium-based
  browsers (seen in Brave Origin) — session audio is now routed to the
  chosen speaker via an audio element instead of the AudioContext call
  that triggered the crash
- Crash safety: if a join attempt never finishes (e.g. the tab crashed
  while noise suppression was starting), the next visit turns noise
  suppression off automatically and says so
- Banner fields renamed on the join screen: **Banner title** (now
  required to join) and **Banner subtitle** (optional), no placeholder
  clutter; title and subtitle sit side by side on desktop
- Tooltips follow the house style everywhere: lozenge-shaped, matching
  the background with an outlined edge — replacing browser-native ones

## 1.1.0 — 2026-08-06

- **Lower thirds**: the small name pill became a full-width two-line
  banner on every tile — name plus an optional smaller line for a
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

## 1.0.0 — 2026-08-06

First production release, live at [app.fossstudio.org](https://app.fossstudio.org).

#

