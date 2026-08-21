#!/usr/bin/env bash
# Roll back to the release before the current one and restart the stack.
# The deploy key is forced-command restricted on the server (see
# /opt/fossstudio/bin/deploy-wrapper.sh) - "rollback" is one of the
# fixed verbs it accepts; the actual logic lives server-side.
# Usage: scripts/rollback.sh   (uses $FOSSSTUDIO_HOST, e.g. root@1.2.3.4)
set -euo pipefail

HOST="${FOSSSTUDIO_HOST:?Set FOSSSTUDIO_HOST, e.g. root@1.2.3.4}"
SSH_KEY="${FOSSSTUDIO_SSH_KEY:-/home/charlie/9-Claude/ssh/lightmorphic-fossstudio-vps-deploy}"

ssh -i "$SSH_KEY" -o IdentitiesOnly=yes "$HOST" rollback
