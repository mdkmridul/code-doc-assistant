# answer-question@v4 with vector retrieval

Golden set `golden/ky.yaml` (ky @ `3541888878c4`), 36 questions, 2026-11-16 15:12 UTC.
Answers by the API's model; faithfulness judged by `claude-sonnet-5-5` (rubric in `evals/src/cda_eval/judge.py`).

## Summary

| Metric | Value |
|---|---:|
| recall@5 (all / identifier / conceptual / multi-file) | 26.8% / 33.3% / 25.0% / 12.5% |
| recall@10 (all / identifier / conceptual / multi-file) | 44.6% / 66.7% / 33.3% / 12.5% |
| Expected files the assistant saw while answering | 94.6% |
| Faithfulness, mean (1-5, 28 judged answers) | 3.96 |
| Faithful answers (score >= 4) | 85.7% |
| Correctness vs gist, mean (1-5) | 4.93 |
| Refusal rate on not-found questions | 87.5% |
| False refusals on answerable questions | 0.0% |
| Mean model calls per question | 3.7 |
| Cost (answers + judge) | $2.97 |
| Errors | 0 |

## Per question

| Question | Type | Outcome | Faithful | Correct | Evidence recall | Calls | Cost | Unsupported claims |
|---|---|---|---:|---:|---:|---:|---:|---|
| force-retry-error | identifier | completed | 3 | 5 | 100.0% | 3 | $0.069 | The constructor's validation details (delay accepts non-negative number or Infinity, rejects NaN, `setTimeout` backoff collapse) are not visible in the truncated evidence; `customDelay` taken from `op |
| max-response-size-limit | identifier | completed | 4 | 5 | 100.0% | 5 | $0.120 | The claim that Chromium specifically is the reason for the wrapping is supported only by a code comment about Chromium replacing stream errors; fine, but 'the request is not retried' relies on the opt |
| ky-stop-before-retry | identifier | completed | 4 | 5 | 100.0% | 4 | $0.116 | That the stop path returns before #retryCount increment is shown (line 1214 after), fine; but claim that the `undefined` is simply 'passed back up as the result' to the request promise is inferred, as |
| timeout-vs-total-timeout | identifier | completed | 4 | 5 | 100.0% | 5 | $0.092 | The `effectiveTimeout` snippet is quoted as being used "for each step", but the evidence shows it only in the body-read path (#raceBodyRead) and does not show it applied to every attempt; Claim that a |
| replace-option | identifier | completed | 4 | 5 | 100.0% | 6 | $0.145 | "Without the wrapper, the signals are combined with `AbortSignal.any`" is cited to lines 360-368 and readme:1078; the AbortSignal.any call is in lines 476-480, and readme 1078 only says signals are co |
| prefix-url-renamed | identifier | completed | 4 | 5 | 100.0% | 5 | $0.114 | The Ky constructor checks for prefixUrl "before doing anything else" - evidence shows it runs after the input type check and destructuring; Claimed the test at test/prefix.ts:53-61 shows an inherited  |
| before-error-hook-flow | identifier | completed | 4 | 5 | 100.0% | 5 | $0.103 | The type-docs list of error types is cited to source/types/hooks.ts:303-306, but the evidence snippet is truncated mid-list and does not show ResponseSizeError or ForceRetryError in full (though Force |
| parse-json-option | identifier | completed | 4 | 5 | 100.0% | 4 | $0.097 | "Ky always reads the body as text first" is a generalization; the evidence shows it only for the .json() shortcut, the decorated response and error data; Errors your parser throws pass through unchang |
| retry-on-timeout | identifier | completed | 5 | 4 | 100.0% | 3 | $0.077 |  |
| http-error-data | identifier | completed | 4 | 5 | 100.0% | 5 | $0.117 | A fetch Response body can only be read once is stated as the reason, while the evidence says only that the body is consumed (general fact, minor); Claimed Ky.ts:62 for maxErrorResponseBodySize is supp |
| is-ky-error-guard | identifier | completed | 3 | 5 | 100.0% | 4 | $0.075 | The KyError class body is shown as `override name = 'KyError'; get isKyError(): true { return true; }` at KyError.ts:8-14, but the evidence truncates after `export class KyError extends` and never sho |
| init-hook-options | identifier | completed | 4 | 5 | 100.0% | 3 | $0.077 | Claim that the hook gets plain user-facing options "before the options are normalized" is inferred from ordering rather than shown directly; Claim that headers are "always a plain object with lowercas |
| request-takes-too-long | conceptual | completed | 3 | 5 | 100.0% | 4 | $0.082 | The quoted code snippet of timeout.ts (setTimeout callback, fetch(...).then with timedOut/cancelBody) is not visible; evidence is truncated at line 22.; Timer cleared in `finally` at lines 31, 43-45 a |
| network-error-detection | conceptual | completed | 3 | 5 | 100.0% | 4 | $0.082 | The detailed line-by-line claims about is-network-error.ts lines 16-46 (TypeError name check, Safari 'Load failed' with no stack/__sentry_captured__, Deno prefix, Chrome 'Failed to fetch') are not vis |
| default-retry-policy | conceptual | completed | 4 | 5 | 100.0% | 3 | $0.065 | POST and PATCH are not retried "because they are not in the default method list" is inferred from the list; no evidence explicitly mentions POST or PATCH; Citation source/types/retry.ts:46-51 for maxR |
| upload-progress | conceptual | completed | 4 | 5 | 100.0% | 6 | $0.207 | The claim that a hook-returned non-Request object is skipped is cited at lines 219-228, which supports it, but the claim that the total is estimated from `body` 'before sending' is only loosely suppor |
| create-vs-extend | conceptual | completed | 4 | 5 | 100.0% | 4 | $0.085 | The code snippet is presented as source/index.ts:42-50 but is paraphrased with types removed (minor); "signals are combined" is cited to ky.ts:100-102, but line 102 is where this is stated, so the ran |
| header-merging | conceptual | completed | 4 | 5 | 100.0% | 4 | $0.077 | Claim that a Headers instance 'can't store a real undefined' is supported, but the claim that replaceOption drops inherited headers is only inferred from code line 465 (supported), while the 'later so |
| query-string-handling | conceptual | completed | 4 | 5 | 100.0% | 4 | $0.089 | Mentions of `ky.extend` as the example path for marking deleted keys is not shown in the Ky.ts evidence (only inferred); Claim that an empty string changes nothing is fine, but "a repeated key ends up |
| cancel-during-retry-wait | conceptual | completed | 4 | 5 | 100.0% | 4 | $0.095 | delay helper "removes the listener" when the delay finishes normally (the evidence snippet is truncated at line 24); "No further attempt starts and no beforeRetry hooks run" after abort is inferred fr |
| mock-response-before-request | conceptual | completed | 4 | 5 | 100.0% | 7 | $0.161 | Claim that `#runBeforeRequestHooks` returning a response skips `#retry()` entirely is inferred from the `??` expression, not shown in the hook implementation; Claim that a `beforeRetry` response follo |
| retry-based-on-response-body | conceptual | completed | 4 | 5 | 0.0% | 3 | $0.072 | Claim that forced retry skips the method check is not stated (the answer omits this, not a claim); the 'delay must be non-negative number' detail is supported; minor: 'If it returns nothing, the respo |
| url-prefix-and-base | conceptual | completed | 4 | 5 | 100.0% | 3 | $0.081 | Concrete worked examples (prefix '/v1' replaces baseUrl path; prefix 'v1' with 'https://x.com/api/' gives https://x.com/api/v1/users) are inferred from URL resolution rules rather than shown in the ev |
| http2-in-node | conceptual | completed | 4 | 5 | 100.0% | 4 | $0.068 | Ky runs on Node's built-in `fetch`, which is built on Undici (not stated in the evidence); `undici` must be installed in the project to import Agent, Pool or ProxyAgent |
| retry-delay-backoff | multi-file | completed | 5 | 5 | 50.0% | 3 | $0.082 |  |
| json-schema-validation | multi-file | completed | 4 | 5 | 100.0% | 3 | $0.069 | `name` is 'SchemaValidationError' and `message` is 'Response schema validation failed' (SchemaValidationError.ts lines 25-33 not shown in evidence); It extends plain `Error` (class body not visible in |
| custom-fetch-and-extra-options | multi-file | completed | 4 | 5 | 100.0% | 3 | $0.101 | Test at test/fetch.ts:951-960 cited for rejection with `undefined` or `{}`; the visible lines support this, but the specific wording that Ky rejects "with" the TypeError is only partially shown; The R |
| retry-after-header | multi-file | completed | 5 | 4 | 100.0% | 4 | $0.124 |  |
| kubernetes-ingress | not-found | not_found | - | - | - | 2 | $0.012 |  |
| world-cup-winner | not-found | not_found | - | - | - | 1 | $0.003 |  |
| postgres-vacuum | not-found | not_found | - | - | - | 2 | $0.011 |  |
| react-use-effect | not-found | not_found | - | - | - | 2 | $0.013 |  |
| graphql-batching | not-found | not_found | - | - | - | 3 | $0.044 |  |
| cookie-jar | not-found | not_found | - | - | - | 3 | $0.061 |  |
| request-deduplication | not-found | not_found | - | - | - | 3 | $0.051 |  |
| xml-response-parsing | not-found | completed | - | - | - | 3 | $0.037 |  |
