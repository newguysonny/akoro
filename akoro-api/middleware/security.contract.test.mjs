import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./security.js", import.meta.url), "utf8");

test("the rate limiter sends a JSON body and counts only failures on auth", () => {
  assert.match(src, /handler: \(req, res, _next, options\) =>/, "v8 handler signature (options is 4th)");
  assert.match(src, /options\?\.message \|\|/, "always a JSON fallback body");
  assert.match(src, /skipSuccessfulRequests: true/, "successful logins don't burn the strict bucket");
});
