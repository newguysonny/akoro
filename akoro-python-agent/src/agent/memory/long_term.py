"""Small JSON-backed long-term memory, deliberately confined to workspace."""
from __future__ import annotations

from pathlib import Path
from typing import Any
import json
import os
import tempfile


class LongTermMemory:
    def __init__(self, workspace: Path, filename: str = "long_term_memory.json") -> None:
        self._workspace = workspace.resolve()
        self._workspace.mkdir(parents=True, exist_ok=True)
        self._path = (self._workspace / filename).resolve()
        if self._workspace not in self._path.parents:
            raise ValueError("Long-term memory must live inside workspace")

    def _load(self) -> dict[str, Any]:
        if not self._path.exists():
            return {}
        try:
            value = json.loads(self._path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    def _save(self, data: dict[str, Any]) -> None:
        # JSON encoding before writing makes unsupported values fail without
        # touching the previous file. os.replace gives readers all-or-nothing.
        encoded = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True)
        fd, temp_name = tempfile.mkstemp(prefix=".agent-memory-", suffix=".tmp", dir=self._workspace)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, self._path)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)

    def remember(self, key: str, value: Any) -> None:
        key = key.strip()
        if not key or len(key) > 120:
            raise ValueError("Memory key must contain 1–120 characters")
        data = self._load()
        data[key] = value
        self._save(data)

    def recall(self, key: str, default: Any = None) -> Any:
        return self._load().get(key, default)

    def all(self) -> dict[str, Any]:
        return self._load()
