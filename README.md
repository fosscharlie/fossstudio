# FOSSStudio

Self-hosted video podcast studio for FOSSNerds & Linux OTC — a StreamYard replacement. Guests join by link with no account; the host runs everything from a web dashboard.

Runs at `fossstudio.fosscharlie.uk` as a single Docker Compose stack. Flat-file storage, no database.

## Layout

- `server/` — Node.js app: web server, signaling, media engine (mediasoup)
- `web/` — everything the browser loads (guest pages, host dashboard)
- `scripts/` — deploy, backup, restore, rollback
- `docs/runbook.md` — plain-language operations guide
- `data/` — settings, session history, recordings (created at runtime; never in git)

## Running it

Copy `.env.example` to `.env`, fill it in, then:

```bash
docker compose up -d --build
```

Day-to-day operations (restart, backups, logs) are all buttons in the host dashboard — see the [runbook](docs/runbook.md).
