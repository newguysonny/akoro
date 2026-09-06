"""Compatibility aliases for live-session state.

Live session ownership is state management, so implementation now lives in
`agent.state.live_sessions`. Keep this module so existing service callers do
not break while imports migrate.
"""
from agent.state.live_sessions import (
    LiveSessionStore,
    SessionBusyError,
    SessionNotFoundError,
    StreamAlreadyActiveError,
    StreamNotActiveError,
)

SessionStore = LiveSessionStore

__all__ = [
    "LiveSessionStore", "SessionBusyError", "SessionNotFoundError", "SessionStore",
    "StreamAlreadyActiveError", "StreamNotActiveError",
]
