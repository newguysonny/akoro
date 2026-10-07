# Akoro Context Layer — Architecture Folder Review

**Question asked:** can the prepared `modules/adaptive-learning/architecture/` docs (soul stack, cognitive
engine, heartbeat, etc.) be used as context files, adopted into the harness so adaptive-learning teaching
can use them?

**Verdict: yes — heavily — but as *distilled doctrine*, not as copied documents.** The folder's own audit
(`ARCHITECTURE_AUDIT-2026-09-07.md`, the best entry point) already drew the right line: *"adopt its core
discipline… do not copy the sketches directly."* The engineering half of these docs is largely **already
built** in our study-prep/exam-prep work; the **doctrine half was never adopted anywhere** — and that is
exactly what the `akoro-agent/` workspace is for. The brain map from the mini-plan (§3.2) gets its source
material from this folder instead of being written from scratch.

---

## 1. What the folder contains, doc by doc

| Doc | What it is | Adopt as doctrine? | Seeds |
|---|---|---|---|
| `ARCHITECTURE_AUDIT-2026-09-07.md` | Reconciliation of the whole folder; 5 standing design decisions | **Index of the folder** — its decisions become standing constraints (§4 below) | — |
| `Cognitive-Engine-and-soul.md` (99 KB) | Protégé cognitive engine: RAG = textbook, cognitive state = brain, LLM renders through that lens | **Yes — core** | `agents/STUDENT_AGENT.md`, `learning/ADAPTATION.md` |
| `akoro-protege-agent…(complete-soul-stack, tracking).md` (20 KB) | 26-component inventory: Tier 1 cognitive, Tier 2 soul, Guardian Angel, Concept Tracker | **Yes — core** | `agents/STUDENT_AGENT.md`, `learning/MASTERY.md`, `policies/TEACHING_VALIDATION.md` (new file) |
| `Soul-Stack-Validation-Suite.md` (85 KB) | HTML prototype: 6 lifecycle scenarios (cold start, 5-day gap, breakthrough, frustration, relapse, mature) | **Yes — as eval fixtures + behaviour doctrine** | eval fixtures; `learning/ADAPTATION.md`, `learning/MOTIVATION.md` |
| `akoro-autonomous-agent-architecture(automations,heartbeat,lanes).md` | Proactive loop: monitor → decide → schedule → act → record → repeat; lanes, suppression, authority boundaries | **Yes — bounded by the autonomy contract** | `autonomy/HEARTBEAT.md`, `autonomy/NUDGES.md` |
| `akoro-autonomous-agent-architecture(research,plan,act pattern).md` | Research (read-only) → Plan → Act, with the low-stakes/consequential split | **Yes** | `reasoning/PLANNING.md` (extend), `policies/HITL_DRAFTS.md` |
| `akoro-agent-upgrade-plan(tools,skills,workflow).md` | Tools/skills/workflows + a **System Prompt Assembly spec** | **Yes — the assembly spec is a pre-written P0/P1 design** | manifest set design, `channels/CHAT.md`, `policies/HITL_DRAFTS.md` |
| `Updated tracking dimensions.md` | Attention span, reasoning quality, fatigue (`effective = base × (0.3 + attention×0.7) × (1 − difficulty/10)`) | **Doctrine yes, implementation deferred** (audit: only after calibrated baseline) | `learning/MASTERY.md`, `learning/PACE.md` |
| `Akoro-Exam-Prep-Confidence-Loop.md` | Diagnostic → teach-back → retest loop | **Already BUILT** (exam-prep service); its teach-back rationale is doctrine | `reasoning/METACOGNITION.md` |
| `REFINED ARCHITECTURE - COMPARISON WITH TEXT TO SPEECH.md` (60 KB) | `ProtegeCond`: bounded typed conditioning, ENCODE/RENDER seam | **Engineering spec, not a doc file** — informs the P2 condition encoder + manifest | manifest design (typed, bounded, versioned) |

## 2. The engineering half is already built (don't rebuild it)

The audit's Phase 0/1/4 asks versus what the study-prep build shipped:

| Audit asked for | Status in our build |
|---|---|
| `concept_catalog` + `concept_edges` (approved concepts, prerequisites, provenance) | ✅ exists (approved) |
| `learner_concept_state` (mastery 0–1, per learner/concept) | ✅ exists |
| Immutable evidence trail (model judgment never overwrites state untraceably) | ✅ `learner_concept_evidence` |
| Exam-Prep Confidence Loop (diagnostic → teach-back → retest, capped attempts) | ✅ exam-prep service + confidence loop |
| Durable workflow state, not scratchpad | ✅ study-prep sessions + events |
| Research → Plan → Act with explicit confirmation gates | ✅ study-prep agent loop (the harness gates) |
| Bounded conditioning (no unbounded transcript into state) | ✅ context-manager's doctrine/dynamic separation |

**The conclusion this licenses:** the workspace files can be written from *real implemented behaviour*
plus this folder's distilled intent — not from aspirational pseudo-code. That matters for D1: doctrine
describes what the system actually does and enforces.

## 3. The doctrine adoption map (the actual answer)

**`agents/STUDENT_AGENT.md`** — the richest adoption. From `Cognitive-Engine-and-soul.md`:
- **State-conditioned generation, not roleplay**: the protégé responds *through* its cognitive state
  (mastery vector, confusion flags, decayed retention, persona), never as a generic helpful student.
  "Do NOT demonstrate full understanding" when mastery is low — the LLM default is overconfidence;
  explicit state variables are the only reliable constraint.
