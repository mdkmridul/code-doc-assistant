"""Markdown (for people) and JSON (for comparisons) results in evals/results/."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .metrics import FAITHFUL_THRESHOLD, answer_metrics, recall_table
from .runner import RECALL_KS, SEARCH_TOP_K, QuestionResult, RetrievalRun

TYPES_ORDER = ["all", "identifier", "conceptual", "multi-file"]


def run_name(prompt_id: str, mode: str) -> str:
    """e.g. answer-question@v4__hybrid: one results file per prompt version and retrieval mode."""
    return f"{prompt_id}__{mode}"


def _pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def _num(value: float | None, digits: int = 2) -> str:
    return "n/a" if value is None else f"{value:.{digits}f}"


def _cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def recall_lines(run: RetrievalRun) -> list[str]:
    table = recall_table(run.rows, RECALL_KS)
    header = "| Questions | n | " + " | ".join(f"recall@{k}" for k in RECALL_KS) + " |"
    lines = [header, "|---|---:|" + "---:|" * len(RECALL_KS)]
    counts = {"all": len(run.rows)} | {t: sum(r.question_type == t for r in run.rows) for t in TYPES_ORDER[1:]}
    for name in TYPES_ORDER:
        if name in table:
            lines.append(f"| {name} | {counts[name]} | " + " | ".join(_pct(table[name][k]) for k in RECALL_KS) + " |")
    return lines


def retrieval_json(run: RetrievalRun) -> dict[str, Any]:
    table = recall_table(run.rows, RECALL_KS)
    return {name: {str(k): v for k, v in by_k.items()} for name, by_k in table.items()}


def write_retrieval_report(results_dir: Path, runs: list[RetrievalRun], meta: dict[str, Any]) -> Path:
    lines = [
        "# Retrieval recall",
        "",
        f"Golden set `{meta['golden']}` ({meta['repo']} @ `{meta['commit'][:12]}`), {meta['when']}.",
        f"Each answerable question is sent to `POST /repos/:id/search` as written (top {SEARCH_TOP_K} chunks);",
        "recall@k is the share of its expected files among the first k distinct files returned.",
        "",
    ]
    for run in runs:
        lines += [f"## {run.mode}", "", *recall_lines(run), ""]
    lines += ["## Per question", "", "| Question | Type | Expected | " + " | ".join(f"{r.mode} rank" for r in runs) + " |"]
    lines.append("|---|---|---|" + "---:|" * len(runs))
    for i, row in enumerate(runs[0].rows):
        ranks = []
        for run in runs:
            files = list(dict.fromkeys(run.rows[i].retrieved_paths))
            found = [files.index(f) + 1 for f in row.expected_files if f in files]
            ranks.append(", ".join(map(str, found)) if found else "-")
        lines.append(f"| {row.question_id} | {row.question_type} | {', '.join(row.expected_files)} | " + " | ".join(ranks) + " |")
    path = results_dir / "retrieval.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    (results_dir / "retrieval.json").write_text(
        json.dumps({"meta": meta, "recall": {r.mode: retrieval_json(r) for r in runs}}, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return path


def write_run_report(
    results_dir: Path,
    prompt_id: str,
    retrieval: RetrievalRun,
    answers: list[QuestionResult],
    meta: dict[str, Any],
) -> Path:
    name = run_name(prompt_id, retrieval.mode)
    # Errored questions are listed below but kept out of the rates.
    metrics = answer_metrics([a.to_row() for a in answers if not a.error])
    judged = [a for a in answers if a.faithfulness is not None]
    errors = [a for a in answers if a.error]
    evidence = [a.evidence_recall for a in answers if a.evidence_recall is not None]
    lines = [
        f"# {prompt_id} with {retrieval.mode} retrieval",
        "",
        f"Golden set `{meta['golden']}` ({meta['repo']} @ `{meta['commit'][:12]}`), {len(answers)} questions, {meta['when']}.",
        f"Answers by the API's model; faithfulness judged by `{meta['judge']}` (rubric in `evals/src/cda_eval/judge.py`).",
        "",
        "## Summary",
        "",
        "| Metric | Value |",
        "|---|---:|",
    ]
    table = recall_table(retrieval.rows, RECALL_KS)
    for k in RECALL_KS:
        lines.append(f"| recall@{k} (all / identifier / conceptual / multi-file) | "
                     + " / ".join(_pct(table.get(t, {}).get(k)) for t in TYPES_ORDER) + " |")
    lines += [
        f"| Expected files the assistant saw while answering | {_pct(sum(evidence) / len(evidence) if evidence else None)} |",
        f"| Faithfulness, mean (1-5, {len(judged)} judged answers) | {_num(metrics['faithfulness_mean'])} |",
        f"| Faithful answers (score >= {FAITHFUL_THRESHOLD}) | {_pct(metrics['faithful_rate'])} |",
        f"| Correctness vs gist, mean (1-5) | {_num(metrics['correctness_mean'])} |",
        f"| Refusal rate on not-found questions | {_pct(metrics['refusal_rate_not_found'])} |",
        f"| False refusals on answerable questions | {_pct(metrics['false_refusal_rate'])} |",
        f"| Mean model calls per question | {_num(sum(a.iterations for a in answers) / len(answers), 1)} |",
        f"| Cost (answers + judge) | ${_num(metrics['cost_usd_total'], 2)} |",
        f"| Errors | {len(errors)} |",
        "",
        "## Per question",
        "",
        "| Question | Type | Outcome | Faithful | Correct | Evidence recall | Calls | Cost | Unsupported claims |",
        "|---|---|---|---:|---:|---:|---:|---:|---|",
    ]
    for a in answers:
        outcome = f"error: {_cell(a.error)[:80]}" if a.error else a.outcome
        lines.append(
            f"| {a.id} | {a.type} | {outcome} | {a.faithfulness or '-'} | {a.correctness or '-'} | "
            f"{_pct(a.evidence_recall) if a.evidence_recall is not None else '-'} | {a.iterations} | "
            f"${a.cost_usd + a.judge_cost_usd:.3f} | {_cell('; '.join(a.unsupported_claims))[:200]} |"
        )
    path = results_dir / f"{name}.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    (results_dir / f"{name}.json").write_text(
        json.dumps(
            {
                "meta": meta | {"prompt": prompt_id, "mode": retrieval.mode},
                "recall": retrieval_json(retrieval),
                "metrics": metrics | {"evidence_recall": sum(evidence) / len(evidence) if evidence else None},
                "questions": [a.to_json() for a in answers],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return path


def write_summary(results_dir: Path) -> Path:
    """One table comparing every run in results/ (prompt version x retrieval mode)."""
    runs = []
    for path in sorted(results_dir.glob("*__*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        runs.append(data)
    lines = [
        "# Eval summary",
        "",
        "One row per run; details in the file named after it. Generated by `make eval`.",
        "",
        "| Run | recall@5 | recall@10 | recall@5 identifier | Evidence recall | Faithfulness | Faithful | Correctness | Refusal (not-found) | False refusal | Calls/q | Cost |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for data in runs:
        m, r, q = data["metrics"], data["recall"], data["questions"]
        calls = sum(x["iterations"] for x in q) / len(q)
        lines.append(
            f"| [{data['meta']['prompt']} / {data['meta']['mode']}]({run_name(data['meta']['prompt'], data['meta']['mode'])}.md) | "
            f"{_pct(r['all']['5'])} | {_pct(r['all']['10'])} | {_pct(r.get('identifier', {}).get('5'))} | "
            f"{_pct(m['evidence_recall'])} | {_num(m['faithfulness_mean'])} | {_pct(m['faithful_rate'])} | "
            f"{_num(m['correctness_mean'])} | {_pct(m['refusal_rate_not_found'])} | {_pct(m['false_refusal_rate'])} | "
            f"{calls:.1f} | ${m['cost_usd_total']:.2f} |"
        )
    path = results_dir / "summary.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    return path


def now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
