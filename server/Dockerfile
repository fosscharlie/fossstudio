# python3/make/g++ build the mediasoup media worker; ffmpeg does the
# recording/streaming work.
FROM node:20-bookworm-slim

# Patch the base OS packages, then add only what we need. Rebuilding
# with --pull keeps this current; the apt upgrade clears fixable CVEs
# on top of whatever the pulled base already carries.
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends python3 make g++ ffmpeg zip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY assets ./assets

# Run as the unprivileged built-in "node" user (uid 1000), never root.
# The app binds only high ports and writes to /data (mounted volume,
# owned by uid 1000 on the host), so no root capability is needed.
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
CMD ["node", "src/index.js"]
