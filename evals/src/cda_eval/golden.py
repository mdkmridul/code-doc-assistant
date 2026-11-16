"""The golden set: questions about one repository at a pinned commit, with what a good answer needs."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, model_validator

QuestionKind = Literal["answerable", "not_found"]
QuestionType = Literal["identifier", "conceptual", "multi-file", "not-found"]


class GoldenRepo(BaseModel):
    name: str
    url: str
    commit: str = Field(pattern=r"^[0-9a-f]{40}$")

    @property
    def archive_url(self) -> str:
        """GitHub's zip of exactly this commit (codeload serves it without auth for public repos)."""
        owner_repo = self.url.removeprefix("https://github.com/").removesuffix(".git")
        return f"https://codeload.github.com/{owner_repo}/zip/{self.commit}"


class GoldenQuestion(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    kind: QuestionKind
    type: QuestionType
    question: str = Field(min_length=5)
    expected_files: list[str]
    expected_symbols: list[str] = []
    gist: str = Field(min_length=10)

    @model_validator(mode="after")
    def _consistent(self) -> GoldenQuestion:
        if self.kind == "answerable" and not self.expected_files:
            raise ValueError(f"{self.id}: an answerable question needs expected_files")
        if self.kind == "not_found" and (self.expected_files or self.type != "not-found"):
            raise ValueError(f"{self.id}: a not_found question has no expected_files and type not-found")
        if self.kind == "answerable" and self.type == "not-found":
            raise ValueError(f"{self.id}: an answerable question can't have type not-found")
        return self


class GoldenSet(BaseModel):
    repo: GoldenRepo
    questions: list[GoldenQuestion] = Field(min_length=25, max_length=40)

    @model_validator(mode="after")
    def _unique_ids(self) -> GoldenSet:
        ids = [q.id for q in self.questions]
        duplicates = sorted({i for i in ids if ids.count(i) > 1})
        if duplicates:
            raise ValueError(f"duplicate question ids: {', '.join(duplicates)}")
        return self

    @property
    def answerable(self) -> list[GoldenQuestion]:
        return [q for q in self.questions if q.kind == "answerable"]

    @property
    def not_found(self) -> list[GoldenQuestion]:
        return [q for q in self.questions if q.kind == "not_found"]


def load_golden(path: Path) -> GoldenSet:
    with path.open(encoding="utf-8") as f:
        return GoldenSet.model_validate(yaml.safe_load(f))
