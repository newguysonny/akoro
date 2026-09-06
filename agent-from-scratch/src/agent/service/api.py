"""Internal REST facade for the Python adaptive-teaching service.

This service is designed for server-to-server use only. The browser continues
to talk to akoro-api; a later Node bridge can translate its Socket.IO lifecycle
to these HTTP calls using PYTHON_AGENT_SERVICE_URL and the shared secret.
"""
from __future__ import annotations

from secrets import compare_digest
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status

from agent.adaptive.model import OpenAIAdaptiveModel, TeachingModel
from agent.adaptive.orchestrator import AdaptiveTeachingOrchestrator
from agent.adaptive.repository import InMemoryLearningRepository, LearningRepository
from agent.adaptive.types import AdaptiveSession, SessionReference
from agent.llm.client import OpenAIChatClient

from .contracts import StartSessionRequest, TeachingTurnRequest
from .settings import ServiceSettings
from .store import SessionNotFoundError, SessionStore


def create_app(
    settings: ServiceSettings | None = None,
    model: TeachingModel | None = None,
    repository: LearningRepository | None = None,
) -> FastAPI:
    settings = settings or ServiceSettings.from_env()
    model = model or OpenAIAdaptiveModel(OpenAIChatClient(settings.llm))
    repository = repository or InMemoryLearningRepository()
    store = SessionStore(settings.session_ttl_seconds)
    app = FastAPI(title="Akoro Adaptive Agent Service", version="0.2.0")
    app.state.settings = settings
    app.state.store = store
    app.state.repository = repository

    def require_internal_caller(
        x_akoro_agent_secret: Annotated[str | None, Header()] = None,
    ) -> None:
        # Development may run without a secret for local evaluation only. A
        # deployed production service refuses all mutating calls without one.
        if not settings.internal_secret:
            if settings.environment == "production":
                raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Service authentication is not configured")
            return
        if not x_akoro_agent_secret or not compare_digest(x_akoro_agent_secret, settings.internal_secret):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal service credential")

    @app.get("/health")
    def health() -> dict:
        return {
            "ok": True,
            "service": "adaptive-agent",
            "version": "0.2.0",
            "activeSessions": store.active_count(),
            "persistence": type(repository).__name__,
            "akoroApiConfigured": bool(settings.akoro_api_url),
            "authConfigured": bool(settings.internal_secret),
        }

    @app.get("/ready")
    def ready() -> dict:
        # MemoryRepository is healthy for evaluation but is intentionally visible
        # here so a production rollout cannot mistake it for durable storage.
        return {
            "ready": True,
            "mode": "evaluation" if isinstance(repository, InMemoryLearningRepository) else "integrated",
            "akoroApiConfigured": bool(settings.akoro_api_url),
        }

    @app.post("/v1/sessions", dependencies=[Depends(require_internal_caller)])
    def start_session(payload: StartSessionRequest) -> dict:
        session_type = "decay_review" if payload.mode == "decay" else "continuation" if payload.mode == "continuation" else "free_teaching"
        session = AdaptiveSession(
            session_id=payload.session_id or AdaptiveSession().session_id,
            student_id=payload.student_id,
            topic=payload.topic.strip(),
            subject=payload.subject.strip() if payload.subject else None,
            teacher_agent_id=payload.teacher_agent_id,
            session_type=session_type,
            reference=SessionReference.from_payload(payload.reference.model_dump() if payload.reference else None),
        )
        orchestrator = AdaptiveTeachingOrchestrator(repository, model, session)
        try:
            ready_payload = orchestrator.initialize()
            store.create(orchestrator)
            return ready_payload
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    @app.post("/v1/sessions/{session_id}/turns", dependencies=[Depends(require_internal_caller)])
    def teaching_turn(session_id: str, payload: TeachingTurnRequest) -> dict:
        try:
            with store.session(session_id) as orchestrator:
                return orchestrator.process_teaching_message(payload.message)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active session with that id") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    @app.get("/v1/sessions/{session_id}/summary", dependencies=[Depends(require_internal_caller)])
    def summary(session_id: str) -> dict:
        try:
            with store.session(session_id) as orchestrator:
                return {"summary": orchestrator.generate_summary()}
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active session with that id") from exc

    @app.post("/v1/sessions/{session_id}/end", dependencies=[Depends(require_internal_caller)])
    def end_session(session_id: str) -> dict:
        try:
            return {"summary": store.end(session_id)}
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active session with that id") from exc

    return app


# Uvicorn entry point. Config errors (including a missing production secret) are
# intentionally fail-fast rather than leaving an unauthenticated service alive.
app = create_app()
