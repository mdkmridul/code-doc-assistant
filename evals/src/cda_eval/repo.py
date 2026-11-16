"""Makes sure the golden set's repository, at its pinned commit, is ingested and ready."""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from .client import CdaClient
from .golden import GoldenRepo


def download_archive(repo: GoldenRepo, cache_dir: Path) -> Path:
    """Downloads the pinned commit's zip once; later runs reuse the cached file."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    archive = cache_dir / f"{repo.name}-{repo.commit}.zip"
    if archive.exists() and archive.stat().st_size > 0:
        return archive
    partial = archive.with_suffix(".zip.part")
    with httpx.stream("GET", repo.archive_url, follow_redirects=True, timeout=300.0) as response:
        response.raise_for_status()
        with partial.open("wb") as f:
            for chunk in response.iter_bytes():
                f.write(chunk)
    partial.replace(archive)
    return archive


def ensure_repo(client: CdaClient, repo: GoldenRepo, cache_dir: Path) -> str:
    """
    Uploads the pinned archive (the API deduplicates identical uploads, so this
    is a no-op after the first run) and waits until it is indexed. Returns the repo id.
    """
    archive = download_archive(repo, cache_dir)
    repo_id = client.register_zip(archive)
    client.wait_ready(repo_id)
    (cache_dir / f"{repo.name}-{repo.commit}.json").write_text(
        json.dumps({"repoId": repo_id, "archive": archive.name}, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    return repo_id
