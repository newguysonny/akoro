import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildGuideMessages, cleanGuideHistory, GUIDE_LIMITS } from "./guideLib.js";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const [routes, askLib, migration, manifest, modal, chatView, recordSession, api] = await Promise.all([
  read("./routes.js"), read("./askLib.js"), read("../../migrations/2026-record-chat-guide.sql"), read("../../migrations/manifest.json"),
  read("../../../akoro-learner/src/components/teaching/TeachAgentModal.jsx"), read("../../../akoro-learner/src/components/teaching/SessionChatView.jsx"),
  read("../../../akoro-learner/src/components/library/RecordTeachSession.jsx"), read("../../../akoro-learner/src/services/recordsApi.js"),
]);

const passages = [{ n: 1, pageNumber: 2, text: "Mitochondria release energy." }, { n: 2, pageNumber: 3, text: "Ribosomes make proteins.", pinned: true }];

test("with a document: the guide teaches from its passages, cites them, one check question", () => {
  const [sys, ...rest] = buildGuideMessages({ guideName: "NaNa Esumai", docName: "Cell biology", topic: "The cell", subject: "Biology", passages, message: "What do ribosomes do?", hasDocument: true });
  assert.equal(sys.role, "system");
  for (const bit of ["You are NaNa Esumai", "ONE check question", "[1] (page 2)\nMitochondria", "[2] (page 3, quoted by the learner)", "cite the passage number", "doesn't cover", "Subject: Biology · Topic: The cell"]) {
    assert.ok(sys.content.includes(bit), bit);
  }
  assert.deepEqual(rest.at(-1), { role: "user", content: "What do ribosomes do?" });
});

test("without a document: the topic, no passages, no citations asked for", () => {
  const [sys] = buildGuideMessages({ topic: "Fractions", message: "hi", hasDocument: false });
  assert.match(sys.content, /There is no document in this session/);
  assert.doesNotMatch(sys.content, /Passages:/);
});

test("history: the guide's own turns as assistant, capped; junk dropped", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "guide" : "user", text: `m${i}` }));
  const h = cleanGuideHistory([...many, { role: "system", text: "x" }, null, { role: "user", text: 5 }]);
  assert.equal(h.length, GUIDE_LIMITS.HISTORY_TURNS * 2);
  assert.ok(h.every((m) => ["user", "assistant"].includes(m.role)));
  const msgs = buildGuideMessages({ message: "next", history: h });
  assert.equal(msgs.length, 1 + h.length + 1);
});

test("the guide's thread is its own channel; Ask keeps its own", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'ask'/);
  assert.match(migration, /CHECK \(channel IN \('ask', 'guide'\)\)/);
  assert.ok(manifest.indexOf('"2026-record-chat-guide.sql"') > manifest.indexOf('"2026-record-chat.sql"'));
  assert.match(askLib, /\.eq\("channel", channel\)/);
  assert.match(askLib, /channel = "ask" \}\) \{/);
  assert.match(routes, /router\.post\("\/guide", authenticateToken/);
  assert.match(routes, /router\.get\("\/guide\/history", authenticateToken/);
  assert.match(routes, /saveAskTurn\(\{ userId: req\.user\.id, recordId: target\.recordId, question: message, selection, answer, citations, channel: "guide" \}\)/);
});

test("the app: guide replies come from the API (no 'not wired' note), with citation chips, saved per document", () => {
  assert.doesNotMatch(modal, /guide_note/);
  assert.match(modal, /const send = guideApi \? guideApi\.send : \(opts\) => guideReply\(opts\);/);
  assert.match(modal, /guideApi\.load\(\)/);
  assert.match(chatView, /<Answer text=\{m\.text\} citations=\{m\.citations\}/);
  assert.match(recordSession, /send: \(opts\) => guideReply\(\{ \.\.\.askTarget, \.\.\.opts \}\)/);
  assert.match(api, /'\/api\/records\/guide\?stream=1'/);
});

test("continuation and links use the saved session's id; a cached transcript finishes loading", () => {
  assert.match(modal, /else if \(d\.rowId\) onSessionSaved\?\.\(d\.rowId\);/);
  assert.match(recordSession, /onSessionSaved=\{\(sid\) => storeSid\(record\.id, sid\)\}/);
  assert.match(recordSession, /ready\(\[\{ html: '', text: '' \}\], null, \{ name: record\.name, text: text\.slice\(0, MAX_REFERENCE_CHARS\) \}\);/);
});
