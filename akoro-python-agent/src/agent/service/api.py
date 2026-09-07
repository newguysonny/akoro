"""Thin internal REST adapter for the Python adaptive-teaching service.

The browser never calls this service. A future Akoro API bridge authenticates
and authorizes the learner, then invokes these endpoints with its internal
credential. Domain construction lives in `harness`, agent coordination in
`loop`, state in `state`, and access decisions in `permissions`.
"""
from __future__ import annotations

from collections.abc import Iterator
import logging
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.responses import StreamingResponse

from agent.adaptive.akoro_concept_state import AkoroConceptStateError
from agent.adaptive.model import TeachingModel
from agent.adaptive.repository import InMemoryLearningRepository, LearningRepository
from agent.adaptive.types import AdaptiveSession, SessionReference
from agent.harness.adaptive_service import AdaptiveServiceRuntime, build_adaptive_service_runtime
from agent.memory.akoro_conversation import AkoroConversationError

from .contracts import ConfirmedActionRequest, StartSessionRequest, TeachingTurnRequest
from .settings import ServiceSettings
from .store import SessionBusyError, SessionNotFoundError, StreamAlreadyActiveError, StreamNotActiveError
from .streaming import sse_event

log = logging.getLogger(__name__)


def create_app(
    settings: ServiceSettings | None = None,
    model: TeachingModel | None = None,
    repository: LearningRepository | None = None,
    runtime: AdaptiveServiceRuntime | None = None,
) -> FastAPI:
    settings = settings or ServiceSettings.from_env()
    runtime = runtime or build_adaptive_service_runtime(settings, model=model, repository=repository)
    app = FastAPI(title="Akoro Adaptive Agent Service", version="0.5.0")
    app.state.settings = settings
    app.state.runtime = runtime

    def require_internal_caller(
        x_akoro_agent_secret: Annotated[str | None, Header()] = None,
    ) -> None:
        allowed, code, detail = runtime.internal_policy.authorize(x_akoro_agent_secret)
        if not allowed:
            raise HTTPException(status_code=code, detail=detail)

    @app.get("/health")
    def health() -> dict:
        return {
            "ok": True,
            "service": "adaptive-agent",
            "version": "0.5.0",
            "activeSessions": runtime.sessions.active_count(),
            "persistence": type(runtime.repository).__name__,
            "akoroApiConfigured": bool(settings.akoro_api_url),
            "authConfigured": bool(settings.internal_secret),
            "conversationContext": {
                "configured": runtime.conversation_client is not None,
                "provider": "akoro-api" if runtime.conversation_client else None,
                "durableOwner": "akoro-api",
            },
            "conceptState": {
                "enabled": runtime.enable_concept_state,
                "durableOwner": "akoro-api" if runtime.enable_concept_state else None,
            },
            "tools": {
                "configured": runtime.tools_configured,
                "provider": "akoro-api" if runtime.tools_configured else None,
                "writeConfirmationProposalsEnabled": runtime.write_confirmation_proposals,
                "sideEffectingToolsEnabled": runtime.allow_side_effecting_tools,
            },
        }

    @app.get("/ready")
    def ready() -> dict:
        # Memory persistence is safe for evaluation but intentionally visible
        # here so an operator cannot mistake it for an integrated durable path.
        return {
            "ready": True,
            "mode": "evaluation" if isinstance(runtime.repository, InMemoryLearningRepository) else "integrated",
            "akoroApiConfigured": bool(settings.akoro_api_url),
            "toolsConfigured": runtime.tools_configured,
        }

    @app.post("/v1/sessions", dependencies=[Depends(require_internal_caller)])
    def start_session(payload: StartSessionRequest) -> dict:
        if runtime.enable_concept_state and not (payload.tool_context and payload.curriculum_key and payload.subject and payload.topic_key):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Concept state requires toolContext, curriculumKey, subject, and topicKey",
            )
        session_type = "decay_review" if payload.mode == "decay" else "continuation" if payload.mode == "continuation" else "free_teaching"
        session = AdaptiveSession(
            session_id=payload.session_id or AdaptiveSession().session_id,
            student_id=payload.student_id,
            topic=payload.topic.strip(),
            subject=payload.subject.strip() if payload.subject else None,
            teacher_agent_id=payload.teacher_agent_id,
            curriculum_key=payload.curriculum_key,
            topic_key=payload.topic_key,
            tool_context=payload.tool_context,
            conversation_id=payload.conversation_id,
            session_type=session_type,
            reference=SessionReference.from_payload(payload.reference.model_dump() if payload.reference else None),
        )
        try:
            return runtime.start(session)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
        except (AkoroConversationError, AkoroConceptStateError) as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    @app.post("/v1/sessions/{session_id}/turns", dependencies=[Depends(require_internal_caller)])
    def teaching_turn(session_id: str, payload: TeachingTurnRequest) -> dict:
        try:
            runtime.sessions.assert_not_streaming(session_id)
            with runtime.sessions.session(session_id) as loop:
                if (loop.session.conversation or loop.concept_state_active) and not payload.turn_id:
                    raise ValueError("turnId is required when durable conversation context or concept state is attached")
                return loop.process_teaching_message(payload.message, turn_id=payload.turn_id)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active session with that id") from exc
        except SessionBusyError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A teaching stream is active for this session") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
        except AkoroConceptStateError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    @app.post("/v1/sessions/{session_id}/confirmed-actions", dependencies=[Depends(require_internal_caller)])
    def execute_confirmed_action(session_id: str, payload: ConfirmedActionRequest) -> dict:
        """Redeem one learner-reviewed action; never ask the model to repeat it."""
        try:
            runtime.sessions.assert_not_streaming(session_id)
            with runtime.sessions.session(session_id) as loop:
                return {"execution": loop.execute_confirmed_action(payload.confirmation_token)}
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active session with that id") from exc
        except SessionBusyError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A teaching stream is active for this session") from exc

    @app.post("/v1/sessions/{session_id}/turns/stream", dependencies=[Depends(require_internal_caller)])
    def streaming_teaching_turn(session_id: str, payload: TeachingTurnRequest) -> StreamingResponse:
        """SSE form of a teaching turn: tokens followed by one final payload."""
        try:
            stop_signal = runtime.sessions.begin_stream(session_id)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active session with that id") from exc
        except StreamAlreadyActiveError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A teaching stream is already active for this session") from exc

        def events() -> Iterator[str]:
            try:
                yield sse_event("stream_started", {"sessionId": session_id})
                with runtime.sessions.session(session_id) as loop:
                    if (loop.session.conversation or loop.concept_state_active) and not payload.turn_id:
                        raise ValueError("turnId is required when durable conversation context or concept state is attached")
                    for item in loop.stream_teaching_message(
                        payload.message, should_stop=stop_signal.is_set, turn_id=payload.turn_id,
                    ):
                        yield sse_event(item["event"], item["data"])
            except GeneratorExit:
                # The client disconnected. The loop has not finalised a partial
                # response, so the learner can retry the turn safely.
                raise
            except ValueError as exc:
                yield sse_event("error", {"code": "invalid_turn", "message": str(exc)})
            except Exception:
                log.exception("Adaptive teaching stream failed", extra={"session_id": session_id})
                yield sse_event("error", {"code": "stream_failed", "message": "Teaching stream could not be completed"})
            finally:
                runtime.sessions.finish_stream(session_id)

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "X-Content-Type-Options": "nosniff",
                "Connection": "keep-alive",
            },
        )

    @app.post("/v1/sessions/{session_id}/turns/stream/stop", dependencies=[Depends(require_internal_caller)])
    def stop_streaming_teaching_turn(session_id: str) -> dict:
        try:
            runtime.sessions.stop_stream(session_id)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active session with that id") from exc
        except StreamNotActiveError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No teaching stream is active for this session") from exc
        return {"sessionId": session_id, "stopping": True}

    @app.get("/v1/sessions/{session_id}/summary", dependencies=[Depends(require_internal_caller)])
    def summary(session_id: str) -> dict:
        try:
            with runtime.sessions.session(session_id) as loop:
                return {"summary": loop.generate_summary()}
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active session with that id") from exc

    @app.post("/v1/sessions/{session_id}/end", dependencies=[Depends(require_internal_caller)])
    def end_session(session_id: str) -> dict:
        try:
            return {"summary": runtime.sessions.end(session_id)}
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active session with that id") from exc
        except SessionBusyError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Stop the active teaching stream before ending this session") from exc

    return app


# Uvicorn entry point. Configuration errors (including a missing production
# shared secret) deliberately fail fast rather than start an open service.
app = create_app()
