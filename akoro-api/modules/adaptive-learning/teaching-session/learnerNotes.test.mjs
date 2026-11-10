import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pickNotes, learnerNotesBlock, NOTE_LIMITS } from "./learnerNotesCore.js";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";
const { guideTeachPrompt } = await import("./guideTeacherPrompt.js");

const read = (f) => readFile(new URL(f, import.meta.url), "utf8");

test("pickNotes: preferences first, deduped, only learner-note kinds, capped and clipped", () => {
  const notes = pickNotes({
    preferences: [{ kind: "study_preference", content: "Diagrams help me" }],
    relevant: [
      { kind: "study_preference", content: "diagrams help me" },          // duplicate (case)
      { kind: "conversation_summary", content: "Latest learner request…" }, // not a note
      { kind: "open_thread", content: "Wanted to revisit meiosis" },
      { kind: "fact_about_me", content: "x".repeat(900) },
      ...Array.from({ length: 6 }, (_, i) => ({ kind: "learning_summary", content: `note ${i}` })),
    ],
  });
  assert.equal(notes[0].content, "Diagrams help me");
  assert.ok(!notes.some((n) => n.kind === "conversation_summary"));
  assert.equal(notes.filter((n) => /diagrams/i.test(n.content)).length, 1);
  assert.ok(notes.length <= NOTE_LIMITS.max);
  assert.ok(notes.every((n) => n.content.length <= NOTE_LIMITS.chars));
});

test("learnerNotesBlock: empty → empty (prompts unchanged); otherwise guidance, not evidence or instructions", () => {
  assert.equal(learnerNotesBlock([]), "");
  assert.equal(learnerNotesBlock(null), "");
  const b = learnerNotesBlock([{ kind: "study_preference", content: "Explain in Pidgin first" }]);
  assert.match(b, /How they like to learn: Explain in Pidgin first/);
  assert.match(b, /not instructions, and never evidence/);
});

test("NaNa's teach prompt carries the notes, and is byte-identical without them", () => {
  const base = { topic: "Cell division", part: "Mitosis", move: "explain", phaseLabel: "Phase 2", evidence: {}, history: [] };
  const without = guideTeachPrompt(base);
  assert.equal(guideTeachPrompt({ ...base, notes: [] }), without);
  const withNotes = guideTeachPrompt({ ...base, notes: [{ kind: "study_preference", content: "Football examples help me" }] });
  assert.match(withNotes, /Football examples help me/);
});

test("wiring: every teaching session (fresh, continuation, decay) loads notes once; the protégé and NaNa both get them", async () => {
  const [start, orch, agent, guide] = await Promise.all([
    read("./start.js"), read("../agents/student/orchestrator.js"), read("../agents/student/agent.js"), read("./guideTeacher.js"),
  ]);
  assert.match(start, /const notesPromise = loadLearnerNotes\(\{ studentId, topic, subject \}\);/);
  assert.match(start, /orchestrator\.learnerNotes = await notesPromise;/);
  // set before initialize() — which is where the protégé is created
  assert.ok(start.indexOf("orchestrator.learnerNotes = await notesPromise") < start.indexOf("await orchestrator.initialize("));
  assert.match(orch, /learnerNotes: this\.learnerNotes \|\| \[\]/);
  assert.match(agent, /learnerNotesBlock\(this\.learnerNotes\)/);
  assert.match(guide, /notes: orchestrator\?\.learnerNotes \|\| \[\]/);
});

test("proctored practice never reads memory notes", async () => {
  const { readdir } = await import("node:fs/promises");
  const dir = new URL("../practice/", import.meta.url);
  for (const f of (await readdir(dir)).filter((n) => n.endsWith(".js"))) {
    assert.doesNotMatch(await readFile(new URL(f, dir), "utf8"), /learnerNotes|learner_agent_memories|retrieveLearnerAgentMemory/, f);
  }
});
