# Retrieval recall

Golden set `golden/ky.yaml` (ky @ `3541888878c4`), 2026-11-16 15:12 UTC.
Each answerable question is sent to `POST /repos/:id/search` as written (top 20 chunks);
recall@k is the share of its expected files among the first k distinct files returned.

## vector

| Questions | n | recall@5 | recall@10 |
|---|---:|---:|---:|
| all | 28 | 26.8% | 44.6% |
| identifier | 12 | 33.3% | 66.7% |
| conceptual | 12 | 25.0% | 33.3% |
| multi-file | 4 | 12.5% | 12.5% |

## hybrid

| Questions | n | recall@5 | recall@10 |
|---|---:|---:|---:|
| all | 28 | 28.6% | 51.8% |
| identifier | 12 | 50.0% | 75.0% |
| conceptual | 12 | 16.7% | 41.7% |
| multi-file | 4 | 0.0% | 12.5% |

## Per question

| Question | Type | Expected | vector rank | hybrid rank |
|---|---|---|---:|---:|
| force-retry-error | identifier | source/errors/ForceRetryError.ts | 6 | 4 |
| max-response-size-limit | identifier | source/utils/body.ts | - | - |
| ky-stop-before-retry | identifier | source/core/Ky.ts | - | - |
| timeout-vs-total-timeout | identifier | source/types/options.ts | 9 | 6 |
| replace-option | identifier | source/utils/merge.ts | 3 | 4 |
| prefix-url-renamed | identifier | source/core/Ky.ts | 4 | 5 |
| before-error-hook-flow | identifier | source/core/Ky.ts | - | - |
| parse-json-option | identifier | source/core/Ky.ts | 10 | 10 |
| retry-on-timeout | identifier | source/core/Ky.ts | - | 6 |
| http-error-data | identifier | source/errors/HTTPError.ts | 7 | 3 |
| is-ky-error-guard | identifier | source/utils/type-guards.ts | 4 | 1 |
| init-hook-options | identifier | source/core/Ky.ts | 5 | 4 |
| request-takes-too-long | conceptual | source/utils/timeout.ts | - | - |
| network-error-detection | conceptual | source/utils/is-network-error.ts | - | - |
| default-retry-policy | conceptual | source/utils/normalize.ts | - | - |
| upload-progress | conceptual | source/utils/body.ts | 4 | - |
| create-vs-extend | conceptual | source/index.ts | - | - |
| header-merging | conceptual | source/utils/merge.ts | - | - |
| query-string-handling | conceptual | source/core/Ky.ts | - | 8 |
| cancel-during-retry-wait | conceptual | source/utils/delay.ts | - | - |
| mock-response-before-request | conceptual | source/core/Ky.ts | 6 | 4 |
| retry-based-on-response-body | conceptual | source/core/Ky.ts | - | 9 |
| url-prefix-and-base | conceptual | source/core/Ky.ts | 4 | 9 |
| http2-in-node | conceptual | readme.md | 1 | 1 |
| retry-delay-backoff | multi-file | source/core/Ky.ts, source/utils/normalize.ts | - | - |
| json-schema-validation | multi-file | source/core/Ky.ts, source/errors/SchemaValidationError.ts | 5 | - |
| custom-fetch-and-extra-options | multi-file | source/core/Ky.ts, source/utils/options.ts | - | 6 |
| retry-after-header | multi-file | source/core/Ky.ts, source/core/retry-timing.ts | - | - |
