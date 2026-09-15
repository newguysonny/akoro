"""Wire format helpers for the internal teaching-turn event stream."""
from __future__ import annotations

import json
from typing import Any


def sse_event(event: str, data: dict[str, Any]) -> str:
    """Serialize a named Server-Sent Event without allowing line injection."""
    # Event names are controlled constants in the service. Compact JSON stays
    # on one logical SSE data line, even when source values contain newlines.
    encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {encoded}\n\n"
