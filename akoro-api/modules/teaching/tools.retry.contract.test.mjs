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

test("a first draft that comes back short is asked again, and the fuller attempt is kept", () => {
  // Found by the gate: Lesson Hooks titled "Five Ways In" came back with 2 hooks and was accepted and charged.
  for (const key of ["misconceptions", "real-world", "lesson-hooks"]) {
    const block = src.slice(src.indexOf(`key: "${key}"`), src.indexOf("system:", src.indexOf(`key: "${key}"`)));
    assert.match(block, /minEntries: 5/, `${key} asks for 5 entries`);
  }
  assert.match(src, /const wanted = base && request \? 0 : \(tool\.minEntries \|\| 0\);/);   // revisions are exempt
  assert.match(src, /return !r \|\| r\.entries\.length < wanted;/);
  assert.match(src, /Your last answer had only \$\{entriesIn\(tried\.at\(-1\)\)\} of the \$\{wanted\} entries/);
  assert.match(src, /raw = tried\.reduce\(\(best, r\) => \(entriesIn\(r\) > entriesIn\(best\) \? r : best\), raw\);/);
});
