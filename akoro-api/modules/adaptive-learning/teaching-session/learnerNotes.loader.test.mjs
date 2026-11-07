import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";
const { loadLearnerNotes } = await import("./learnerNotes.js");

test("loadLearnerNotes: uses retrieved notes (not chat summaries); a failure or no learner → []", async () => {
  const retrieve = async () => ({ memories: [
    { source: "memory", kind: "open_thread", content: "Wanted to revisit meiosis" },
    { source: "conversation_summary", kind: "conversation_summary", content: "Earlier the learner asked…" },
  ] });
  const preferences = async () => [{ kind: "study_preference", content: "Diagrams help me" }];
  const notes = await loadLearnerNotes({ studentId: "00000000-0000-4000-8000-000000000000", topic: "Meiosis", retrieve, preferences });
  assert.equal(notes[0].content, "Diagrams help me", "preferences come first");
  assert.ok(notes.some((n) => n.content === "Wanted to revisit meiosis"));
  assert.ok(!notes.some((n) => n.kind === "conversation_summary"));
  assert.deepEqual(await loadLearnerNotes({ studentId: null, topic: "x", retrieve }), []);
  assert.deepEqual(await loadLearnerNotes({ studentId: "u", topic: "x", retrieve: async () => { throw new Error("down"); }, preferences: async () => { throw new Error("down"); } }), []);
});
