import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import express from "express";

/**
 * Parse-worker console contract — the operator's browser surface for the
 * RunPod hanji-parse endpoint, same front door as the HF mirror console:
 * shared-key guard (501 unarmed / 401 bad key), an HTML console at
 * GET /console, JSON runs at POST /console through parsePageOnRunpod
 * (the SAME call the extraction feature uses — the console tests the real
 * path, not a parallel one), and a status poll reporting config + the
 * last run. Routes mounted via express() (a Router invoked directly on
 * http.createServer falls through to 404 — Express 4 behavior).
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");

const [consoleSrc, appJs, envExample] = await Promise.all([
  read("./parseConsole.js"),
  read("../../app.js"),
  read("../../.env.example"),
]);

const parseConsoleModule = (await import("./parseConsole.js")).default;

/* ── harness: the router on a real express app ────────────────────────── */
import http from "node:http";
const startServer = () => new Promise((resolve) => {
  const app = express();
  app.use(express.json({ limit: "64mb" }));
  app.use(parseConsoleModule);
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
});
/* Node's fetch (undici) keeps sockets alive after the response —
   server.close() alone never drains and the test runner hangs. Drop them. */
const stop = (server) => new Promise((resolve) => {
  server.closeAllConnections?.();
  server.close(() => resolve());
});
const call = async (port, method, path, { headers = {}, body } = {}) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { ...headers, connection: "close" }, body });
  return { status: res.status, text: await res.text() };
};

/* 1×1 PNG — a tiny data: URI the console contract accepts */
const PNG_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const ENV = ["PARSE_CONSOLE_KEY", "RUNPOD_API_KEY", "RUNPOD_PARSE_ENDPOINT_ID"];

test("the guard: unarmed → 501, bad key → 401, key via header or ?key=", async () => {
  for (const k of ENV) delete process.env[k];
  let { server, port } = await startServer();
  let r = await call(port, "GET", "/console");
  assert.equal(r.status, 501, "no PARSE_CONSOLE_KEY — routes are unarmed, with the fix named");
  assert.match(r.text, /PARSE_CONSOLE_KEY/);
  await stop(server);

  process.env.PARSE_CONSOLE_KEY = "sekrit";
  ({ server, port } = await startServer());
  r = await call(port, "GET", "/console");
  assert.equal(r.status, 401, "armed but unauthenticated");
  r = await call(port, "GET", "/console?key=wrong");
  assert.equal(r.status, 401);
  r = await call(port, "GET", "/console/status?key=sekrit");
  assert.equal(r.status, 200);
  r = await call(port, "GET", "/console/status", { headers: { "x-parse-console-key": "sekrit" } });
  assert.equal(r.status, 200, "header works too");
  await stop(server);
});

test("POST runs the REAL extraction path and returns blocks + markdown + wallMs", async () => {
  process.env.PARSE_CONSOLE_KEY = "sekrit";
  process.env.RUNPOD_API_KEY = "rpa_test";
  process.env.RUNPOD_PARSE_ENDPOINT_ID = "ep_console";
  const seen = [];
  const realFetch = globalThis.fetch;
  // Only the RunPod URL is stubbed — the harness's own localhost calls
  // pass through to the real fetch.
  globalThis.fetch = async (url, opts = {}) => {
    if (!String(url).startsWith("https://api.runpod.ai")) return realFetch(url, opts);
    seen.push({ url, auth: opts.headers?.authorization });
    return { ok: true, status: 200, json: async () => ({ status: "COMPLETED", output: {
      blocks: [{ bbox_2d: [10, 20, 300, 80], text_content: "Visit Date: 08/12/2025" }],
      model: "hanji-dev/hanji-parse-4b",
    } }) };
  };
  try {
    const { server, port } = await startServer();
    const r = await call(port, "POST", "/console", {
      headers: { "x-parse-console-key": "sekrit", "content-type": "application/json" },
      body: JSON.stringify({ imageBase64: PNG_DATA_URI, maxNewTokens: 4096 }),
    });
    assert.equal(r.status, 200);
    const j = JSON.parse(r.text);
    assert.equal(j.success, true);
    assert.equal(j.data.blocks[0].text_content, "Visit Date: 08/12/2025");
    assert.match(j.data.markdown, /Visit Date/);
    assert.ok(Number.isFinite(j.data.wallMs));
    assert.equal(seen.length, 1, "exactly one RunPod call");
    assert.equal(seen[0].url, "https://api.runpod.ai/v2/ep_console/runsync", "the real endpoint, runsync");
    assert.equal(seen[0].auth, "Bearer rpa_test");

    // the status poll now carries the run
    const s = JSON.parse((await call(port, "GET", "/console/status?key=sekrit")).text);
    assert.equal(s.data.last.ok, true);
    assert.equal(s.data.last.blocks, 1);
    assert.equal(s.data.configured, true);
    await stop(server);
  } finally { globalThis.fetch = realFetch; }
});

