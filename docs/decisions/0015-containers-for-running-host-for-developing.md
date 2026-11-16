# 0015 — Containers for running the app, the host for developing it

The API and the web app have Dockerfiles (`apps/api/Dockerfile`, `apps/web/Dockerfile`, built from the repo root) and compose services behind the `app` profile. `docker compose --profile app up -d --build` runs the whole stack: Postgres, Redis, Ollama, a one-shot `migrate` service (`prisma migrate deploy`, which the API waits for), the API and the web app. Plain `docker compose up -d` still starts only the infrastructure, and day-to-day development runs the API and web app on the host (`npm run start:dev -w api`, `npm run dev -w web`).

**We chose both over containers only.** Containers give a one-command start that needs nothing but Docker, and the same images could later be deployed. Developing inside them on Windows costs too much, though. Source mounted from the host goes through Docker Desktop's file sharing, so watch mode is slow or needs polling. Native packages (Prisma, esbuild, Tailwind's oxide, swc) need a separate Linux `node_modules`, and tests, migrations, `next typegen` and debugging all become `docker compose exec`. A profile keeps one compose file and one `.env` for both modes.

**Configuration.** In the containers, the API reaches its dependencies by service name. Compose overrides the host-oriented `DATABASE_URL`, `REDIS_URL` and `OLLAMA_URL` from `.env`, so no new variables are needed. `NEXT_PUBLIC_API_URL` is the URL the *browser* uses, so it stays `http://localhost:<API_PORT>`. It is a build argument because `next build` writes it into the bundle, which means changing it requires a rebuild of the web image. The web app is published on port 3000, which must match `WEB_ORIGIN` (CORS). Secrets never enter an image (`.dockerignore` excludes `.env`); the API gets them from `env_file` at run time.

**Images.** Both use the `node:22.14.0-bookworm-slim` base, the same Node version as development.
- **API:** builds `@cda/domain`, the Prisma client and Nest in a build stage. That stage also serves as the `migrate` image, since it has the Prisma CLI. The runtime stage has production dependencies only, plus `git` for cloning repositories.
- **Web:** uses Next's `output: "standalone"` with `outputFileTracingRoot` at the repo root and runs only the traced `server.js`.

The API image is about 1 GB, mostly the Node base image, git with its Perl dependencies, and the Prisma CLI, which npm installs in production because `@prisma/client` declares it as a peer. Trimming it is possible later and isn't needed for a local stack.
