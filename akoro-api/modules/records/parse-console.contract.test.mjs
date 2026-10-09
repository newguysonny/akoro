import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import express from "express";

/**
 * Parse-worker console contract — the operator's browser surface for the
 * RunPod hanji-parse endpoint. The run is ASYNC (submit → jobId, then the
 * page polls /console/status?jobId=…) because proxies in front of the API
 * (Cloudflare ~100s, Render restart windows) kill long-held requests with
 * HTML error pages — a GPU job must never ride one. Same front door as
 * the HF mirror console: shared-key guard (501 unarmed / 401 bad key).
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
   server.close() alone never drains and the test runner hangs. */
const stop = (server) => new Promise((resolve) => {
  server.closeAllConnections?.();
  server.close(() => resolve());
});
const call = async (port, method, path, { headers = {}, body } = {}) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { ...headers, connection: "close" }, body });
  return { status: res.status, text: await res.text() };
};

/* 1×1 PNG as a data: URI — what the console's FileReader produces */
const PNG_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const ENV = ["PARSE_CONSOLE_KEY", "RUNPOD_API_KEY", "RUNPOD_PARSE_ENDPOINT_ID"];
const H = { "x-parse-console-key": "sekrit", "content-type": "application/json" };

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

test("the run is ASYNC: POST submits to /run → jobId; the poll returns the parsed page", async () => {
  process.env.PARSE_CONSOLE_KEY = "sekrit";
  process.env.RUNPOD_API_KEY = "rpa_test";
  process.env.RUNPOD_PARSE_ENDPOINT_ID = "ep_console";
  const seen = [];
  const realFetch = globalThis.fetch;
  // Only RunPod URLs are stubbed — the harness's own localhost calls pass through.
  globalThis.fetch = async (url, opts = {}) => {
    if (!String(url).startsWith("https://api.runpod.ai")) return realFetch(url, opts);
    seen.push({ url, auth: opts.headers?.authorization });
    if (String(url).endsWith("/run")) {
      return { ok: true, status: 200, json: async () => ({ id: "job_42", status: "IN_QUEUE" }) };
    }
    return { ok: true, status: 200, json: async () => ({ id: "job_42", status: "COMPLETED", output: {
      blocks: [{ bbox_2d: [10, 20, 300, 80], text_content: "Visit Date: 08/12/2025" }],
      model: "hanji-dev/hanji-parse-4b", wall_ms: 1234,
    } }) };
  };
  try {
    const { server, port } = await startServer();
    const r = await call(port, "POST", "/console", { headers: H, body: JSON.stringify({ imageBase64: PNG_DATA_URI, maxNewTokens: 4096 }) });
    assert.equal(r.status, 200);
    const j = JSON.parse(r.text);
    assert.equal(j.success, true);
    assert.equal(j.data.jobId, "job_42", "submit returns a jobId, NOT the page — no held-open request");
    assert.equal(seen[0].url, "https://api.runpod.ai/v2/ep_console/run", "submits to /run, never runsync");

    // the poll: done + shaped result
    const p = JSON.parse((await call(port, "GET", "/console/status?jobId=job_42", { headers: H })).text);
    assert.equal(p.success, true);
    assert.equal(p.data.job.done, true, JSON.stringify(p).slice(0, 300));
    assert.equal(p.data.job.blocks[0].text_content, "Visit Date: 08/12/2025");
    assert.match(p.data.job.markdown, /Visit Date/);
    assert.equal(p.data.job.model, "hanji-dev/hanji-parse-4b");
    assert.ok(seen.some((s) => s.url === "https://api.runpod.ai/v2/ep_console/status/job_42"), "polls RunPod's status endpoint");

    // the header status carries the run
    const s = JSON.parse((await call(port, "GET", "/console/status?key=sekrit")).text);
    assert.equal(s.data.last.ok, true);
    assert.equal(s.data.last.blocks, 1);
    server.close();
    await stop(server);
  } finally { globalThis.fetch = realFetch; }
});

