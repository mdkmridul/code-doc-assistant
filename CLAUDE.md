# Code Documentation Assistant

npm workspaces monorepo:

- `apps/api` — NestJS backend (controllers, processors, MCP entrypoint)
- `apps/web` — Next.js frontend (see `apps/web/CLAUDE.md`)
- `packages/domain` — `@cda/domain`: entities, use cases and ports

## Commands

Run from the repo root:

- `npm install` — installs every workspace. Use only the root lockfile; don't run `npm install` inside a workspace.
- `npm run lint` / `npm run typecheck` / `npm test` — cover all three workspaces; all must pass before a step is done.
- `docker compose up -d` — starts Postgres (pgvector) and Redis using the values in the root `.env`.
- `npm run start:dev -w api` — runs the API; it logs `Connected to Postgres ... (pgvector x.y.z)` and `Connected to Redis` on a healthy boot.
- `npm run db:deploy -w api` — applies migrations. `npm run db:migrate -w api` creates one from `schema.prisma` changes (dev). `npm run db:seed -w api` inserts the sample repo.
- `npm run prisma:generate -w api` — regenerates the client into `apps/api/src/generated/prisma` (gitignored; also runs on `npm install`).

## Code rules

- TypeScript `strict` everywhere. Shared compiler options live in `tsconfig.base.json` (`module`/`moduleResolution: nodenext`, CommonJS output).
- `packages/domain` never imports from Nest, Prisma, Redis or any SDK. Zod is its only allowed runtime dependency.

## Environment variables

- The root `.env` (gitignored) is read by both docker compose and the API. `.env.example` is the committed template.
- Adding, renaming or removing a variable means updating **all** of these in the same change: the Zod schema in `apps/api/src/config/env.schema.ts`, `.env.example` (with a comment saying who reads it), `docker-compose.yml` if compose uses it, and `apps/api/src/config/load-config.spec.ts` (its `validEnv`).
- Every API variable is required with no default, so a missing value stops the boot.

## Database (Prisma)

- `apps/api/prisma/schema.prisma` is the source of truth for every table. Never edit a migration that has been committed; add a new one.
- `chunks.embedding` (pgvector) and `chunks.search_vector` (generated tsvector) and their HNSW/GIN indexes are created by a hand-written migration (ADR 0005). Any change to them is hand-written SQL, and `schema.prisma` must be updated to match (`Unsupported`, `dbgenerated`, `@@index`).
- After any schema or migration change, `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` (in `apps/api`) must print an empty migration. Otherwise Prisma will try to drop the search indexes.
- Prisma cannot write `Unsupported` columns: set embeddings with `$executeRaw` and a `::vector` cast.
- Full-text search uses the `simple` dictionary (no stemming), so query with `to_tsquery('simple', ...)`.

## Architecture

- Controllers, processors and the MCP entrypoint call **use cases**.
- Use cases depend on **ports** defined in `packages/domain`.
- **Infrastructure** implements the ports. Dependencies point inward, never from domain to infrastructure.

## Process

- Every use case gets a unit test with fakes before it is wired to a transport.
- Build only what the current step asks. No speculative features.
- Every "chose X over Y" decision gets a one-paragraph ADR in `docs/decisions/` (`NNNN-short-title.md`). The README is assembled from these.

## Gotchas

- TypeScript versions differ: `packages/domain` and the root are on 6.0.x, `apps/api` and `apps/web` on 5.9.x. `typescript-eslint` (all workspaces) runs on the root 6.0.x. TypeScript 6 no longer auto-includes `@types`, so tsconfigs list `types` explicitly, and it always enables `esModuleInterop`. Write code that type-checks on both.
- `moduleResolution: node`/`node10` is removed in TypeScript 7 and deprecated in 6; `ignoreDeprecations` is not a fix.
- Prisma is pinned to 7.x. npm's `latest` tag is an 8.0 release candidate that needs Node >= 22.18.
- Text files must use LF line endings (`.gitattributes`). CRLF breaks `prettier/prettier` in the API lint.
