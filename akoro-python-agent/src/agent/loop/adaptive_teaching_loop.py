"""Bounded adaptive-teaching lifecycle built from the shared agent modules.

This is the Python peer of JavaScript's StudentSessionOrchestrator. Domain
roles stay under `adaptive/`; transcript storage, phase state, progression
rules, and service composition live in their dedicated top-level modules.
"""
from __future__ import annotations

from collections.abc import Callable, Iterator
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from agent.adaptive.guide import NaNaGuide
from agent.adaptive.model import TeachingModel
from agent.adaptive.repository import LearningRepository
from agent.adaptive.student import StudentAgent
from agent.adaptive.types import AdaptiveSession
from agent.memory.akoro_conversation import AkoroConversationError, AkoroConversationSession
from agent.memory.conversation import ConversationMemoryUpdate, LearnerMemory, MAX_MEMORY_ITEMS
from agent.memory.scratchpad import WorkingScratchpad
from agent.reasoning.teaching import TeachingPlan
from agent.state.teaching_state import PHASE_LABELS, ProgressionPolicy
from agent.tools.akoro_api import AkoroToolSession

_ACTION_LABELS = {
    "DIG_DEEPER": "Dig deeper",
    "CLEAR_MISTAKE": "Clear a misconception",
    "NAME_IT": "Name the concept",
    "NEXT_SUBTOPIC": "Move to next concept",
    "ONE_MORE_PUSH": "One more push",
    "USE_ANALOGY": "Use an analogy",
    "GAP_CLOSED": "Gap closed ✓",
    "TRIGGER_RECALL": "Trigger recall",
    "CHALLENGE": "Challenge understanding",
    "MASTERY": "Mastery reached 🎉",
}


@dataclass(slots=True)
class _CachedConversationTurn:
    user_message: str
    assistant_message: str
    update: ConversationMemoryUpdate
    response: dict[str, Any]


