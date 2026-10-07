"""Server-to-server authentication policy for the agent-service adapter."""
from __future__ import annotations

from dataclasses import dataclass
from secrets import compare_digest


@dataclass(frozen=True, slots=True)
class InternalServicePolicy:
    secret: str | None
    environment: str = "development"

    def authorize(self, supplied_secret: str | None) -> tuple[bool, int, str]:
        if not self.secret:
            if self.environment == "production":
                return False, 503, "Service authentication is not configured"
            return True, 200, "Development mode"
        if not supplied_secret or not compare_digest(supplied_secret, self.secret):
            return False, 401, "Invalid internal service credential"
        return True, 200, "Authenticated"
