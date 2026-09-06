"""Composition root for an adaptive-agent service runtime."""
from __future__ import annotations

from dataclasses import dataclass

from agent.adaptive.model import OpenAIAdaptiveModel, TeachingModel
from agent.adaptive.repository import InMemoryLearningRepository, LearningRepository
from agent.adaptive.types import AdaptiveSession
from agent.llm.client import OpenAIChatClient
from agent.loop.adaptive_teaching_loop import AdaptiveTeachingLoop
from agent.permissions.internal import InternalServicePolicy
from agent.service.settings import ServiceSettings
from agent.state.live_sessions import LiveSessionStore
from agent.tools.akoro_api import AkoroToolsClient, AkoroToolsError, AkoroToolSession


@dataclass(slots=True)
class AdaptiveServiceRuntime:
    repository: LearningRepository
    model: TeachingModel
    sessions: LiveSessionStore
    internal_policy: InternalServicePolicy
    tools_client: AkoroToolsClient | None = None
    tool_max_calls_per_session: int = 4
    allow_side_effecting_tools: bool = False

    @property
    def tools_configured(self) -> bool:
        return self.tools_client is not None

    def start(self, session: AdaptiveSession) -> dict:
        tools = self._open_tools(session)
        loop = AdaptiveTeachingLoop(self.repository, self.model, session, tools=tools)
        ready = loop.initialize()
        self.sessions.create(loop)
        return ready

    def _open_tools(self, session: AdaptiveSession) -> AkoroToolSession | None:
        if not self.tools_client or not session.tool_context:
            return None
        try:
            return self.tools_client.open_session(
                session.session_id,
                session.tool_context,
                max_calls=self.tool_max_calls_per_session,
                allow_side_effects=self.allow_side_effecting_tools,
            )
        except AkoroToolsError:
            # Tooling is an optional enhancement, never a reason to drop an
            # otherwise valid teaching session. The model sees no functions,
            # so it cannot claim a lookup that did not happen.
            return AkoroToolSession.disabled("Akoro tools API is unavailable")


def build_adaptive_service_runtime(
    settings: ServiceSettings,
    model: TeachingModel | None = None,
    repository: LearningRepository | None = None,
    sessions: LiveSessionStore | None = None,
    tools_client: AkoroToolsClient | None = None,
) -> AdaptiveServiceRuntime:
    repository = repository or InMemoryLearningRepository()
    model = model or OpenAIAdaptiveModel(OpenAIChatClient(settings.llm))
    if tools_client is None and settings.tools_configured:
        tools_client = AkoroToolsClient(
            settings.akoro_tools_api_url or "",
            settings.akoro_tools_api_secret or "",
            settings.tool_timeout_seconds,
        )
    return AdaptiveServiceRuntime(
        repository=repository,
        model=model,
        sessions=sessions or LiveSessionStore(settings.session_ttl_seconds),
        internal_policy=InternalServicePolicy(settings.internal_secret, settings.environment),
        tools_client=tools_client,
        tool_max_calls_per_session=settings.tool_max_calls_per_session,
        allow_side_effecting_tools=settings.allow_side_effecting_tools,
    )
