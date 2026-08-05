#!/usr/bin/env bash
# Deploy the current checkout to the VPS as a new timestamped release,
# switch the `current` symlink to it, and (re)start the stack.
# The previous release stays on disk, so rollback is just moving the symlink back.
#
# Usage: scripts/deploy.sh            (uses $FOSSSTUDIO_HOST, e.g. root@1.2.3.4)
set -euo pipefail

HOST="${FOSSSTUDIO_HOST:?Set FOSSSTUDIO_HOST, e.g. root@1.2.3.4}"
SSH_KEY="${FOSSSTUDIO_SSH_KEY:-$HOME/.ssh/fossstudio_deploy}"
BASE=/opt/fossstudio
RELEASE="$(date +%Y%m%d-%H%M%S)"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

run() { ssh -i "$SSH_KEY" "$HOST" "$@"; }

echo "== Uploading release $RELEASE =="
run "mkdir -p $BASE/releases/$RELEASE"
rsync -az --delete -e "ssh -i $SSH_KEY" \
  --exclude .git --exclude node_modules --exclude data --exclude .env \
  "$REPO_ROOT/" "$HOST:$BASE/releases/$RELEASE/"

echo "== Switching current -> $RELEASE =="
run "ln -s $BASE/.env $BASE/releases/$RELEASE/.env \
  && ln -sfn $BASE/releases/$RELEASE $BASE/current"

echo "== Starting stack =="
run "cd $BASE/current && DATA_PATH=$BASE/data docker compose -p fossstudio up -d --build --remove-orphans"

echo "== Health check =="
sleep 3
run "curl -fsS http://127.0.0.1:\${HTTP_PORT:-3000}/healthz" && echo " OK"

echo "== Pruning old releases (keep 5) =="
run "cd $BASE/releases && ls -1t | tail -n +6 | xargs -r rm -rf"

echo "Deployed $RELEASE"
