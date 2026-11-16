# 0012 — Raise the per-question model-call cap from 6 to 8

`CHAT_MAX_ITERATIONS` defaults to 8 in `.env.example` (it was 6 in ADR 0011's first version). The token budget stays at 200,000.

**Why.** Adding `read_file` changed how the model works. Before, it ran a few searches and answered from cut-off snippets. Now it searches, then reads the exact lines it needs, which is what makes answers precise, but each read is a round trip. In the live check on 2026-11-16 (ky repo, prompt `answer-question@v2`), "How does ky decide whether to retry a failed request, and how long does it wait between retries?" used all 6 calls: 5 rounds of `search_code` and `read_file` (7 tool calls), then the forced tool-less final call. The answer was complete, but there was no headroom left. Simpler questions finished in 3–4 calls. We chose 8 over keeping 6, because 6 would cut off deeper questions just as reading starts to pay off, and over a higher number, because the last call already forces an answer and every extra call re-reads the growing conversation. Calls in that check cost $0.01–0.05 each, mostly cache reads.

**Cost bound.** One question can now take at most 8 calls, and the 200,000-token budget still stops it earlier when a conversation grows large. Measured questions cost $0.08–0.24.

**How to track it.** Revisit this if answers often end in `outcome: "iteration_cap"` (returned by `POST /sessions/:id/messages`), or if the cost per question rises.
- The outcome is not stored yet. If we need to measure how often the cap is hit, persist `outcome` and `iterations` on the assistant message first.
- Until then, the calls per session and their cost can be read from `llm_calls`:

```sql
SELECT session_id, count(*) AS calls, sum(cost_usd) AS cost_usd
FROM llm_calls
WHERE purpose = 'answer_question' AND prompt_version = 'answer-question@v2'
GROUP BY session_id ORDER BY calls DESC;
```

**Related open item.** Answers sometimes cite lines in shorthand, `(:690-692)`, meaning "the file named before". `resolveCitations` ignores these rather than marking them unverified, so the citation count undercounts what the answer referenced. This affects citation completeness, not grounding.
