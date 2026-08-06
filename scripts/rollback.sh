#!/usr/bin/env bash
# Roll back to the release before the current one and restart the stack.
# Usage: scripts/rollback.sh   (uses $FOSSSTUDIO_HOST, e.g. root@1.2.3.4)
set -euo pipefail

HOST="${FOSSSTUDIO_HOST:?Set FOSSSTUDIO_HOST, e.g. root@1.2.3.4}"
SSH_KEY="${FOSSSTUDIO_SSH_KEY:-$HOME/.ssh/fossstudio_deploy}"
BASE=/opt/fossstudio

ssh -i "$SSH_KEY" "$HOST" bash -s <<'EOF'
set -euo pipefail
BASE=/opt/fossstudio
current="$(basename "$(readlink $BASE/current)")"
previous="$(ls -1t $BASE/releases | grep -vx "$current" | head -1)"
if [ -z "$previous" ]; then echo "No previous release to roll back to."; exit 1; fi
echo "Rolling back: $current -> $previous"
ln -sfn "$BASE/releases/$previous" "$BASE/current"
# From the release dir, not the symlink — see deploy.sh
cd "$BASE/releases/$previous" && DATA_PATH=$BASE/data docker compose -p fossstudio up -d --build --remove-orphans
EOF
