"""HTTP request models. Aliases match the existing Socket.IO naming style."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Contract(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class ReferenceRequest(Contract):
    name: str = Field(default="reference", max_length=180)
    text: str = Field(min_length=1, max_length=50_000)
    truncated: bool = False


class StartSessionRequest(Contract):
    student_id: str = Field(alias="studentId", min_length=1, max_length=180)
    topic: str = Field(min_length=1, max_length=500)
    subject: str | None = Field(default=None, max_length=180)
    teacher_agent_id: str | None = Field(default=None, alias="teacherAgentId", max_length=180)
    session_id: str | None = Field(default=None, alias="sessionId", max_length=180)
    mode: Literal["fresh", "continuation", "decay"] = "fresh"
    reference: ReferenceRequest | None = None


class TeachingTurnRequest(Contract):
    message: str = Field(min_length=1, max_length=12_000)
