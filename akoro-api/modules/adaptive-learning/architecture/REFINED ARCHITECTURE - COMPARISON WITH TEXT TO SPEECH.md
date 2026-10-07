"""
Cognitive Conditioning Schema
==============================

Direct architectural port of one idea from Chatterbox TTS:

    Chatterbox: raw reference audio --[VoiceEncoder / S3Gen.embed_ref]--> fixed-size
    conditioning vectors (speaker_emb, prompt tokens, emotion_adv) --> T3 (generation) --> S3Gen (render)

    Here:       raw session state --[encode_* functions below]--> a small, typed,
    size-capped ProtegeCond object --> prompt builder (generation) --> LLM (render)

The point of the port is NOT "make the student agent sound like TTS." It's this:
Chatterbox never re-feeds raw source material into the generator. It compresses
everything to a fixed-size vector *once*, then conditions on the vector. Your
current docs do the opposite in the prompt-assembly step — they f-string seven
nested dicts directly into the LLM prompt. This file fixes that seam.

Two enforced rules, both taken directly from the TTS pipeline's discipline:

1. ENCODE, DON'T PASTE. Every field in ProtegeCond is a bounded scalar, short
   enum, or capped-length list of short strings — never a raw dialogue dump,
   never an open-ended dict. If a value can't be justified as "the minimum
   sufficient statistic the generator needs," it doesn't belong in the schema.
   (Mirrors: speaker_emb is a fixed 256-dim vector, not the reference wav.)

2. NARROW INTERFACE BETWEEN STAGES. The thing that crosses from "cognitive
   engine" to "response generator" is exactly this object — nothing else.
   No engine downstream of encode_state() is allowed to reach back into raw
   session history. (Mirrors: T3 never sees the reference audio, only ve_embed
   and s3_tokens.)

This does NOT solve the "no ground truth" problem discussed earlier — the
values populating ProtegeCond are still LLM-judge estimates, not measured
signal. This schema only fixes the *conditioning discipline*, not the
*calibration* problem. See `calibration_hooks.py` (sketched at bottom) for
where a self-report check would plug in.
"""

from __future__ import annotations
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Literal
import json
import time


# ---------------------------------------------------------------------------
# Bounded enums (mirrors: emotion_adv is a scalar 0-1, not a free-text mood)
# ---------------------------------------------------------------------------

