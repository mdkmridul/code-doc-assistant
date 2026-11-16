"""Runs the golden set against the API: retrieval recall per mode, and judged answers."""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from typing import Any

from .client import CdaClient, RetrievalMode
from .golden import GoldenQuestion, GoldenSet
from .judge import Judge, format_evidence
from .metrics import AnswerRow, RecallRow, unique_paths

#: Chunks requested per search; recall@k then counts the first k distinct files.
SEARCH_TOP_K = 20
RECALL_KS = (5, 10)


@dataclass
class RetrievalRun:
    mode: RetrievalMode
    rows: list[RecallRow]


def run_retrieval(client: CdaClient, repo_id: str, golden: GoldenSet, mode: RetrievalMode) -> RetrievalRun:
    """search_code exactly as the assistant would call it, with the question as the query."""
    rows = []
    for q in golden.answerable:
        hits = client.search(repo_id, q.question, SEARCH_TOP_K, mode)
        rows.append(
            RecallRow(
                question_id=q.id,
                question_type=q.type,
                expected_files=tuple(q.expected_files),
                retrieved_paths=tuple(h["path"] for h in hits),
            )
        )
    return RetrievalRun(mode=mode, rows=rows)


@dataclass
class QuestionResult:
    id: str
    kind: str
    type: str
    question: str
    outcome: str = "error"
    answer: str = ""
    iterations: int = 0
    tool_calls: list[str] = field(default_factory=list)
    cited_files: list[str] = field(default_factory=list)
    #: Expected files among the code the assistant saw while answering.
    evidence_recall: float | None = None
    cost_usd: float = 0.0
    latency_s: float = 0.0
    faithfulness: int | None = None
    correctness: int | None = None
    unsupported_claims: list[str] = field(default_factory=list)
    rationale: str = ""
    judge_cost_usd: float = 0.0
    error: str | None = None

    def to_row(self) -> AnswerRow:
        return AnswerRow(
            question_id=self.id,
            kind=self.kind,
            outcome=self.outcome,
            faithfulness=self.faithfulness,
            correctness=self.correctness,
            cost_usd=self.cost_usd + self.judge_cost_usd,
        )

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


def _answer_one(
    client: CdaClient,
    judge: Judge,
    repo_id: str,
    q: GoldenQuestion,
    prompt_version: str,
    mode: RetrievalMode,
) -> QuestionResult:
    result = QuestionResult(id=q.id, kind=q.kind, type=q.type, question=q.question)
    try:
        session_id = client.start_session(repo_id)  # a fresh session: no history leaks between questions
        started = time.monotonic()
        answer = client.ask(session_id, q.question, prompt_version=prompt_version, retrieval_mode=mode)
        result.latency_s = round(time.monotonic() - started, 1)
        result.outcome = answer["outcome"]
        result.answer = answer["answer"]
        result.iterations = answer["iterations"]
        result.cost_usd = float(answer["usage"]["costUsd"])
        result.tool_calls = [t["name"] for t in answer["toolCalls"]]
        result.cited_files = unique_paths(c["path"] for c in answer["citations"])
        seen = {e["path"] for t in answer["toolCalls"] for e in (t.get("excerpts") or [])}
        if q.expected_files:
            result.evidence_recall = sum(f in seen for f in q.expected_files) / len(q.expected_files)
        # Faithfulness is judged for answers given; a declined answer has no claims to check.
        if q.kind == "answerable" and result.outcome != "not_found":
            verdict = judge.grade(q.question, q.gist, result.answer, format_evidence(answer["toolCalls"]))
            result.faithfulness = verdict.faithfulness
            result.correctness = verdict.correctness
            result.unsupported_claims = verdict.unsupported_claims
            result.rationale = verdict.rationale
            result.judge_cost_usd = verdict.cost_usd
    except Exception as error:  # one failed question must not sink the run; it is reported
        result.error = f"{type(error).__name__}: {error}"
    return result


def run_answers(
    client: CdaClient,
    judge: Judge,
    repo_id: str,
    golden: GoldenSet,
    prompt_version: str,
    mode: RetrievalMode,
    workers: int = 4,
    limit: int | None = None,
    on_done: Any = None,
) -> list[QuestionResult]:
    questions = golden.questions[:limit] if limit else golden.questions
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_answer_one, client, judge, repo_id, q, prompt_version, mode) for q in questions]
        results = []
        for future in futures:
            result = future.result()
            if on_done:
                on_done(result)
            results.append(result)
    return results
