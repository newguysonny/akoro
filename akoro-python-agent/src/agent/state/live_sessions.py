"""Concurrency-safe runtime ownership of live adaptive sessions."""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
from threading import Event, RLock
from time import monotonic
from typing import Iterator

from agent.loop.adaptive_teaching_loop import AdaptiveTeachingLoop


class SessionNotFoundError(KeyError):
    """The session expired, ended, or was never created on this instance."""


class StreamAlreadyActiveError(RuntimeError):
    """Only one ordered teaching stream may own a session at a time."""


class StreamNotActiveError(RuntimeError):
    """A stop was requested when the session has no running stream."""


class SessionBusyError(RuntimeError):
    """The requested operation would race an active teaching stream."""


@dataclass(slots=True)
class _Entry:
    loop: AdaptiveTeachingLoop
    last_touched: float
    lock: RLock = field(default_factory=RLock)
    stream_stop: Event = field(default_factory=Event)
    streaming: bool = False


class LiveSessionStore:
    """Owns only live state; durable persistence belongs to LearningRepository."""

    def __init__(self, ttl_seconds: int = 1800) -> None:
        self._ttl = ttl_seconds
        self._entries: dict[str, _Entry] = {}
        self._lock = RLock()

    def create(self, loop: AdaptiveTeachingLoop) -> None:
        session_id = loop.session.session_id
        with self._lock:
            self._reap_locked()
            if session_id in self._entries:
                raise ValueError("sessionId is already active")
            self._entries[session_id] = _Entry(loop, monotonic())

    @contextmanager
    def session(self, session_id: str) -> Iterator[AdaptiveTeachingLoop]:
        with self._lock:
            self._reap_locked()
            entry = self._entries.get(session_id)
            if not entry:
                raise SessionNotFoundError(session_id)
        # A separate lock per session permits unrelated students to learn in
        # parallel while preventing concurrent turns from reordering one
        # learner's transcript or cognitive state.
        with entry.lock:
            entry.last_touched = monotonic()
            yield entry.loop

    def begin_stream(self, session_id: str) -> Event:
        """Reserve ordered session ownership before a StreamingResponse starts."""
        with self._lock:
            self._reap_locked()
            entry = self._entries.get(session_id)
            if not entry:
                raise SessionNotFoundError(session_id)
            if entry.streaming:
                raise StreamAlreadyActiveError(session_id)
            entry.streaming = True
            entry.stream_stop.clear()
            entry.last_touched = monotonic()
            return entry.stream_stop

    def finish_stream(self, session_id: str) -> None:
        with self._lock:
            entry = self._entries.get(session_id)
            if entry:
                entry.streaming = False
                entry.last_touched = monotonic()

    def stop_stream(self, session_id: str) -> None:
        with self._lock:
            self._reap_locked()
            entry = self._entries.get(session_id)
            if not entry:
                raise SessionNotFoundError(session_id)
            if not entry.streaming:
                raise StreamNotActiveError(session_id)
            entry.stream_stop.set()

    def assert_not_streaming(self, session_id: str) -> None:
        with self._lock:
            self._reap_locked()
            entry = self._entries.get(session_id)
            if not entry:
                raise SessionNotFoundError(session_id)
            if entry.streaming:
                raise SessionBusyError(session_id)

    def end(self, session_id: str) -> dict:
        self.assert_not_streaming(session_id)
        with self.session(session_id) as loop:
            result = loop.end_session()
        with self._lock:
            self._entries.pop(session_id, None)
        return result

    def active_count(self) -> int:
        with self._lock:
            self._reap_locked()
            return len(self._entries)

    def _reap_locked(self) -> None:
        cutoff = monotonic() - self._ttl
        # Never evict a live response merely because an upstream LLM or tool
        # call was slower than expected. Cancellation/end will release it.
        for session_id in [
            key for key, entry in self._entries.items()
            if not entry.streaming and entry.last_touched < cutoff
        ]:
            self._entries.pop(session_id, None)
