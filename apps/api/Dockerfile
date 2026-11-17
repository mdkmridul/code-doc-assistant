# API image (NestJS). Build context is the repo root (see docker-compose.yml,
# profile `app`). ADR 0015.
FROM node:22.14.0-bookworm-slim AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false

# Manifests first, so dependency layers stay cached until they change.
FROM base AS manifests
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/

# All dependencies; builds @cda/domain, the Prisma client and the API.
# Also the image of the one-shot `migrate` service: it has the Prisma CLI.
# Scripts are skipped because the API's postinstall (prisma generate) needs
# the schema, which isn't copied yet; generate runs explicitly below.
FROM manifests AS build
# openssl: the Prisma CLI's schema engine (migrate deploy) links against it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
RUN npm ci -w api -w @cda/domain --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY apps/api apps/api
WORKDIR /app/apps/api
# prisma.config.ts requires DATABASE_URL; generate never connects to it.
RUN DATABASE_URL=postgresql://build@localhost/build npx prisma generate \
 && npm run build

# Production dependencies and compiled output only.
FROM manifests AS runtime
# git: ingestion clones public repositories (ls-remote + shallow fetch).
# openssl: the Prisma CLI's schema engine, for migrations run as a platform
# release command in production (ADR 0022).
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*
RUN npm ci -w api -w @cda/domain --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=build /app/apps/api/dist apps/api/dist
# System prompts are read at boot from <repo>/prompts.
COPY prompts prompts
# Schema, migrations and Prisma config: `npx prisma migrate deploy` from
# apps/api applies them (ADR 0022).
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
