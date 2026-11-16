# 0019 — Evals: a golden set at a pinned commit, retrieval recall without a model, and a separate judge

`evals/` is a [uv](https://docs.astral.sh/uv/) Python project that measures the assistant through its HTTP API. A golden YAML set describes **ky at a pinned commit**: 28 answerable questions (12 identifier, 12 conceptual, 4 multi-file) and 8 not-found questions. Each question has expected files and symbols and a gist of the correct answer. `make eval` writes one Markdown table per prompt version and retrieval mode to `evals/results/`, and `make eval-test` fails when recall drops more than a tolerance below the committed `baseline.json`.

**Choices.**
- **A separate Python project, not another npm workspace.** The eval is a client of the API and shares no code with it, and Python's YAML, pydantic and pytest are the usual eval toolkit. The API stays the single source of behaviour.
- **A pinned commit uploaded as GitHub's zip, not the repository URL.** Git ingest always follows HEAD, so results would drift as ky changes. The zip of a fixed commit, deduplicated by content hash, keeps every run on the same code.
- **Recall@k through `POST /repos/:id/search`, with no model.** It is exactly what `search_code` returns, it costs nothing, and it is deterministic, so a regression test can run on every change. k counts distinct files, not chunks, so one file split into many chunks takes one slot.
- **Faithfulness judged by `claude-sonnet-5-5`, never the answering model.** A model is lenient with its own writing. The judge sees the question, the answer, the code the assistant actually saw (its tool-call excerpts, numbered as the model saw them), and the gist. It scores faithfulness (1–5, faithful at 4 or more) and correctness against the gist, with a fixed rubric and a JSON schema (`output_config.format`). The judge also uses server-side refusal fallbacks (`fallbacks: "default"`).
- **Per-question prompt version and retrieval mode on the API** (`promptVersion`, `retrievalMode`), not separate server builds. One running API can compare versions and modes. Only prompt versions with a changelog entry load, and an unknown version is a 400.
- **The judge's evidence must equal the model's.** `read_file` excerpts used to be cut at 8,000 characters while the model read up to 16,000. The judge then flagged claims the model had in fact seen, so excerpts now keep everything that was read.

**First results** (ky @ `3541888878c4`, 2026-11-16):

| Run | recall@5 | recall@10 | recall@5 identifier | Evidence recall | Faithfulness | Faithful | Correctness | Refusal (not-found) | Cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| v4 / hybrid | 28.6% | 51.8% | 50.0% | 91.1% | 3.79 | 75.0% | 4.79 | 87.5% | $3.26 |
| v4 / vector | 26.8% | 44.6% | 33.3% | 94.6% | 3.96 | 85.7% | 4.93 | 87.5% | $2.97 |
| v3 / hybrid | 28.6% | 51.8% | 50.0% | 94.6% | 3.89 | 82.1% | 4.82 | 75.0% | $4.56 |

Model calls per question: 3.7 for both v4 runs and 4.9 for v3. No question errored in any run.

- **Hybrid retrieval does what ADR 0018 claims at the retrieval level** (identifier recall@5 up from 33% to 50%), **but that does not yet carry over to answers.** The agent searches several times and reads files, so it reaches the expected file in 91–95% of questions either way. The answer-level differences are a question or two out of 28, within noise.
- **Faithfulness is the weak spot, and it is real.** Every low score is an answer quoting code beyond what the assistant saw: search snippets are cut at 600 characters, yet the answer "quotes" the rest of the class, most likely from the model's prior knowledge of ky. This is also a gap in ADR 0017's citation check, which accepts lines anywhere in a search hit's *chunk* although the model only saw the snippet. The next steps to measure with this eval: validate search-hit citations against the snippet's lines, and steer the model to `read_file` before quoting.
- **v4 against v3 (ADR 0017's claims).**
  - **Refusals:** v4 declines more not-found questions (87.5% against 75%), as ADR 0017 expected. Both versions decline all 4 off-topic questions. Every miss, in either version, is a *grounded negative* ("ky has no XML shortcut" or "no cookie jar", citing the code), not an invented feature. v4 just declines those more firmly. The XML question should be reworded or made answerable.
  - **Cost:** v4 also costs less, 28% under v3 (3.7 against 4.9 model calls per question). v3 never writes the citation block, so every v3 answer needs the one rewrite.
  - **Faithfulness and correctness are the same within noise**, as expected: v4 changes the answer contract, not how the model researches.
- **The comparison run found two bugs in ADR 0017's rewrite step, now fixed.** Neither showed in the v4 runs, which never needed a rewrite, nor in unit tests, whose fake model doesn't enforce the API's rules.
  - **Rejected note.** The rewrite note was sent as a mid-conversation `system` message right after the assistant's text, which the API rejects with a 400. Every v3 question failed this way. The adapter now sends such a note as a user turn (a note after tool results stays a system message).
  - **Format not shown.** The note didn't spell out the block's JSON, so v3 wrote `{"sourceIds": [...]}`, the strict schema rejected it, and every answer, answerable ones included, became "not found". The note now shows the exact block, and a test checks that its example parses.
