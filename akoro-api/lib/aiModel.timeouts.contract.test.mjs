import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The per-call bounds (__timeoutMs / __maxRetries) were read from the params
// copy AFTER they had been deleted from it, so no call was ever bounded.
test("per-call timeout and retries reach the SDK", async () => {
  const src = await readFile(new URL("./aiBilling.js", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("async function meteredCreate"), src.indexOf("const bills = Boolean"));
  assert.match(body, /const reqOpts = \(params\.__timeoutMs != null \|\| params\.__maxRetries != null\)/);
  assert.match(body, /timeout: params\.__timeoutMs/);
  assert.match(body, /maxRetries: params\.__maxRetries/);
  assert.doesNotMatch(body.slice(body.indexOf("const reqOpts")), /clean\.__timeoutMs/);
});
