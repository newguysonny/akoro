import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * The community error card must tell the truth about WHY nothing arrived.
 *
 * Live catch: a learner on a perfectly good connection ("every other page
 * loads fine") was shown "Your connection seems slow or offline" for a
 * server-side stall. The card now distinguishes slow (deadline / 504 —
 * naming the query step the server gave up on), setup (503), server (any
 * other server answer, showing the API's own user-facing message) and
 * network (the request truly never arrived).
 */

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [page, communityApi, api] = await Promise.all([
  read("../src/pages/CommunityActivityPage.jsx"),
  read("../src/services/communityApi.js"),
  read("../src/services/api.js"),
]);

test("classifyError maps every failure to its honest kind", () => {
  assert.match(page, /function classifyError\(e\) \{/);
  assert.match(page, /if \(e\?\.status === 404 \|\| e\?\.status === 403\) return \{ kind: 'missing' \};/);
  assert.match(page, /if \(e\?\.timedOut \|\| e\?\.status === 504\) return \{ kind: 'slow', step: e\?\.step, timeoutMs: e\?\.timeoutMs \};/);
  assert.match(page, /if \(e\?\.status === 503\) return \{ kind: 'setup' \};/);
  assert.match(page, /if \(e\?\.status\) return \{ kind: 'server', message: e\?\.message \};/);
  assert.match(page, /return \{ kind: 'network' \};/);
  // The load path classifies instead of hard-coding 'network'.
  assert.match(page, /setError\(classifyError\(e\)\);/);
});

test("each kind has its own icon, title and body — no kind blames the network unfairly", () => {
  for (const kind of ["slow", "setup", "server", "network"]) {
    assert.match(page, new RegExp("  " + kind + ": \\{"));
  }
  assert.match(page, /icon: 'ti-hourglass', title: 'This community is taking too long to load'/);
  assert.match(page, /icon: 'ti-settings', title: 'Communities are still being set up'/);
  assert.match(page, /icon: 'ti-server', title: 'Something went wrong on our side'/);
  assert.match(page, /icon: 'ti-wifi-off', title: "Couldn't reach this community"/);
  // "that's on our side, not your connection" — the sentence that was missing.
  assert.match(page, /that's on our side, not your connection\./);
  // The 504's step is shown so a screenshot names the wedged query; a client
  // deadline with NO server answer says how long the silence lasted — the two
  // lines separate "server hung on X" from "request never reached the server".
  assert.match(page, /The server gave up waiting on: \{error\.step\}/);
  assert.match(page, /No answer at all within \{Math\.round\(error\.timeoutMs \/ 1000\)\} seconds/);
  // Server errors show the API's own user-facing message.
  assert.match(page, /error\.kind === 'server' \? \(error\.message \|\| meta\.body\) : meta\.body/);
  // 'missing' still falls through to the not-found card, not this one.
  assert.match(page, /if \(error && error\.kind !== 'missing'\) \{/);
});

test("the feed read is strict on the activity page — a dead feed is an error, not an empty state", () => {
  assert.match(page, /fetchCommunityStrict, fetchCommunityActivitiesStrict,/);
  assert.match(page, /Promise\.all\(\[fetchCommunityStrict\(communityId\), fetchCommunityActivitiesStrict\(communityId\)\]\)/);
  // The tolerant variant stays for pages where the feed is a bonus.
  assert.match(communityApi, /export async function fetchCommunityActivitiesStrict\(communityId\) \{/);
  assert.match(communityApi, /export async function fetchCommunityActivities\(communityId\) \{/);
});

test("apiError carries the server's machine code and the 504's step name", () => {
  assert.match(api, /serverCode = j\.code;/);
  assert.match(api, /serverStep = j\.step;/);
  assert.match(api, /err\.code   = serverCode;/);
  assert.match(api, /err\.step   = serverStep;/);
});
