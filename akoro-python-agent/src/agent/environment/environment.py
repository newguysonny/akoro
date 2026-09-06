"""The agent's local environment boundary: one writable workspace only."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Environment:
    workspace: Path

    def __post_init__(self) -> None:
        root = self.workspace.resolve()
        root.mkdir(parents=True, exist_ok=True)
        object.__setattr__(self, "workspace", root)

    def resolve(self, relative_path: str) -> Path:
        candidate = (self.workspace / relative_path).resolve()
        if candidate != self.workspace and self.workspace not in candidate.parents:
            raise PermissionError("Path escapes the agent workspace")
        return candidate

    def read_text(self, relative_path: str) -> str:
        return self.resolve(relative_path).read_text(encoding="utf-8")

    def write_text(self, relative_path: str, content: str) -> Path:
        path = self.resolve(relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path
