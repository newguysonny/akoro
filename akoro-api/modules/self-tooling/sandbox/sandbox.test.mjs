// Sandbox escape test pack (plan phase S5 exit): every attempt is contained.
import assert from "node:assert/strict";
import test from "node:test";
import { runCode, staticCheck, asRows, CODE_LIMITS } from "./index.js";

// The static checks are one layer; these run code that SKIPS them, to prove
// the sandbox itself contains what gets past. (runCode always checks first.)
import { Worker } from "node:worker_threads";
const raw = (source, payload = {}) => new Promise((resolve) => {
  const w = new Worker(new URL("./worker.js", import.meta.url), { workerData: { source, payload, limits: CODE_LIMITS }, resourceLimits: { maxOldGenerationSizeMb: 96 } });
  const timer = setTimeout(() => { w.terminate(); resolve({ ok: false, error: "the code ran too long" }); }, CODE_LIMITS.wallMs);
  w.once("message", (m) => { clearTimeout(timer); w.terminate(); resolve(m.ok ? { ok: true, value: JSON.parse(m.json) } : m); });
  w.once("error", (e) => { clearTimeout(timer); resolve({ ok: false, error: e.message }); });
});

test("a normal tool computes from the data it was given", async () => {
  const r = await runCode(`function run(input, data, akoro) {
    var days = data.weak.slice().sort(function (a, b) { return a.confidence - b.confidence; });
    var out = [];
    for (var i = 0; i < days.length; i++) out.push({ day: Math.floor(i / input.perDay) + 1, topic: days[i].topic });
    return out;
  }`, { input: { perDay: 2 }, data: { weak: [{ topic: "A", confidence: 0.4 }, { topic: "B", confidence: 0.1 }, { topic: "C", confidence: 0.3 }] }, akoro: { today: "2026-10-16" } });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.value, [{ day: 1, topic: "B" }, { day: 1, topic: "C" }, { day: 2, topic: "A" }]);
});

test("static checks refuse the obvious escape routes", () => {
  for (const [src, what] of [
    ["function run(){ return eval('1') }", "eval"], ["function run(){ return Function('return 1')() }", "Function"],
    ["function run(){ return require('fs') }", "require"], ["function run(){ return globalThis }", "globalThis"],
    ["function run(){ return [].constructor.constructor('return 1')() }", "constructor"],
    ["function run(){ Object.prototype.x = 1 }", "prototypes"], ["function run(){ return fetch('http://x') }", "network"],
    ["function run(){ return process.env }", "process"], ["async function run(){ await 1 }", "async"],
    ["function run(){ setTimeout(function(){}, 1) }", "timers"], ["function run(){ return this }", "this"],
  ]) assert.ok(staticCheck(src).some((e) => e.includes(what)), `${what}: ${staticCheck(src)}`);
  assert.ok(staticCheck("function nope(){}").length);
  assert.ok(staticCheck(`function run(){ return "${"x".repeat(500)}" }`).some((e) => /too long/.test(e)));
  assert.ok(staticCheck(`function run(){ return 1 }${" ".repeat(9000)}`).some((e) => /KB/.test(e)));
  assert.deepEqual(staticCheck('function run(){ return [{ label: "Function of x" }] }'), [], "names inside strings are fine");
});

test("no network, no filesystem, no host — even past the static checks", async () => {
  const r = await raw(`function run(){ return {
    fetch: typeof fetch, require: typeof require, process: typeof process, XHR: typeof XMLHttpRequest,
    setTimeout: typeof setTimeout, std: typeof std, os: typeof os, wasm: typeof WebAssembly } }`);
  assert.equal(r.ok, true, r.error);
  for (const [k, v] of Object.entries(r.value)) assert.equal(v, "undefined", `${k} is reachable`);
  const viaEval = await raw("function run(){ return (0, eval)('typeof require + typeof process') }");
  assert.deepEqual(viaEval, { ok: true, value: "undefinedundefined" });
  const viaCtor = await raw("function run(){ return [].constructor.constructor('return typeof process')() }");
  assert.deepEqual(viaCtor, { ok: true, value: "undefined" });
});

