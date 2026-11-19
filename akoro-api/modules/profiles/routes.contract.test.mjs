import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routes = await readFile(new URL("./routes.js", import.meta.url), "utf8");
const store = await readFile(new URL("./store-users.js", import.meta.url), "utf8");
const settings = await readFile(new URL("./service-settings.js", import.meta.url), "utf8");
const profilePatch = settings.slice(settings.indexOf("export async function patchMe"));

test("profile PATCH writes independently of additive profile read columns", () => {
  assert.match(routes, /router\.patch\("\/me", authenticateToken/);
  assert.match(store, /const \{ error: updateError \} = await db\.from\("users"\)\s*\.update\(patch\)\.eq\("id", userId\);/s);
  assert.doesNotMatch(store, /\.update\(patch\)\.eq\("id", userId\)\.select\(PROFILE_SELECT\)/s);
});

test("profile PATCH falls back to the base projection when its full projection is unavailable", () => {
  assert.match(store, /\.select\(PROFILE_SELECT\)\.eq\("id", userId\)\.maybeSingle\(\)/s);
  assert.match(store, /if \(profileReadError\) \{\s*\(\{ data: updated, error: profileReadError \} = await db\.from\("users"\)\s*\.select\(PROFILE_SELECT_BASE\)\.eq\("id", userId\)\.maybeSingle\(\)\);\s*\}/s);
  assert.match(profilePatch, /schoolType: updated\.school_type \?\? null/);
});
