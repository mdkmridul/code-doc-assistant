# Evals

A [uv](https://docs.astral.sh/uv/) Python project that measures the assistant against a golden set, through the API. ADR 0019 explains the design.

## What it measures

| Metric | How | Model calls |
|---|---|---|
| **recall@k** (k = 5, 10) | Each answerable question goes to `POST /repos/:id/search` as written. recall@k is the share of its `expected_files` among the first k *distinct files* returned (top 20 chunks), overall and per question type. | none |
| **Evidence recall** | The share of expected files among the code the assistant actually saw while answering (tool-call excerpts). | — |
| **Faithfulness** (1–5) | `claude-sonnet-5-5`, a different model from the one answering, grades each answer against the code the assistant saw, using the rubric in `src/cda_eval/judge.py`. An answer counts as faithful at a score of 4 or more. The judge also scores **correctness** against the question's `gist`. | judge |
| **Refusal rate** | The share of `not_found` questions answered with `outcome: not_found`. False refusals (answerable questions declined) are reported too. | answers |

## Golden set

`golden/ky.yaml` covers [ky](https://github.com/sindresorhus/ky) at a pinned commit: 28 answerable questions (12 identifier, 12 conceptual, 4 multi-file) and 8 not-found questions (4 off-topic, 4 plausible features ky doesn't have). Each question has `expected_files`, `expected_symbols`, a `gist` of the correct answer, and a comment saying which lines it was checked against.

The repository is GitHub's zip of exactly that commit. It's downloaded once into `.cache/` and uploaded with `POST /repos`; the API deduplicates identical uploads. Results therefore don't move when ky does. To change commit, update `repo.commit`, re-check the questions, and re-record the baseline.

## Running

The API must be running: `docker compose --profile app up -d --build`, or the host commands in CLAUDE.md. The judge reads `ANTHROPIC_API_KEY` from the root `.env`. From the repository root:

```
make eval            # recall for vector + hybrid, then answers for v4/hybrid, v4/vector, v3/hybrid (~$10)
make eval-retrieval  # recall only, no model calls
make eval-baseline   # record current recall as evals/baseline.json (commit it)
make eval-test       # offline tests + recall regression test against the baseline
make eval-test TOLERANCE=-0.10   # demand a 10-point improvement (shows the test failing)
make eval-unit       # offline tests only
```

Without make, use `uv --directory evals run cda-eval all|retrieval|baseline|summary`, or `answers --prompt v4 --mode hybrid [--limit N]` for a single run.

## Results

`results/` holds one Markdown table per run, named after the prompt version and retrieval mode (for example `answer-question@v4__hybrid.md`), with a JSON file beside it. It also has `retrieval.md` (recall by mode and question) and `summary.md` (every run side by side). Commit them when a change is meant to move a number.

## Regression test

`tests/test_recall_regression.py` re-runs retrieval for both modes and fails when recall@5 or recall@10 falls more than `TOLERANCE` (default 0.05, i.e. 5 points) below `baseline.json`. It makes no model calls. Re-record the baseline when a change is *meant* to change retrieval, and commit it with that change.
