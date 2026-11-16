# 0016 — An ingest-time endpoint scan, and a context budget for tool results

**Endpoints come from a lexical scan at ingest, not a parser or a query-time search.** "What endpoints does this service expose" is a question about the whole repository. Semantic search returns the 8–20 chunks nearest a query, so it can't enumerate. So while a repository is ingested, `extractEndpoints` (in the domain, pure) reads each file for route declarations:
- **Nest:** `@Controller` plus `@Get`/`@Post`/…
- **Express-style routers:** `app.get`, `router.post`, `app.route(...).get(...)`, the same calls Fastify, Koa Router and Hono use.
- **FastAPI:** `@app.get`, `@router.post`, `api_route`.
- **Flask:** `@app.route`, `@bp.route`, including `methods=`.

Rows go into an `endpoints` table that cascades from `files`, saved in the file's own transaction, and the `list_endpoints` tool reads them with filters and paging.

**Why regexes over tree-sitter or the TypeScript compiler:** we chose small, tested regexes because route declarations are idiomatic one-liners, and four ecosystems would otherwise need four grammars and native builds in the API image. What the regexes miss is acknowledged rather than guessed:
- paths built at run time (variables, `${}` templates);
- prefixes added in another file (`app.use('/api', router)`, `setGlobalPrefix`). The tool's note tells the model to check the app setup, and prompt v3 asks it to.

**Noise filtered at the source.** Test files (`test/`, `__tests__/`, `*.spec.ts`, `test_*.py`, …) and comments are skipped, because their mock servers and doc examples aren't the service's API. Without this, ky and got (HTTP *client* libraries) reported 541 and 1,616 "endpoints" from their test servers. `npm run db:backfill-endpoints -w api` re-derives the rows for repositories already ingested, from the stored file contents.

**A context budget refuses results instead of cutting them to fit.** Each question gets a `ContextBudget` (domain, pure): `CHAT_CONTEXT_BUDGET` estimated tokens for all tool results, 40,000 by default. A single result is capped at 8,000 tokens, and anything longer is truncated with a note saying how much was shown. The budget keeps a running total of what it admits.

A result that doesn't fit what remains is **refused whole**, and the model gets a short note instead. We chose this over trimming the result to the space left, because a half-shown search result reads as complete and invites wrong answers. After a refusal the loop makes one final call with tools disabled, so the question still gets an answer, with `outcome: "context_budget"`.

Without the budget, a sprawling question grew the context on every call. Since `CHAT_TOKEN_BUDGET` sums input tokens across calls, it ran out first and stopped with no answer at all. A refused result is not citable and shows no sources. For a truncated one, only locations whose file still appears in what the model saw count.

**Estimated tokens, not exact counts.** The budget uses `ceil(chars / 3)`, slightly conservative for code and JSON, rather than a tokenizer or the provider's token-counting endpoint. That keeps the domain free of SDKs and costs no extra request per tool result. The budget is a guard rail, not billing; `llm_calls` records the real usage.

**`read_file` has a hard character cap as well as its 200-line window.** It returns at most 16,000 characters, about 5,300 estimated tokens, whole lines only. A single longer line (minified code) is cut with a marker, and `nextStartLine` says where to resume. The cap sits under the per-result cap, so a read is never truncated by the budget.