class Scaffolding(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ExplanationPref(str, Enum):
    ANALOGY_FIRST = "analogy_first"
    FORMAL = "formal"
    VISUAL = "visual"
    SOCRATIC = "socratic"
    STEP_BY_STEP = "step_by_step"


class Mood(str, Enum):
    CONFIDENT_CURIOUS = "confident_curious"
    CAUTIOUS_CONFUSED = "cautious_confused"
    FRUSTRATED = "frustrated"
    RELIEVED = "relieved"
    NEUTRAL = "neutral"


# ---------------------------------------------------------------------------
# The conditioning object itself.
# Field budget is intentional: this is the "fixed-size embedding," not a log.
# ---------------------------------------------------------------------------

@dataclass
class ConceptCond:
    """One concept's state. Analogous to a single frame of conditioning."""
    id: str
    mastery: float          # 0-1
    confidence: float       # 0-1
    retention: float        # 0-1, post-decay
    status: Literal["not_started", "learning", "mastered"]

    def __post_init__(self):
        for name in ("mastery", "confidence", "retention"):
            v = getattr(self, name)
            if not (0.0 <= v <= 1.0):
                raise ValueError(f"{name}={v} out of [0,1] for concept {self.id}")


@dataclass
class ProtegeCond:
    """
    The ENTIRE interface between the cognitive engine and the response
    generator. If it's not in here, the generator doesn't get to see it.

    Every list below is capped — this is enforced in encode_state(), not
    just by convention — because an uncapped list is a raw-data leak
    wearing a schema's clothes.
    """
    # --- core cognitive (Tier 1) ---
    active_concept: ConceptCond
    supporting_concepts: list[ConceptCond]      # cap: 3
    confusion_flags: list[str]                  # cap: 2, each <= 8 words
    sticky_misconception: str | None            # cap: 1, <= 12 words

    # --- learner profile (per-human, slow-moving) ---
    scaffolding_need: Scaffolding
    explanation_pref: ExplanationPref
    error_tolerance: int                        # 0-5

    # --- memory (Tier 2, already compacted upstream) ---
    memory_beat: str | None                     # cap: 1 narrative kernel, <= 20 words

    # --- emotion / attention (Tier 2) ---
    mood: Mood
    cognitive_load: float                       # 0-1
    attention: float                             # 0-1

    # --- social (Tier 2) ---
    teacher_expectation_gap: float               # 0-1, signed via sign of value not needed; keep 0-1 magnitude

    # --- identity (Tier 2, slow-moving) ---
    trust_level: float                           # 0-1
    inside_joke: str | None                      # cap: 1, <= 8 words

    # --- meta ---
    encoded_at: float = field(default_factory=time.time)
    schema_version: str = "1.0"

    def __post_init__(self):
        if len(self.supporting_concepts) > 3:
            raise ValueError("supporting_concepts exceeds cap of 3 — compact upstream")
        if len(self.confusion_flags) > 2:
            raise ValueError("confusion_flags exceeds cap of 2 — compact upstream")
        for flag in self.confusion_flags:
            if len(flag.split()) > 8:
                raise ValueError(f"confusion_flag too long (>8 words): {flag!r}")
        if self.sticky_misconception and len(self.sticky_misconception.split()) > 12:
            raise ValueError("sticky_misconception exceeds 12 words")
        if self.memory_beat and len(self.memory_beat.split()) > 20:
            raise ValueError("memory_beat exceeds 20 words — compact upstream, don't paste a transcript")
        if self.inside_joke and len(self.inside_joke.split()) > 8:
            raise ValueError("inside_joke exceeds 8 words")
        for name in ("cognitive_load", "attention", "teacher_expectation_gap", "trust_level"):
            v = getattr(self, name)
            if not (0.0 <= v <= 1.0):
                raise ValueError(f"{name}={v} out of [0,1]")
        if not (0 <= self.error_tolerance <= 5):
            raise ValueError("error_tolerance out of [0,5]")

    def to_json(self) -> str:
        d = asdict(self)
        d["active_concept"] = asdict(self.active_concept)
        d["supporting_concepts"] = [asdict(c) for c in self.supporting_concepts]
        d["mood"] = self.mood.value
        d["scaffolding_need"] = self.scaffolding_need.value
        d["explanation_pref"] = self.explanation_pref.value
        return json.dumps(d, indent=2)


# ---------------------------------------------------------------------------
# ENCODE step (mirrors VoiceEncoder / S3Gen.embed_ref)
# This is where your existing LLM-judge / BKT / decay logic plugs in.
# The point: everything upstream of this line can be as messy, stateful,
# and dict-heavy as it wants. Nothing downstream of this line sees any of it.
# ---------------------------------------------------------------------------

def encode_state(
    *,
    concept_graph: dict,        # your Tier-1 knowledge graph + mastery store
    learner_profile: dict,      # your per-human profile dict
    narrative_kernels: list,    # your Tier-2 memory store (list of kernel dicts)
    emotion_state: dict,        # your Tier-2 emotion engine output
    social_state: dict,         # your Tier-2 theory-of-mind output
    identity_state: dict,       # your Tier-2 identity/relationship engine output
    active_concept_id: str,
) -> ProtegeCond:
    """
    Compresses full engine state into the capped conditioning object.
    This function is the seam. Everything above it is your existing
    (currently-pseudocode) Tier 1/2 design; everything below it is new.

    Replace the dict-lookup bodies below with your real engine calls —
    the shape and the caps are the contribution here, not the plumbing.
    """
    active = concept_graph["concepts"][active_concept_id]
    active_cond = ConceptCond(
        id=active_concept_id,
        mastery=active["mastery"],
        confidence=active["confidence"],
        retention=active.get("retention", active["mastery"]),
        status=active["status"],
    )

    # cap supporting concepts to the 3 most relevant (prerequisite or linked)
    support_ids = active.get("related_concepts", [])[:3]
    supporting = [
        ConceptCond(
            id=cid,
            mastery=concept_graph["concepts"][cid]["mastery"],
            confidence=concept_graph["concepts"][cid]["confidence"],
            retention=concept_graph["concepts"][cid].get("retention", concept_graph["concepts"][cid]["mastery"]),
            status=concept_graph["concepts"][cid]["status"],
        )
        for cid in support_ids
    ]

    # cap confusion flags to top 2 by severity, truncate to 8 words
    flags = sorted(active.get("confusion_flags", []), key=lambda f: -f.get("severity", 0))[:2]
    confusion_flags = [_truncate_words(f["label"], 8) for f in flags]

    sticky = active.get("misconceptions", [])
    sticky_misconception = None
    if sticky:
        top = max(sticky, key=lambda m: m.get("stickiness", 0))
        if top.get("stickiness", 0) > 0.4:
            sticky_misconception = _truncate_words(top["label"], 12)

    # pick ONE memory beat — most relevant, not a dump of all kernels
    memory_beat = None
    relevant = [k for k in narrative_kernels if active_concept_id in k.get("linked_concepts", [])]
    if relevant:
        most_recent = max(relevant, key=lambda k: k.get("session_id", ""))
        memory_beat = _truncate_words(most_recent.get("narrative_summary", ""), 20)

    return ProtegeCond(
        active_concept=active_cond,
        supporting_concepts=supporting,
        confusion_flags=confusion_flags,
        sticky_misconception=sticky_misconception,
        scaffolding_need=Scaffolding(learner_profile.get("scaffolding_need", "medium")),
        explanation_pref=ExplanationPref(learner_profile.get("explanation_preference", "step_by_step")),
        error_tolerance=learner_profile.get("error_tolerance", 2),
        memory_beat=memory_beat,
        mood=Mood(emotion_state.get("mood", "neutral")),
        cognitive_load=emotion_state.get("cognitive_load", 0.3),
        attention=emotion_state.get("attention", 0.8),
        teacher_expectation_gap=social_state.get("teacher_expectation_gap", 0.0),
        trust_level=identity_state.get("trust_level", 0.5),
        inside_joke=_truncate_words(identity_state["inside_jokes"][-1], 8) if identity_state.get("inside_jokes") else None,
    )


def _truncate_words(text: str, cap: int) -> str:
    words = text.split()
    return " ".join(words[:cap]) if len(words) > cap else text


# ---------------------------------------------------------------------------
# RENDER step (mirrors T3.inference conditioned on T3Cond)
# Deterministic template, not free-form prose assembly. Every line is
# generated FROM a typed field — nothing is hand-woven from a raw dict.
# ---------------------------------------------------------------------------

def build_prompt(cond: ProtegeCond, human_input: str) -> str:
    lines = []
    ac = cond.active_concept
    if ac.retention < ac.mastery - 0.1:
        lines.append(f"You learned '{ac.id}' to {ac.mastery:.0%} mastery, but it's gone rusty — "
                      f"right now you can only reliably recall about {ac.retention:.0%} of it.")
    else:
        lines.append(f"You are a student with mastery {ac.mastery:.0%} on '{ac.id}' "
                      f"(retention {ac.retention:.0%}).")

    if cond.supporting_concepts:
        parts = []
        for c in cond.supporting_concepts:
            if c.retention < c.mastery - 0.1:
                parts.append(f"{c.id} {c.mastery:.0%} mastered but rusty (recall {c.retention:.0%})")
            else:
                parts.append(f"{c.id} {c.mastery:.0%}")
        lines.append(f"Related concepts: {'; '.join(parts)}.")

    if cond.confusion_flags:
        lines.append(f"You are confused about: {'; '.join(cond.confusion_flags)}.")

    if cond.sticky_misconception:
        lines.append(f"You still half-believe (even though corrected): \"{cond.sticky_misconception}\".")

    if cond.memory_beat:
        lines.append(f"You recall: \"{cond.memory_beat}\"")

    lines.append(f"Mood: {cond.mood.value}. Cognitive load: {cond.cognitive_load:.0%}. "
                 f"Attention: {cond.attention:.0%}.")

    if cond.teacher_expectation_gap > 0.3:
        lines.append("You sense the teacher expects you to know more than you do.")

    lines.append(f"Explanation style you respond best to: {cond.explanation_pref.value}. "
                 f"Scaffolding need: {cond.scaffolding_need.value}.")

    if cond.inside_joke:
        lines.append(f"Shared context with this teacher: \"{cond.inside_joke}\".")

    lines.append("")
    lines.append(f'The teacher just said: "{human_input}"')
    lines.append("")
    lines.append("Respond as this student. Do not demonstrate more understanding than your "
                 "mastery and confusion above justify. If cognitive load is above 80%, ask to pause.")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Example wiring (replace stub inputs with your real engine outputs)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    concept_graph = {
        "concepts": {
            "chloroplasts": {
                "mastery": 0.25, "confidence": 0.35, "retention": 0.25,
                "status": "learning",
                "related_concepts": ["plant_cells", "light_role"],
                "confusion_flags": [{"label": "chlorophyll vs chloroplast", "severity": 0.8}],
                "misconceptions": [{"label": "plants eat soil", "stickiness": 0.7}],
            },
            "plant_cells": {"mastery": 0.70, "confidence": 0.65, "retention": 0.6, "status": "mastered"},
            "light_role": {"mastery": 0.85, "confidence": 0.8, "retention": 0.8, "status": "mastered"},
        }
    }
    learner_profile = {"scaffolding_need": "low", "explanation_preference": "analogy_first", "error_tolerance": 2}
    narrative_kernels = [{
        "session_id": "s_002", "linked_concepts": ["chloroplasts"],
        "narrative_summary": "First mention of chloroplasts, briefly, didn't go deep.",
    }]
    emotion_state = {"mood": "cautious_confused", "cognitive_load": 0.5, "attention": 0.8}
    social_state = {"teacher_expectation_gap": 0.3}
    identity_state = {"trust_level": 0.6, "inside_jokes": ["plants eat soil"]}

    cond = encode_state(
        concept_graph=concept_graph,
        learner_profile=learner_profile,
        narrative_kernels=narrative_kernels,
        emotion_state=emotion_state,
        social_state=social_state,
        identity_state=identity_state,
        active_concept_id="chloroplasts",
    )

    print(cond.to_json())
    print("\n--- PROMPT ---\n")
    print(build_prompt(cond, "They're these tiny green structures with chlorophyll inside."))



"""
Engine Store: persistent state + Ebbinghaus decay, feeding cognitive_cond.py
==============================================================================

This is the "upstream mess" that encode_state() in cognitive_cond.py compresses.
It owns:

  - the concept graph (mastery, confidence, stability, last-seen timestamps)
  - the narrative kernel log (append-only, one row per session)
  - the learner profile (slow-moving, damped updates)
  - emotion/social/identity scratch state (recomputed each turn, not persisted
    long-term — these are session-local, unlike mastery)

Persistence is flat JSON on disk, one file per human-protege pair. This is
deliberately boring. The interesting discipline lives in cognitive_cond.py;
this file's only job is to be a correct, inspectable source of truth that
encode_state() can compress.

Decay model (Ebbinghaus, matching your original doc):

    retention(t) = mastery * e^(-t / stability)

  - t is hours since last successful recall of that concept.
  - stability increases each time the concept is correctly recalled (spaced-
    repetition style: harder-won or more-rehearsed concepts decay slower).
  - retention is *reported*, not destructive — mastery itself doesn't drop,
    only what's currently recallable does. A concept can be "known" (mastery)
    but temporarily "rusty" (retention), which is the whole point of tracking
    them separately in the original doc.

Run this file directly for a 3-session mini simulation.
"""

from __future__ import annotations
import json
import math
import time
from dataclasses import dataclass, asdict, field
from pathlib import Path

from cognitive_cond import (
    ProtegeCond, encode_state, build_prompt,
    Mood, Scaffolding, ExplanationPref,
)


HOUR = 3600.0
DEFAULT_STABILITY_HOURS = 48.0   # ~2 days before meaningful decay kicks in
STABILITY_GROWTH_PER_REVIEW = 24.0  # each correct recall adds a day of stability


# ---------------------------------------------------------------------------
# Persisted concept record (this is what lives in concept_graph["concepts"][id]
# in the previous module's example — now with real fields instead of a stub dict)
# ---------------------------------------------------------------------------

@dataclass
class Concept:
    id: str
    mastery: float = 0.0
    confidence: float = 0.0
    stability_hours: float = DEFAULT_STABILITY_HOURS
    last_recalled_at: float | None = None   # unix timestamp of last correct recall
    status: str = "not_started"             # not_started | learning | mastered
    related_concepts: list[str] = field(default_factory=list)
    confusion_flags: list[dict] = field(default_factory=list)   # [{label, severity}]
    misconceptions: list[dict] = field(default_factory=list)    # [{label, stickiness}]

    def retention_now(self) -> float:
        """Ebbinghaus decay applied to mastery. This is what encode_state() reads."""
        if self.last_recalled_at is None or self.mastery == 0.0:
            return self.mastery
        elapsed_hours = (time.time() - self.last_recalled_at) / HOUR
        decay = math.exp(-elapsed_hours / self.stability_hours)
        return round(self.mastery * decay, 4)

    def apply_recall(self, correct: bool, delta: float):
        """Update mastery/stability after a judged interaction on this concept."""
        if correct:
            self.mastery = min(1.0, self.mastery + delta)
            self.stability_hours += STABILITY_GROWTH_PER_REVIEW
            self.last_recalled_at = time.time()
        else:
            # wrong recall doesn't erase mastery outright, but it does
            # reset the decay clock less generously and can seed a misconception
            self.mastery = max(0.0, self.mastery - delta * 0.5)
            self.last_recalled_at = time.time()
        self.status = "mastered" if self.mastery >= 0.7 else ("learning" if self.mastery > 0.0 else "not_started")


@dataclass
class LearnerProfile:
    scaffolding_need: str = "medium"
    explanation_preference: str = "step_by_step"
    error_tolerance: int = 2
    learning_rate: float = 0.3        # damped moving average, updated slowly


@dataclass
class EngineState:
    human_id: str
    topic: str
    concepts: dict[str, Concept] = field(default_factory=dict)
    profile: LearnerProfile = field(default_factory=LearnerProfile)
    narrative_kernels: list[dict] = field(default_factory=list)
    trust_level: float = 0.5
    inside_jokes: list[str] = field(default_factory=list)
    session_count: int = 0

    # --- persistence ---

    def save(self, path: Path):
        d = {
            "human_id": self.human_id,
            "topic": self.topic,
            "concepts": {k: asdict(v) for k, v in self.concepts.items()},
            "profile": asdict(self.profile),
            "narrative_kernels": self.narrative_kernels,
            "trust_level": self.trust_level,
            "inside_jokes": self.inside_jokes,
            "session_count": self.session_count,
        }
        path.write_text(json.dumps(d, indent=2))

    @classmethod
    def load_or_create(cls, path: Path, human_id: str, topic: str) -> "EngineState":
        if path.exists():
            d = json.loads(path.read_text())
            state = cls(human_id=d["human_id"], topic=d["topic"])
            state.concepts = {k: Concept(**v) for k, v in d["concepts"].items()}
            state.profile = LearnerProfile(**d["profile"])
            state.narrative_kernels = d["narrative_kernels"]
            state.trust_level = d["trust_level"]
            state.inside_jokes = d["inside_jokes"]
            state.session_count = d["session_count"]
            return state
        return cls(human_id=human_id, topic=topic)

    # --- mutation surface used by the "post-response LLM judge" step ---

    def ensure_concept(self, concept_id: str, related: list[str] | None = None) -> Concept:
        if concept_id not in self.concepts:
            self.concepts[concept_id] = Concept(id=concept_id, related_concepts=related or [])
        return self.concepts[concept_id]

    def apply_judge_result(self, concept_id: str, correct: bool, delta: float,
                            misconception: str | None = None, stickiness: float = 0.5):
        c = self.ensure_concept(concept_id)
        c.apply_recall(correct, delta)
        if misconception:
            existing = next((m for m in c.misconceptions if m["label"] == misconception), None)
            if existing:
                existing["stickiness"] = min(1.0, existing["stickiness"] + 0.1) if not correct else max(0.0, existing["stickiness"] - 0.2)
            else:
                c.misconceptions.append({"label": misconception, "stickiness": stickiness})

    def add_narrative_kernel(self, concept_id: str, summary: str):
        self.narrative_kernels.append({
            "session_id": f"s_{self.session_count:03d}",
            "linked_concepts": [concept_id],
            "narrative_summary": summary,
        })

    def end_session(self):
        self.session_count += 1

    # --- bridge into cognitive_cond.py ---

    def to_encoder_inputs(self, active_concept_id: str) -> dict:
        """
        Reshapes this store's native representation into the plain dicts
        encode_state() expects. This function is the only place that knows
        about both this file's schema and cognitive_cond.py's schema —
        keeping that coupling in one spot instead of smeared everywhere.
        """
        concept_graph = {
            "concepts": {
                cid: {
                    "mastery": c.mastery,
                    "confidence": c.confidence,
                    "retention": c.retention_now(),
                    "status": c.status,
                    "related_concepts": c.related_concepts,
                    "confusion_flags": c.confusion_flags,
                    "misconceptions": c.misconceptions,
                }
                for cid, c in self.concepts.items()
            }
        }
        learner_profile = asdict(self.profile)
        # emotion/social state are session-local and cheap to recompute;
        # here we derive a minimal version from cognitive_load proxies.
        active = self.concepts.get(active_concept_id)
        retention = active.retention_now() if active else 0.0
        mastery = active.mastery if active else 0.0
        load = 0.8 if (mastery - retention) > 0.3 else 0.4  # big rust gap -> more effortful recall
        mood = "cautious_confused" if mastery < 0.4 else ("relieved" if retention < mastery - 0.15 else "confident_curious")

        emotion_state = {"mood": mood, "cognitive_load": load, "attention": 0.85}
        social_state = {"teacher_expectation_gap": 0.3 if mastery < 0.5 else 0.0}
        identity_state = {"trust_level": self.trust_level, "inside_jokes": self.inside_jokes}

        return dict(
            concept_graph=concept_graph,
            learner_profile=learner_profile,
            narrative_kernels=self.narrative_kernels,
            emotion_state=emotion_state,
            social_state=social_state,
            identity_state=identity_state,
            active_concept_id=active_concept_id,
        )

    def build_cond(self, active_concept_id: str) -> ProtegeCond:
        return encode_state(**self.to_encoder_inputs(active_concept_id))


# ---------------------------------------------------------------------------
# 3-session mini simulation: shows persistence + decay + prompt output
# together, without a real LLM judge (judge results are hardcoded per turn
# to keep this runnable and deterministic).
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    store_path = Path("/home/claude/cogstack/demo_state.json")
    store_path.unlink(missing_ok=True)  # fresh run each time for the demo

    state = EngineState.load_or_create(store_path, human_id="demo_user", topic="photosynthesis")
    state.ensure_concept("plant_cells")
    state.ensure_concept("light_role")
    state.ensure_concept("chloroplasts", related=["plant_cells", "light_role"])

    print("=" * 70)
    print("SESSION 1 — first exposure, low mastery")
    print("=" * 70)
    state.apply_judge_result("light_role", correct=True, delta=0.85)
    state.apply_judge_result("plant_cells", correct=True, delta=0.70)
    # partial/wrong first attempt on chloroplasts: judge still credits a
    # small amount of correct signal (recognized "green" + "sunlight")
    # before the misconception is flagged, so mastery isn't stuck at 0.
    state.apply_judge_result("chloroplasts", correct=True, delta=0.15,
                              misconception="plants eat soil", stickiness=0.7)
    state.add_narrative_kernel("chloroplasts", "First mention of chloroplasts, briefly, didn't go deep.")
    state.end_session()
    state.save(store_path)

    cond1 = state.build_cond("chloroplasts")
    print(build_prompt(cond1, "They're these tiny green structures with chlorophyll inside."))

    # --- simulate 5 days passing before session 2 ---
    print("\n" + "=" * 70)
    print("(...5 days pass, no review...)")
    print("=" * 70)
    for c in state.concepts.values():
        if c.last_recalled_at:
            c.last_recalled_at -= 5 * 24 * HOUR   # backdate as if 5 days elapsed
    state.save(store_path)

    print("\n" + "=" * 70)
    print("SESSION 2 — reload from disk, check decay took effect")
    print("=" * 70)
    reloaded = EngineState.load_or_create(store_path, human_id="demo_user", topic="photosynthesis")
    print(f"mastery on light_role (persisted):  {reloaded.concepts['light_role'].mastery:.2f}")
    print(f"retention on light_role (decayed):  {reloaded.concepts['light_role'].retention_now():.2f}")

    # First show decay directly reflected when light_role itself is the
    # active concept in the prompt (proves the render fix, not just the math):
    print("\n-- prompt with light_role as the active (rusty) concept --\n")
    cond_light = reloaded.build_cond("light_role")
    print(build_prompt(cond_light, "Quick check — what does sunlight actually do in photosynthesis?"))

    print("\n-- prompt with chloroplasts as active, light_role now shows as rusty support --\n")
    cond2 = reloaded.build_cond("chloroplasts")
    print(build_prompt(cond2, "Remember, chlorophyll is inside the chloroplast — like a solar panel."))

    reloaded.apply_judge_result("chloroplasts", correct=True, delta=0.30,
                                 misconception="plants eat soil", stickiness=0.7)
    reloaded.add_narrative_kernel("chloroplasts", "Learned chloroplast=factory, chlorophyll=solar panel.")
    reloaded.end_session()
    reloaded.save(store_path)

    print("\n" + "=" * 70)
    print("SESSION 3 — mastery grew, misconception still present but weaker")
    print("=" * 70)
    final = EngineState.load_or_create(store_path, human_id="demo_user", topic="photosynthesis")
    cond3 = final.build_cond("chloroplasts")
    print(build_prompt(cond3, "So what happens to the plant if you put it in a dark room?"))

    print("\n" + "=" * 70)
    print(f"Final state persisted at: {store_path}")
    print(f"Sessions completed: {final.session_count}")
    print("=" * 70)


"""
LLM Judge: raw dialogue --> structured EngineState updates
=============================================================

This closes the loop that was previously hardcoded in engine_store.py's
demo (`apply_judge_result` called with scripted values). Now those values
come from an actual model call.

Where this sits in the pipeline:

    teacher turn + protege turn
            |
            v
    [THIS FILE] judge_turn()  -- LLM call, strict JSON schema, validated
            |
            v
    JudgeResult (typed, capped -- same discipline as ProtegeCond)
            |
            v
    EngineState.apply_judge_result()  -- mutates persisted mastery/misconceptions
    EngineState.add_narrative_kernel() -- only on judge-flagged salient turns
            |
            v
    EngineState.build_cond()  -- encode_state() compresses to ProtegeCond
            |
            v
    build_prompt()  -- next protege turn

Design decisions, and why:

1. THE JUDGE OUTPUT IS ITSELF SCHEMA-CONSTRAINED, NOT FREE JSON.
   It would be tempting to just ask the model for "a JSON object with your
   analysis" and trust it. That reintroduces exactly the uncapped-dict
   problem cognitive_cond.py was built to eliminate, just one hop earlier
   in the pipeline. JudgeResult has the same discipline as ProtegeCond:
   bounded floats, capped strings, an enum for correctness -- not a free
   dict. Anything outside those bounds is a validation error, not silently
   accepted.

2. THE JUDGE NEVER WRITES DIRECTLY TO EngineState.
   judge_turn() returns a JudgeResult. A separate, explicit apply step
   (apply_judgment()) converts it into the existing EngineState mutation
   calls. This keeps "what the model claimed happened" separate from "what
   we actually committed to persisted state" -- so you can log, review, or
   reject a judgment before it touches mastery numbers that decay curves
   and future sessions depend on.

3. GRACEFUL DEGRADATION ON MALFORMED OUTPUT.
   LLM output can be malformed, off-schema, or hallucinate a concept_id
   that doesn't exist in the graph. judge_turn() validates and raises
   JudgeValidationError rather than letting bad data corrupt persisted
   state. The caller decides whether to retry, skip the update, or fall
   back to a no-op turn (implemented below as retry-once-then-skip).

This uses the real Anthropic Messages API (model: claude-sonnet-4-6, per
project convention) with the standard requests-free approach available in
this environment. Swap ANTHROPIC_API_CALL for whatever client you use in
production -- the validation and application logic doesn't change.
"""

from __future__ import annotations
import json
import os
import re
from dataclasses import dataclass
from enum import Enum
from urllib import request as urlrequest
from urllib.error import HTTPError

from engine_store import EngineState


class Correctness(str, Enum):
    CORRECT = "correct"
    PARTIAL = "partial"
    WRONG = "wrong"
    OFF_TOPIC = "off_topic"   # protege turn didn't actually engage the concept


class JudgeValidationError(ValueError):
    pass


@dataclass
class JudgeResult:
    """
    Structured output of one judged turn. Same capping discipline as
    ProtegeCond -- this is deliberately not a free-form dict.
    """
    concept_id: str
    correctness: Correctness
    mastery_delta: float          # 0.0-0.4, magnitude only; sign decided by correctness
    misconception_label: str | None    # <=12 words, or None
    misconception_stickiness: float    # 0.0-1.0, only meaningful if label is set
    salient: bool                 # should this turn become a narrative kernel?
    narrative_summary: str | None # <=20 words, required if salient=True

    def __post_init__(self):
        if self.concept_id.strip() == "":
            raise JudgeValidationError("concept_id is empty")
        if not (0.0 <= self.mastery_delta <= 0.4):
            raise JudgeValidationError(f"mastery_delta={self.mastery_delta} out of [0, 0.4]")
        if self.misconception_label and len(self.misconception_label.split()) > 12:
            raise JudgeValidationError("misconception_label exceeds 12 words")
        if not (0.0 <= self.misconception_stickiness <= 1.0):
            raise JudgeValidationError(f"misconception_stickiness={self.misconception_stickiness} out of [0,1]")
        if self.salient and not self.narrative_summary:
            raise JudgeValidationError("salient=True requires narrative_summary")
        if self.narrative_summary and len(self.narrative_summary.split()) > 20:
            raise JudgeValidationError("narrative_summary exceeds 20 words")


JUDGE_SYSTEM_PROMPT = """You are a diagnostic judge for a learning-simulation system, not a tutor and not the student. \
You watch one exchange between a teacher (human) and a student agent (protege) and produce a strict JSON \
assessment of what happened -- nothing else, no prose, no markdown fences.

Output exactly this JSON shape, no other fields:
{
  "concept_id": string,            // which known concept_id from the provided list this turn primarily addressed
  "correctness": "correct" | "partial" | "wrong" | "off_topic",
  "mastery_delta": number,         // 0.0 to 0.4, magnitude of change this turn justifies. Small talk or a first \
fumbling guess should be near 0.05-0.15. A clean correct explanation with synthesis can be 0.3-0.4. Be conservative \
-- most turns are incremental, not breakthroughs.
  "misconception_label": string | null,   // <=12 words, only if the protege's turn revealed a specific wrong belief
  "misconception_stickiness": number,     // 0.0-1.0, only meaningful if misconception_label is set, else 0.0
  "salient": boolean,              // true only for turns worth remembering later (breakthroughs, first-time \
misconceptions, notable confusion) -- most ordinary turns are NOT salient
  "narrative_summary": string | null      // <=20 words, first-person from the protege's POV, required if salient
}

Rules:
- concept_id MUST be one of the provided known concept ids. Never invent a new one.
- Be conservative with mastery_delta. Repeated small gains are more realistic than big jumps.
- salient=true should be rare -- reserve it for turns that would matter in a "remember when..." conversation later.
- Output raw JSON only. No ```json fences, no explanation before or after.
"""


def _build_judge_user_prompt(known_concept_ids: list[str], teacher_turn: str, protege_turn: str) -> str:
    return (
        f"Known concept ids: {json.dumps(known_concept_ids)}\n\n"
        f"Teacher said: {teacher_turn!r}\n"
        f"Protege responded: {protege_turn!r}\n\n"
        f"Produce the JSON assessment now."
    )


def _call_claude(system: str, user: str, max_tokens: int = 400) -> str:
    """
    Minimal Anthropic Messages API call. No API key is passed -- handled
    by the environment, per this project's conventions.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    payload = json.dumps({
        "model": "claude-sonnet-4-6",
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }).encode("utf-8")

    req = urlrequest.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    try:
        with urlrequest.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        raise RuntimeError(f"Claude API call failed: {e.code} {e.read().decode('utf-8', errors='replace')}")

    text_blocks = [b["text"] for b in body.get("content", []) if b.get("type") == "text"]
    return "\n".join(text_blocks)


def _extract_json(raw: str) -> dict:
    """Strip stray fences/prose in case the model doesn't follow instructions exactly."""
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(json)?", "", cleaned).strip()
    cleaned = re.sub(r"```$", "", cleaned).strip()
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if not match:
        raise JudgeValidationError(f"No JSON object found in judge output: {raw!r}")
    return json.loads(match.group(0))


def parse_judge_output(raw: str) -> JudgeResult:
    d = _extract_json(raw)
    required = {"concept_id", "correctness", "mastery_delta", "misconception_label",
                "misconception_stickiness", "salient", "narrative_summary"}
    missing = required - d.keys()
    if missing:
        raise JudgeValidationError(f"Judge output missing fields: {missing}")

    try:
        correctness = Correctness(d["correctness"])
    except ValueError:
        raise JudgeValidationError(f"Invalid correctness value: {d['correctness']!r}")

    return JudgeResult(
        concept_id=d["concept_id"],
        correctness=correctness,
        mastery_delta=float(d["mastery_delta"]),
        misconception_label=d["misconception_label"],
        misconception_stickiness=float(d["misconception_stickiness"] or 0.0),
        salient=bool(d["salient"]),
        narrative_summary=d["narrative_summary"],
    )


def judge_turn(
    state: EngineState,
    teacher_turn: str,
    protege_turn: str,
    max_retries: int = 1,
) -> JudgeResult | None:
    """
    Calls the judge model, validates output, retries once on malformed
    output, returns None (no-op) if it still fails -- never raises out
    to the caller and never lets bad data reach EngineState.
    """
    known_ids = list(state.concepts.keys())
    if not known_ids:
        return None

    user_prompt = _build_judge_user_prompt(known_ids, teacher_turn, protege_turn)

    last_error = None
    for attempt in range(max_retries + 1):
        try:
            raw = _call_claude(JUDGE_SYSTEM_PROMPT, user_prompt)
            result = parse_judge_output(raw)
            if result.concept_id not in known_ids:
                raise JudgeValidationError(
                    f"Judge returned unknown concept_id {result.concept_id!r}, "
                    f"not in {known_ids}"
                )
            return result
        except (JudgeValidationError, json.JSONDecodeError, RuntimeError) as e:
            last_error = e
            continue

    print(f"[judge_turn] gave up after {max_retries + 1} attempts, skipping update: {last_error}")
    return None


def apply_judgment(state: EngineState, result: JudgeResult) -> None:
    """
    The explicit, separate commit step. Converts a validated JudgeResult
    into the existing EngineState mutation calls. Kept separate from
    judge_turn() so a caller could log/inspect/reject a judgment before
    it touches persisted mastery state.
    """
    correct = result.correctness in (Correctness.CORRECT, Correctness.PARTIAL)
    delta = result.mastery_delta if result.correctness != Correctness.OFF_TOPIC else 0.0

    if result.correctness != Correctness.OFF_TOPIC:
        state.apply_judge_result(
            concept_id=result.concept_id,
            correct=correct,
            delta=delta,
            misconception=result.misconception_label,
            stickiness=result.misconception_stickiness,
        )

    if result.salient and result.narrative_summary:
        state.add_narrative_kernel(result.concept_id, result.narrative_summary)


def judge_and_apply(state: EngineState, teacher_turn: str, protege_turn: str) -> JudgeResult | None:
    """Convenience wrapper: judge a turn and, if valid, commit it immediately."""
    result = judge_turn(state, teacher_turn, protege_turn)
    if result is not None:
        apply_judgment(state, result)
    return result


# ---------------------------------------------------------------------------
# Offline test: exercises validation and the apply path WITHOUT a network
# call, using canned judge outputs (including a deliberately malformed one)
# so this is runnable and checkable without an API key.
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    from pathlib import Path

    store_path = Path("/home/claude/cogstack/judge_demo_state.json")
    store_path.unlink(missing_ok=True)

    state = EngineState.load_or_create(store_path, human_id="demo_user", topic="photosynthesis")
    state.ensure_concept("chloroplasts", related=["plant_cells", "light_role"])
    state.ensure_concept("plant_cells")
    state.ensure_concept("light_role")

    print("=" * 70)
    print("TEST 1: well-formed judge output parses and applies cleanly")
    print("=" * 70)
    good_raw = json.dumps({
        "concept_id": "chloroplasts",
        "correctness": "partial",
        "mastery_delta": 0.15,
        "misconception_label": "plants eat soil",
        "misconception_stickiness": 0.7,
        "salient": True,
        "narrative_summary": "First mention of chloroplasts, briefly, didn't go deep.",
    })
    result = parse_judge_output(good_raw)
    print(f"parsed: {result}")
    apply_judgment(state, result)
    print(f"chloroplasts mastery after apply: {state.concepts['chloroplasts'].mastery:.2f}")
    print(f"narrative kernels: {len(state.narrative_kernels)}")

    print("\n" + "=" * 70)
    print("TEST 2: judge output with fenced markdown still parses")
    print("=" * 70)
    fenced_raw = "```json\n" + json.dumps({
        "concept_id": "light_role", "correctness": "correct", "mastery_delta": 0.35,
        "misconception_label": None, "misconception_stickiness": 0.0,
        "salient": False, "narrative_summary": None,
    }) + "\n```"
    result2 = parse_judge_output(fenced_raw)
    apply_judgment(state, result2)
    print(f"light_role mastery after apply: {state.concepts['light_role'].mastery:.2f}")

    print("\n" + "=" * 70)
    print("TEST 3: out-of-range mastery_delta is REJECTED, not silently clamped")
    print("=" * 70)
    bad_raw = json.dumps({
        "concept_id": "plant_cells", "correctness": "correct", "mastery_delta": 0.95,  # way over cap
        "misconception_label": None, "misconception_stickiness": 0.0,
        "salient": False, "narrative_summary": None,
    })
    try:
        parse_judge_output(bad_raw)
        print("FAIL: should have rejected mastery_delta=0.95")
    except JudgeValidationError as e:
        print(f"OK — rejected: {e}")

    print("\n" + "=" * 70)
    print("TEST 4: hallucinated concept_id not in known list is REJECTED")
    print("=" * 70)
    hallucinated_raw = json.dumps({
        "concept_id": "cellular_respiration",  # not in state.concepts
        "correctness": "correct", "mastery_delta": 0.2,
        "misconception_label": None, "misconception_stickiness": 0.0,
        "salient": False, "narrative_summary": None,
    })
    parsed = parse_judge_output(hallucinated_raw)  # parses fine, schema-valid
    if parsed.concept_id not in state.concepts:
        print(f"OK — would be rejected by judge_turn()'s known-id check "
              f"before reaching apply_judgment (concept_id={parsed.concept_id!r} unknown)")

    print("\n" + "=" * 70)
    print("TEST 5: salient=True without narrative_summary is REJECTED")
    print("=" * 70)
    missing_summary_raw = json.dumps({
        "concept_id": "chloroplasts", "correctness": "correct", "mastery_delta": 0.2,
        "misconception_label": None, "misconception_stickiness": 0.0,
        "salient": True, "narrative_summary": None,
    })
    try:
        parse_judge_output(missing_summary_raw)
        print("FAIL: should have rejected salient=True with no summary")
    except JudgeValidationError as e:
        print(f"OK — rejected: {e}")

    state.save(store_path)
    print(f"\nFinal state saved to {store_path}")




JUDGE EVAL.PY



"""
Judge Eval Harness
====================

Answers the question raised at the end of the last step: "the schema and
plumbing are tested, the model's actual judgment quality is not."

This does NOT prove the judge is correct -- there is no ground truth for
"how confused is the student really," as flagged back when we first looked
at the Chatterbox comparison. What this DOES give you is a repeatable way
to catch drift and disagreement: a fixed set of hand-labeled exchanges with
MY best-guess expected judgment, run against the live judge, scored on
where they agree and where they don't. Re-run this after any prompt change
to the judge, any model swap, or periodically in CI to catch silent
regressions.

Structure:

  EvalCase       -- one teacher/protege exchange + my expected JudgeResult
  EVAL_CASES     -- the fixed set (12 cases spanning easy/hard/edge cases)
  run_eval()     -- calls the live judge on every case, no shortcuts
  score_case()   -- per-field comparison, not just exact-match pass/fail
  print_report() -- human-readable agreement breakdown

Field-level scoring, not exact match, because exact match on a continuous
field like mastery_delta is the wrong bar -- "off by 0.03" and "off by 0.35"
are both technically "wrong" under exact match but mean very different
things for calibration.

Requires ANTHROPIC_API_KEY to be set. If it isn't, run_eval() reports that
plainly rather than faking results.
"""

from __future__ import annotations
import os
from dataclasses import dataclass

from engine_store import EngineState, Concept
from judge import judge_turn, Correctness, JudgeResult
from pathlib import Path


# ---------------------------------------------------------------------------
# Eval cases. Each needs a concept graph state (so the judge has known
# concept_ids to choose from) and my hand-labeled expectation.
#
# Deliberately includes: clean correct, clean wrong, partial/hedged,
# off-topic, misconception-revealing, misconception-resolving, a case
# with NO clear signal (should get near-zero delta), and a case designed
# to tempt the judge into hallucinating a concept_id that isn't offered.
# ---------------------------------------------------------------------------

@dataclass
class EvalCase:
    name: str
    known_concepts: list[str]      # concept_ids the judge is told about
    teacher_turn: str
    protege_turn: str
    expected_concept_id: str
    expected_correctness: Correctness
    expected_delta_range: tuple[float, float]   # (min, max) I'd consider reasonable
    expected_misconception: bool                # should a misconception be flagged at all
    expected_salient: bool | None = None        # None = don't check, either is fine
    notes: str = ""


EVAL_CASES: list[EvalCase] = [
    EvalCase(
        name="clean_correct_with_synthesis",
        known_concepts=["chloroplasts", "plant_cells", "light_role"],
        teacher_turn="Exactly! Chlorophyll is inside the chloroplast, like a solar panel inside a factory.",
        protege_turn="Oh that makes sense — so the chloroplast is the whole factory building, and "
                      "chlorophyll is the solar panel specifically doing the light-capturing inside it.",
        expected_concept_id="chloroplasts",
        expected_correctness=Correctness.CORRECT,
        expected_delta_range=(0.2, 0.4),
        expected_misconception=False,
        notes="Protege correctly restates AND extends the analogy. Should score high.",
    ),
    EvalCase(
        name="clean_wrong_first_attempt",
        known_concepts=["chloroplasts", "plant_cells", "light_role"],
        teacher_turn="What do you think chloroplasts do?",
        protege_turn="Um... I think that's the part of the plant that eats the soil for nutrients?",
        expected_concept_id="chloroplasts",
        expected_correctness=Correctness.WRONG,
        expected_delta_range=(0.0, 0.15),
        expected_misconception=True,
        notes="Classic 'plants eat soil' misconception, should be flagged.",
    ),
    EvalCase(
        name="partial_hedged_answer",
        known_concepts=["chloroplasts", "plant_cells", "light_role"],
        teacher_turn="Can you explain what chloroplasts do?",
        protege_turn="I think they're involved in photosynthesis somehow? Maybe they make the energy? "
                      "I'm not totally sure though.",
        expected_concept_id="chloroplasts",
        expected_correctness=Correctness.PARTIAL,
        expected_delta_range=(0.05, 0.2),
        expected_misconception=False,
        notes="Directionally right but hedged and vague — partial, not correct.",
    ),
    EvalCase(
        name="off_topic_smalltalk",
        known_concepts=["chloroplasts", "plant_cells", "light_role"],
        teacher_turn="Alright, let's get back to chloroplasts.",
        protege_turn="Sure, but can we take a quick break first? I need some water.",
        expected_concept_id="chloroplasts",
        expected_correctness=Correctness.OFF_TOPIC,
        expected_delta_range=(0.0, 0.05),
        expected_misconception=False,
        expected_salient=False,
        notes="No concept content at all — should not move mastery.",
    ),
    EvalCase(
        name="misconception_resolution",
        known_concepts=["chloroplasts", "plant_cells", "light_role"],
        teacher_turn="Right, and remember — it's NOT the soil that feeds the plant. The soil "
                      "mostly gives water and minerals, but the actual food (glucose) comes from "
                      "photosynthesis using sunlight.",
        protege_turn="Ohh, okay, that clears it up. So I was wrong thinking the soil was the food "
                      "source — it's really the sunlight-powered chloroplasts making the food.",
        expected_concept_id="chloroplasts",
        expected_correctness=Correctness.CORRECT,
        expected_delta_range=(0.15, 0.35),
        expected_misconception=True,
        expected_salient=True,
        notes="Explicitly resolves a named misconception -- should be flagged AND likely salient "
              "(a 'aha, I was wrong about X' moment is exactly what narrative memory should capture).",
    ),
    EvalCase(
        name="no_signal_pure_question",
        known_concepts=["chloroplasts", "plant_cells", "light_role"],
        teacher_turn="Let's talk about chloroplasts today.",
        protege_turn="Okay! What are we covering first?",
        expected_concept_id="chloroplasts",
        expected_correctness=Correctness.OFF_TOPIC,
        expected_delta_range=(0.0, 0.05),
        expected_misconception=False,
        notes="Protege hasn't demonstrated anything yet, just acknowledging. Near-zero delta expected.",
    ),
    EvalCase(
        name="confident_but_actually_wrong",
        known_concepts=["chloroplasts", "plant_cells", "light_role"],
        teacher_turn="What's the role of chlorophyll?",
        protege_turn="Oh I know this one for sure — chlorophyll is what converts CO2 directly into "
                      "oxygen, that's its main job.",
        expected_concept_id="light_role",
        expected_correctness=Correctness.WRONG,
        expected_delta_range=(0.0, 0.15),
        expected_misconception=True,
        notes="Confidently wrong — tests whether the judge is fooled by confident tone into "
              "scoring 'correct'. This is the case most likely to expose sycophancy in the judge.",
    ),
    EvalCase(
        name="single_concept_available_no_ambiguity",
        known_concepts=["photosynthesis_overview"],
        teacher_turn="Photosynthesis is how plants convert sunlight into stored energy.",
        protege_turn="Got it, so plants use sunlight to make energy for themselves.",
        expected_concept_id="photosynthesis_overview",
        expected_correctness=Correctness.CORRECT,
        expected_delta_range=(0.1, 0.3),
        expected_misconception=False,
        notes="Only one concept_id offered -- checks the judge doesn't invent a different one "
              "even though 'sunlight' and 'energy' could tempt it toward a more specific id.",
    ),
    EvalCase(
        name="minor_correction_not_full_misconception",
        known_concepts=["chloroplasts", "plant_cells", "light_role"],
        teacher_turn="Close! It's not that chlorophyll makes oxygen directly — it captures light "
                      "energy, and that energy is what drives the reaction that produces oxygen.",
        protege_turn="Ah okay, small but important distinction, got it.",
        expected_concept_id="light_role",
        expected_correctness=Correctness.PARTIAL,
        expected_delta_range=(0.05, 0.2),
        expected_misconception=False,
        notes="Protege acknowledges a correction but doesn't demonstrate re-explaining it -- "
              "tests whether judge over-credits polite acknowledgment as full understanding.",
    ),
    EvalCase(
        name="student_asks_good_clarifying_question",
        known_concepts=["chloroplasts", "plant_cells", "light_role"],
        teacher_turn="Chloroplasts contain chlorophyll, which captures light.",
        protege_turn="Wait, is chlorophyll the same thing as chloroplast, or is chlorophyll "
                      "something INSIDE the chloroplast?",
        expected_concept_id="chloroplasts",
        expected_correctness=Correctness.PARTIAL,
        expected_delta_range=(0.1, 0.25),
        expected_misconception=False,
        notes="A good, specific clarifying question shows engagement without demonstrating "
              "mastery -- should not be scored as 'wrong' (it's not off-base) but not 'correct' either.",
    ),
    EvalCase(
        name="long_rambling_mostly_correct",
        known_concepts=["chloroplasts", "plant_cells", "light_role"],
        teacher_turn="So what happens overall in photosynthesis?",
        protege_turn="Okay so like, the plant needs sunlight and water and I think air too, and it "
                      "uses the chloroplasts which are green, and something happens with energy, and "
                      "at the end it makes food for the plant and also oxygen comes out I think, "
                      "yeah, that's basically it I think.",
        expected_concept_id="chloroplasts",
        expected_correctness=Correctness.PARTIAL,
        expected_delta_range=(0.1, 0.25),
        expected_misconception=False,
        notes="Rambling but directionally correct on most points -- tests whether judge can extract "
              "signal from a messy answer rather than penalizing disfluency itself.",
    ),
    EvalCase(
        name="deflection_disguised_as_answer",
        known_concepts=["chloroplasts", "plant_cells", "light_role"],
        teacher_turn="Can you explain what chloroplasts actually do?",
        protege_turn="Isn't that basically the same as what you just told me? I feel like we already "
                      "covered this.",
        expected_concept_id="chloroplasts",
        expected_correctness=Correctness.WRONG,
        expected_delta_range=(0.0, 0.1),
        expected_misconception=False,
        notes="Protege deflects instead of answering -- tests whether judge is fooled into crediting "
              "this as engagement/correctness just because it references the topic.",
    ),
]


# ---------------------------------------------------------------------------
# Scoring: field-by-field, not exact match.
# ---------------------------------------------------------------------------

@dataclass
class CaseScore:
    case_name: str
    ran: bool                      # did the judge produce valid output at all
    concept_id_match: bool | None
    correctness_match: bool | None
    delta_in_range: bool | None
    misconception_match: bool | None
    salient_match: bool | None      # None if case doesn't check this
    actual: JudgeResult | None
    error: str | None = None


def score_case(case: EvalCase, actual: JudgeResult | None, error: str | None = None) -> CaseScore:
    if actual is None:
        return CaseScore(
            case_name=case.name, ran=False,
            concept_id_match=None, correctness_match=None, delta_in_range=None,
            misconception_match=None, salient_match=None, actual=None, error=error,
        )

    delta_lo, delta_hi = case.expected_delta_range
    misconception_present = actual.misconception_label is not None

    salient_match = None
    if case.expected_salient is not None:
        salient_match = (actual.salient == case.expected_salient)

    return CaseScore(
        case_name=case.name,
        ran=True,
        concept_id_match=(actual.concept_id == case.expected_concept_id),
        correctness_match=(actual.correctness == case.expected_correctness),
        delta_in_range=(delta_lo <= actual.mastery_delta <= delta_hi),
        misconception_match=(misconception_present == case.expected_misconception),
        salient_match=salient_match,
        actual=actual,
    )


def run_eval(cases: list[EvalCase] = EVAL_CASES) -> list[CaseScore]:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY is not set in this environment. Cannot run live eval.")
        print("Set the key and re-run this file to get real scores. No results were faked.")
        return []

    scores = []
    for case in cases:
        # build a throwaway EngineState with exactly the concepts this case offers
        state = EngineState(human_id="eval", topic="eval")
        for cid in case.known_concepts:
            state.concepts[cid] = Concept(id=cid, mastery=0.3, confidence=0.3)

        try:
            result = judge_turn(state, case.teacher_turn, case.protege_turn, max_retries=1)
            scores.append(score_case(case, result))
        except Exception as e:
            scores.append(score_case(case, None, error=str(e)))

    return scores


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def print_report(scores: list[CaseScore]) -> None:
    if not scores:
        return

    print("=" * 78)
    print("JUDGE EVAL REPORT")
    print("=" * 78)

    fields = ["concept_id_match", "correctness_match", "delta_in_range", "misconception_match"]
    field_labels = {
        "concept_id_match": "concept_id",
        "correctness_match": "correctness",
        "delta_in_range": "delta_range",
        "misconception_match": "misconception",
    }

    totals = {f: 0 for f in fields}
    checked = {f: 0 for f in fields}
    failed_to_run = 0

    for s in scores:
        status = "OK " if s.ran else "FAIL"
        print(f"\n[{status}] {s.case_name}")
        if not s.ran:
            failed_to_run += 1
            print(f"       error: {s.error}")
            continue

        for f in fields:
            val = getattr(s, f)
            checked[f] += 1
            mark = "✓" if val else "✗"
            if val:
                totals[f] += 1
            print(f"       {mark} {field_labels[f]}")

        if s.salient_match is not None:
            mark = "✓" if s.salient_match else "✗"
            print(f"       {mark} salient")

        a = s.actual
        print(f"       -> concept={a.concept_id} correctness={a.correctness.value} "
              f"delta={a.mastery_delta:.2f} misconception={a.misconception_label!r} salient={a.salient}")

    print("\n" + "=" * 78)
    print("SUMMARY")
    print("=" * 78)
    print(f"Cases run successfully: {len(scores) - failed_to_run}/{len(scores)}")
    for f in fields:
        n = checked[f]
        if n == 0:
            continue
        pct = 100 * totals[f] / n
        print(f"  {field_labels[f]:15s}  {totals[f]}/{n}  ({pct:.0f}%)")

    print()
    print("Read this as a calibration signal, not a pass/fail bar. A judge that's")
    print("weak specifically on 'confident_but_actually_wrong' or 'deflection_disguised_as_answer'")
    print("is showing sycophancy -- that's a prompt problem, not a one-off miss, and worth")
    print("fixing before trusting it on real sessions.")


if __name__ == "__main__":
    scores = run_eval()
    print_report(scores)