test("an infinite loop is stopped", async () => {
  const t0 = Date.now();
  const r = await runCode("function run(){ var i = 0; for (;;) { i++; } }", {});
  assert.equal(r.ok, false);
  assert.match(r.error, /too long/);
  assert.ok(Date.now() - t0 < CODE_LIMITS.wallMs + 1500);
});

test("a memory bomb is stopped", async () => {
  const r = await runCode("function run(){ var s = 'x'; for (var i = 0; i < 60; i++) { s = s + s; } return s.length; }", {});
  assert.equal(r.ok, false);
  assert.match(r.error, /memory|too long/);
  const arrays = await runCode("function run(){ var a = []; for (var i = 0; i < 1e8; i++) { a.push([i, i, i, i]); } return a.length; }", {});
  assert.equal(arrays.ok, false);
});

test("deep recursion is stopped", async () => {
  const r = await runCode("function run(){ function f(n){ return f(n + 1) + 1; } return f(0); }", {});
  assert.equal(r.ok, false);
});

test("prototype tampering stays inside one run", async () => {
  const a = await raw("function run(){ Object.prototype.hacked = 'yes'; Array.prototype.map = null; return ({}).hacked }");
  assert.deepEqual(a, { ok: true, value: "yes" });
  const b = await raw("function run(){ return [({}).hacked === undefined, typeof [].map] }");
  assert.deepEqual(b, { ok: true, value: [true, "function"] }, "a fresh runtime per run");
  assert.equal(({}).hacked, undefined, "the host is untouched");
  const frozen = await raw("function run(input, data, akoro){ akoro.today = 'x'; return akoro.today }", { input: {}, data: {}, akoro: { today: "2026-10-16" } });
  assert.deepEqual(frozen, { ok: true, value: "2026-10-16" });
});

test("oversized answers and promises are refused; rows are normalised", async () => {
  const big = await runCode("function run(){ var a = []; for (var i = 0; i < 20000; i++) a.push({ i: i, t: 'abcdefgh' }); return a; }", {});
  assert.equal(big.ok, false);
  assert.match(big.error, /too large/);
  const p = await raw("function run(){ return Promise.resolve(1) }");
  assert.equal(p.ok, false);
  assert.deepEqual(asRows([1, { a: 1 }]), [{ value: 1 }, { a: 1 }]);
  assert.deepEqual(asRows({ rows: [{ a: 1 }] }), [{ a: 1 }]);
});

test("code tools: validated (flag, reads, static checks) and run through the interpreter", async () => {
  const { validateDefinition, runDefinition } = await import("../interpreters.js");
  const def = { kind: "code", steps: [], source: "function run(input, data, akoro) { var out = []; for (var i = 1; i <= input.n; i++) out.push({ day: i, date: akoro.today, label: '$' + i }); return out; }" };
  delete process.env.AKORO_SELF_TOOLING_CODE_ENABLED;
  assert.ok((await validateDefinition(structuredClone(def), { n: { type: "integer" } })).errors.some((e) => /turned off/.test(e)));
  process.env.AKORO_SELF_TOOLING_CODE_ENABLED = "true";
  try {
    const v = await validateDefinition(structuredClone(def), { n: { type: "integer" } });
    assert.deepEqual(v.errors, [], "a '$' inside code isn't a param slot");
    const bad = await validateDefinition({ kind: "code", steps: [{ id: "x", view: "nope" }], source: "function run(){ return eval('1') }", then: [] }, {});
    assert.ok(bad.errors.some((e) => /unknown view/.test(e)));
    assert.ok(bad.errors.some((e) => /code: not allowed in a tool: eval/.test(e)));
    assert.ok(bad.errors.some((e) => /no then-ops/.test(e)));
    const out = await runDefinition(def, { n: 3 }, { learnerId: "u", callCapability: async () => ({}) });
    assert.equal(out.total, 3);
    assert.match(out.rows[0].date, /^\d{4}-\d{2}-\d{2}$/);
    await assert.rejects(runDefinition({ ...def, source: "function run(){ for(;;){} }" }, {}, { learnerId: "u" }), /too long/);
  } finally {
    delete process.env.AKORO_SELF_TOOLING_CODE_ENABLED;
  }
});
