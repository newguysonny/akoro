import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./routes.js", import.meta.url), "utf8");
const profilePatch = source.slice(source.indexOf('router.patch("/me", authenticateToken'));

test("profile PATCH writes independently of additive profile read columns", () => {
  assert.match(profilePatch, /const \{ error: updateError \} = await db\.from\("users"\)\s*\.update\(patch\)\.eq\("id", userId\);/s);
  assert.doesNotMatch(profilePatch, /\.update\(patch\)\.eq\("id", userId\)\.select\(PROFILE_SELECT\)/s);
});

test("profile PATCH falls back to the base projection when its full projection is unavailable", () => {
  assert.match(profilePatch, /\.select\(PROFILE_SELECT\)\.eq\("id", userId\)\.maybeSingle\(\)/s);
  assert.match(profilePatch, /if \(profileReadError\) \{\s*\(\{ data: updated, error: profileReadError \} = await db\.from\("users"\)\s*\.select\(PROFILE_SELECT_BASE\)\.eq\("id", userId\)\.maybeSingle\(\)\);\s*\}/s);
  assert.match(profilePatch, /schoolType: updated\.school_type \?\? null/);
});
