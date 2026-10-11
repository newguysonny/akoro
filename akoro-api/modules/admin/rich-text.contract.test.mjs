import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseRich } from "../../../akoro-instructor/src/components/common/richText.js";

const instructorPage = await readFile(
  new URL("../../../akoro-instructor/src/pages/ChatPage.jsx", import.meta.url), "utf8");
const learnerTab = await readFile(
  new URL("../../../akoro-learner/src/components/tabs/AgentChatTab.jsx", import.meta.url), "utf8");
const sessionChat = await readFile(
  new URL("../../../akoro-learner/src/components/teaching/SessionChatView.jsx", import.meta.url), "utf8");
const chatSource = await readFile(
  new URL("../adaptive-learning/chat.js", import.meta.url), "utf8");
const chatDoctrine = await readFile(
  new URL("../../akoro-agent/channels/CHAT.md", import.meta.url), "utf8");
const studentAgent = await readFile(
  new URL("../../../akoro-python-agent/src/agent/adaptive/student.py", import.meta.url), "utf8");

test("parser: headings, bold, lists, code, rules — the class-report shape", () => {
  const blocks = parseRich([
    "### Class Name:",
    "- **Name:** JSS1",
    "- **Student Limit:** 9999",
    "### Student List:",
    "1. Emoa Leaa",
    "2. Priya JSS1-1",
    "Email me at `teacher1@demo.akoro.app`.",
    "---",
  ].join("\n"));
  assert.equal(blocks[0].type, "h");
  assert.equal(blocks[0].level, 3);
  assert.equal(blocks[1].type, "ul");
  assert.deepEqual(blocks[1].items[0].map((s) => [s.text, s.bold]), [["Name:", true], [" JSS1", false]]);
  assert.equal(blocks[2].type, "h");
  assert.equal(blocks[3].type, "ol");
  assert.equal(blocks[3].items.length, 2);
  assert.ok(blocks[4].spans.some((s) => s.code && s.text === "teacher1@demo.akoro.app"));
  assert.equal(blocks[5].type, "hr");
});

test("parser: unterminated markers and HTML stay literal — no injection surface", () => {
  const blocks = parseRich("Hello **world and <img src=x onerror=alert(1)> `oops");
  // The parser keeps hostile text verbatim — it is inert: the renderer emits
  // React elements, never HTML. The invariant is span purity: text + flags only.
  assert.ok(blocks[0].spans.some((s) => s.text.includes("<img")));
  for (const span of blocks[0].spans) {
    assert.deepEqual(Object.keys(span).sort(), ["bold", "code", "italic", "text"]);
  }
  assert.ok(blocks[0].spans.some((s) => s.text.includes("**world")));
  assert.ok(blocks[0].spans.every((s) => !s.bold)); // unterminated marker must not bold the rest
});

test("parser: italics fire at word boundaries; snake_case stays literal; single-char spans keep their letters", () => {
  const spans = parseRich("*done* and _todo_, snake_case_id stays")[0].spans;
  assert.deepEqual(spans.map((s) => [s.text, s.italic]), [
    ["done", true], [" and ", false], ["todo", true], [", snake_case_id stays", false],
  ]);
  // The off-by-one regression: single-char markers used to eat the first
  // letter inside the span ("`teacher1`" became "eacher1").
  const code = parseRich("Email `teacher1@demo.akoro.app` now")[0].spans;
  assert.ok(code.some((s) => s.code && s.text === "teacher1@demo.akoro.app"));
});

test("parser: blank lines split paragraphs; deep headings map to three tiers", () => {
  const blocks = parseRich("First paragraph.\n\n#### Deep heading");
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, "p");
  assert.equal(blocks[1].type, "h");
  assert.equal(blocks[1].level, 3);
});

test("RichText has ONE span render path — list items can never render empty", () => {
  for (const f of ["../../../akoro-instructor/src/components/common/RichText.jsx", "../../../akoro-learner/src/components/common/RichText.jsx"]) {
    return readFile(new URL(f, import.meta.url), "utf8").then((src) => {
      assert.match(src, /<SpanRun spans=\{item\} \/>/);   // list items render the full span run
      assert.doesNotMatch(src, /<Spans s=\{item\}/);       // never a single-span component fed an array
    });
  }
});

test("all three agent chat surfaces render RichText; user bubbles stay plain", () => {
  assert.match(instructorPage, /<RichText text=\{textPart\} color=\{INK\} \/>/);
  // …at the Agent Chat's reading size (16 → 14 → 14.5 after the 2026-10
  // tightening, bumped on review; RichText cascades to bold/lists inside
  // replies). Learner bubbles sit at 14.
  assert.match(learnerTab, /<RichText text=\{msg\.text\} size=\{14\.5\} lineHeight=\{1\.55\}\/>/);
  assert.match(sessionChat, /<RichText text=\{m\.text\} \/>/);
});

test("both agents carry the formatting contract", () => {
  // P1: the chat persona + formatting contract load from the workspace.
  assert.match(chatDoctrine, /Formatting contract \(the chat renders a small markdown subset/);
  assert.match(chatDoctrine, /NEVER use markdown tables, HTML, images, links, or code fences/);
  assert.match(chatSource, /assembleChatDoctrine|tutorSystemPrompt/);
  assert.match(studentAgent, /never use headings, tables, HTML, or code fences/);
});
