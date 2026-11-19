import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseRefusalCode, parseRefusalMessage } from "./parseRefusal.js";

test("a paused parse worker is named in plain words, never as RunPod's raw JSON", () => {
  const raw = 'RunPod HTTP 409: {"status":409,"title":"Conflict","detail":"Endpoint is paused (max_workers=0). Set max_workers > 0 to accept work.","code":"ENDPOINT_PAUSED"}';
  assert.equal(parseRefusalCode(raw), "worker_paused");
  assert.match(parseRefusalMessage(raw), /switched off right now\. Your file is saved/);
  assert.doesNotMatch(parseRefusalMessage(raw), /RunPod|max_workers|409/);
  assert.equal(parseRefusalCode("RunPod did not accept the job in time — try again"), "worker_slow");
  assert.equal(parseRefusalCode("RunPod extraction is not configured (RUNPOD_API_KEY / RUNPOD_PARSE_ENDPOINT_ID)"), "worker_unconfigured");
  assert.equal(parseRefusalCode("RunPod HTTP 500"), "worker_refused");
});

test("learner-facing extraction routes never answer 502 (Cloudflare swaps it for a page without CORS → 'Failed to fetch')", async () => {
  const src = await readFile(new URL("./routes.js", import.meta.url), "utf8")
    + await readFile(new URL("./service-extract.js", import.meta.url), "utf8")
    + await readFile(new URL("./service-records.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /status\(502\)/);
  assert.doesNotMatch(src, /status\(504\)/);
  assert.match(src, /res\.status\(424\)\.json\(\{ success: false, code: parseRefusalCode/);
});