test("unconfigured RunPod → 501; bad input → 400; worker error → 502 + shown in status", async () => {
  process.env.PARSE_CONSOLE_KEY = "sekrit";
  delete process.env.RUNPOD_API_KEY;
  delete process.env.RUNPOD_PARSE_ENDPOINT_ID;
  let { server, port } = await startServer();
  let r = await call(port, "POST", "/console", {
    headers: { "x-parse-console-key": "sekrit", "content-type": "application/json" },
    body: JSON.stringify({ imageBase64: PNG_DATA_URI }),
  });
  assert.equal(r.status, 501);
  assert.match(r.text, /RUNPOD_API_KEY/);
  await stop(server);

  process.env.RUNPOD_API_KEY = "rpa_test";
  process.env.RUNPOD_PARSE_ENDPOINT_ID = "ep_console";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (!String(url).startsWith("https://api.runpod.ai")) return realFetch(url, opts);
    return { ok: true, status: 200, json: async () => ({ status: "COMPLETED", output: { error: "Model unavailable: Cached model not found" } }) };
  };
  try {
    ({ server, port } = await startServer());
    const H = { "x-parse-console-key": "sekrit", "content-type": "application/json" };
    let res = await call(port, "POST", "/console", { headers: H, body: JSON.stringify({}) });
    assert.equal(res.status, 400, "no image at all");
    res = await call(port, "POST", "/console", { headers: H, body: JSON.stringify({ imageBase64: PNG_DATA_URI }) });
    assert.equal(res.status, 502, "the worker's readable error surfaces");
    assert.match(res.text, /Model unavailable/);
    const s = JSON.parse((await call(port, "GET", "/console/status?key=sekrit")).text);
    assert.equal(s.data.last.ok, false);
    assert.match(s.data.last.error, /Model unavailable/);
    await stop(server);
  } finally { globalThis.fetch = realFetch; }
});

test("the console page is self-sufficient and the app mounts it", () => {
  assert.match(consoleSrc, /type="file"/, "file picker");
  assert.match(consoleSrc, /readAsDataURL/, "client-side base64");
  assert.match(consoleSrc, /x-parse-console-key/, "the page echoes the key as a header");
  assert.match(consoleSrc, /console\/status/, "status poll on load");
  assert.match(consoleSrc, /first call on a cold worker loads the model/, "honest latency note");
  assert.ok(!consoleSrc.includes("process.env.RUNPOD_API_KEY") || !consoleSrc.split("router.get(\"/console\"")[1].includes("RUNPOD_API_KEY"),
    "the page never embeds server secrets");

  assert.match(appJs, /parseConsoleModule/, "imported in app.js");
  assert.match(appJs, /app\.use\("\/api\/parse"/, "mounted at /api/parse");
  assert.match(envExample, /PARSE_CONSOLE_KEY/, "the env var is documented");
});
