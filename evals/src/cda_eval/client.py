"""A small client for the Code Documentation Assistant HTTP API (apps/api)."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Literal

import httpx

RetrievalMode = Literal["vector", "hybrid"]


class ApiError(RuntimeError):
    pass


class CdaClient:
    def __init__(self, base_url: str, timeout: float = 600.0) -> None:
        # Answers can take minutes (agent loop); uploads are up to 50 MB.
        self._http = httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> CdaClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _json(self, response: httpx.Response) -> Any:
        if response.status_code >= 400:
            raise ApiError(f"{response.request.method} {response.request.url.path} -> {response.status_code}: {response.text}")
        return response.json()

    def health(self) -> None:
        """Raises if the API is not reachable (any HTTP answer counts as up)."""
        try:
            self._http.get("/repos/00000000-0000-4000-8000-000000000000")
        except httpx.TransportError as error:
            raise ApiError(f"The API at {self._http.base_url} is not reachable: {error}") from error

    def register_zip(self, archive: Path) -> str:
        with archive.open("rb") as f:
            response = self._http.post("/repos", files={"file": (archive.name, f, "application/zip")})
        return str(self._json(response)["id"])

    def get_repo(self, repo_id: str) -> dict[str, Any]:
        return self._json(self._http.get(f"/repos/{repo_id}"))

    def wait_ready(self, repo_id: str, timeout_s: float = 900.0, poll_s: float = 2.0) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_s
        while True:
            repo = self.get_repo(repo_id)
            if repo["status"] == "ready":
                return repo
            if repo["status"] == "failed":
                raise ApiError(f"Ingest of {repo_id} failed: {repo.get('error')}")
            if time.monotonic() > deadline:
                raise ApiError(f"Ingest of {repo_id} not ready after {timeout_s:.0f}s (status {repo['status']})")
            time.sleep(poll_s)

    def search(self, repo_id: str, query: str, top_k: int, mode: RetrievalMode) -> list[dict[str, Any]]:
        body = {"query": query, "topK": top_k, "mode": mode}
        return list(self._json(self._http.post(f"/repos/{repo_id}/search", json=body))["results"])

    def start_session(self, repo_id: str) -> str:
        return str(self._json(self._http.post("/sessions", json={"repoId": repo_id}))["id"])

    def ask(
        self,
        session_id: str,
        question: str,
        prompt_version: str | None = None,
        retrieval_mode: RetrievalMode | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"content": question}
        if prompt_version is not None:
            body["promptVersion"] = prompt_version
        if retrieval_mode is not None:
            body["retrievalMode"] = retrieval_mode
        return self._json(self._http.post(f"/sessions/{session_id}/messages", json=body))
