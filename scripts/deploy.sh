#!/usr/bin/env bash
# Deploy the current checkout to the VPS as a new timestamped release,
# switch the `current` symlink to it, and (re)start the stack.
# The previous release stays on disk, so rollback is just moving the symlink back.
#
# The deploy key is forced-command restricted on the server to a fixed
# set of verbs (see /opt/fossstudio/bin/deploy-wrapper.sh) - this script
# only ever sends those verbs, and rsync's destination is relative
# because the restricted rsync (rrsync) anchors it under the releases
# directory itself.
#
# Usage: scripts/deploy.sh            (uses $FOSSSTUDIO_HOST, e.g. root@1.2.3.4)
set -euo pipefail

HOST="${FOSSSTUDIO_HOST:?Set FOSSSTUDIO_HOST, e.g. root@1.2.3.4}"
SSH_KEY="${FOSSSTUDIO_SSH_KEY:-/home/charlie/2-Data/SSH/lightmorphic-fossstudio-vps-deploy}"
RELEASE="$(date +%Y%m%d-%H%M%S)"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

run() { ssh -i "$SSH_KEY" -o IdentitiesOnly=yes "$HOST" "$@"; }

echo "== Uploading release $RELEASE =="
run "mkdir-release $RELEASE"
rsync -az --delete -e "ssh -i $SSH_KEY -o IdentitiesOnly=yes" \
  --exclude .git --exclude node_modules --exclude data --exclude .env \
  "$REPO_ROOT/" "$HOST:$RELEASE/"

echo "== Switching current -> $RELEASE =="
run "activate-release $RELEASE"

echo "== Starting stack =="
run "start-release $RELEASE"

echo "== Health check =="
sleep 3
run "healthcheck" && echo " OK"

echo "== Pruning old releases (keep 5) =="
run "prune-releases"

echo "Deployed $RELEASE"
