"""Metric maths, kept pure so it is unit-tested without the API or a model."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from statistics import mean

#: Faithfulness scores at or above this count as a faithful answer (1-5 rubric).
FAITHFUL_THRESHOLD = 4


def unique_paths(paths: Iterable[str]) -> list[str]:
    """Paths in first-seen order: several chunks of one file are one retrieved file."""
    seen: dict[str, None] = {}
    for path in paths:
        seen.setdefault(path, None)
    return list(seen)


def recall_at_k(expected_files: Sequence[str], retrieved_paths: Sequence[str], k: int) -> float:
    """
    Share of the expected files found among the first k distinct retrieved files.
    k counts files, not chunks: a file split into many chunks takes one slot.
    """
    if not expected_files:
        raise ValueError("recall is undefined without expected files")
    if k < 1:
        raise ValueError("k must be at least 1")
    top = set(unique_paths(retrieved_paths)[:k])
    return sum(1 for f in expected_files if f in top) / len(expected_files)


@dataclass(frozen=True)
class RecallRow:
    question_id: str
    question_type: str
    expected_files: tuple[str, ...]
    retrieved_paths: tuple[str, ...]


def recall_table(rows: Sequence[RecallRow], ks: Sequence[int]) -> dict[str, dict[int, float]]:
    """Mean recall@k overall (key "all") and per question type."""
    groups: dict[str, list[RecallRow]] = {"all": list(rows)}
    for row in rows:
        groups.setdefault(row.question_type, []).append(row)
    return {
        name: {k: mean(recall_at_k(r.expected_files, r.retrieved_paths, k) for r in group) for k in ks}
        for name, group in groups.items()
        if group
    }


def rate(flags: Iterable[bool]) -> float | None:
    values = list(flags)
    return sum(values) / len(values) if values else None


@dataclass(frozen=True)
class AnswerRow:
    question_id: str
    kind: str  # answerable | not_found
    outcome: str
    faithfulness: int | None  # judged answerable answers only
    correctness: int | None
    cost_usd: float


def answer_metrics(rows: Sequence[AnswerRow]) -> dict[str, float | None]:
    answerable = [r for r in rows if r.kind == "answerable"]
    not_found = [r for r in rows if r.kind == "not_found"]
    judged = [r for r in answerable if r.faithfulness is not None]
    return {
        # Not-found questions the assistant correctly declined.
        "refusal_rate_not_found": rate(r.outcome == "not_found" for r in not_found),
        # Answerable questions it wrongly declined.
        "false_refusal_rate": rate(r.outcome == "not_found" for r in answerable),
        "faithfulness_mean": mean(r.faithfulness for r in judged) if judged else None,  # type: ignore[misc]
        "faithful_rate": rate((r.faithfulness or 0) >= FAITHFUL_THRESHOLD for r in judged),
        "correctness_mean": mean(r.correctness for r in judged if r.correctness is not None) if judged else None,
        "cost_usd_total": sum(r.cost_usd for r in rows),
    }
