# Changelog

All notable changes to FOSSStudio are documented here.

## Unreleased

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
  *Podcast banner* (podcast name + advertising/support banner upload,
  moved out of Streaming). The accent colour now restyles the host
  dashboard itself, not just the session view
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

