# Two stages keep the runtime image minimal: python3/make/g++ exist only
# in the build stage to compile the mediasoup media worker, and are never
# shipped. The runtime carries just Node, ffmpeg (recording/streaming)
# and zip (recording bundles) - no compilers, no npm.

FROM node:20-bookworm-slim AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim

# Patch the base OS packages, then add only what we need. Rebuilding
# with --pull keeps this current; the apt upgrade clears fixable CVEs
# on top of whatever the pulled base already carries. npm/npx/corepack
# are removed: the app never installs anything at runtime, and a
# package manager in a running container is pure attack surface.
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends ffmpeg zip ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
        /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn*

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY assets ./assets

# Run as the unprivileged built-in "node" user (uid 1000), never root.
# The app binds only high ports and writes to /data (mounted volume,
# owned by uid 1000 on the host), so no root capability is needed.
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
CMD ["node", "src/index.js"]
