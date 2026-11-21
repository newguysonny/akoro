import assert from "node:assert/strict";
import test from "node:test";
import { splitPagedMarkdown } from "./extractModel.js";

test("multi-page answers split on their markers, in order", () => {
  const text = [
    "<<<PAGE 1>>>",
    "# First",
    "Body one.",
    "<<<PAGE 2>>>",
    "Body two.",
    "<<<PAGE 3>>>",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
  ].join("\n");
  const out = splitPagedMarkdown(text);
  assert.deepEqual([...out.keys()], [1, 2, 3]);
  assert.match(out.get(1), /^# First/);
  assert.equal(out.get(2), "Body two.");
  assert.match(out.get(3), /^\| a \| b \|/);
});

test("a fenced page is unwrapped and an empty section is dropped", () => {
  const out = splitPagedMarkdown("<<<PAGE 1>>>\n```md\nHello\n```\n<<<PAGE 2>>>\n");
  assert.equal(out.get(1), "Hello");
  assert.equal(out.has(2), false);
});

test("no markers means no pages — the group falls back to single calls", () => {
  assert.equal(splitPagedMarkdown("just markdown, no markers").size, 0);
});
