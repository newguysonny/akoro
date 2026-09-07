"""Deterministic, bounded planning skills shared by adaptive workflows."""
from __future__ import annotations
from dataclasses import dataclass
from typing import Iterable


def _fraction(value: object) -> float:
    try: return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError): return 0.0

@dataclass(frozen=True, slots=True)
class TopicSignal:
    topic: str
    mastery: float = 0.0
    retention: float = 0.0
    evidence_confidence: float = 0.0
    misconception_active: bool = False
    learning_status: str = "not_started"
    curriculum_weight: float = 0.5

    def gap(self) -> float:
        base = (1 - _fraction(self.mastery)) * .45 + (1 - _fraction(self.retention)) * .30 + (1 - _fraction(self.evidence_confidence)) * .15
        return round(min(1, base + (.20 if self.misconception_active else 0) + (.10 if self.learning_status in {"not_started", "confused"} else 0)), 4)

def knowledge_gap_analysis(signals: Iterable[TopicSignal]) -> list[dict[str, object]]:
    result = []
    for signal in signals:
        reason = "active_misconception" if signal.misconception_active else "low_retention" if _fraction(signal.retention) < .45 else "insufficient_evidence" if _fraction(signal.evidence_confidence) < .35 else "practice_gap"
        result.append({"topic": signal.topic[:180], "gap": signal.gap(), "reason": reason, "status": signal.learning_status})
    return sorted(result, key=lambda item: (-float(item["gap"]), str(item["topic"])))

def prioritise_topics(signals: Iterable[TopicSignal], limit: int = 5) -> list[dict[str, object]]:
    sources = list(signals)
    ranked = []
    for item in knowledge_gap_analysis(sources):
        source = next((x for x in sources if x.topic[:180] == item["topic"]), None)
        weight = _fraction(source.curriculum_weight) if source else .5
        ranked.append({**item, "priority": round(float(item["gap"]) * (.5 + .5 * weight), 4)})
    return sorted(ranked, key=lambda item: (-float(item["priority"]), str(item["topic"])))[:max(0, min(limit, 12))]

def calibrate_difficulty(signal: TopicSignal) -> str:
    if signal.misconception_active or _fraction(signal.mastery) < .35: return "easy"
    if _fraction(signal.mastery) >= .78 and _fraction(signal.retention) >= .65 and _fraction(signal.evidence_confidence) >= .55: return "hard"
    return "medium"

def session_sizing(*, pacing: str, attention: float | None = None, fatigue: float | None = None) -> int:
    if _fraction(fatigue) >= .65 or _fraction(attention) < .40 or pacing == "shorter_chunks": return 10
    if pacing == "stretch" and _fraction(attention) >= .72 and _fraction(fatigue) < .45: return 30
    return 20

def synthesise_progress(signals: Iterable[TopicSignal]) -> dict[str, object]:
    items = list(signals)
    gaps = knowledge_gap_analysis(items)
    return {"topics": len(items), "needsRepair": sum(x.misconception_active for x in items), "needsRetrieval": sum(_fraction(x.retention) < .45 for x in items), "mastered": sum(x.learning_status == "mastered" for x in items), "nextTopic": gaps[0]["topic"] if gaps else None}
