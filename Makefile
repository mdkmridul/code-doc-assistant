# Evals (evals/, a uv project). The API must be running (`docker compose --profile app up -d --build`
# or `npm run start:dev -w api`); the golden repository is downloaded and ingested on first use.
# Recipes avoid shell-specific syntax so they work from Git Bash, PowerShell and cmd.

UV ?= uv
EVALS := evals
# How far recall@k may fall below evals/baseline.json (absolute; negative demands an improvement).
TOLERANCE ?= 0.05

.PHONY: eval eval-retrieval eval-baseline eval-test eval-unit

# Recall@k for vector and hybrid retrieval (free), then answers judged for
# v4/hybrid, v4/vector and v3/hybrid. Calls Claude: about $6-12 per run.
eval:
	$(UV) --directory $(EVALS) run cda-eval all

# Recall@k only: no model calls.
eval-retrieval:
	$(UV) --directory $(EVALS) run cda-eval retrieval

# Records current recall as evals/baseline.json (commit it).
eval-baseline:
	$(UV) --directory $(EVALS) run cda-eval baseline

# Offline tests plus the recall regression test against the baseline.
eval-test:
	$(UV) --directory $(EVALS) run pytest -v --recall-tolerance=$(TOLERANCE)

# Offline tests only (no API needed).
eval-unit:
	$(UV) --directory $(EVALS) run pytest -m "not live"
