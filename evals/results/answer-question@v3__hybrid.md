# answer-question@v3 with hybrid retrieval

Golden set `golden/ky.yaml` (ky @ `3541888878c4`), 36 questions, 2026-11-16 16:45 UTC.
Answers by the API's model; faithfulness judged by `claude-sonnet-5-5` (rubric in `evals/src/cda_eval/judge.py`).

## Summary

| Metric | Value |
|---|---:|
| recall@5 (all / identifier / conceptual / multi-file) | 28.6% / 50.0% / 16.7% / 0.0% |
| recall@10 (all / identifier / conceptual / multi-file) | 51.8% / 75.0% / 41.7% / 12.5% |
| Expected files the assistant saw while answering | 94.6% |
| Faithfulness, mean (1-5, 28 judged answers) | 3.89 |
| Faithful answers (score >= 4) | 82.1% |
| Correctness vs gist, mean (1-5) | 4.82 |
| Refusal rate on not-found questions | 75.0% |
| False refusals on answerable questions | 0.0% |
| Mean model calls per question | 4.9 |
| Cost (answers + judge) | $4.56 |
| Errors | 0 |

## Per question

| Question | Type | Outcome | Faithful | Correct | Evidence recall | Calls | Cost | Unsupported claims |
|---|---|---|---:|---:|---:|---:|---:|---|
| force-retry-error | identifier | completed | 3 | 5 | 100.0% | 4 | $0.132 | Constructor validation details (delay Infinity allowed, negative/NaN rejected, cross-realm Request accepted) are cited to ForceRetryError.ts:19-36, but those lines are truncated and not visible in the |
| max-response-size-limit | identifier | completed | 4 | 5 | 100.0% | 5 | $0.167 | The code excerpt in the answer is paraphrased/condensed (types removed), though logic matches the evidence; Claim that the 'Chromium' behaviour applies to native body methods is from a comment only, b |
| ky-stop-before-retry | identifier | completed | 4 | 5 | 100.0% | 5 | $0.138 | The claim that the run loop 'returns undefined without running the afterResponse hooks' is only partly shown: lines 601-604 show the early return on undefined, but the surrounding code is truncated. |
| timeout-vs-total-timeout | identifier | completed | 4 | 5 | 100.0% | 5 | $0.128 | Retry waits: the answer says "Before each wait" Ky uses the smaller of the two, but the evidence shows this is for per-attempt/body-read effective timeout, not explicitly waits between retries; Cites  |
| replace-option | identifier | completed | 4 | 5 | 100.0% | 7 | $0.222 | Claim that `signal: undefined` removes signals is cited only partly; the claim about `retry` number shorthand being skipped is inferred from code, not documented; `searchParams: undefined`, `context:  |
| prefix-url-renamed | identifier | completed | 4 | 5 | 100.0% | 6 | $0.146 | Claim that the check occurs "before any options are merged or the request is built" is only partly supported; the check is after destructuring but before `this.#options` is built, which is roughly tru |
| before-error-hook-flow | identifier | completed | 4 | 5 | 100.0% | 7 | $0.174 | Claim that the user's abort signal case covers 'three cases' is fine, but the description 'the timeout can't be computed' is an inference from #getEffectiveTimeout throwing, not stated directly; The c |
| parse-json-option | identifier | completed | 4 | 5 | 100.0% | 6 | $0.155 | The claim that a timeout in #raceWithTotalTimeout raises TimeoutError is supported only via lines 427-429, but the 'non-2xx responses' framing for #getResponseData's caller is not shown in the evidenc |
| retry-on-timeout | identifier | completed | 4 | 4 | 100.0% | 4 | $0.106 | Each retry gets its own fresh per-attempt timeout is cited to options.ts lines that show only the per-attempt wording, not the retry mechanics; Claim that delay, jitter and backoffLimit all apply via  |
| http-error-data | identifier | completed | 3 | 4 | 100.0% | 6 | $0.149 | Quoted HTTPError.ts:11 doc text about body consumed and error.response.json() not working is not visible in evidence (truncated at line 9); Type `T \| string \| undefined` at HTTPError.ts:20 is not sh |
| is-ky-error-guard | identifier | completed | 3 | 5 | 100.0% | 4 | $0.102 | KyError getter code at source/errors/KyError.ts:8-14 (`override name = 'KyError'`, `get isKyError(): true`) is quoted, but the evidence truncates at `export class KyError extends ` and never shows the |
| init-hook-options | identifier | completed | 4 | 5 | 100.0% | 5 | $0.129 | An async hook's changes made after an await won't be used (inferred from synchronous loop, not stated explicitly); The changed object goes straight into new Ky(...) which "builds the request" (request |
| request-takes-too-long | conceptual | completed | 3 | 5 | 100.0% | 5 | $0.173 | The timeout.ts code snippet and lines 22-28 details (abort via AbortController, reject TimeoutError) are not visible; the evidence truncates at line 22.; Late response is discarded and its body cancel |
| network-error-detection | conceptual | completed | 3 | 5 | 100.0% | 5 | $0.133 | Detailed line-by-line breakdown of is-network-error.ts (TypeError name check, Safari 'Load failed', Deno prefix, Chrome 'Failed to fetch' at lines 16-45) is not visible; evidence is truncated at line  |
| default-retry-policy | conceptual | completed | 4 | 5 | 100.0% | 4 | $0.100 | Claim that 413 is retried only when the response has a timing header is supported, but the claim that POST and PATCH are 'not retried unless you add them' is inferred rather than shown directly; Exact |
| upload-progress | conceptual | completed | 4 | 4 | 100.0% | 7 | $0.205 | Ky streams the request body through a progress counter (the code attaching it in Ky.ts was not seen; only withProgress and the docs); Chunks are reported one step late and the ReadableStream content-l |
| create-vs-extend | conceptual | completed | 4 | 4 | 100.0% | 4 | $0.107 | The code snippet is paraphrased: type annotations were removed from the quoted implementation, though the logic matches.; Claim that the parent is never changed is an inference; evidence supports it o |
| header-merging | conceptual | completed | 4 | 5 | 100.0% | 5 | $0.146 | Hooks receive plain object claim is supported, but "Values are not appended together" is only inferred from Map.set behavior; The `replaceOption` behavior of starting from `{}` is supported, but the c |
| query-string-handling | conceptual | completed | 4 | 5 | 100.0% | 5 | $0.130 | merge.ts lines 401-412 described as merging "later sources into a URLSearchParams" is only partly visible (truncated at line 413); Specific summary that "Rebuilding drops a body inherited from a Reque |
| cancel-during-retry-wait | conceptual | completed | 4 | 5 | 100.0% | 5 | $0.114 | The code in #throwIfAbortedByUser is not shown, so the claim that the cancellation is reported as a normal abort (not a hook error) is inferred from the comment only; The claim that the request reject |
| mock-response-before-request | conceptual | completed | 4 | 5 | 100.0% | 7 | $0.168 | The claim that `#retry()` is the method that eventually calls fetch is not directly shown in the visible evidence, since the body of `#retry` is truncated.; The claim that `#runBeforeRequestHooks` ret |
| retry-based-on-response-body | conceptual | completed | 4 | 5 | 0.0% | 5 | $0.138 | Claim that forced retry goes to beforeError hooks when limit is hit is supported only partially by truncated evidence (line 306 mentions it), fine; but 'it skips jitter and backoffLimit' is supported; |
| url-prefix-and-base | conceptual | completed | 4 | 5 | 100.0% | 5 | $0.140 | The practical claim that a prefix starting with `/` yields an origin-relative result replacing the baseUrl path is inferred from URL semantics and the docs examples, but is not stated for prefix speci |
| http2-in-node | conceptual | completed | 4 | 5 | 100.0% | 4 | $0.093 | Using ky.create({dispatcher: agent}) as the recommended way to apply HTTP/2 to every request is only indirectly supported by the test; Node's built-in fetch uses undici (not shown in evidence) |
| retry-delay-backoff | multi-file | completed | 5 | 5 | 50.0% | 4 | $0.126 |  |
| json-schema-validation | multi-file | completed | 4 | 4 | 100.0% | 8 | $0.162 | The SchemaValidationError class body (lines 25-33) including constructor and message 'Response schema validation failed' is shown as code, but the evidence snippet is truncated before those lines; Sch |
| custom-fetch-and-extra-options | multi-file | completed | 4 | 5 | 100.0% | 4 | $0.146 | Claim that the default is the global fetch is from the `@default fetch` doc only; the code for the default isn't shown; Claim that passing a native window.fetch won't throw is inferred from the commen |
| retry-after-header | multi-file | completed | 5 | 5 | 100.0% | 6 | $0.189 |  |
| kubernetes-ingress | not-found | not_found | - | - | - | 3 | $0.037 |  |
| world-cup-winner | not-found | not_found | - | - | - | 2 | $0.019 |  |
| postgres-vacuum | not-found | not_found | - | - | - | 3 | $0.030 |  |
| react-use-effect | not-found | not_found | - | - | - | 3 | $0.052 |  |
| graphql-batching | not-found | not_found | - | - | - | 4 | $0.077 |  |
| cookie-jar | not-found | completed | - | - | - | 6 | $0.126 |  |
| request-deduplication | not-found | not_found | - | - | - | 4 | $0.095 |  |
| xml-response-parsing | not-found | completed | - | - | - | 6 | $0.101 |  |