test("unconfigured → 501; empty image → 400 (no job submitted); submit failure → 502; job error surfaces readably", async () => {
  process.env.PARSE_CONSOLE_KEY = "sekrit";
  delete process.env.RUNPOD_API_KEY;
  delete process.env.RUNPOD_PARSE_ENDPOINT_ID;
  let { server, port } = await startServer();
  let r = await call(port, "POST", "/console", { headers: H, body: JSON.stringify({ imageBase64: PNG_DATA_URI }) });
  assert.equal(r.status, 501);
  assert.match(r.text, /RUNPOD_API_KEY/);
  await stop(server);

  process.env.RUNPOD_API_KEY = "rpa_test";
  process.env.RUNPOD_PARSE_ENDPOINT_ID = "ep_console";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (!String(url).startsWith("https://api.runpod.ai")) return realFetch(url, opts);
    if (String(url).endsWith("/run")) return { ok: false, status: 500, text: async () => "boom" };
    if (String(url).includes("/status/job_7")) return { ok: true, status: 200, json: async () => ({ id: "job_7", status: "FAILED", output: { error: "Model unavailable: Cached model not found" } }) };
    if (String(url).includes("/status/job_9")) return { ok: true, status: 200, json: async () => ({ id: "job_9", status: "FAILED", output: null }) };
  };
  try {
    ({ server, port } = await startServer());
    let res = await call(port, "POST", "/console", { headers: H, body: JSON.stringify({}) });
    assert.equal(res.status, 400, "no image at all — rejected before any job");
    res = await call(port, "POST", "/console", { headers: H, body: JSON.stringify({ imageBase64: PNG_DATA_URI }) });
    assert.equal(res.status, 502, "a failed submit surfaces readably");
    assert.match(res.text, /RunPod HTTP 500/);
    res = await call(port, "POST", "/console", { headers: H, body: JSON.stringify({ imageBase64: PNG_DATA_URI }) });
    // (third submit also 502s; now poll a completed-with-error job)
    res = await call(port, "GET", "/console/status?jobId=job_7", { headers: H });
    assert.equal(res.status, 200);
    let j = JSON.parse(res.text);
    assert.equal(j.data.job.done, true, JSON.stringify(j).slice(0, 300));
    assert.match(j.data.job.error, /Model unavailable/, "the worker's readable error is the result");
    res = await call(port, "GET", "/console/status?jobId=job_9", { headers: H });
    j = JSON.parse(res.text);
    assert.match(j.data.job.error, /no worker message.*RunPod console → Logs/, "a bare FAILED names where the traceback lives");
    await stop(server);
  } finally { globalThis.fetch = realFetch; }
});

test("the console page is self-sufficient, never cached, and the app mounts it", () => {
  assert.match(consoleSrc, /type="file"/, "file picker");
  assert.match(consoleSrc, /readAsDataURL/, "client-side base64");
  assert.match(consoleSrc, /x-parse-console-key/, "the page echoes the key as a header");
  assert.match(consoleSrc, /console\/status/, "status poll on load");
  assert.match(consoleSrc, /run'\).disabled = !v/, "Run arms only once an image is loaded — no empty 400s");
  assert.match(consoleSrc, /Cache-Control", "no-store/, "the page is never cached — an old console lies");
  assert.match(consoleSrc, /submit\+poll/, "version stamp");
  assert.match(consoleSrc, /polling…/, "the page polls instead of holding the request open");
  assert.match(consoleSrc, /first, ~10-20s|loads the model first/, "honest cold-start note");

  assert.match(appJs, /parseConsoleModule/, "imported in app.js");
  assert.match(appJs, /app\.use\("\/api\/parse"/, "mounted at /api/parse");
  assert.match(appJs, /app\.use\("\/api\/parse\/console",\s*express\.json\(\{ limit: "12mb" \}\)\)/,
    "scoped 12mb body parser BEFORE the global 2mb one — a real page image must not 413");
  assert.match(envExample, /PARSE_CONSOLE_KEY/, "the env var is documented");
  assert.match(consoleSrc, /parsePageRunAsync|\/run'/, "the module submits via /run");
});
