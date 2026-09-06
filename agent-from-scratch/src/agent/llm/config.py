"""Configuration for the LLM-facing part of the agent.

No framework is required to load a local .env file. Process environment values
win, so a deploy platform can inject secrets without the checked-in template
changing its behaviour.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Mapping
import os


class ConfigurationError(ValueError):
    """Raised when the agent cannot be configured safely."""


def _read_dotenv(path: Path) -> dict[str, str]:
    """Read a small .env subset: KEY=value, optional `export`, and quotes."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key:
            values[key] = value
    return values


def _as_bool(value: str | None, default: bool) -> bool:
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _as_int(value: str | None, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value) if value is not None else default
    except ValueError as exc:
        raise ConfigurationError(f"Expected an integer, got {value!r}") from exc
    if not minimum <= parsed <= maximum:
        raise ConfigurationError(f"Value must be between {minimum} and {maximum}, got {parsed}")
    return parsed


def _as_float(value: str | None, default: float, minimum: float, maximum: float) -> float:
    try:
        parsed = float(value) if value is not None else default
    except ValueError as exc:
        raise ConfigurationError(f"Expected a number, got {value!r}") from exc
    if not minimum <= parsed <= maximum:
        raise ConfigurationError(f"Value must be between {minimum} and {maximum}, got {parsed}")
    return parsed


@dataclass(frozen=True, slots=True)
class LLMConfig:
    """Validated configuration consumed by the provider client and loop."""

    api_key: str
    model: str = "gpt-4.1-mini"
    base_url: str | None = None
    temperature: float = 0.2
    max_steps: int = 6
    timeout_seconds: int = 45
    allow_search: bool = True

    @classmethod
    def from_env(
        cls,
        env: Mapping[str, str] | None = None,
        dotenv_path: Path | None = None,
    ) -> "LLMConfig":
        root = Path(__file__).resolve().parents[3]
        dotenv_values = _read_dotenv(dotenv_path or root / ".env")
        # Explicit process (or supplied test) values override .env values.
        source = {**dotenv_values, **dict(os.environ if env is None else env)}
        api_key = source.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            raise ConfigurationError("OPENAI_API_KEY is required; add it to .env or the environment")
        base_url = source.get("OPENAI_BASE_URL", "").strip() or None
        return cls(
            api_key=api_key,
            model=source.get("OPENAI_MODEL", "gpt-4.1-mini").strip() or "gpt-4.1-mini",
            base_url=base_url,
            temperature=_as_float(source.get("AGENT_TEMPERATURE"), 0.2, 0, 2),
            max_steps=_as_int(source.get("AGENT_MAX_STEPS"), 6, 1, 20),
            timeout_seconds=_as_int(source.get("AGENT_TIMEOUT_SECONDS"), 45, 1, 300),
            allow_search=_as_bool(source.get("AGENT_ALLOW_SEARCH"), True),
        )
