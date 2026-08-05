# FOSS Studio Runbook

Plain-language guide for keeping FOSS Studio running. Routine tasks are buttons in the host dashboard — this file is for when the dashboard itself is unreachable.

*This runbook grows as the build progresses; sections marked (coming) are filled in when that feature lands.*

## Restart everything

SSH to the VPS, then:

```bash
cd /opt/fossstudio/current && docker compose restart
```

## See what's wrong (logs)

```bash
cd /opt/fossstudio/current && docker compose logs --tail 100
```

## Restore a backup (coming — phase 6)

## Roll back a bad deploy (coming — phase 6)
