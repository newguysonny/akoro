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


@dataclass(slots=True)
class AdaptiveServiceRuntime:
    repository: LearningRepository
    model: TeachingModel
    sessions: LiveSessionStore
    internal_policy: InternalServicePolicy

    def start(self, session: AdaptiveSession) -> dict:
        loop = AdaptiveTeachingLoop(self.repository, self.model, session)
        ready = loop.initialize()
        self.sessions.create(loop)
        return ready


def build_adaptive_service_runtime(
    settings: ServiceSettings,
    model: TeachingModel | None = None,
    repository: LearningRepository | None = None,
    sessions: LiveSessionStore | None = None,
) -> AdaptiveServiceRuntime:
    repository = repository or InMemoryLearningRepository()
    model = model or OpenAIAdaptiveModel(OpenAIChatClient(settings.llm))
    return AdaptiveServiceRuntime(
        repository=repository,
        model=model,
        sessions=sessions or LiveSessionStore(settings.session_ttl_seconds),
        internal_policy=InternalServicePolicy(settings.internal_secret, settings.environment),
    )
