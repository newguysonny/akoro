"""Composition root for an adaptive-agent service runtime."""
from __future__ import annotations

from dataclasses import dataclass

from agent.adaptive.akoro_concept_state import AkoroConceptStateClient, AkoroConceptStateError
from agent.adaptive.akoro_learning_insights import AkoroLearningInsightsClient, AkoroLearningInsightsError
from agent.adaptive.akoro_soul_state import AkoroSoulStateClient, AkoroSoulStateError
from agent.adaptive.akoro_teaching_workflow import AkoroTeachingWorkflowClient, AkoroTeachingWorkflowError
from agent.adaptive.concept_repository import AkoroConceptLearningRepository
from agent.adaptive.model import OpenAIAdaptiveModel, TeachingModel
from agent.adaptive.repository import InMemoryLearningRepository, LearningRepository
from agent.adaptive.types import AdaptiveSession
from agent.llm.client import OpenAIChatClient
from agent.loop.adaptive_teaching_loop import AdaptiveTeachingLoop
from agent.loop.remote_teaching_workflow import RemoteTeachingWorkflowProxy
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
    soul_state_client: AkoroSoulStateClient | None = None
    teaching_workflow_client: AkoroTeachingWorkflowClient | None = None
    tool_max_calls_per_session: int = 4
    write_confirmation_proposals: bool = False
    allow_side_effecting_tools: bool = False
    enable_concept_state: bool = False
    enable_learning_insights: bool = False
    enable_soul_state: bool = False
    prefer_node_teaching_workflow: bool = True

    @property
    def tools_configured(self) -> bool:
        return self.tools_client is not None

    def start(self, session: AdaptiveSession) -> dict:
        """Choose one authority for the complete session, before any turn starts.

        A canonical Node session remains canonical for its full lifetime, and
        (D42/D43) when the Node workflow is configured it is the ONLY teaching
        authority: fresh, continuation and decay all run there, saved to Akoro
        and gated on evidence. A Node outage at start is surfaced as an error —
        never a silent switch to the local loop, which saves nothing to Akoro
        and has its own progression. The local loop remains for the standalone
        evaluation mode (no Node workflow configured).
        """
        if self._node_is_authority() and session.session_type == "continuation" and not session.previous_session_id:
            raise ValueError("A continuation needs previousSessionId (the earlier session's recordId)")
        if self._can_use_node_workflow(session):
            remote = self.teaching_workflow_client.open_session(  # type: ignore[union-attr]
                session_id=session.session_id, tool_context=session.tool_context or "",
            )
            proxy = RemoteTeachingWorkflowProxy(session, remote)
            try:
                ready = proxy.initialize()
                self.sessions.create(proxy)  # type: ignore[arg-type]
                return ready
            except AkoroTeachingWorkflowError:
                # Recoverable or not: the canonical workflow owns teaching, so
                # the caller sees the outage instead of an ungated local lesson.
                raise
        else:
            fallback_reason = "not_eligible" if self.teaching_workflow_client else "not_configured"

        tools = self._open_tools(session)
        conversation_store = self._open_conversation(session)
        repository = self._repository_for_session(session)
        insights_store = self._open_learning_insights(session)
        soul_state_store = self._open_soul_state(session)
        loop = AdaptiveTeachingLoop(
            repository, self.model, session, tools=tools,
            conversation_store=conversation_store, learning_insights_store=insights_store,
            soul_state_store=soul_state_store,
        )
        ready = loop.initialize()
        ready["workflowAuthority"] = "python_local"
        # This is deliberately coarse operational metadata: it does not reveal
        # transport failures, secrets, model output, or learner content.
        if self.prefer_node_teaching_workflow and self.teaching_workflow_client:
            ready["workflowFallback"] = fallback_reason
        self.sessions.create(loop)
        return ready

    def _node_is_authority(self) -> bool:
        return bool(self.prefer_node_teaching_workflow and self.teaching_workflow_client)

    def _can_use_node_workflow(self, session: AdaptiveSession) -> bool:
        # The Node workflow owns its own conversation/evidence lifecycle. Keep
        # Python-only durable context and canonical-concept deployments local
        # until their state contracts are deliberately unified.
        return bool(
            self.prefer_node_teaching_workflow
            and self.teaching_workflow_client
            and session.tool_context
            # All three modes: Akoro loads a continuation's earlier session
            # and a review's decay context itself (D43).
            and session.session_type in ("free_teaching", "continuation", "decay_review")
            and not session.conversation_id
            and not self.enable_concept_state
            and not self.enable_learning_insights
            and not self.enable_soul_state
        )

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

    def _open_soul_state(self, session: AdaptiveSession):
        if not self.enable_soul_state:
            return None
        if not self.soul_state_client or not session.tool_context:
            raise AkoroSoulStateError("Akoro soul state is not configured for this session")
        return self.soul_state_client.open_session(session_id=session.session_id, tool_context=session.tool_context)

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
    soul_state_client: AkoroSoulStateClient | None = None,
    teaching_workflow_client: AkoroTeachingWorkflowClient | None = None,
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
    if soul_state_client is None and settings.enable_soul_state:
        soul_state_client = AkoroSoulStateClient(
            settings.akoro_tools_api_url or "",
            settings.akoro_tools_api_secret or "",
            settings.tool_timeout_seconds,
        )
    if teaching_workflow_client is None and settings.tools_configured and settings.prefer_node_teaching_workflow:
        teaching_workflow_client = AkoroTeachingWorkflowClient(
            settings.akoro_tools_api_url or "",
            settings.akoro_tools_api_secret or "",
            settings.teaching_workflow_timeout_seconds,
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
        soul_state_client=soul_state_client,
        teaching_workflow_client=teaching_workflow_client,
        tool_max_calls_per_session=settings.tool_max_calls_per_session,
        write_confirmation_proposals=settings.write_confirmation_proposals,
        allow_side_effecting_tools=settings.allow_side_effecting_tools,
        enable_concept_state=settings.enable_concept_state,
        enable_learning_insights=settings.enable_learning_insights,
        enable_soul_state=settings.enable_soul_state,
        prefer_node_teaching_workflow=settings.prefer_node_teaching_workflow,
    )
