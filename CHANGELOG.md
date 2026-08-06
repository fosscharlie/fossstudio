# Changelog

All notable changes to FOSSStudio are documented here.

## Unreleased

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

