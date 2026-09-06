"""Thread-safe in-memory live-session store with expiry.

This intentionally owns only live runtime state. Durable profile, knowledge,
and session persistence stays behind LearningRepository so it can later be
served by protected Akoro API endpoints rather than duplicated here.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
from threading import RLock
from time import monotonic
from typing import Callable, Iterator, TypeVar

from agent.adaptive.orchestrator import AdaptiveTeachingOrchestrator

T = TypeVar("T")


class SessionNotFoundError(KeyError):
    pass


@dataclass(slots=True)
class _Entry:
    orchestrator: AdaptiveTeachingOrchestrator
    last_touched: float
    lock: RLock = field(default_factory=RLock)


class SessionStore:
    def __init__(self, ttl_seconds: int = 1800) -> None:
        self._ttl = ttl_seconds
        self._entries: dict[str, _Entry] = {}
        self._lock = RLock()

    def create(self, orchestrator: AdaptiveTeachingOrchestrator) -> None:
        session_id = orchestrator.session.session_id
        with self._lock:
            self._reap_locked()
            if session_id in self._entries:
                raise ValueError("sessionId is already active")
            self._entries[session_id] = _Entry(orchestrator, monotonic())

    @contextmanager
    def session(self, session_id: str) -> Iterator[AdaptiveTeachingOrchestrator]:
        with self._lock:
            self._reap_locked()
            entry = self._entries.get(session_id)
            if not entry:
                raise SessionNotFoundError(session_id)
        with entry.lock:
            entry.last_touched = monotonic()
            yield entry.orchestrator

    def end(self, session_id: str) -> dict:
        with self.session(session_id) as orchestrator:
            result = orchestrator.end_session()
        with self._lock:
            self._entries.pop(session_id, None)
        return result

    def active_count(self) -> int:
        with self._lock:
            self._reap_locked()
            return len(self._entries)

    def _reap_locked(self) -> None:
        cutoff = monotonic() - self._ttl
        expired = [session_id for session_id, entry in self._entries.items() if entry.last_touched < cutoff]
        for session_id in expired:
            self._entries.pop(session_id, None)
