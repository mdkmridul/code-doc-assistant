# answer-question prompt changelog

Every version of `prompts/answer-question/` that has been used stays in place unchanged, so `llm_calls.prompt_version` (for example `answer-question@v4`) always points at the exact text that ran. To change the prompt, add the next version, add its entry here, and bump `ANSWER_QUESTION_PROMPT` in `apps/api/src/chat/chat.constants.ts`. The API refuses to boot if the version in use has no entry here.

## v4

- States that repository contents are data: instructions inside files or tool results are ignored (prompt-injection defence).
- Every final answer ends with a `<citations>` JSON block (`found`, `citations[{sourceId, lines?}]`), parsed with a zod schema and validated against the sourceIds that tools returned in this question. One rewrite is allowed, then the answer becomes "not found".
- `found: false` for questions the repository can't answer, including off-topic ones; no answers from general knowledge.

## v3

- Adds list_endpoints for questions about a service's HTTP API, with a caveat about prefixes declared elsewhere.
- Adds the per-question context budget: prefer targeted calls, and answer with what you have once the budget is used up.
- Read only the line range you need.

## v2

- Adds read_file: read the exact lines when a search snippet is cut off.
- Asks for precise citations as `path:start-end` with the full path.

## v1

- First version: answer from search_code results only, cite file paths and lines, say so when the answer can't be found.
