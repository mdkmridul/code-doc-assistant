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
- `npm run start:dev -w api` — runs the API; it logs `Connected to Postgres` and `Connected to Redis` on a healthy boot.

## Code rules

- TypeScript `strict` everywhere. Shared compiler options live in `tsconfig.base.json` (`module`/`moduleResolution: nodenext`, CommonJS output).
- `packages/domain` never imports from Nest, Prisma, Redis or any SDK. Zod is its only allowed runtime dependency.

## Environment variables

- The root `.env` (gitignored) is read by both docker compose and the API. `.env.example` is the committed template.
- Adding, renaming or removing a variable means updating **all** of these in the same change: the Zod schema in `apps/api/src/config/env.schema.ts`, `.env.example` (with a comment saying who reads it), `docker-compose.yml` if compose uses it, and `apps/api/src/config/load-config.spec.ts` (its `validEnv`).
- Every API variable is required with no default, so a missing value stops the boot.

## Architecture

- Controllers, processors and the MCP entrypoint call **use cases**.
- Use cases depend on **ports** defined in `packages/domain`.
- **Infrastructure** implements the ports. Dependencies point inward, never from domain to infrastructure.

## Process

- Every use case gets a unit test with fakes before it is wired to a transport.
- Build only what the current step asks. No speculative features.
- Every "chose X over Y" decision gets a one-paragraph ADR in `docs/decisions/` (`NNNN-short-title.md`). The README is assembled from these.

## Gotchas

- The root `node_modules` has TypeScript 7, which removed `moduleResolution: node`/`node10`. `ignoreDeprecations` can't bring it back.
- `packages/domain` installs its own TypeScript 6, because `typescript-eslint` doesn't support 7 yet. `apps/api` is on 5.9.
- Text files must use LF line endings (`.gitattributes`). CRLF breaks `prettier/prettier` in the API lint.
