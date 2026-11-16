# 0021 — CI on GitHub Actions: checks on every push, SQL against service containers, evals on a label

**`ci.yml` runs on every push and pull request**, as two parallel jobs on Node 22:
- **checks:** `npm ci`, lint, type-check and unit tests for all three workspaces, then the domain's coverage thresholds (`npm run test:coverage -w @cda/domain`: statements 97%, branches 90%, functions 97%, lines 98%, just under today's numbers so coverage can't quietly slip).
- **integration:** the same Postgres (`pgvector/pgvector:pg17`) and Redis images as Compose, as service containers. It applies the migrations, fails if `prisma migrate diff --exit-code` finds drift (which would mean Prisma wants to drop the hand-written search indexes, ADR 0005), then runs `npm run test:integration`: the retriever's vector and hybrid SQL (including the HNSW plan), the endpoint catalog, the metrics SQL and the Redis usage guard.

**`evals.yml` runs only when the `run-evals` label is added to a pull request.** Evals call Claude (about $4 for the recall regression test plus one judged run of v4 with hybrid retrieval). They also need the whole stack, Ollama included, which costs CI minutes to start. So they never run on push.

**Why the label event, not every push to a labelled PR.** The workflow listens only to `pull_request: labeled` and checks that the label just added is `run-evals`. Pushing more commits to a labelled PR doesn't spend again, and neither does adding some other label. To re-run, remove the label and add it back.

**What the eval job does.** It writes `.env` from `.env.example` plus the `ANTHROPIC_API_KEY` repository secret, and fails with a clear message when the secret is missing. It starts the stack with `docker compose --profile app up -d --build api` (CPU Ollama), runs the recall regression test and the judged answers, adds `results/summary.md` to the run summary, and uploads `evals/results/` as an artifact.

**Over the alternatives.** A nightly schedule would spend money whether or not anything changed. `workflow_dispatch` alone would hide evals from the PR they judge. Running evals on every push would cost about $4 per push. The label keeps the decision with whoever reviews the PR.
