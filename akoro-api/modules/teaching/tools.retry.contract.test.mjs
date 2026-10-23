import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const src = await readFile(new URL("./tools.js", import.meta.url), "utf8");

test("a teaching tool retries once when the answer is unusable, and bills the attempts together", () => {
  // Found by the gate: lesson hooks failed twice with UNPARSEABLE in a row; a retry is free
  // (charged after the call) and these failures are intermittent.
  assert.match(src, /for \(let attempt = 0; attempt < 2; attempt\+\+\)/);
  assert.match(src, /if \(!unusable\(raw\)\) break;/);
  assert.match(src, /usage: Object\.keys\(usage\)\.length \? usage : \(resp\.usage \|\| \{\}\)/);
  // …and the specific errors are still what the caller gets when both attempts fail.
  for (const code of ["EMPTY", "UNPARSEABLE", "NO_SECTIONS"]) assert.match(src, new RegExp(`"${code}"`));
});