- **One knowledge-state store, two personas reading from it** (the soul-stack doc's own pattern note):
  tutor-agent explains/quizzes off the same `learner_concept_state` the protégé narrates from. Never a
  parallel mastery model for the protégé.
- Calibrated confidence, characteristic mistakes tied to *known* misconceptions, hesitation after decay
  gaps — all renderable from existing state.

**`learning/MASTERY.md`** — the Concept Tracker's status vocabulary is doctrine-grade and matches our
schema: `not_started | introduced | learning | confused | understood | mastered | needs_review`, plus
"resume precisely instead of re-diagnosing cold" (the `resume_point` principle — already how study-prep
sessions restore). Tracking-dimensions principles (attention, fatigue, reasoning quality) get one honest
paragraph as *future signals*, implementation deferred per the audit.

**`policies/TEACHING_VALIDATION.md`** (new file — Guardian Angel doctrine, honest variant) — from the
soul-stack doc's 6 layers, keeping the mechanism and **changing the framing** (§5): a false claim never
enters durable knowledge; the protégé's response strategy scales with its own mastery/confidence (high →
"I thought it was different…"; low → plain clarification request); post-session consistency checks;
`verified | contradicted | uncertain` recorded separately from the protégé's apparent answer; checks
limited to approved curriculum material — never autonomous open-web self-teaching.

**`autonomy/HEARTBEAT.md`** — from the automations/heartbeat doc: the monitor → decide → schedule → act →
record → repeat loop ("Akoro doesn't wait for you to ask what to learn next. It identifies what it is
forgetting, what it is weak at, and what it should practice next."), **bounded to the learner-autonomy
contract**: opt-in while Online, due-time-only, one proactive chat, no task modification. `NUDGES.md`
takes quiet hours, one-nudge-at-a-time, notification suppression.

**`reasoning/PLANNING.md`** (extend) — from research/plan/act: research is read-only and parallel; the
**low-stakes/consequential split** (plan and act may collapse for `explain_concept`/`quiz_me`; anything
that spends coins or submits a grade shows its plan and waits); progress is **status visibility, never
chain-of-thought** (`researching`, `quiz_ready`, `assessment_recorded`).

**`reasoning/METACOGNITION.md`** — from the exam-prep doc's rationale: teach-back forces active retrieval
and exposes gaps a passive re-read hides (protégé effect / Feynman technique); the agent's genuine
confusion when warranted *is* the assessment signal.

**`learning/ADAPTATION.md` + `learning/MOTIVATION.md`** — from the six validation scenarios: the
frustration scenario (de-escalate, shrink the step, win small) and the relapse scenario (a regression is
data, not a failure — revisit, don't punish) are exactly the adaptation and motivation doctrine we mapped;
the scenarios double as **eval fixtures** (audit Phase 0: assert on structured state + policy decisions,
evaluate wording separately by rubric — same split as our deliberate-narration snapshots).

**Manifest/set design (P0/P1)** — from the upgrade plan's System Prompt Assembly spec, which reads like a
pre-written version of our selection-set doctrine: always-injected environment block (learner context,
current date, the workflow pointer so the model knows its own scope); skills listed **by description and
loaded on demand**, never the full registry as free choice; per-workflow authority reminders when
entering a consequential Act phase. This validates the manifest design and hands us the `chat_student`
set's contents.

## 4. Standing constraints adopted from the audit (all five already honoured)

1. **LLM output is observation, never ground truth** — evidence tables, deterministic transitions.
2. **No manufactured mistakes, emotion, or consciousness** — bounded, seedable variability only; never
   knowingly false academic content; never pretend human feelings, especially to minors.
3. **Two profiles, never conflated** — teaching-partner preferences vs learner study preferences.
4. **Autonomy boundaries preserved** — heartbeat doctrine is bounded by the existing policy.
5. **No chain-of-thought as progress** — status visibility only.

## 5. Rejected (with reasons — do not adopt even into doctrine)

- **"Stealth correction" / "never admit it's validating"** (Guardian Angel as specified). The soul-stack
  doc itself flags this as a founder-level call for a minors' product. **Recommendation: the honest
  middle path** — the protégé genuinely asks clarifying questions when it detects a mismatch (honest
  behaviour, not a performance), which preserves the pedagogy without concealed corrective AI aimed at
  children. Adopted in §3 on this basis; **founder confirmation pending**.
- **Neo4j/Memgraph, local JSON persistence** — rejected by the audit; Postgres + pgvector stands.
- **Broad autonomous actions** (self-battles, autonomous task creation, open-web self-teaching) — outside
  the learner-autonomy contract.
- **BKT/DKT knowledge tracing now** — audit: conservative simple tracing until baseline data proves the
  complexity is worthwhile.
- **The HTML prototypes as-is** — the scenarios convert to fixtures; the demo pages stay reference.

## 6. Effect on the mini-plan

- §3.2 brain map gains **`policies/TEACHING_VALIDATION.md`** (≈38 files) and every file listed in §3
  above now has a named source document.
- **P0/P1 authoring is materially cheaper**: the upgrade plan's assembly spec pre-writes the manifest/
  `chat_student` design; HEARTBEAT, STUDENT_AGENT, PLANNING, METACOGNITION, ADAPTATION, MOTIVATION,
  MASTERY, TEACHING_VALIDATION all distil from reviewed material rather than being written cold.
- **New eval fixtures**: the six lifecycle scenarios join the deliberate-narration snapshot pattern and
  `lib/evals` as the doctrine regression suite (assert on state/policy; rubric the wording).
- The architecture folder stays where it is, untouched, as source material; the audit remains its index.
