# syntax=docker/dockerfile:1

FROM node:24.16.0-bookworm-slim AS base

WORKDIR /app

FROM base AS dependencies

RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ make python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci \
    && npm cache clean --force

FROM dependencies AS test

COPY --chown=node:node . .
USER node
RUN npm test

FROM base AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tar tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

RUN mkdir -p /var/lib/galpi /vault /backups \
    && chown node:node /var/lib/galpi /vault /backups

ENV NODE_ENV=production \
    GALPI_DATA_DIR=/var/lib/galpi \
    VAULT_PATH=/vault \
    BACKUP_DIR=/backups \
    HOST=0.0.0.0 \
    PORT=3000

USER node
EXPOSE 3000

ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
