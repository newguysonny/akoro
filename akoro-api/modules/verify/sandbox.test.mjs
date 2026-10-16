import assert from "node:assert/strict";
import test from "node:test";
import { sandboxConfig, goesToSandbox, forward } from "./sandbox.js";

const withEnv = (env, fn) => async () => {
  const keep = { ...process.env };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try { await fn(); } finally { for (const k of Object.keys(env)) { if (k in keep) process.env[k] = keep[k]; else delete process.env[k]; } }
};

test("off or unset: everything stays on this API", withEnv({ VERIFY_SANDBOX_ENABLED: undefined, VERIFY_SANDBOX_URL: undefined }, () => {
  assert.equal(sandboxConfig().enabled, false);
  assert.equal(goesToSandbox(undefined), false);
}));

test("on without a valid URL: stays here (and says why)", withEnv({ VERIFY_SANDBOX_ENABLED: "true", VERIFY_SANDBOX_URL: "not-a-url" }, () => {
  const c = sandboxConfig();
  assert.equal(c.requested, true);
  assert.equal(c.enabled, false);
  assert.equal(goesToSandbox(undefined), false);
}));

test("on: runs go to the sandbox unless pinned here; the sandbox never forwards", withEnv({ VERIFY_SANDBOX_ENABLED: "true", VERIFY_SANDBOX_URL: "https://sandbox.example.com/", VERIFY_TARGET: undefined }, async () => {
  assert.equal(sandboxConfig().url, "https://sandbox.example.com");
  assert.equal(goesToSandbox(undefined), true);
  assert.equal(goesToSandbox("production"), false);
  process.env.VERIFY_TARGET = "sandbox";
  assert.equal(goesToSandbox(undefined), false, "no forwarding loop");
  delete process.env.VERIFY_TARGET;
}));

test("an unreachable sandbox is BLOCKED, never a silent fallback", withEnv({ VERIFY_SANDBOX_ENABLED: "true", VERIFY_SANDBOX_URL: "http://127.0.0.1:9" }, async () => {
  const r = await forward("GET", "/scenarios", null, { timeoutMs: 3000 });
  assert.equal(r.status, 503);
  assert.equal(r.body.data.verdict, "BLOCKED");
  assert.match(r.body.error, /target.*production/);
}));
