import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const security = read("middleware/security.js");

test("a hung request is named in the logs, not silent", () => {
  // The community-details incident: "no answer at all within 30 seconds", and
  // the request logger only spoke on finish — a hang left NO line, so "never
  // reached the app" and "hung inside Express" were indistinguishable.
  assert.match(security, /const STALL_MS = 25_000;/);
  assert.match(security, /securityLog\('REQUEST_STALLED', r, \{ age_ms: now - e\.start, method: e\.method, url: e\.url \}/);
  assert.match(security, /e\.warned = true;/);          // one line per request
  assert.match(security, /stallTimer\.unref\?\.\(\);/); // never holds the process open
});

test("legitimately long request families are exempt from the watchdog", () => {
  assert.match(security, /includes\('text\/event-stream'\)/);        // SSE tool loops
  assert.match(security, /startsWith\('multipart\/'\)/);             // uploads
  assert.match(security, /> 1_000_000;/);                            // big bodies
});

test("in-flight entries are released when the response settles", () => {
  assert.match(security, /const leave = \(\) => inFlight\.delete\(req\);/);
  assert.match(security, /res\.on\('close', leave\);/);
  assert.match(security, /leave\(\);/);
});
