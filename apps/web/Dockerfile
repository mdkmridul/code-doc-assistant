# Web image (Next.js standalone server). Build context is the repo root (see
# docker-compose.yml, profile `app`). ADR 0015.
FROM node:22.14.0-bookworm-slim AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false \
    NEXT_TELEMETRY_DISABLED=1

FROM base AS build
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/web/package.json apps/web/
RUN npm ci -w web -w @cda/domain --ignore-scripts
COPY tsconfig.base.json ./
# Type-only import of @cda/domain/events; the build type-checks against its source.
COPY packages/domain packages/domain
COPY apps/web apps/web
# Inlined into the browser bundle by `next build`, so it is fixed per image:
# it is the URL the *browser* uses to reach the API, not a container hostname.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
WORKDIR /app/apps/web
RUN npm run build

# The traced standalone output: server.js plus only the files it needs.
FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
