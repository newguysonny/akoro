"""Thin internal REST adapter for the Python adaptive-teaching service.

The browser never calls this service. A future Akoro API bridge authenticates
and authorizes the learner, then invokes these endpoints with its internal
credential. Domain construction lives in `harness`, agent coordination in
`loop`, state in `state`, and access decisions in `permissions`.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status

from agent.adaptive.model import TeachingModel
from agent.adaptive.repository import InMemoryLearningRepository, LearningRepository
from agent.adaptive.types import AdaptiveSession, SessionReference
from agent.harness.adaptive_service import AdaptiveServiceRuntime, build_adaptive_service_runtime

from .contracts import StartSessionRequest, TeachingTurnRequest
from .settings import ServiceSettings
from .store import SessionNotFoundError


def create_app(
    settings: ServiceSettings | None = None,
    model: TeachingModel | None = None,
    repository: LearningRepository | None = None,
    runtime: AdaptiveServiceRuntime | None = None,
) -> FastAPI:
    settings = settings or ServiceSettings.from_env()
    runtime = runtime or build_adaptive_service_runtime(settings, model=model, repository=repository)
    app = FastAPI(title="Akoro Adaptive Agent Service", version="0.3.0")
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
            "version": "0.3.0",
            "activeSessions": runtime.sessions.active_count(),
            "persistence": type(runtime.repository).__name__,
            "akoroApiConfigured": bool(settings.akoro_api_url),
            "authConfigured": bool(settings.internal_secret),
        }

    @app.get("/ready")
    def ready() -> dict:
        # Memory persistence is safe for evaluation but intentionally visible
        # here so an operator cannot mistake it for an integrated durable path.
        return {
            "ready": True,
            "mode": "evaluation" if isinstance(runtime.repository, InMemoryLearningRepository) else "integrated",
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
        try:
            return runtime.start(session)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    @app.post("/v1/sessions/{session_id}/turns", dependencies=[Depends(require_internal_caller)])
    def teaching_turn(session_id: str, payload: TeachingTurnRequest) -> dict:
        try:
            with runtime.sessions.session(session_id) as loop:
                return loop.process_teaching_message(payload.message)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active session with that id") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

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

    return app


# Uvicorn entry point. Configuration errors (including a missing production
# shared secret) deliberately fail fast rather than start an open service.
app = create_app()
