import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * The workspace was suspended for burning Render's entire 5 GB monthly
 * bandwidth allowance in four days with no real users — and the question
 * "what is eating it?" had no answer, because nothing measured outbound
 * bytes. The egress meter counts what each route puts on the wire (after
 * compression), keeps a 24-hour ring so the burn PATTERN is visible
 * (steady 3 a.m. climb = bots/worker; spikes only during testing = the
 * operator's own traffic), exposes a numbers-only summary publicly in
 * /health, and a per-route breakdown behind the internal secret.
 */

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [appJs, streamJs] = await Promise.all([read("app.js"), read("modules/courses/stream.js")]);

test("every response's on-the-wire bytes are counted, per route", () => {
  assert.match(appJs, /const egress = \{ since: new Date\(\)\.toISOString\(\), totalBytes: 0, requests: 0, byRoute: new Map\(\), hours: \[\] \};/);
  // Wraps write AND end, ahead of compression, so it counts post-compression bytes.
  assert.match(appJs, /const origWrite = res\.write, origEnd = res\.end;/);
  assert.match(appJs, /res\.write = function \(chunk, \.\.\.rest\) \{ if \(chunk\?\.length\) bytes \+= chunk\.length; return origWrite\.call\(this, chunk, \.\.\.rest\); \};/);
  // Route keys use the pattern (/:id), not raw uuid-bearing paths.
  assert.match(appJs, /const route = \(\) => \(req\.route\?\.path \? `\$\{req\.baseUrl \|\| ""\}\$\{req\.route\.path\}` : req\.path\.split\("\?"\)\[0\]\)\.slice\(0, 120\);/);
  // An hourly ring, 24 slots.
  assert.match(appJs, /while \(ring\.length > 24\) ring\.shift\(\);/);
});

test("/health carries the numbers-only summary (public, no route structure)", () => {
  assert.match(appJs, /egress: \{/);
  assert.match(appJs, /sinceBootBytes: egress\.totalBytes,/);
  assert.match(appJs, /last24hBytes: egress\.hours\.reduce\(\(s, h\) => s \+ h\.bytes, 0\),/);
  assert.match(appJs, /hourlyBytes: egress\.hours\.map\(\(h\) => \(\{ hour: h\.hour, bytes: h\.bytes \}\)\),/);
});

test("the per-route breakdown is guarded like preflight, sorted by bytes", () => {
  assert.match(appJs, /app\.get\("\/internal\/egress", \(req, res\) => \{/);
  assert.match(appJs, /req\.headers\["x-internal-secret"\] === secret/);
  assert.match(appJs, /\.sort\(\(a, b\) => b\.bytes - a\.bytes\)/);
});

test("the in-memory video upload landmine is capped at 2 GB, not 50", () => {
  // A 50 GB memory buffer on a 512 MB instance OOMs long before the limit,
  // and every proxied byte later leaves for R2 through metered egress.
  assert.match(streamJs, /limits:  \{ fileSize: 2 \* 1024 \* 1024 \* 1024 \},/);
  assert.doesNotMatch(streamJs, /50 \* 1024 \* 1024 \* 1024/);
});
