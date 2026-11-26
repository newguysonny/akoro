#!/usr/bin/env node
// Sandbox smoke: the Premium record-sharing choice (discoverable).
//
// Model (confirmed by Matt, 2026-11-26): uploads are public for free users
// and private for Premium subscribers; a Premium subscriber may set a
// record public as a choice — PATCH /api/records/:id { discoverable }.
//
// This smoke proves the choice surface end to end on the sandbox with two
// free demo accounts: the PATCH round-trip, its validation, its owner
// scoping, and that free-user visibility is unchanged. The Premium-gated
// transitions themselves (ask 404 → share → ask 200 → unshare → 404, and
// the Discover feed appearance) need a Premium sandbox account, which does
// not exist yet; they are covered by the behavioural tests in
// akoro-api/modules/records/discoverable.contract.test.mjs (14/14) and are
// marked UNPROBED here until such an account is provisioned.
//
// Usage: node sandbox-premium-sharing-smoke.mjs [baseUrl]
// Default base: https://sandbox.akoro.ng (NEVER production).

const BASE = (process.argv[2] || "https://sandbox.akoro.ng").replace(/\/$/, "");
const PASSWORD = "Password123!";
let failures = 0;

async function call(path, { method = "GET", token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data };
}

function verdict(label, ok, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
}

async function login(email) {
  const r = await call("/api/auth/login", { method: "POST", body: { email, password: PASSWORD } });
  const token = r.data?.data?.accessToken;
  if (!token) { console.error(`FATAL: login failed for ${email}: HTTP ${r.status}`); process.exit(2); }
  return token;
}

const tokenA = await login("tester01@demo.akoro.app");
const tokenB = await login("tester02@demo.akoro.app");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const created = await call("/api/records", {
  method: "POST",
  token: tokenA,
  body: {
    kind: "paste",
    name: `docs-premium-sharing-smoke-${stamp}`,
    content: "Photosynthesis converts sunlight, water and carbon dioxide into glucose and oxygen.",
  },
});
if (created.status !== 201) { console.error(`FATAL: record creation failed: HTTP ${created.status}`); process.exit(2); }
const recordId = created.data?.data?.id;
const startFlag = created.data?.data?.discoverable;
verdict("1/7 new record starts not-discoverable", startFlag === false, `discoverable=${JSON.stringify(startFlag)} (expect false)`);
console.log(`     record ${recordId}`);

try {
  const badType = await call(`/api/records/${recordId}`, {
    method: "PATCH", token: tokenA, body: { discoverable: "yes" },
  });
  verdict("2/7 PATCH with a non-boolean discoverable", badType.status === 400, `HTTP ${badType.status} (expect 400)`);

  const notOwner = await call(`/api/records/${recordId}`, {
    method: "PATCH", token: tokenB, body: { discoverable: true },
  });
  verdict("3/7 PATCH by a non-owner", notOwner.status === 403, `HTTP ${notOwner.status} (expect 403)`);

  const share = await call(`/api/records/${recordId}`, {
    method: "PATCH", token: tokenA, body: { discoverable: true },
  });
  verdict("4/7 owner PATCH discoverable=true", share.status === 200 && share.data?.data?.discoverable === true,
    `HTTP ${share.status}, discoverable=${JSON.stringify(share.data?.data?.discoverable)} (expect 200, true)`);

  const ask = await call("/api/records/ask", {
    method: "POST", token: tokenB,
    body: { recordId, question: "What does photosynthesis produce?" },
  });
  verdict("5/7 free owner's record still askable by another learner", ask.status === 200,
    `HTTP ${ask.status} (expect 200 — free visibility unchanged by the flag)`);

  const feed = await call("/api/records/discover?limit=200", { token: tokenB });
  const inFeed = JSON.stringify(feed.data || {}).includes(recordId);
  verdict("6/7 record appears in the other learner's Discover feed", feed.status === 200 && inFeed,
    `HTTP ${feed.status}, inFeed=${inFeed} (expect 200, true)`);

  const unshare = await call(`/api/records/${recordId}`, {
    method: "PATCH", token: tokenA, body: { discoverable: false },
  });
  verdict("7/7 owner PATCH discoverable=false", unshare.status === 200 && unshare.data?.data?.discoverable === false,
    `HTTP ${unshare.status}, discoverable=${JSON.stringify(unshare.data?.data?.discoverable)} (expect 200, false)`);

  console.log("UNPROBED  Premium-gated transitions (owner Premium: ask 404 → share → ask 200 + feed → unshare → 404) — no Premium sandbox account exists yet.");
} finally {
  const del = await call(`/api/records/${recordId}`, { method: "DELETE", token: tokenA });
  console.log(`cleanup: DELETE record → HTTP ${del.status}`);
}

console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
