# 0020 — Request-id tracing in JSON logs, usage metrics from llm_calls, limits in Redis

**JSON logs with a request id that follows the work.** The API logs one JSON object per line: `time`, `level`, `context`, `msg`, structured fields, and `requestId` (plus `jobId` inside a worker).
- **Where the id comes from.** Every HTTP request gets an id: the client's `x-request-id` when it is a safe token, otherwise a UUID. The id is echoed in the response header, exposed through CORS so the web app can read it, and held in `AsyncLocalStorage`.
- **Logs.** Any `new Logger(...)` call made while handling the request inherits the id. That includes domain use cases, which log nothing themselves.
- **Ingest jobs.** The queue adapter copies the id into the BullMQ job data, and the worker runs the job inside the same context. Workspace and ingest logs from the job share the HTTP request's id.
- **LLM calls.** Every LLM call writes a log line and an `llm_calls` row with `request_id` (new column, indexed).
- **In practice.** `docker compose logs api | grep '"requestId":"<id>"'` shows one request end to end, and `SELECT … FROM llm_calls WHERE request_id = '<id>'` shows what it cost.

**A small logger of our own over pino or `nestjs-pino`.** Nest's `LoggerService` takes about 60 lines to implement. We needed the async context anyway, to carry the id into jobs and `llm_calls`, and that context is the part `nestjs-pino` would add. A dedicated library would bring faster serialisation and log levels by config, neither of which matters at this volume. The domain stays untouched: the request id is an infrastructure concern read from the context, never passed through use cases.

**`GET /metrics` reads `llm_calls`, not counters.** It reports calls, failed calls, tokens, cost, and mean and p95 latency: totals, per UTC day, and per session (most recent first), over 1–90 days. The data comes from three aggregate queries over the table that already records every model call, so the metrics can't drift from what was billed, and a Redis restart loses nothing. This is a `GetUsageMetrics` use case over a `UsageMetricsReader` port.

**Usage limits in Redis, enforced by the agent loop.** A `UsageGuard` port (domain) implemented by `RedisUsageGuard`, shared by every API process:
- **Per-session rate limit** (`SESSION_QUESTIONS_PER_MINUTE`): a fixed one-minute window counted with `INCR` and `EXPIRE`. A fixed window is simple and allows at most twice the limit across a window boundary, which is fine for protecting spend. A sliding log would cost a sorted set per session.
- **Daily spend cap** (`DAILY_SPEND_CAP_USD`): `INCRBYFLOAT` per UTC day after every model call. It is checked before the question is stored and before each model call. The call that crosses the cap finishes, so spend can overshoot by one call; the next call is refused.
- **Refusals are readable domain errors.** `SessionRateLimitedError` ("Too many questions: this conversation allows 6 per minute. Try again in 25 seconds.") and `DailySpendCapReachedError` ("The daily spending limit for answering questions ($25.00) has been reached ($25.13 spent today). Questions can be asked again after 00:00 UTC.") become HTTP 429, with `Retry-After` for the rate limit, or a stream `error` event, which the web app shows on the turn. A refused question is not stored and costs nothing; a cap reached mid-loop stops the loop before the next call.

**Known limit.** The spend counter starts when this code first runs, or after Redis is flushed, at $0, even if `llm_calls` already shows spend for that day. Seeding it from `llm_calls` on a missing key would close that gap if it ever matters.
