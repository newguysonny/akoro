import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * No request may outlive the learner's patience — connection OR body.
 *
 * Live catch: the community details page "kept loading with no data
 * arriving" forever. The request timeout already bounded time-to-headers,
 * but a proxy can deliver headers and then stall the body — and an
 * unbounded `await r.json()` hangs a page exactly like an unbounded
 * fetch. These pins keep the deadline armed until the body has been read.
 */

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const api = await read("../src/services/api.js");

test("a deadline can be armed by the caller and covers the body read", () => {
  // armDeadline: signal + settle, disarmed by the consumer after the body.
  assert.match(api, /function armDeadline\(timeoutMs = DEFAULT_TIMEOUT_MS\) \{/);
  assert.match(api, /return \{ signal: ctrl\.signal, settle\(\) \{ clearTimeout\(timer\); \} \};/);
  assert.match(api, /signal: undefined, settle\(\) \{\}/);          // opt-out stays a no-op
});

test("an abort past the deadline looks like every other network failure", () => {
  assert.match(api, /function recastAbort\(err\) \{/);
  assert.match(api, /err\?\.name !== 'AbortError' && err\?\.name !== 'TimeoutError'/);
  assert.match(api, /e\.isNetwork = true;/);
  assert.match(api, /e\.timedOut  = true;/);
  // fetchWithTimeout defers to a caller-owned signal instead of overriding it.
  assert.match(api, /opts\.signal\) return fetch\(url, opts\)/);
});

test("apiGet keeps one clock across headers, error body and JSON body", () => {
  assert.match(api, /const deadline = armDeadline\(ms\);       \/\/ headers AND body under one clock/);
  assert.match(api, /method: 'GET', signal: deadline\.signal/);
  assert.match(api, /const e = recastAbort\(err\);                 \/\/ a body-read abort is a network error too/);
  assert.match(api, /finally \{\n    deadline\.settle\(\);\n  \}\n\}\n\n\/\/ Shared write path/);
});

test("apiSend keeps the same body-inclusive deadline", () => {
  assert.match(api, /signal: deadline\.signal,\n      \.\.\.\(body !== undefined \? \{ body: JSON\.stringify\(body\) \} : \{\}\),/);
  assert.match(api, /if \(queueOffline && isNetworkError\(e\)\) \{/);
  assert.match(api, /return \{ queued: true, _offline: true \};\n    \}\n    throw e;\n  \} finally \{\n    deadline\.settle\(\);/);
});

test("uploads get their longer budget, and it covers their body too", () => {
  assert.match(api, /const deadline = armDeadline\(UPLOAD_TIMEOUT_MS\);/);
  assert.match(api, /body: formData,\n      signal: deadline\.signal,/);
});

test("a refresh whose body stalls must not pin the shared promise open", () => {
  // refreshSession arms its own deadline and settles it in the same finally
  // that clears `refreshing` — a hung refresh can no longer wedge the tab's
  // auth (and every authed request behind it) forever.
  assert.match(api, /const deadline = armDeadline\(REFRESH_TIMEOUT_MS\);/);
  assert.match(api, /body: '\{\}',\n      signal: deadline\.signal,/);
  assert.match(api, /finally\(\(\) => \{ refreshing = null; deadline\.settle\(\); \}\)/);
});
