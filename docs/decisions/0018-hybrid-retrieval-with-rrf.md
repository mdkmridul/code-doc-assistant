# 0018 — Hybrid retrieval: vector plus full-text, fused with reciprocal rank fusion

`search_code` now defaults to **hybrid** retrieval. One SQL statement runs the existing pgvector ranking (the inner `ORDER BY embedding <=> query LIMIT n`, so HNSW is still used, ADR 0010) and a full-text ranking of the question's words over `chunks.search_vector`, the `simple`-configuration tsvector with its GIN index (ADR 0005). Each ranking keeps at least 40 candidates, and they are fused with **reciprocal rank fusion**: a chunk scores Σ 1/(60 + rank) over the rankings it appears in, scaled to 0–1. `vector` mode is still available, per question (`retrievalMode`) and on `POST /repos/:id/search`, and runs exactly the old SQL.

**Why fuse at all.** ADRs 0005 and 0010 claimed the `simple` tsvector would help because identifiers are indexed exactly as written (`afterStatusCodes`, `ForceRetryError`), and embeddings blur them. The eval (ADR 0019) bears this out on ky at a pinned commit:

| ky, 28 answerable questions | vector recall@5 | hybrid recall@5 | vector recall@10 | hybrid recall@10 |
|---|---:|---:|---:|---:|
| identifier questions (12) | 33.3% | **50.0%** | 66.7% | **75.0%** |
| conceptual questions (12) | 25.0% | 16.7% | 33.3% | **41.7%** |
| multi-file questions (4) | 12.5% | 0.0% | 12.5% | 12.5% |
| all | 26.8% | **28.6%** | 44.6% | **51.8%** |

The biggest gain is where the ADRs said it would be. Conceptual questions lose a little at k = 5, where common words like "request" and "retry" pull in chunks with matching words but the wrong subject, and gain at k = 10. On average hybrid wins at both cutoffs, so it is the default.

**RRF over blending scores.** Cosine similarity and `ts_rank_cd` are on unrelated scales: a ranking's raw score says nothing about the other's. Weighted blending would need normalisation and a tuned weight per repository. RRF uses only ranks, has one constant with a well-known default (60), and needs no tuning to be a reasonable baseline.

**How the question becomes a text query.** `toOrTsQuery` splits the question the way Postgres' parser does: letters and digits; `_`, `-` and `.` separate words. It lower-cases the words, drops a small list of English and code-question stop words and anything shorter than three characters, and ORs up to 12 terms. AND semantics would demand every word of a natural-language question appear in one chunk, which almost never happens. A question with nothing left after that ("how does it work?") falls back to vector search. Because only letters and digits survive, no tsquery operator can be injected.

**Plans.** On real data (ky's 818 chunks among about 9,600 in the dev database) every step is an index scan. The text half reaches chunks through the repository's files (`chunks_file_id_idx`) and filters with `@@`, about 5 ms; the GIN index takes over when a single repository is large enough for that to pay. The integration tests assert the HNSW plan of the vector half. The text half's plan is the planner's choice on the tiny test table, so it is checked here instead.

**Known limit.** Absolute recall on ky is low, about 50% at k = 10, because `test/` and `readme.md` chunks crowd out `source/` for many questions. The per-question table in `evals/results/retrieval.md` shows which ones. Down-weighting test files is the next lever to try, and the eval is there to say whether it helps.
