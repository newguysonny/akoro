"""Composition root for an adaptive-agent service runtime."""
from __future__ import annotations

from dataclasses import dataclass

from agent.adaptive.akoro_concept_state import AkoroConceptStateClient, AkoroConceptStateError
from agent.adaptive.akoro_learning_insights import AkoroLearningInsightsClient, AkoroLearningInsightsError
from agent.adaptive.concept_repository import AkoroConceptLearningRepository
from agent.adaptive.model import OpenAIAdaptiveModel, TeachingModel
from agent.adaptive.repository import InMemoryLearningRepository, LearningRepository
from agent.adaptive.types import AdaptiveSession
from agent.llm.client import OpenAIChatClient
from agent.loop.adaptive_teaching_loop import AdaptiveTeachingLoop
from agent.memory.akoro_conversation import AkoroConversationClient, AkoroConversationError, AkoroConversationSession
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
    conversation_client: AkoroConversationClient | None = None
    concept_state_client: AkoroConceptStateClient | None = None
    learning_insights_client: AkoroLearningInsightsClient | None = None
    tool_max_calls_per_session: int = 4
    write_confirmation_proposals: bool = False
    allow_side_effecting_tools: bool = False
    enable_concept_state: bool = False
    enable_learning_insights: bool = False

    @property
    def tools_configured(self) -> bool:
        return self.tools_client is not None

    def start(self, session: AdaptiveSession) -> dict:
        tools = self._open_tools(session)
        conversation_store = self._open_conversation(session)
        repository = self._repository_for_session(session)
        insights_store = self._open_learning_insights(session)
        loop = AdaptiveTeachingLoop(
            repository, self.model, session, tools=tools,
            conversation_store=conversation_store, learning_insights_store=insights_store,
        )
        ready = loop.initialize()
        self.sessions.create(loop)
        return ready

    def _repository_for_session(self, session: AdaptiveSession) -> LearningRepository:
        if not self.enable_concept_state:
            return self.repository
        if not self.concept_state_client or not session.tool_context:
            raise AkoroConceptStateError("Akoro concept state is not configured for this session")
        concept_session = self.concept_state_client.open_session(
            session_id=session.session_id,
            tool_context=session.tool_context,
            curriculum_key=session.curriculum_key,
            subject=session.subject,
            topic_key=session.topic_key,
        )
        return AkoroConceptLearningRepository(self.repository, concept_session)

    def _open_learning_insights(self, session: AdaptiveSession):
        if not self.enable_learning_insights:
            return None
        if not self.learning_insights_client or not session.tool_context:
            raise AkoroLearningInsightsError("Akoro learning insights are not configured for this session")
        return self.learning_insights_client.open_session(
            session_id=session.session_id, tool_context=session.tool_context,
        )

    def _open_conversation(self, session: AdaptiveSession) -> AkoroConversationSession | None:
        if not session.conversation_id:
            return None
        if not self.conversation_client or not session.tool_context:
            raise AkoroConversationError("Durable conversation context is not configured for this service")
        conversation = self.conversation_client.open_session(
            session_id=session.session_id,
            tool_context=session.tool_context,
            conversation_id=session.conversation_id,
        )
        session.conversation = conversation.context
        return conversation

    def _open_tools(self, session: AdaptiveSession) -> AkoroToolSession | None:
        if not self.tools_client or not session.tool_context:
            return None
        try:
            return self.tools_client.open_session(
                session.session_id,
                session.tool_context,
                max_calls=self.tool_max_calls_per_session,
                allow_side_effects=self.allow_side_effecting_tools,
                request_write_confirmations=self.write_confirmation_proposals,
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
    conversation_client: AkoroConversationClient | None = None,
    concept_state_client: AkoroConceptStateClient | None = None,
    learning_insights_client: AkoroLearningInsightsClient | None = None,
) -> AdaptiveServiceRuntime:
    repository = repository or InMemoryLearningRepository()
    model = model or OpenAIAdaptiveModel(OpenAIChatClient(settings.llm))
    if tools_client is None and settings.tools_configured:
        tools_client = AkoroToolsClient(
            settings.akoro_tools_api_url or "",
            settings.akoro_tools_api_secret or "",
            settings.tool_timeout_seconds,
        )
    if conversation_client is None and settings.tools_configured:
        # Conversation context uses the same private, capability-bound Akoro
        # gateway as account tools, but lives in a separate client/module.
        conversation_client = AkoroConversationClient(
            settings.akoro_tools_api_url or "",
            settings.akoro_tools_api_secret or "",
            settings.tool_timeout_seconds,
        )
    if concept_state_client is None and settings.enable_concept_state:
        concept_state_client = AkoroConceptStateClient(
            settings.akoro_tools_api_url or "",
            settings.akoro_tools_api_secret or "",
            settings.tool_timeout_seconds,
        )
    if learning_insights_client is None and settings.enable_learning_insights:
        learning_insights_client = AkoroLearningInsightsClient(
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
        conversation_client=conversation_client,
        concept_state_client=concept_state_client,
        learning_insights_client=learning_insights_client,
        tool_max_calls_per_session=settings.tool_max_calls_per_session,
        write_confirmation_proposals=settings.write_confirmation_proposals,
        allow_side_effecting_tools=settings.allow_side_effecting_tools,
        enable_concept_state=settings.enable_concept_state,
        enable_learning_insights=settings.enable_learning_insights,
    )
