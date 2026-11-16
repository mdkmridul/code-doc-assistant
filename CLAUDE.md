# Code Documentation Assistant

npm workspaces monorepo:

- `apps/api` — NestJS backend (controllers, processors, MCP entrypoint)
- `apps/web` — Next.js frontend (see `apps/web/CLAUDE.md`)
- `packages/domain` — `@cda/domain`: entities, use cases and ports

## Commands

Run from the repo root:

- `npm install` — installs every workspace. Use only the root lockfile; don't run `npm install` inside a workspace.
- `npm run lint` / `npm run typecheck` / `npm test` — cover all three workspaces; all must pass before a step is done.
- `npm run test:integration` — SQL tests (`*.int-spec.ts`) against the Compose Postgres, in a separate `cda_test` database (created and migrated automatically). Needs `docker compose up -d`. Run it whenever retriever or store SQL changes.
- `docker compose up -d` — starts Postgres (pgvector), Redis and Ollama (local embeddings), and pulls `nomic-embed-text` on first run (`ollama-pull` service), using the values in the root `.env`. On NVIDIA machines, `COMPOSE_FILE` in `.env` adds `docker-compose.gpu.yml` (about 23x faster embeddings); `docker compose exec ollama ollama ps` should show `100% GPU`.
- `npm run dev -w web` — the web app on http://localhost:3000: ingest, chat and sources on one page. Run the API alongside it.
- `npm run start:dev -w api` — runs the API; it logs `Connected to Postgres ... (pgvector x.y.z)`, `Connected to Redis` and `Connected to Ollama ... (nomic-embed-text)` on a healthy boot.
- `npm run db:deploy -w api` — applies migrations. `npm run db:migrate -w api` creates one from `schema.prisma` changes (dev). `npm run db:seed -w api` inserts the sample repo.
- `POST /repos` with `{"url": "https://github.com/<owner>/<repo>"}` or a multipart `file` (.zip) queues an ingest; `GET /repos/:id` shows its status (`queued → running → ready | failed`) and file/chunk counts.
- `POST /sessions` `{"repoId"}` opens a Q&A session on a ready repo; `POST /sessions/:id/messages` `{"content"}` runs the agent loop and returns the full answer as JSON (answer, outcome, iterations, toolCalls, citations, unverifiedReferences, usage). `GET /sessions/:id` returns the session and its messages. `POST /sessions/:id/messages/stream` is the same as SSE (token, tool_call, tool_result, done, error); `GET /repos/:id/events` streams ingest progress until ready/failed (ADR 0013). Every model call is a row in `llm_calls`.
- `npm run prisma:generate -w api` — regenerates the client into `apps/api/src/generated/prisma` (gitignored; also runs on `npm install`).

## Code rules

- TypeScript `strict` everywhere. Shared compiler options live in `tsconfig.base.json` (`module`/`moduleResolution: nodenext`, CommonJS output).
- `packages/domain` never imports from Nest, Prisma, Redis or any SDK. Zod is its only allowed runtime dependency. Its ESLint config enforces this (`no-restricted-imports`).
- Tools (`packages/domain/src/tools`) implement `Tool`: a zod `inputSchema` with `.describe()` on every field (the model reads them), and `execute(input, context)`. Facts the model must not choose, like `repoId`, come from `ToolContext`, never from input. Call tools through `invokeTool`, which validates first.

## Environment variables

- The root `.env` (gitignored) is read by both docker compose and the API. `.env.example` is the committed template.
- Adding, renaming or removing a variable means updating **all** of these in the same change: the Zod schema in `apps/api/src/config/env.schema.ts`, `.env.example` (with a comment saying who reads it), `docker-compose.yml` if compose uses it, and `apps/api/src/config/load-config.spec.ts` (its `validEnv`).
- Every API variable is required with no default, so a missing value stops the boot.

## Database (Prisma)

- `apps/api/prisma/schema.prisma` is the source of truth for every table. Never edit a migration that has been committed; add a new one.
- `chunks.embedding` (pgvector) and `chunks.search_vector` (generated tsvector) and their HNSW/GIN indexes are created by a hand-written migration (ADR 0005). Any change to them is hand-written SQL, and `schema.prisma` must be updated to match (`Unsupported`, `dbgenerated`, `@@index`).
- After any schema or migration change, `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` (in `apps/api`) must print an empty migration. Otherwise Prisma will try to drop the search indexes.
- Prisma cannot write `Unsupported` columns: set embeddings with `$executeRaw` and a `::vector` cast.
- Vector search is raw SQL in `pgvector-retriever.ts` (ADR 0010). Keep the inner `ORDER BY embedding <=> query LIMIT k` shape (it is what lets HNSW be used), and keep `hnsw.iterative_scan` on: without it, repo/path/language filters can return too few rows.
- Deleted chunks stay in the HNSW graph until VACUUM and hurt recall; integration tests VACUUM after cleanup.
- Full-text search uses the `simple` dictionary (no stemming), so query with `to_tsquery('simple', ...)`.

## Embeddings

- `nomic-embed-text` via Ollama, 768 dimensions (ADR 0009). The model, `NOMIC_DIMENSIONS`, `vector(768)` in `schema.prisma` and the migration, and the seed's `EMBEDDING_DIMENSIONS` must all agree. Changing model means a new migration and re-ingesting every repo.
- Ollama's nomic-embed-text has a 2048-token context; longer inputs are truncated, not rejected. Keep chunks well under it.
- nomic needs task prefixes: `OllamaEmbedder` adds `search_document: ` (indexing) or `search_query: ` (questions, via `inputType: 'query'`). Never embed raw text with it.

