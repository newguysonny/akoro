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
    # Required together when the feature-flagged canonical concept slice is
    # enabled. They are resolved by Akoro against approved curriculum rows.
    curriculum_key: str | None = Field(default=None, alias="curriculumKey", min_length=1, max_length=180)
    topic_key: str | None = Field(default=None, alias="topicKey", min_length=1, max_length=180)
    session_id: str | None = Field(default=None, alias="sessionId", max_length=180)
    # Existing public Agent Chat uses UUID session ids. Supplying one tells the
    # trusted bridge to hydrate the user/assistant transcript from Akoro API;
    # clients cannot pass raw history directly to this internal service.
    conversation_id: str | None = Field(
        default=None, alias="conversationId", min_length=36, max_length=36,
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
    )
    mode: Literal["fresh", "continuation", "decay"] = "fresh"
    # continuation: the earlier session's Akoro recordId (returned when it
    # started). decay: the learner's decay alert, if the review came from one.
    # Akoro checks both belong to the capability's learner.
    previous_session_id: str | None = Field(default=None, alias="previousSessionId", min_length=36, max_length=36, pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    notification_id: str | None = Field(default=None, alias="notificationId", min_length=36, max_length=36, pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    # Opaque, short-lived capability created by Akoro API after it authenticates
    # and authorises the browser request. Python only relays it to the private
    # tools API and never parses it as identity or permission data.
    tool_context: str | None = Field(default=None, alias="toolContext", min_length=1, max_length=4096)
    reference: ReferenceRequest | None = None


class TeachingTurnRequest(Contract):
    message: str = Field(min_length=1, max_length=12_000)
    # The bridge creates this opaque retry key before calling Python. It binds
    # one user prompt/assistant answer pair to one durable Akoro write.
    turn_id: str | None = Field(
        default=None, alias="turnId", min_length=8, max_length=180,
        pattern=r"^[A-Za-z0-9_-]+$",
    )


class ConfirmedActionRequest(Contract):
    # Opaque, short-lived token issued only after the learner approves the
    # exact preview. The trusted Node bridge—not browser JavaScript—relays it.
    # Python does not parse or authorise it.
    confirmation_token: str = Field(alias="confirmationToken", min_length=1, max_length=4096)
