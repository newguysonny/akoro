import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_REFERENCE_CHARS,
  isSupportedSessionReference,
  normalizeSessionReference,
  readSessionReference,
} from "./sessionReference.js";

test("recognizes the document formats accepted by a session reference", () => {
  assert.equal(isSupportedSessionReference({ mimetype: "application/pdf", originalname: "week-2.pdf" }), true);
  assert.equal(isSupportedSessionReference({ mimetype: "", originalname: "lecture.md" }), true);
  assert.equal(isSupportedSessionReference({ mimetype: "image/png", originalname: "diagram.png" }), false);
});

test("extracts and caps a text session reference", async () => {
  const body = `Overview\n${"a".repeat(MAX_REFERENCE_CHARS + 100)}`;
  const reference = await readSessionReference({
    mimetype: "text/markdown",
    originalname: "week-2.md",
    size: Buffer.byteLength(body),
    buffer: Buffer.from(body),
  });

  assert.equal(reference.name, "week-2.md");
  assert.equal(reference.text.length, MAX_REFERENCE_CHARS);
  assert.equal(reference.truncated, true);
});

test("normalizes a direct socket reference to the same safe cap", () => {
  const reference = normalizeSessionReference({
    name: "notes\nweek 2.txt",
    text: `  ${"x".repeat(MAX_REFERENCE_CHARS + 1)}  `,
  });

  assert.equal(reference.name, "notes week 2.txt");
  assert.equal(reference.text.length, MAX_REFERENCE_CHARS);
  assert.equal(reference.truncated, true);
  assert.equal(normalizeSessionReference({ name: "empty.txt", text: "   " }), null);
});
