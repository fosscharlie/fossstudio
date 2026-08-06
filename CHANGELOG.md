# Changelog

All notable changes to FOSSStudio are documented here.

## 1.0.0 — 2026-08-06

First production release, live at [app.fossstudio.org](https://app.fossstudio.org).

### Sessions & guests
- Join-by-link guest flow: no accounts, up to 10 participants per session
- Preview screen: camera/mic/speaker selection, speaker **test sound**,
  mic level meter, mirror toggle, name — choices remembered for next time
- **Camera zoom**: true lens zoom where the camera supports it, digital
  crop-zoom everywhere else — what guests, recordings and streams see,
  not just a local effect
- RNNoise noise suppression in the guest's browser, on by default
- Simplified mobile view; PWA with push notifications
- Registered-only session links (unknown URLs don't create rooms)

### Host tools
- In-session host panel: grid/spotlight layouts, per-guest volume for
  everyone, per-session automatic level balancing, recording and live
  streaming controls with visible REC / LIVE badges
- Recording: browser-side per-person (PCM) or server-side (per-host
  permission, chosen per session); output is one combined MKV plus a
  lossless FLAC per participant
- Live streaming: server-composited 720p grid over RTMP (YouTube-ready),
  grid rebuilds automatically as people join or leave

### Accounts
- Admin/host role split: admins create and manage hosts and the system;
  hosts own their sessions, recordings, branding and stream key
- Email invitations: hosts set their own password via a 7-day single-use
  link; clipboard fallback when email isn't configured
- Optional TOTP two-factor login for every account; login rate limiting

### Dashboard & operations
- Lightmorphic-styled dashboard: boxed menus (main → sub → content),
  URL-persistent navigation, theme editor (banner, accent, wallpaper)
- SMTP settings in the dashboard; all outgoing email uses a branded
  HTML template with plain-text fallback
- One-click restart, daily backups with restore (restore tested against
  production data), log viewer, full data export
- External uptime check via GitHub Actions; release-based deploys with
  one-command rollback

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

## Unreleased

_Nothing yet._
