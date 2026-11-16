from __future__ import annotations

import os

import pytest


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--recall-tolerance",
        type=float,
        default=float(os.environ.get("EVAL_RECALL_TOLERANCE", "0.05")),
        help="How far recall@k may fall below evals/baseline.json before the regression test fails "
        "(absolute, e.g. 0.05 = 5 points). Negative values demand an improvement.",
    )
    parser.addoption(
        "--api",
        default=os.environ.get("CDA_API_URL", "http://localhost:3001"),
        help="API base URL for live tests",
    )


@pytest.fixture
def recall_tolerance(request: pytest.FixtureRequest) -> float:
    return float(request.config.getoption("--recall-tolerance"))


@pytest.fixture
def api_url(request: pytest.FixtureRequest) -> str:
    return str(request.config.getoption("--api"))
