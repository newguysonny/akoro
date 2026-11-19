import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";

const { resolveSessionDocument, groundTurn, passagesAsReference, citationsForReply } = await import("./documentGrounding.js");
const ws = await readFile(new URL("../realtime/websocket.js", import.meta.url), "utf8");
const sessionStart = await readFile(new URL("../teaching-session/start.js", import.meta.url), "utf8");
const agent = await readFile(new URL("../agents/student/agent.js", import.meta.url), "utf8");

const passages = [
  { n: 1, kind: "block", pageNumber: 3, bbox: [50, 100, 950, 300], startMs: null, endMs: null, text: "Photosynthesis converts light energy into chemical energy." },
  { n: 2, kind: "transcript", pageNumber: null, bbox: null, startMs: 725000, endMs: 760000, text: "Enzymes lower activation energy." },
];

test("the session's document is resolved for the AUTHENTICATED learner, and never throws", async () => {
  let asked = null;
  const ok = await resolveSessionDocument({ userId: "u1", document: { contentKey: "records/o/file.pdf" }, resolve: async (a) => { asked = a; return { recordId: "r", ownerId: "o", contentKey: "records/o/file.pdf", name: "Bio" }; } });
  assert.deepEqual(asked, { userId: "u1", contentKey: "records/o/file.pdf" });
  assert.equal(ok.recordId, "r");
  assert.equal(await resolveSessionDocument({ userId: "u1", document: { recordId: "x" }, resolve: async () => ({ status: 404, message: "Record not found." }) }), null, "no access → no grounding");
  assert.equal(await resolveSessionDocument({ userId: "u1", document: { recordId: "x" }, resolve: async () => { throw new Error("db down"); } }), null);
  assert.equal(await resolveSessionDocument({ userId: "u1", document: "nope" }), null);
  assert.equal(await resolveSessionDocument({ userId: null, document: { recordId: "x" } }), null);
});

test("each turn's reference is the numbered passages for what the learner said", async () => {
  let gathered = null;
  const g = await groundTurn({
    target: { recordId: "r", ownerId: "o", contentKey: "k", name: "Biology notes" },
    message: "plants make glucose from light",
    gather: async (args) => { gathered = args; return { passages, indexed: true }; },
  });
  assert.equal(gathered.question, "plants make glucose from light");
  assert.deepEqual([g.reference.name, g.reference.cited], ["Biology notes", true]);
  assert.match(g.reference.text, /^\[1\] \(page 3\)\nPhotosynthesis/);
  assert.match(g.reference.text, /\[2\] \(at 12:05\)\nEnzymes/);
  assert.equal(g.passages, passages);
});

test("nothing indexed or a failure keeps the fixed reference (null)", async () => {
  const target = { recordId: "r", ownerId: "o" };
  assert.equal(await groundTurn({ target, message: "x", gather: async () => ({ passages: [], indexed: false }) }), null);
  assert.equal(await groundTurn({ target, message: "x", gather: async () => { throw new Error("search down"); } }), null);
  assert.equal(await groundTurn({ target: null, message: "x" }), null);
  assert.equal(await groundTurn({ target, message: "   " }), null);
});

test("the protégé's [n] become page/box or moment citations; reference text is bounded", () => {
  const cites = citationsForReply("Light becomes chemical energy [1]. Enzymes help too [2] [9].", passages);
  assert.deepEqual(cites.map((c) => [c.n, c.pageNumber, c.startMs]), [[1, 3, null], [2, null, 725000]]);
  assert.deepEqual(citationsForReply("no markers", passages), []);
  const long = Array.from({ length: 40 }, (_, i) => ({ ...passages[0], n: i + 1, text: "x".repeat(800) }));
  assert.ok(passagesAsReference(long).length <= 9000);
});

test("the socket wires it: resolve at start (token identity), ground before the turn, cite after", () => {
  assert.match(ws, /document,\s+\/\/ \{ recordId \} \| \{ contentKey \}/);
  // Resolved in the shared session start (D43), against the token identity.
  assert.match(sessionStart, /orchestrator\.documentTargetPromise = document \? resolveSessionDocument\(\{ userId: caller, document \}\) : null;/);
  assert.match(ws, /prepareTeachingSession\(\{[^}]*document/);
  const turn = ws.slice(ws.indexOf('socket.on("teacher_message"'), ws.indexOf('socket.on("request_summary"'));
  assert.ok(turn.indexOf("groundTurn(") < turn.indexOf("processTeachingMessage("), "grounding happens before the turn runs");
  assert.match(turn, /orchestrator\.studentAgent\.referenceMaterial = grounding \? grounding\.reference : orchestrator\.referenceMaterial;/, "no grounding → the fixed reference again");
  assert.match(turn, /citationsForReply\(studentBlock\.text, grounding\.passages\)/);
  assert.ok(turn.indexOf("studentBlock.citations = citations") < turn.indexOf("appendSessionBlocks("), "citations are saved with the block");
  assert.match(ws, /orchestrator\.documentTargetPromise = priorOrchestrator\?\.documentTargetPromise \|\| null;/, "a guide switch keeps the document");
  assert.match(agent, /this\.referenceMaterial\?\.cited/);
  assert.match(agent, /cite it right after the sentence as \[n\]/);
});
