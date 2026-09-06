"""Configuration for the internal Python agent service."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from agent.llm.config import LLMConfig, load_environment


@dataclass(frozen=True, slots=True)
class ServiceSettings:
    llm: LLMConfig
    environment: str
    internal_secret: str | None
    akoro_api_url: str | None
    session_ttl_seconds: int

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "ServiceSettings":
        source = load_environment(env)
        environment = source.get("AGENT_SERVICE_ENVIRONMENT", "development").strip().lower() or "development"
        try:
            ttl = int(source.get("AGENT_SESSION_TTL_SECONDS", "1800"))
        except ValueError as exc:
            raise ValueError("AGENT_SESSION_TTL_SECONDS must be an integer") from exc
        if not 60 <= ttl <= 86_400:
            raise ValueError("AGENT_SESSION_TTL_SECONDS must be between 60 and 86400")
        secret = source.get("AKORO_AGENT_SERVICE_SECRET", "").strip() or None
        if environment == "production" and not secret:
            raise ValueError("AKORO_AGENT_SERVICE_SECRET is required in production")
        api_url = source.get("AKORO_API_URL", "").strip().rstrip("/") or None
        return cls(
            llm=LLMConfig.from_env(source),
            environment=environment,
            internal_secret=secret,
            akoro_api_url=api_url,
            session_ttl_seconds=ttl,
        )
