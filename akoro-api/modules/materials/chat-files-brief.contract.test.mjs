import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chatFilesBrief } from "./ingestCore.js";

// The chat from 2026-10-25: two Paper 2 scans read as watermark only, one Objective paper read properly.
const rows = [{
  names: ["waec_Chemistry2_November_2000.pdf", "waec_Chemistry2_November_2011.pdf", "Chemistry Objective.pdf"], state: "ready",
  structure: { items: [
    { name: "waec_Chemistry2_November_2000.pdf", topics: [], questionCount: 0 },
    { name: "waec_Chemistry2_November_2011.pdf", topics: [], questionCount: 0 },
    { name: "Chemistry Objective.pdf", topics: Array(15).fill({ name: "t" }), questionCount: 30 },
  ] },
}];

test("each file and what its read found", () => {
  const b = chatFilesBrief(rows);
  assert.match(b, /## Files in this chat/);
  assert.match(b, /waec_Chemistry2_November_2000\.pdf: read, but its pages had no readable text/);
  assert.match(b, /Chemistry Objective\.pdf: read — 15 topic\(s\), 30 question\(s\)/);
});

test("the true rule, never 'can't read files sent in this chat', and what to offer", () => {
  const b = chatFilesBrief(rows);
  assert.match(b, /scans and photos by Akoro's page reader/);
  assert.match(b, /Never say you can't read files sent in this chat/);
  assert.match(b, /send it again here/);
});

test("not read yet, undone, and nothing at all", () => {
  assert.match(chatFilesBrief([{ names: ["a.pdf"], state: "extracting", structure: null }]), /a\.pdf: saved, not read yet/);
  assert.equal(chatFilesBrief([{ names: ["a.pdf"], state: "undone", structure: null }]), "");
  assert.equal(chatFilesBrief([]), "");
});

test("the chat turn adds it for learners", () => {
  const chat = readFileSync(new URL("../adaptive-learning/chat.js", import.meta.url), "utf8");
  assert.match(chat, /chatFilesCtx = chatFilesBrief\(data \|\| \[\]\);/);
  assert.match(chat, /ingestCtx \+ chatFilesCtx \+/);
});
