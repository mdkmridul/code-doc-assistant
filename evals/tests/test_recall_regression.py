"""
Fails when retrieval recall drops beyond the tolerance below the committed
baseline (evals/baseline.json). Live: needs the API running; it ingests the
pinned golden repository if needed. No model calls, so it is free to run.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from cda_eval.client import CdaClient
from cda_eval.golden import load_golden
from cda_eval.metrics import recall_table
from cda_eval.repo import ensure_repo
from cda_eval.runner import RECALL_KS, run_retrieval

EVALS_DIR = Path(__file__).resolve().parents[1]
BASELINE_FILE = EVALS_DIR / "baseline.json"
MODES = ("hybrid", "vector")


@pytest.fixture(scope="module")
def baseline() -> dict:
    if not BASELINE_FILE.exists():
        pytest.fail(f"{BASELINE_FILE} is missing: record it with `make eval-baseline`")
    return json.loads(BASELINE_FILE.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def live(request: pytest.FixtureRequest, baseline: dict):
    golden = load_golden(EVALS_DIR / baseline["golden"])
    client = CdaClient(str(request.config.getoption("--api")))
    client.health()
    repo_id = ensure_repo(client, golden.repo, EVALS_DIR / ".cache")
    yield client, golden, repo_id
    client.close()


@pytest.mark.live
@pytest.mark.parametrize("mode", MODES)
def test_recall_does_not_regress(live, baseline: dict, mode: str, recall_tolerance: float) -> None:
    client, golden, repo_id = live
    assert golden.repo.commit == baseline["commit"], "the baseline was recorded for another commit; re-record it"

    current = recall_table(run_retrieval(client, repo_id, golden, mode).rows, RECALL_KS)["all"]
    failures = []
    for k in RECALL_KS:
        recorded = baseline["recall"][mode][str(k)]
        floor = recorded - recall_tolerance
        print(f"{mode} recall@{k}: {current[k]:.3f} (baseline {recorded:.3f}, floor {floor:.3f})")
        if current[k] < floor - 1e-9:
            failures.append(f"recall@{k} is {current[k]:.3f}, floor {floor:.3f}")
    assert not failures, (
        f"{mode} retrieval regressed beyond the tolerance {recall_tolerance:+.3f} "
        f"against evals/baseline.json: " + "; ".join(failures)
    )
