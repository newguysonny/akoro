"""Bounded adaptive-teaching lifecycle built from the shared agent modules.

This is the Python peer of JavaScript's StudentSessionOrchestrator. Domain
roles stay under `adaptive/`; transcript storage, phase state, progression
rules, and service composition live in their dedicated top-level modules.
"""
from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

from agent.adaptive.guide import NaNaGuide
from agent.adaptive.model import TeachingModel
from agent.adaptive.repository import LearningRepository
from agent.adaptive.student import StudentAgent
from agent.adaptive.types import AdaptiveSession
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


class AdaptiveTeachingLoop:
    """Coordinates agent roles while preserving hard state and privacy limits."""

    def __init__(self, repository: LearningRepository, model: TeachingModel, session: AdaptiveSession,
                 tools: AkoroToolSession | None = None) -> None:
        self._repository = repository
        self._model = model
        self.session = session
        self._tools = tools
        self._guide = NaNaGuide(model)
        self._progression = ProgressionPolicy()
        self._profile = None
        self._student = None
        self._ended = False

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
        self._student = StudentAgent(
            self._profile, self._repository, self._model, self.session.subject, self.session.reference, self._tools,
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
            "tools": {
                "enabled": bool(self._tools and self._tools.enabled),
                "available": self._tools.public_catalogue() if self._tools else [],
            },
            "guideProfile": {"name": self._guide.name, "emoji": self._guide.emoji},
            "agentPairId": "student-session",
        }

    def process_teaching_message(self, human_message: str) -> dict[str, Any]:
        human_message, prior = self._prepare_teaching_turn(human_message)
        student_reply = self._student.reply(  # type: ignore[union-attr]
            human_message, self.session.topic, prior.as_percentages(), self.session.history,
            self.session.progress.label(),
        )
        return self._complete_teaching_turn(human_message, student_reply)

    def stream_teaching_message(
        self, human_message: str, should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[dict[str, Any]]:
        """Yield ordered token and terminal events for one teaching turn.

        A cancelled or disconnected stream does not alter cognitive state,
        transcript, XP, or knowledge persistence. Those mutations occur only
        once a complete Student Agent reply has been received.
        """
        human_message, prior = self._prepare_teaching_turn(human_message)
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
        yield {"event": "turn_complete", "data": self._complete_teaching_turn(human_message, student_reply)}

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

    def _complete_teaching_turn(self, human_message: str, student_reply: str) -> dict[str, Any]:
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
        return {
            "type": "teaching_response",
            "studentAgentResponse": student_reply,
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
