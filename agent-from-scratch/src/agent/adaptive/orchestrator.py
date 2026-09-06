"""Python equivalent of the JavaScript StudentSessionOrchestrator.

The output keys intentionally mirror the adaptive Socket.IO payloads where it
makes sense. A small Node bridge can therefore map REST responses to existing
`session_ready`, `turn_complete`, and `session_summary` events without teaching
the learner UI a second protocol.
"""
from __future__ import annotations

from typing import Any

from .guide import NaNaGuide
from .model import TeachingModel
from .repository import LearningRepository
from .student import StudentAgent
from .types import AdaptiveSession, CognitiveState, PHASE_LABELS, SessionReference

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


class AdaptiveTeachingOrchestrator:
    def __init__(self, repository: LearningRepository, model: TeachingModel, session: AdaptiveSession) -> None:
        self._repository = repository
        self._model = model
        self.session = session
        self._guide = NaNaGuide(model)
        self._profile = None
        self._student = None
        self._ended = False

    def initialize(self) -> dict[str, Any]:
        if not self.session.student_id or not self.session.topic.strip():
            raise ValueError("student_id and topic are required")
        self._profile = self._repository.get_or_create_agent(self.session.student_id)
        reference_text = self.session.reference.text if self.session.reference else ""
        ladder = self._guide.build_ladder(self.session.topic, self.session.subject, reference_text)
        self.session.knowledge_map = ladder
        self.session.must_know_parts = [step.title for step in ladder]
        self._student = StudentAgent(self._profile, self._repository, self._model, self.session.subject, self.session.reference)
        cognitive = self._repository.get_cognitive_state(self._profile.id, self.session.topic)
        current = self.session.must_know_parts[0] if self.session.must_know_parts else self.session.topic
        opening_blocks = [
            {
                "type": "subtopic-hdr",
                "subtopic": current,
                "items": self.session.must_know_parts,
                "map": [step.public() for step in ladder],
                "idx": self.session.must_know_index,
                "total": len(self.session.must_know_parts) or 1,
                "topic": self.session.topic,
                "subject": self.session.subject or "",
            },
            {
                "type": "guide",
                "agent": self._guide.name,
                "emoji": self._guide.emoji,
                "phase": PHASE_LABELS[self.session.phase],
                "text": f"Let's teach {self.session.topic} to your agent. Start by explaining {current} in your own words.",
            },
        ]
        return {
            "sessionId": self.session.session_id,
            "mode": "decay" if self.session.session_type == "decay_review" else "fresh",
            "sessionType": self.session.session_type,
            "topic": self.session.topic,
            "subject": self.session.subject,
            "message": opening_blocks[1]["text"],
            "openingBlocks": opening_blocks,
            "mustKnowParts": self.session.must_know_parts,
            "agentLevel": self._profile.level,
            "knowledgeScore": round(self._profile.knowledge_score),
            "initialState": cognitive.as_percentages(),
            "reference": self.session.reference.metadata() if self.session.reference else None,
            "guideProfile": {"name": self._guide.name, "emoji": self._guide.emoji},
            "agentPairId": "student-session",
        }

    def process_teaching_message(self, human_message: str) -> dict[str, Any]:
        if self._ended:
            raise RuntimeError("This session has already ended")
        if not self._student or not self._profile:
            raise RuntimeError("Initialize the session before processing messages")
        human_message = human_message.strip()
        if not human_message:
            raise ValueError("message is required")
        if len(human_message) > 12_000:
            raise ValueError("message is limited to 12,000 characters")

        prior = self._repository.get_cognitive_state(self._profile.id, self.session.topic)
        student_reply = self._student.reply(
            human_message, self.session.topic, prior.as_percentages(), self.session.history,
            PHASE_LABELS[self.session.phase],
        )
        analysis = self._student.analyse_understanding(student_reply, self.session.topic, self.session.history)
        current = self._repository.update_cognitive_state(self._profile.id, self.session.topic, analysis)
        state = current.as_percentages()

        chunk = self._student.extract_knowledge(
            human_message, student_reply, self.session.topic, self.session.subject, analysis, self.session.session_id,
        )
        if chunk:
            self.session.knowledge_buffer.append(chunk)
        if analysis.strengths:
            self._repository.save_student_strengths(self._profile.id, self.session.student_id, self.session.topic, self.session.subject, analysis.strengths)

        active_part = self.session.must_know_parts[self.session.must_know_index] if self.session.must_know_parts else self.session.topic
        guide = self._guide.coaching_tip(
            topic=self.session.topic,
            phase=PHASE_LABELS[self.session.phase],
            current_subtopic=active_part,
            human_message=human_message,
            student_response=student_reply,
            state=state,
            history=self.session.history,
            must_know_parts=self.session.must_know_parts,
            current_index=self.session.must_know_index,
        )
        old_phase = self.session.phase
        old_index = self.session.must_know_index
        if guide["nextPhase"]:
            self.session.phase = guide["nextPhase"]
        self.session.must_know_index = guide["nextMustKnowIndex"]
        phase_changed = old_phase != self.session.phase
        subtopic_advanced = old_index != self.session.must_know_index

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
        next_part = self.session.must_know_parts[self.session.must_know_index] if self.session.must_know_parts else self.session.topic
        return {
            "type": "teaching_response",
            "studentAgentResponse": student_reply,
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
            "phaseChanged": phase_changed,
            "phaseLabel": PHASE_LABELS[self.session.phase] if phase_changed else None,
            "subtopicAdvanced": subtopic_advanced,
            "currentSubtopic": next_part,
            "currentPhase": self.session.phase,
            "topic": self.session.topic,
            "subject": self.session.subject or "",
            "subtopicIdx": self.session.must_know_index,
            "totalSubtopics": len(self.session.must_know_parts) or 1,
            "subtopicObjectives": self.session.must_know_parts if subtopic_advanced else [],
            "driftInfo": {"isDrifting": guide["offTopic"], "driftLevel": "edge" if guide["offTopic"] else "none"},
            "agentPairId": "student-session",
            "sessionType": self.session.session_type,
            "turnXP": turn_xp,
        }

    def generate_summary(self) -> dict[str, Any]:
        if not self._profile:
            raise RuntimeError("Initialize the session before requesting a summary")
        state = self._repository.get_cognitive_state(self._profile.id, self.session.topic)
        evaluation = self._guide.evaluate_session(self.session.topic, self.session.history, state.as_percentages()["understanding"])
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
