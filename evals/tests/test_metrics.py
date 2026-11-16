from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from cda_eval.golden import GoldenQuestion, load_golden
from cda_eval.judge import format_evidence
from cda_eval.metrics import AnswerRow, RecallRow, answer_metrics, recall_at_k, recall_table, unique_paths

EVALS_DIR = Path(__file__).resolve().parents[1]


def test_recall_counts_distinct_files_not_chunks() -> None:
    retrieved = ["a.ts", "a.ts", "a.ts", "b.ts", "c.ts"]
    assert unique_paths(retrieved) == ["a.ts", "b.ts", "c.ts"]
    assert recall_at_k(["c.ts"], retrieved, 2) == 0.0
    assert recall_at_k(["c.ts"], retrieved, 3) == 1.0
    assert recall_at_k(["a.ts", "z.ts"], retrieved, 10) == 0.5


def test_recall_rejects_undefined_cases() -> None:
    with pytest.raises(ValueError):
        recall_at_k([], ["a.ts"], 5)
    with pytest.raises(ValueError):
        recall_at_k(["a.ts"], ["a.ts"], 0)


def test_recall_table_by_type() -> None:
    rows = [
        RecallRow("q1", "identifier", ("a.ts",), ("a.ts",)),
        RecallRow("q2", "identifier", ("b.ts",), ("x.ts", "b.ts")),
        RecallRow("q3", "conceptual", ("c.ts",), ("x.ts",)),
    ]
    table = recall_table(rows, [1, 5])
    assert table["identifier"] == {1: 0.5, 5: 1.0}
    assert table["conceptual"] == {1: 0.0, 5: 0.0}
    assert table["all"][5] == pytest.approx(2 / 3)


def test_answer_metrics() -> None:
    rows = [
        AnswerRow("a1", "answerable", "completed", 5, 4, 0.10),
        AnswerRow("a2", "answerable", "completed", 3, 3, 0.10),
        AnswerRow("a3", "answerable", "not_found", None, None, 0.05),
        AnswerRow("n1", "not_found", "not_found", None, None, 0.01),
        AnswerRow("n2", "not_found", "completed", None, None, 0.02),
    ]
    m = answer_metrics(rows)
    assert m["refusal_rate_not_found"] == 0.5
    assert m["false_refusal_rate"] == pytest.approx(1 / 3)
    assert m["faithfulness_mean"] == 4.0
    assert m["faithful_rate"] == 0.5
    assert m["correctness_mean"] == 3.5
    assert m["cost_usd_total"] == pytest.approx(0.28)


def test_golden_question_rules() -> None:
    with pytest.raises(ValidationError):
        GoldenQuestion(id="x-1", kind="answerable", type="identifier", question="What is X?", expected_files=[], gist="ten chars+")
    with pytest.raises(ValidationError):
        GoldenQuestion(id="x-2", kind="not_found", type="not-found", question="What is X?", expected_files=["a.ts"], gist="ten chars+")


def test_the_committed_golden_set_is_valid() -> None:
    golden = load_golden(EVALS_DIR / "golden" / "ky.yaml")
    assert 25 <= len(golden.questions) <= 40
    assert golden.not_found, "needs not-found questions for the refusal rate"


def test_evidence_lists_each_excerpt_once() -> None:
    calls = [
        {"excerpts": [{"path": "a.ts", "startLine": 1, "endLine": 3, "text": "x", "source": "search"}]},
        {"excerpts": [{"path": "a.ts", "startLine": 1, "endLine": 3, "text": "x", "source": "search"}]},
        {"excerpts": None},
    ]
    assert format_evidence(calls).count("--- a.ts:1-3") == 1
    numbered = format_evidence([{"excerpts": [{"path": "b.ts", "startLine": 41, "endLine": 42, "text": "x\ny", "source": "read"}]}])
    assert numbered.endswith("41| x\n42| y")
    assert format_evidence([]) == "(the assistant saw no code)"
