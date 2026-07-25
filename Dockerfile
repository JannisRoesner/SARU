# syntax=docker/dockerfile:1

FROM node:22-bookworm AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
  && npm prune --omit=dev

FROM pgvector/pgvector:pg17

ARG NODE_MAJOR=22

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gosu \
    gnupg \
  && curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/.output ./.output
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/server/database/migrations ./server/database/migrations
COPY docker/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
  && mkdir -p /data/uploads \
  && chown -R postgres:postgres /var/lib/postgresql

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000 \
    PGDATA=/var/lib/postgresql/data \
    POSTGRES_USER=saru \
    POSTGRES_PASSWORD=saru \
    POSTGRES_DB=saru \
    DATABASE_URL=postgres://saru:saru@127.0.0.1:5432/saru \
    NUXT_UPLOAD_DIR=/data/uploads \
    NUXT_LOG_LEVEL=info \
    NUXT_TRUST_PROXY=false

EXPOSE 3000

VOLUME ["/var/lib/postgresql/data", "/data"]

LABEL org.opencontainers.image.title="SARU" \
      org.opencontainers.image.description="System zur Archivierung von Reihen und Unterrichtsmaterialien" \
      org.opencontainers.image.source="https://github.com/JannisRoesner/SARU"

ENTRYPOINT ["/entrypoint.sh"]
