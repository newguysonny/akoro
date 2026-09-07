"""Configuration for the internal Python agent service."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping
from urllib.parse import urlparse

from agent.llm.config import LLMConfig, load_environment


def _as_bool(value: str | None, *, name: str) -> bool:
    normalised = (value or "").strip().lower()
    if normalised in {"1", "true", "yes", "on"}:
        return True
    if normalised in {"", "0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be true or false")


@dataclass(frozen=True, slots=True)
class ServiceSettings:
    llm: LLMConfig
    environment: str
    internal_secret: str | None
    akoro_api_url: str | None
    session_ttl_seconds: int
    # A separate credential is deliberate: inbound Akoro API → Python-service
    # access and outbound Python-service → Akoro tools access are different
    # trust directions and should be independently rotatable.
    akoro_tools_api_url: str | None = None
    akoro_tools_api_secret: str | None = None
    tool_timeout_seconds: float = 12
    tool_max_calls_per_session: int = 4
    # Enables staging review cards from model-proposed learner writes. Staging
    # never executes the action; redemption needs a learner confirmation too.
    write_confirmation_proposals: bool = False
    # Master deployment gate for redeeming an already learner-confirmed write.
    allow_side_effecting_tools: bool = False
    # Feature gate for the Akoro-owned canonical concept/evidence vertical
    # slice. It is intentionally off until reviewed curriculum rows and the
    # trusted Node bridge are deployed.
    enable_concept_state: bool = False
    # Opt-in durable, bounded turn measurements and learner-clearable study
    # profile/episodes. This remains off until the corresponding Akoro migration
    # and authenticated learner controls are deployed.
    enable_learning_insights: bool = False
    # Learner-selected interaction preferences / short-lived check-ins. It is
    # intentionally separate from measured cognition and off by default.
    enable_soul_state: bool = False

    @property
    def tools_configured(self) -> bool:
        return bool(self.akoro_tools_api_url and self.akoro_tools_api_secret)

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

        tools_url = source.get("AKORO_AGENT_TOOLS_URL", "").strip().rstrip("/") or None
        tools_secret = source.get("AKORO_AGENT_TOOLS_SECRET", "").strip() or None
        if bool(tools_url) != bool(tools_secret):
            raise ValueError("AKORO_AGENT_TOOLS_URL and AKORO_AGENT_TOOLS_SECRET must be configured together")
        enable_concept_state = _as_bool(source.get("AGENT_ENABLE_CONCEPT_STATE"), name="AGENT_ENABLE_CONCEPT_STATE")
        enable_learning_insights = _as_bool(source.get("AGENT_ENABLE_LEARNING_INSIGHTS"), name="AGENT_ENABLE_LEARNING_INSIGHTS")
        enable_soul_state = _as_bool(source.get("AGENT_ENABLE_SOUL_STATE"), name="AGENT_ENABLE_SOUL_STATE")
        if enable_concept_state and not (tools_url and tools_secret):
            raise ValueError("AGENT_ENABLE_CONCEPT_STATE requires the configured Akoro private gateway")
        if enable_learning_insights and not (tools_url and tools_secret):
            raise ValueError("AGENT_ENABLE_LEARNING_INSIGHTS requires the configured Akoro private gateway")
        if enable_soul_state and not (tools_url and tools_secret):
            raise ValueError("AGENT_ENABLE_SOUL_STATE requires the configured Akoro private gateway")
        if tools_url:
            parsed = urlparse(tools_url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError("AKORO_AGENT_TOOLS_URL must be an absolute HTTP(S) URL")
            if environment == "production" and parsed.scheme != "https":
                raise ValueError("AKORO_AGENT_TOOLS_URL must use HTTPS in production")
        try:
            tool_timeout = float(source.get("AGENT_TOOL_TIMEOUT_SECONDS", "12"))
        except ValueError as exc:
            raise ValueError("AGENT_TOOL_TIMEOUT_SECONDS must be a number") from exc
        if not 1 <= tool_timeout <= 60:
            raise ValueError("AGENT_TOOL_TIMEOUT_SECONDS must be between 1 and 60")
        try:
            tool_max_calls = int(source.get("AGENT_TOOL_MAX_CALLS_PER_SESSION", "4"))
        except ValueError as exc:
            raise ValueError("AGENT_TOOL_MAX_CALLS_PER_SESSION must be an integer") from exc
        if not 1 <= tool_max_calls <= 12:
            raise ValueError("AGENT_TOOL_MAX_CALLS_PER_SESSION must be between 1 and 12")

        return cls(
            llm=LLMConfig.from_env(source),
            environment=environment,
            internal_secret=secret,
            akoro_api_url=api_url,
            session_ttl_seconds=ttl,
            akoro_tools_api_url=tools_url,
            akoro_tools_api_secret=tools_secret,
            tool_timeout_seconds=tool_timeout,
            tool_max_calls_per_session=tool_max_calls,
            write_confirmation_proposals=_as_bool(
                source.get("AGENT_ENABLE_WRITE_CONFIRMATION_PROPOSALS"),
                name="AGENT_ENABLE_WRITE_CONFIRMATION_PROPOSALS",
            ),
            allow_side_effecting_tools=_as_bool(source.get("AGENT_ALLOW_SIDE_EFFECTING_TOOLS"), name="AGENT_ALLOW_SIDE_EFFECTING_TOOLS"),
            enable_concept_state=enable_concept_state,
            enable_learning_insights=enable_learning_insights,
            enable_soul_state=enable_soul_state,
        )
