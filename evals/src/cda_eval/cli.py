"""`cda-eval`: run the golden set against a running API. See evals/README.md."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import anthropic
from dotenv import load_dotenv

from .client import CdaClient
from .golden import load_golden
from .judge import JUDGE_MODEL, Judge
from .metrics import recall_table
from .repo import ensure_repo
from .report import now, write_retrieval_report, write_run_report, write_summary
from .runner import RECALL_KS, RetrievalRun, run_answers, run_retrieval

EVALS_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = EVALS_DIR.parent
PROMPT_NAME = "answer-question"
MODES = ("vector", "hybrid")

#: `make eval`: both retrieval modes on the current prompt, and the previous prompt on hybrid.
MATRIX = (("v4", "hybrid"), ("v4", "vector"), ("v3", "hybrid"))


def _setup(args: argparse.Namespace) -> tuple[CdaClient, object, str, dict]:
    golden = load_golden(args.golden)
    client = CdaClient(args.api)
    client.health()
    print(f"Ensuring {golden.repo.name} @ {golden.repo.commit[:12]} is ingested...", flush=True)
    repo_id = ensure_repo(client, golden.repo, EVALS_DIR / ".cache")
    meta = {
        "golden": args.golden.relative_to(EVALS_DIR).as_posix() if args.golden.is_relative_to(EVALS_DIR) else str(args.golden),
        "repo": golden.repo.name,
        "commit": golden.repo.commit,
        "repoId": repo_id,
        "when": now(),
        "judge": JUDGE_MODEL,
    }
    return client, golden, repo_id, meta


def _retrieval(client: CdaClient, golden, repo_id: str, meta: dict, results: Path) -> dict[str, RetrievalRun]:
    runs = {mode: run_retrieval(client, repo_id, golden, mode) for mode in MODES}
    path = write_retrieval_report(results, list(runs.values()), meta)
    for mode, run in runs.items():
        table = recall_table(run.rows, RECALL_KS)["all"]
        print(f"  {mode:6} " + "  ".join(f"recall@{k}={table[k]:.3f}" for k in RECALL_KS))
    print(f"Wrote {path}")
    return runs


def _answers(client, golden, repo_id, meta, results, retrieval: RetrievalRun, version: str, args) -> None:
    load_dotenv(REPO_ROOT / ".env")  # ANTHROPIC_API_KEY for the judge, from the root .env
    judge = Judge(anthropic.Anthropic())
    prompt_id = f"{PROMPT_NAME}@{version}"
    print(f"Answering {args.limit or len(golden.questions)} questions with {prompt_id} / {retrieval.mode}...", flush=True)

    def progress(result) -> None:
        mark = "!" if result.error else ("f" if result.faithfulness is not None else ".")
        print(mark, end="", flush=True)

    answers = run_answers(
        client, judge, repo_id, golden, version, retrieval.mode, workers=args.workers, limit=args.limit, on_done=progress
    )
    print()
    path = write_run_report(results, prompt_id, retrieval, answers, meta)
    errors = [a for a in answers if a.error]
    for a in errors:
        print(f"  error on {a.id}: {a.error}", file=sys.stderr)
    print(f"Wrote {path}")


def cmd_retrieval(args: argparse.Namespace) -> None:
    client, golden, repo_id, meta = _setup(args)
    _retrieval(client, golden, repo_id, meta, args.results)


def cmd_answers(args: argparse.Namespace) -> None:
    client, golden, repo_id, meta = _setup(args)
    retrieval = run_retrieval(client, repo_id, golden, args.mode)
    _answers(client, golden, repo_id, meta, args.results, retrieval, args.prompt, args)
    print(f"Wrote {write_summary(args.results)}")


def cmd_all(args: argparse.Namespace) -> None:
    client, golden, repo_id, meta = _setup(args)
    runs = _retrieval(client, golden, repo_id, meta, args.results)
    for version, mode in MATRIX:
        _answers(client, golden, repo_id, meta, args.results, runs[mode], version, args)
    print(f"Wrote {write_summary(args.results)}")


def cmd_baseline(args: argparse.Namespace) -> None:
    """Records current recall per mode as the committed baseline the regression test compares to."""
    client, golden, repo_id, meta = _setup(args)
    baseline = {
        "golden": meta["golden"],
        "commit": meta["commit"],
        "recorded": meta["when"],
        "recall": {
            mode: {str(k): round(v, 4) for k, v in recall_table(run_retrieval(client, repo_id, golden, mode).rows, RECALL_KS)["all"].items()}
            for mode in MODES
        },
    }
    args.baseline.write_text(json.dumps(baseline, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Wrote {args.baseline}: {baseline['recall']}")


def cmd_summary(args: argparse.Namespace) -> None:
    print(f"Wrote {write_summary(args.results)}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="cda-eval", description=__doc__)
    parser.add_argument("--api", default=os.environ.get("CDA_API_URL", "http://localhost:3001"), help="API base URL")
    parser.add_argument("--golden", type=Path, default=EVALS_DIR / "golden" / "ky.yaml")
    parser.add_argument("--results", type=Path, default=EVALS_DIR / "results")
    parser.add_argument("--baseline", type=Path, default=EVALS_DIR / "baseline.json")
    parser.add_argument("--workers", type=int, default=4, help="questions answered in parallel")
    parser.add_argument("--limit", type=int, default=None, help="only the first N questions (answers)")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("retrieval", help="recall@k for vector and hybrid retrieval (no model calls)").set_defaults(func=cmd_retrieval)
    answers = sub.add_parser("answers", help="answer and judge every question for one prompt version and mode")
    answers.add_argument("--prompt", required=True, help='prompt version, e.g. "v4"')
    answers.add_argument("--mode", choices=MODES, required=True)
    answers.set_defaults(func=cmd_answers)
    sub.add_parser("all", help="retrieval, then answers for " + ", ".join(f"{v}/{m}" for v, m in MATRIX)).set_defaults(func=cmd_all)
    sub.add_parser("baseline", help="record current recall as evals/baseline.json").set_defaults(func=cmd_baseline)
    sub.add_parser("summary", help="rebuild results/summary.md from the run files").set_defaults(func=cmd_summary)
    args = parser.parse_args(argv)
    args.results.mkdir(parents=True, exist_ok=True)
    args.func(args)


if __name__ == "__main__":
    main()