## Agent loop and prompts

- Tools: `search_code` (semantic search) and `read_file` (exact numbered lines, max 200 per call). Citations are the `path:start-end` references an answer writes that overlap code the model actually retrieved; anything else is returned as `unverifiedReferences`.
- Track: if answers often end with `outcome: "iteration_cap"` or the cost per question rises, revisit the cap (ADR 0012, which has the SQL). Shorthand citations like `(:690-692)` are not parsed yet.

- `AnswerQuestion` (domain) owns the loop; `LoopPolicy` owns its limits (`CHAT_MAX_ITERATIONS`, default 8, see ADR 0012; `CHAT_TOKEN_BUDGET`, 200,000). The last allowed call runs with tools disabled so a capped question still answers. ADR 0011.
- System prompts are versioned files: `prompts/<name>/<version>.md`. Never edit a version that has been used; add `v2.md` and bump `ANSWER_QUESTION_PROMPT` in `apps/api/src/chat/chat.constants.ts`. `llm_calls.prompt_version` records which one ran.
- Claude Opus 5.5 rules the adapter depends on: replay assistant turns of the current loop verbatim (`providerContent`, thinking blocks included); keep `system` and `tools` identical for the whole loop; never send forced `tool_choice` (`any`/`tool` is a 400), `thinking: disabled`, `budget_tokens` or sampling parameters. Prices live in `anthropic-pricing.ts`; the API refuses to boot with a model it can't price.

## Architecture

- Domain use cases (`packages/domain/src/ingestion`) are plain classes; `apps/api/src/ingestion/ingestion.module.ts` builds them with factory providers. Don't add Nest decorators to domain code.
- `@cda/domain` runs from `dist/` (ADR 0008). After changing domain code, restart the API; `prestart*`/`prebuild` rebuild it. Type-check, lint and tests read the source directly.

- Controllers, processors and the MCP entrypoint call **use cases**.
- Use cases depend on **ports** defined in `packages/domain`.
- **Infrastructure** implements the ports. Dependencies point inward, never from domain to infrastructure.

## Process

- Every use case gets a unit test with fakes before it is wired to a transport.
- Build only what the current step asks. No speculative features.
- Every "chose X over Y" decision gets a one-paragraph ADR in `docs/decisions/` (`NNNN-short-title.md`). The README is assembled from these.

## Streaming

- Wire types for both streams live in `packages/domain/src/events.ts` (`@cda/domain/events`). Keep that file import-free: the web app imports it type-only. Change an event there and both sides must follow.
- Disconnecting from the answer stream aborts the loop (AbortSignal through `AnswerQuestion` into the SDK stream); the answer is stored as cancelled. Don't make the loop ignore the signal.
- Ingest progress is best effort (Redis pub/sub, `repo-progress:<repoId>`); Postgres stays the source of truth. One shared subscriber (`RepoProgressHub`) per API process; channels unsubscribe when their last stream closes (`PUBSUB NUMSUB` should drop to 0).

## Web app

- `apps/web` is Next.js 16 with Cache Components; read `apps/web/AGENTS.md` and the bundled docs before changing it.
- One page (`/`), three zones: ingest, chat, sources (ADR 0014). State is in the URL (`?repo=`, `?session=`). Components: `src/components` (zones), `src/components/ui` (shadcn, owned source: edit freely), `src/lib/turns.ts` (pure conversation model: keep logic here, not in components).
- Styling: Tailwind 4 via `@tailwindcss/postcss` and shadcn/ui (Radix, Nova preset); `npx shadcn@latest add <component>` from `apps/web`. Check afterwards that it created no `apps/web/package-lock.json`.
- Tests: `npm test -w web` (Vitest + Testing Library, jsdom). Keep one React version in the tree: two copies make hooks fail with "reading 'useState'" in tests.
- `npm run typecheck -w web` runs `next typegen` first: route types live in `.next`, and a stale `.next` breaks `tsc` after routes are removed.
- The browser calls the API directly at `NEXT_PUBLIC_API_URL`; the API allows `WEB_ORIGIN` through CORS. There is no Next.js proxy, so long answers and 50 MB uploads aren't subject to proxy limits.
- `next.config.ts` loads the root `.env`. `NEXT_PUBLIC_*` values are inlined when `next dev`/`next build` starts, so restart the web app after changing them.
- URL data (`params`) must be read behind `<Suspense>` (see `app/sessions/[id]/page.tsx`); `npm run build -w web` fails otherwise.

## Gotchas

- TypeScript versions differ: `packages/domain` and the root are on 6.0.x, `apps/api` and `apps/web` on 5.9.x. `typescript-eslint` (all workspaces) runs on the root 6.0.x. TypeScript 6 no longer auto-includes `@types`, so tsconfigs list `types` explicitly, and it always enables `esModuleInterop`. Write code that type-checks on both.
- `moduleResolution: node`/`node10` is removed in TypeScript 7 and deprecated in 6; `ignoreDeprecations` is not a fix.
- BullMQ ingest jobs use `jobId = ingest_key` and are removed when they finish. Don't set `removeOnFail: false` or retain failed jobs: a re-queue with the same jobId would be silently ignored.
- Prisma is pinned to 7.x. npm's `latest` tag is an 8.0 release candidate that needs Node >= 22.18.
- Text files must use LF line endings (`.gitattributes`). CRLF breaks `prettier/prettier` in the API lint.
