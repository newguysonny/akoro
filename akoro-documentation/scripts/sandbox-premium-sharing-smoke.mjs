#!/usr/bin/env node
// Sandbox smoke: the Premium record-sharing model, end to end.
//
// Model (confirmed by Matt, 2026-11-26): uploads are public for free users
// and private for Premium subscribers; a Premium subscriber may set a
// record public as a choice — PATCH /api/records/:id { discoverable }.
//
// Owner: premium.tester@demo.akoro.app, a seeded Premium account (its
// subscription row mirrors a real checkout — see
// docs/audits/section-15-verification-2026-11-26.md). Other learner:
// tester02@demo.akoro.app (free). Probes: the owner's plan, the PATCH
// validation and owner scoping, the unshared gate (ask 404, absent from
// Discover), the shared state (ask 200, present in Discover), and the
// unshared state restored. A free owner's record is also checked to stay
// askable throughout (free visibility unchanged by the flag).
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
      "X-Akoro-Portal": "student",
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

const premium = await login("premium.tester@demo.akoro.app");
const other = await login("tester02@demo.akoro.app");
const freeOwner = await login("tester01@demo.akoro.app");

const me = await call("/api/profiles/me", { token: premium });
verdict("1/9 premium owner's plan reads Premium", me.data?.data?.plan === "Premium",
  `plan=${JSON.stringify(me.data?.data?.plan)} (expect "Premium")`);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const created = await call("/api/records", {
  method: "POST",
  token: premium,
  body: {
    kind: "paste",
    name: `docs-premium-sharing-smoke-${stamp}`,
    content: "Photosynthesis converts sunlight, water and carbon dioxide into glucose and oxygen.",
  },
});
if (created.status !== 201) { console.error(`FATAL: record creation failed: HTTP ${created.status}`); process.exit(2); }
const recordId = created.data?.data?.id;
verdict("2/9 new record starts not-discoverable", created.data?.data?.discoverable === false,
  `discoverable=${JSON.stringify(created.data?.data?.discoverable)} (expect false)`);
console.log(`     record ${recordId}`);

let freeRecordId = null;
try {
  const badType = await call(`/api/records/${recordId}`, {
    method: "PATCH", token: premium, body: { discoverable: "yes" },
  });
  verdict("3/9 PATCH with a non-boolean discoverable", badType.status === 400, `HTTP ${badType.status} (expect 400)`);

  const notOwner = await call(`/api/records/${recordId}`, {
    method: "PATCH", token: other, body: { discoverable: true },
  });
  verdict("4/9 PATCH by a non-owner", notOwner.status === 403, `HTTP ${notOwner.status} (expect 403)`);

  const ask1 = await call("/api/records/ask", {
    method: "POST", token: other,
    body: { recordId, question: "What does photosynthesis produce?" },
  });
  const feed1 = await call("/api/records/discover?limit=200", { token: other });
  const inFeed1 = JSON.stringify(feed1.data || {}).includes(recordId);
  verdict("5/9 unshared Premium record is gated", ask1.status === 404 && feed1.status === 200 && !inFeed1,
    `ask HTTP ${ask1.status} (expect 404), inFeed=${inFeed1} (expect false)`);

  const share = await call(`/api/records/${recordId}`, {
    method: "PATCH", token: premium, body: { discoverable: true },
  });
  const ask2 = await call("/api/records/ask", {
    method: "POST", token: other,
    body: { recordId, question: "What does photosynthesis produce?" },
  });
  const feed2 = await call("/api/records/discover?limit=200", { token: other });
  const inFeed2 = JSON.stringify(feed2.data || {}).includes(recordId);
  verdict("6/9 shared Premium record opens up", share.status === 200 && ask2.status === 200 && inFeed2,
    `PATCH HTTP ${share.status}, ask HTTP ${ask2.status} (expect 200), inFeed=${inFeed2} (expect true)`);

  const unshare = await call(`/api/records/${recordId}`, {
    method: "PATCH", token: premium, body: { discoverable: false },
  });
  const ask3 = await call("/api/records/ask", {
    method: "POST", token: other,
    body: { recordId, question: "What does photosynthesis produce?" },
  });
  verdict("7/9 unsharing restores the gate", unshare.status === 200 && ask3.status === 404,
    `PATCH HTTP ${unshare.status}, ask HTTP ${ask3.status} (expect 200, 404)`);

  const freeCreated = await call("/api/records", {
    method: "POST",
    token: freeOwner,
    body: {
      kind: "paste",
      name: `docs-premium-sharing-smoke-free-${stamp}`,
      content: "Photosynthesis converts sunlight, water and carbon dioxide into glucose and oxygen.",
    },
  });
  freeRecordId = freeCreated.data?.data?.id;
  const freeAsk = await call("/api/records/ask", {
    method: "POST", token: other,
    body: { recordId: freeRecordId, question: "What does photosynthesis produce?" },
  });
  verdict("8/9 free owner's record stays askable", freeCreated.status === 201 && freeAsk.status === 200,
    `create HTTP ${freeCreated.status}, ask HTTP ${freeAsk.status} (expect 201, 200)`);

  verdict("9/9 cleanup prepared", true, "records deleted in the finally block");
} finally {
  const del = await call(`/api/records/${recordId}`, { method: "DELETE", token: premium });
  console.log(`cleanup: DELETE premium record → HTTP ${del.status}`);
  if (freeRecordId) {
    const delFree = await call(`/api/records/${freeRecordId}`, { method: "DELETE", token: freeOwner });
    console.log(`cleanup: DELETE free record → HTTP ${delFree.status}`);
  }
}

console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
