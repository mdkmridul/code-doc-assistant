# answer-question@v4 with hybrid retrieval

Golden set `golden/ky.yaml` (ky @ `3541888878c4`), 36 questions, 2026-11-16 15:12 UTC.
Answers by the API's model; faithfulness judged by `claude-sonnet-5-5` (rubric in `evals/src/cda_eval/judge.py`).

## Summary

| Metric | Value |
|---|---:|
| recall@5 (all / identifier / conceptual / multi-file) | 28.6% / 50.0% / 16.7% / 0.0% |
| recall@10 (all / identifier / conceptual / multi-file) | 51.8% / 75.0% / 41.7% / 12.5% |
| Expected files the assistant saw while answering | 91.1% |
| Faithfulness, mean (1-5, 28 judged answers) | 3.79 |
| Faithful answers (score >= 4) | 75.0% |
| Correctness vs gist, mean (1-5) | 4.79 |
| Refusal rate on not-found questions | 87.5% |
| False refusals on answerable questions | 0.0% |
| Mean model calls per question | 3.7 |
| Cost (answers + judge) | $3.26 |
| Errors | 0 |

## Per question

| Question | Type | Outcome | Faithful | Correct | Evidence recall | Calls | Cost | Unsupported claims |
|---|---|---|---:|---:|---:|---:|---:|---|
| force-retry-error | identifier | completed | 3 | 5 | 100.0% | 3 | $0.040 | Constructor validation details: delay must be non-negative number or Infinity, code must be a string, request must be a Request (only the null check is visible in tests; imports hint at others); Non-E |
| max-response-size-limit | identifier | completed | 4 | 5 | 100.0% | 5 | $0.096 | The claim that bytes are counted "not up front from Content-Length" is supported by docs, but the claim that no automatic retry occurs relies on the options doc; fine. The specific statement that `clo |
| ky-stop-before-retry | identifier | completed | 4 | 5 | 100.0% | 3 | $0.055 | Claim that the request "resolves with nothing" because the retry method returns undefined is inferred; the code shows only the early return, not how it propagates to the caller (though docs support it |
| timeout-vs-total-timeout | identifier | completed | 4 | 5 | 0.0% | 3 | $0.082 | The claim that `totalTimeout: 0` throws before fetch (an error of unspecified type) is mostly supported, but the answer's phrasing 'throws' is vague; the test shows TimeoutError, which is not contradi |
| replace-option | identifier | completed | 4 | 5 | 100.0% | 5 | $0.133 | The final claim that a later normal extend merges with the replaced set is cited to test/main.ts:2966, but the evidence shows only the test title there, not its assertions; Claim that tests check hook |
| prefix-url-renamed | identifier | completed | 3 | 5 | 100.0% | 6 | $0.126 | Test at test/prefix.ts:73-87 shows it throws for string, URL, and Request inputs; the evidence is truncated and doesn't show this; {prefixUrl: undefined} throws per test/prefix.ts:62-71; evidence show |
| before-error-hook-flow | identifier | completed | 4 | 5 | 100.0% | 5 | $0.133 | The cited line range 783-812 is fine, but the claim that hook type docs list errors at hooks.ts:301-310 is only partly visible since the snippet is truncated (ForceRetryError and ResponseSizeError are |
| parse-json-option | identifier | completed | 4 | 5 | 100.0% | 5 | $0.113 | On parse timeout in #getResponseData, 'no error is raised' is overstated: throwIfTotalTimeoutReached can throw a TimeoutError when the timeout comes from totalTimeout.; Claim that non-2xx responses ar |
| retry-on-timeout | identifier | completed | 5 | 4 | 100.0% | 3 | $0.089 |  |
| http-error-data | identifier | completed | 3 | 5 | 100.0% | 4 | $0.114 | Claim that the HTTPError.ts doc quote at line 11 and the type at line 20 are as stated; the evidence for HTTPError.ts is truncated and does not show the quoted text or the type declaration; The 10 MiB |
| is-ky-error-guard | identifier | completed | 3 | 5 | 100.0% | 3 | $0.079 | KyError defines `get isKyError(): true { return true; }` and `override name = 'KyError'` — the evidence for KyError.ts is truncated and does not show the getter or name field; Citation source/errors/K |
| init-hook-options | identifier | completed | 4 | 5 | 100.0% | 3 | $0.095 | InitOptions definition details (retry added back as mutable, 'hooks cannot change the hooks option') partly inferred; evidence only shows the Omit type truncated at 'retry?: MutableRetryOptions \| num |
| request-takes-too-long | conceptual | completed | 3 | 5 | 100.0% | 4 | $0.132 | The timeout.ts code snippet (setTimeout with timedOut = true, abortController?.abort(), reject(new TimeoutError(request))) is not visible; evidence truncates at line 22; Late response is discarded and |
| network-error-detection | conceptual | completed | 3 | 5 | 100.0% | 3 | $0.089 | Details of isRawNetworkError logic at lines 16-46 (TypeError name check, Safari 'Load failed' with no stack/__sentry_captured__, Deno prefix, Chrome 'Failed to fetch' variants) are not visible in the  |
| default-retry-policy | conceptual | completed | 4 | 5 | 100.0% | 3 | $0.083 | Citation source/types/retry.ts:37-51 is fine, but the claim that 'Ky waits for the time given in the retry timing header' for afterStatusCodes is only loosely supported by the retry.ts doc text shown; |
| upload-progress | conceptual | completed | 4 | 4 | 100.0% | 5 | $0.137 | "Ky runs the request body through a byte-counting stream" for uploads is inferred; the code that wires withProgress into the request was not shown; The line range `source/utils/body.ts:78-110` is cite |
| create-vs-extend | conceptual | completed | 4 | 4 | 100.0% | 3 | $0.085 | Cited line ranges are slightly off: source/types/ky.ts:104-119 and 96-102 cover the function form and replaceOption, but the answer's attribution is approximate.; The claim that calling api.create(... |
| header-merging | conceptual | completed | 4 | 5 | 100.0% | 5 | $0.097 | Claim that the `.extend()` options and request are both the 'later source' — evidence shows only layered merge, not explicit request-vs-instance ordering; Statement that `undefined` deletion marker ca |
| query-string-handling | conceptual | completed | 4 | 5 | 100.0% | 4 | $0.105 | The Ky constructor snippet is abbreviated but the claim that a duplicate key ends up as `?a=1&a=2` is inferred rather than shown (reasonable from append); Body is read back from the current request: t |
| cancel-during-retry-wait | conceptual | completed | 4 | 5 | 100.0% | 4 | $0.097 | The delay helper's "if the timer finishes first, it removes the listener and resolves" is not shown, because the delay.ts snippet cuts off at line 24.; The claim that Ky's per-attempt timeout does not |
| mock-response-before-request | conceptual | completed | 4 | 4 | 100.0% | 4 | $0.091 | Cites source/types/hooks.ts:149 for Ky swapping in its abort signal; supported, but the claim that the early return 'ends the loop' and no request is sent is inferred from the runner without seeing it |
| retry-based-on-response-body | conceptual | completed | 4 | 4 | 0.0% | 3 | $0.088 | If the retry limit runs out, the ForceRetryError goes to beforeError (only the hooks.ts snippet is truncated, though it does state ForceRetryError when limit exceeded); Forced retry skipping shouldRet |
| url-prefix-and-base | conceptual | completed | 4 | 5 | 100.0% | 3 | $0.073 | Claim that a relative path like `api/users` is added after the base URL's last `/` and that a leading-`/` path replaces the base path is standard URL behavior, not shown in the evidence; The worked ex |
| http2-in-node | conceptual | completed | 4 | 5 | 100.0% | 4 | $0.092 | Node's `fetch` uses undici (the evidence only names undici as the dispatcher library, not as what Node's fetch runs on); ProxyAgent example in the answer is shown as `await ky(...)` with no `.json()`  |
| retry-delay-backoff | multi-file | completed | 4 | 5 | 50.0% | 4 | $0.109 | If the server sends a retry timing header, that header sets the wait instead (the code that applies the header delay is not shown; only docs/notes imply it); Forced retry delay is used exactly with no |
| json-schema-validation | multi-file | completed | 3 | 4 | 100.0% | 4 | $0.133 | The SchemaValidationError class body (name, constructor, super message, issues field) at SchemaValidationError.ts:25-33 is quoted but only lines 1-13 are visible in the evidence; The claim that an inv |
| custom-fetch-and-extra-options | multi-file | completed | 4 | 5 | 100.0% | 4 | $0.126 | The citation for test/fetch.ts:301-317 says a per-request dispatcher replaces the ky.create default and the class instance arrives intact; this is shown, but the specific `import {Agent} from 'undici' |
| retry-after-header | multi-file | completed | 4 | 5 | 100.0% | 7 | $0.241 | Claim that a forced retry via ky.retry({delay}) is at Ky.ts:698-700 is supported, but the line range citation for the #calculateDelay start (665-686) and "ky.retry({delay})" naming rely on partial evi |
| kubernetes-ingress | not-found | not_found | - | - | - | 2 | $0.023 |  |
| world-cup-winner | not-found | not_found | - | - | - | 1 | $0.014 |  |
| postgres-vacuum | not-found | not_found | - | - | - | 2 | $0.024 |  |
| react-use-effect | not-found | not_found | - | - | - | 2 | $0.031 |  |
| graphql-batching | not-found | not_found | - | - | - | 3 | $0.056 |  |
| cookie-jar | not-found | not_found | - | - | - | 4 | $0.068 |  |
| request-deduplication | not-found | not_found | - | - | - | 3 | $0.050 |  |
| xml-response-parsing | not-found | completed | - | - | - | 3 | $0.062 |  |
