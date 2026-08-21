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
#        FOSSSTUDIO_URL=https://app.fossstudio.org (default) - the live
#        site, checked before restarting so an in-flight recording
#        render isn't killed mid-flight (see /render-status). This is a
#        courtesy wait, not a hard guarantee: if the server is stuck
#        rendering past the cap, or unreachable, the deploy proceeds -
#        the server auto-resumes any recording interrupted mid-render
#        the moment it comes back up, so nothing is silently lost.
set -euo pipefail

HOST="${FOSSSTUDIO_HOST:?Set FOSSSTUDIO_HOST, e.g. root@1.2.3.4}"
SSH_KEY="${FOSSSTUDIO_SSH_KEY:-/home/charlie/9-Claude/ssh/lightmorphic-fossstudio-vps-deploy}"
SITE_URL="${FOSSSTUDIO_URL:-https://app.fossstudio.org}"
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

echo "== Waiting for any in-flight recording render (up to 3 min) =="
WAITED=0
while [ "$WAITED" -lt 180 ]; do
  RENDERING="$(curl -fsS -m 5 "$SITE_URL/render-status" 2>/dev/null | grep -o '"rendering":[0-9]*' | grep -o '[0-9]*$' || echo "")"
  if [ -z "$RENDERING" ] || [ "$RENDERING" = "0" ]; then
    [ "$WAITED" -gt 0 ] && echo "  clear after ${WAITED}s"
    break
  fi
  [ "$WAITED" -eq 0 ] && echo "  a recording is rendering - waiting for it to finish..."
  sleep 5
  WAITED=$((WAITED + 5))
done
if [ "$WAITED" -ge 180 ]; then
  echo "  still rendering after 3 minutes - proceeding anyway (it will auto-resume after restart)"
fi

echo "== Starting stack =="
run "start-release $RELEASE"

echo "== Health check =="
sleep 3
run "healthcheck" && echo " OK"

echo "== Pruning old releases (keep 5) =="
run "prune-releases"

echo "Deployed $RELEASE"