class AdaptiveTeachingLoop:
    """Coordinates agent roles while preserving hard state and privacy limits."""

    def __init__(self, repository: LearningRepository, model: TeachingModel, session: AdaptiveSession,
                 tools: AkoroToolSession | None = None,
                 conversation_store: AkoroConversationSession | None = None) -> None:
        self._repository = repository
        self._model = model
        self.session = session
        self._tools = tools
        # The store is an Akoro API capability-bound handle. It is optional for
        # standalone/evaluation sessions and never owns database credentials.
        self._conversation_store = conversation_store
        self._guide = NaNaGuide(model)
        self._progression = ProgressionPolicy()
        self._profile = None
        self._student = None
        self._ended = False
        # Retains only recent completed turns during the live session so a
        # bridge retry never regenerates a different answer for one turn id.
        self._durable_turn_cache: dict[str, _CachedConversationTurn] = {}
        # Public metadata only; semantic hits themselves stay inside the model
        # prompt and never become an extra raw context payload to the browser.
        self._last_memory_retrieval: dict[str, Any] = {"attempted": False, "mode": "not_available", "matches": 0}

    def initialize(self) -> dict[str, Any]:
        if not self.session.student_id or not self.session.topic.strip():
            raise ValueError("student_id and topic are required")
        self._profile = self._repository.get_or_create_agent(self.session.student_id)
        reference_text = self.session.reference.text if self.session.reference else ""
        plan = TeachingPlan(
            topic=self.session.topic,
            subject=self.session.subject,
            steps=tuple(self._guide.build_ladder(self.session.topic, self.session.subject, reference_text)),
        )
        self.session.knowledge_map = list(plan.steps)
        self.session.must_know_parts = plan.titles
        self.session.scratchpad = (
            self.session.conversation.scratchpad
            if self.session.conversation and self.session.conversation.scratchpad
            else WorkingScratchpad.initial(self.session.topic)
        )
        if self.session.conversation:
            self.session.conversation.scratchpad = self.session.scratchpad
        self._student = StudentAgent(
            self._profile, self._repository, self._model, self.session.subject, self.session.reference, self._tools,
            self.session.conversation, self.session.scratchpad,
        )
        cognitive = self._repository.get_cognitive_state(self._profile.id, self.session.topic)
        current = self._current_subtopic()
        opening_blocks = [
            {
                "type": "subtopic-hdr",
                "subtopic": current,
                "items": self.session.must_know_parts,
                "map": plan.public_map(),
                "idx": self.session.progress.subtopic_index,
                "total": len(self.session.must_know_parts) or 1,
                "topic": self.session.topic,
                "subject": self.session.subject or "",
            },
            {
                "type": "guide",
                "agent": self._guide.name,
                "emoji": self._guide.emoji,
                "phase": self.session.progress.label(),
                "text": f"Let's teach {self.session.topic} to your agent. Start by explaining {current} in your own words.",
            },
        ]
        mode = {
            "free_teaching": "fresh",
            "continuation": "continuation",
            "decay_review": "decay",
        }[self.session.session_type]
        return {
            "sessionId": self.session.session_id,
            "mode": mode,
            "sessionType": self.session.session_type,
            "topic": self.session.topic,
            "subject": self.session.subject,
            "message": opening_blocks[1]["text"],
            "openingBlocks": opening_blocks,
            "mustKnowParts": self.session.must_know_parts,
            "agentLevel": self._profile.level,
            "knowledgeScore": round(self._profile.knowledge_score),
            "initialState": cognitive.as_percentages(),
            # Metadata only: source text never crosses the service boundary.
            "reference": self.session.reference.metadata() if self.session.reference else None,
            # No raw conversation or memory is echoed to the caller. The bridge
            # already owns it; this merely confirms whether it was restored.
            "conversation": self.session.conversation.public_metadata() if self.session.conversation else None,
            "scratchpad": self.session.scratchpad.wire() if self.session.scratchpad else None,
            "tools": {
                "enabled": bool(self._tools and self._tools.enabled),
                "available": self._tools.public_catalogue() if self._tools else [],
            },
            "guideProfile": {"name": self._guide.name, "emoji": self._guide.emoji},
            "agentPairId": "student-session",
        }

    def process_teaching_message(self, human_message: str, turn_id: str | None = None) -> dict[str, Any]:
        normalised = human_message.strip()
        if turn_id and turn_id in self._durable_turn_cache:
            return self._replay_durable_turn(turn_id, normalised)
        human_message, prior = self._prepare_teaching_turn(normalised)
        self._refresh_relevant_memory(human_message)
        self.session.scratchpad = self._student.plan_scratchpad(human_message, self.session.topic)  # type: ignore[union-attr]
        student_reply = self._student.reply(  # type: ignore[union-attr]
            human_message, self.session.topic, prior.as_percentages(), self.session.history,
            self.session.progress.label(),
        )
        return self._complete_teaching_turn(human_message, student_reply, turn_id=turn_id)

    def stream_teaching_message(
        self, human_message: str, should_stop: Callable[[], bool] | None = None,
        turn_id: str | None = None,
    ) -> Iterator[dict[str, Any]]:
        """Yield ordered token and terminal events for one teaching turn.

        A cancelled or disconnected stream does not alter cognitive state,
        transcript, XP, or knowledge persistence. Those mutations occur only
        once a complete Student Agent reply has been received.
        """
        normalised = human_message.strip()
        if turn_id and turn_id in self._durable_turn_cache:
            replayed = self._replay_durable_turn(turn_id, normalised)
            yield {"event": "student_token", "data": {"text": replayed["studentAgentResponse"]}}
            yield {"event": "turn_complete", "data": replayed}
            return
        human_message, prior = self._prepare_teaching_turn(normalised)
        self._refresh_relevant_memory(human_message)
        self.session.scratchpad = self._student.plan_scratchpad(human_message, self.session.topic)  # type: ignore[union-attr]
        fragments: list[str] = []
        for token in self._student.stream_reply(  # type: ignore[union-attr]
            human_message, self.session.topic, prior.as_percentages(), self.session.history,
            self.session.progress.label(), should_stop,
        ):
            if should_stop and should_stop():
                yield {"event": "stopped", "data": {"sessionId": self.session.session_id}}
                return
            fragments.append(token)
            yield {"event": "student_token", "data": {"text": token}}
        if should_stop and should_stop():
            yield {"event": "stopped", "data": {"sessionId": self.session.session_id}}
            return
        student_reply = "".join(fragments).strip()
        if not student_reply:
            yield {"event": "stopped", "data": {"sessionId": self.session.session_id}}
            return
        yield {"event": "turn_complete", "data": self._complete_teaching_turn(human_message, student_reply, turn_id=turn_id)}

    def _prepare_teaching_turn(self, human_message: str):
        if self._ended:
            raise RuntimeError("This session has already ended")
        if not self._student or not self._profile:
            raise RuntimeError("Initialize the session before processing messages")
        human_message = human_message.strip()
        if not human_message:
            raise ValueError("message is required")
        if len(human_message) > 12_000:
            raise ValueError("message is limited to 12,000 characters")
        return human_message, self._repository.get_cognitive_state(self._profile.id, self.session.topic)

    def _refresh_relevant_memory(self, human_message: str) -> None:
        """Hydrate bounded semantic context before planning or replying.

        The gateway owns embeddings and user scoping. A request failure is not
        fatal to teaching: the pre-hydrated recent notes and role-correct chat
        transcript remain available as a deterministic local fallback.
        """
        if not self._conversation_store or not self.session.conversation:
            self._last_memory_retrieval = {"attempted": False, "mode": "not_available", "matches": 0}
            return
        try:
            mode, memories = self._conversation_store.retrieve_relevant(
                query=human_message,
                subject=self.session.subject,
            )
            self.session.conversation.set_relevant_memories(memories)
            self._last_memory_retrieval = {"attempted": True, "mode": mode, "matches": len(memories)}
        except AkoroConversationError:
            self.session.conversation.set_relevant_memories([])
            self._last_memory_retrieval = {"attempted": True, "mode": "unavailable", "matches": 0}

    def _complete_teaching_turn(
        self, human_message: str, student_reply: str, *, turn_id: str | None = None,
    ) -> dict[str, Any]:
        if not self._student or not self._profile:
            raise RuntimeError("Initialize the session before processing messages")
        analysis = self._student.analyse_understanding(student_reply, self.session.topic, self.session.history)
        cognitive = self._repository.update_cognitive_state(self._profile.id, self.session.topic, analysis)
        state = cognitive.as_percentages()

        chunk = self._student.extract_knowledge(
            human_message, student_reply, self.session.topic, self.session.subject, analysis, self.session.session_id,
        )
        if chunk:
            self.session.knowledge_buffer.append(chunk)
        if analysis.strengths:
            self._repository.save_student_strengths(
                self._profile.id, self.session.student_id, self.session.topic, self.session.subject, analysis.strengths,
            )

        guide = self._guide.coaching_tip(
            topic=self.session.topic,
            phase=self.session.progress.label(),
            current_subtopic=self._current_subtopic(),
            human_message=human_message,
            student_response=student_reply,
            state=state,
            history=self.session.history,
            must_know_parts=self.session.must_know_parts,
            current_index=self.session.progress.subtopic_index,
        )
        transition = self._progression.apply(
            self.session.progress,
            requested_phase=guide["nextPhase"],
            requested_index=guide["nextMustKnowIndex"],
            total_subtopics=len(self.session.must_know_parts),
            understanding=analysis.understanding,
        )

        self.session.history.extend([
            {"role": "human_teacher", "content": human_message},
            {"role": "student_agent", "content": student_reply},
        ])
        self.session.turns_completed += 1
        if analysis.new_concept_learned and analysis.new_concept_learned not in self.session.concepts_learned:
            self.session.concepts_learned.append(analysis.new_concept_learned)
        if analysis.misconception_cleared and analysis.misconception_detected:
            self.session.misconceptions_cleared.append(analysis.misconception_detected)
        turn_xp = 5 + (20 if analysis.new_concept_learned else 0) + (15 if analysis.misconception_cleared else 0)
        if self.session.session_type == "decay_review":
            turn_xp = round(turn_xp * 1.5)
        self.session.xp_earned += turn_xp

        action = "CLEAR_MISTAKE" if analysis.misconception_detected and not analysis.misconception_cleared else guide["nextAction"]
        scratchpad = self._student.update_scratchpad(human_message, student_reply, self.session.topic)
        self.session.scratchpad = scratchpad
        response = {
            "type": "teaching_response",
            "studentAgentResponse": student_reply,
            "scratchpad": scratchpad.wire(),
            # No retrieved text is exposed here. This only reports whether the
            # bounded learner-memory lookup informed this turn's prompt.
            "memoryRetrieval": dict(self._last_memory_retrieval),
            # This structured audit field is intentionally result-free. The
            # model may use bounded data to answer the teacher's question, but
            # callers do not receive a second raw tool-result payload here.
            "toolExecutions": self._student.last_tool_executions,
            "guideMessage": guide["tip"],
            "guideIsUrgent": guide["isUrgent"],
            "guideName": self._guide.name,
            "controlStatusLine": None,
            "controlName": "Focus Monitor",
            "adaptiveEngine": {
                **state,
                "actionLabel": _ACTION_LABELS.get(action, "Continue"),
                "misconception": analysis.misconception_detected,
                "misconceptionCleared": analysis.misconception_cleared,
                "newConceptLearned": analysis.new_concept_learned,
                "agentKnowledgeAdded": len(self.session.knowledge_buffer),
                "knowledgeScore": round(self._profile.knowledge_score),
                "agentLevel": self._profile.level,
            },
            "phaseChanged": transition.phase_changed,
            "phaseLabel": PHASE_LABELS[transition.current_phase] if transition.phase_changed else None,
            "subtopicAdvanced": transition.subtopic_advanced,
            "currentSubtopic": self._current_subtopic(),
            "currentPhase": transition.current_phase,
            "topic": self.session.topic,
            "subject": self.session.subject or "",
            "subtopicIdx": transition.current_subtopic_index,
            "totalSubtopics": len(self.session.must_know_parts) or 1,
            "subtopicObjectives": self.session.must_know_parts if transition.subtopic_advanced else [],
            "driftInfo": {"isDrifting": guide["offTopic"], "driftLevel": "edge" if guide["offTopic"] else "none"},
            "agentPairId": "student-session",
            "sessionType": self.session.session_type,
            "turnXP": turn_xp,
        }
        if self.session.conversation:
            self.session.conversation.append_turn(human_message, student_reply)
        if self._conversation_store:
            # Durable persistence is attempted only after a complete model
            # response. A stopped/partial stream never reaches this point.
            if not turn_id:
                response["conversationPersistence"] = {
                    "saved": False,
                    "reason": "A turnId is required for durable conversation persistence",
                }
            else:
                self._remember_durable_turn(
                    turn_id, human_message, student_reply,
                    self._conversation_memory_update(scratchpad, chunk), response,
                )
                return self._replay_durable_turn(turn_id, human_message)
        return response

    def _remember_durable_turn(
        self, turn_id: str, user_message: str, assistant_message: str,
        update: ConversationMemoryUpdate, response: dict[str, Any],
    ) -> None:
        if self.session.conversation:
            self.session.conversation.summary = update.summary
            for item in update.memories:
                memory = LearnerMemory.from_wire(item)
                if memory:
                    self.session.conversation.memories.insert(0, memory)
            del self.session.conversation.memories[MAX_MEMORY_ITEMS:]
        self._durable_turn_cache[turn_id] = _CachedConversationTurn(
            user_message=user_message,
            assistant_message=assistant_message,
            update=update,
            response=deepcopy(response),
        )
        if len(self._durable_turn_cache) > 32:
            oldest = next(iter(self._durable_turn_cache))
            self._durable_turn_cache.pop(oldest, None)

    def _replay_durable_turn(self, turn_id: str, user_message: str) -> dict[str, Any]:
        cached = self._durable_turn_cache[turn_id]
        if cached.user_message != user_message:
            raise ValueError("turnId cannot be reused for a different message")
        response = deepcopy(cached.response)
        try:
            if not self._conversation_store:
                raise AkoroConversationError("Durable conversation context is unavailable")
            saved = self._conversation_store.persist_turn(
                turn_id=turn_id,
                user_message=cached.user_message,
                assistant_message=cached.assistant_message,
                update=cached.update,
            )
            response["conversationPersistence"] = {"saved": True, **saved}
        except AkoroConversationError:
            # A retry always returns the original model response. This prevents
            # one browser/network retry from creating a different answer and a
            # divergent durable transcript.
            response["conversationPersistence"] = {
                "saved": False,
                "reason": "Akoro conversation persistence is unavailable",
            }
        cached.response = deepcopy(response)
        return response

    def _conversation_memory_update(self, scratchpad: WorkingScratchpad, chunk=None) -> ConversationMemoryUpdate:
        """Create compact study context without copying raw prompts into memory."""
        concepts = self.session.concepts_learned[-3:]
        concept_text = "; ".join(concepts) if concepts else "Continue building the current foundation"
        cleared = self.session.misconceptions_cleared[-2:]
        correction = f" Corrections covered: {'; '.join(cleared)}." if cleared else ""
        summary = (
            f"Adaptive study session on {self.session.topic}. "
            f"Current learning focus: {concept_text}.{correction}"
        )[:4_000]
        memories: tuple[dict[str, str], ...] = ()
        if chunk:
            memories = ({
                "kind": "learning_summary",
                "content": chunk.content[:1_500],
                "topic": chunk.topic[:180],
                "subject": (chunk.subject or "")[:180],
            },)
        return ConversationMemoryUpdate(summary=summary, scratchpad=scratchpad, memories=memories)

    def execute_confirmed_action(self, confirmation_token: str) -> dict[str, Any]:
        """Redeem a server-issued learner confirmation without re-prompting the model."""
        if not self._tools:
            return {"success": False, "error": "Akoro account tools are not available for this session"}
        return self._tools.execute_confirmed_write(confirmation_token)

    def generate_summary(self) -> dict[str, Any]:
        if not self._profile:
            raise RuntimeError("Initialize the session before requesting a summary")
        state = self._repository.get_cognitive_state(self._profile.id, self.session.topic)
        evaluation = self._guide.evaluate_session(
            self.session.topic, self.session.history, state.as_percentages()["understanding"],
        )
        return {
            "teachingScore": evaluation["overallScore"],
            "xpEarned": self.session.xp_earned,
            "agentFeedback": evaluation["nextTimeTip"],
            "keyConcepts": self.session.concepts_learned[:5],
            "strengthAreas": evaluation["strengths"],
            "gapsIdentified": self.session.misconceptions_cleared[:3] or [evaluation["nextLesson"]],
        }

    def end_session(self) -> dict[str, Any]:
        if self._ended:
            raise RuntimeError("This session has already ended")
        if not self._profile:
            raise RuntimeError("Initialize the session before ending it")
        summary = self.generate_summary()
        saved = self._repository.save_agent_knowledge(self.session.knowledge_buffer)
        updated = self._repository.finish_session(self._profile.id, self.session.turns_completed, self.session.xp_earned, saved)
        state = self._repository.get_cognitive_state(self._profile.id, self.session.topic)
        self._ended = True
        return {
            "evaluation": {
                "overallScore": summary["teachingScore"],
                "strengths": summary["strengthAreas"],
                "nextTimeTip": summary["agentFeedback"],
                "nextLesson": summary["gapsIdentified"][0] if summary["gapsIdentified"] else f"Continue with {self.session.topic}",
            },
            "controlReport": {"summary": f"Session complete — {self.session.turns_completed} turns"},
            "finalState": state.as_percentages(),
            "totalTurns": self.session.turns_completed,
            "topic": self.session.topic,
            "agentPairId": "student-session",
            "sessionType": self.session.session_type,
            "agentGrowth": {
                "knowledgeChunksSaved": saved,
                "xpEarned": self.session.xp_earned,
                "conceptsLearned": self.session.concepts_learned,
                "misconceptionsCleared": self.session.misconceptions_cleared,
                "agentLevel": updated.level,
                "agentKnowledgeScore": round(updated.knowledge_score),
                "totalSessions": updated.total_sessions,
                "leveledUp": updated.level > self._profile.level,
            },
        }

    def _current_subtopic(self) -> str:
        if not self.session.must_know_parts:
            return self.session.topic
        return self.session.must_know_parts[self.session.progress.subtopic_index]
