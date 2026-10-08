/**
 * modules/hfmirror/hfmirror.contract.test.mjs
 *
 * Guards the Hugging Face mirror (modules/hfmirror):
 *   • the engine's pure helpers behave (repo-id parsing, target
 *     resolution, byte formatting, token redaction);
 *   • a DRY RUN actually runs end-to-end against a mocked Hub (whoami
 *     + file tree), plans the mirror, and never leaks the token into
 *     the job log;
 *   • a REAL RUN prefers the Hub's server-side duplicate (no model
 *     bytes through this process), and when the destination already
 *     exists it RESUMES file-by-file — skipping everything already
 *     there — instead of aborting (the OOM-restart incident);
 *   • the console routes keep their safe defaults (dry run on, private
 *     on), stay key-guarded, and can't double-run;
 *   • the module is mounted and its env contract is documented.
 *
 * Everything here runs offline — the mock fetch stands in for
 * huggingface.co, which the test environment can't reach.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));

const read = (p) => readFileSync(join(here, p), "utf8");
const [engineSrc, routesSrc, appSrc, pkg, envExample] = await Promise.all([
  read("engine.js"),
  read("routes.js"),
  read("../../app.js"),
  read("../../package.json"),
  read("../../.env.example"),
]);

const { parseRepoId, resolveTarget, formatBytes, scrub, runMirrorJob } =
  await import("./engine.js");

/* ── pure helpers ──────────────────────────────────────────────────────── */

test("parseRepoId accepts owner/name, hf.co URLs and models/ prefixes", () => {
  assert.equal(parseRepoId("openai/whisper-large-v3").id, "openai/whisper-large-v3");
  assert.equal(parseRepoId("https://huggingface.co/openai/whisper-large-v3").id, "openai/whisper-large-v3");
  assert.equal(parseRepoId("https://hf.co/openai/whisper-large-v3.git").id, "openai/whisper-large-v3");
  assert.equal(parseRepoId("models/openai/whisper-large-v3").id, "openai/whisper-large-v3");
  assert.equal(parseRepoId("  org/name  ").id, "org/name");
});

test("parseRepoId rejects the shapes that would break the transfer", () => {
  for (const bad of ["", "just-a-name", "a/b/c", "org/", "/name", "org/../etc", "org/na me", null]) {
    assert.equal(parseRepoId(bad).ok, false, `expected rejection: ${JSON.stringify(bad)}`);
  }
});

test("resolveTarget: explicit wins, otherwise the token's account names it", () => {
  assert.equal(resolveTarget({ target: "my-org/my-copy", sourceId: "openai/whisper-large-v3", accountName: "me" }).id, "my-org/my-copy");
  assert.equal(resolveTarget({ target: null, sourceId: "openai/whisper-large-v3", accountName: "me" }).id, "me/whisper-large-v3");
  assert.equal(resolveTarget({ target: null, sourceId: "openai/whisper-large-v3", accountName: null }).ok, false);
  assert.equal(resolveTarget({ target: "bad target!", sourceId: "openai/whisper-large-v3", accountName: "me" }).ok, false);
});

test("formatBytes speaks human", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1048576), "1.0 MB");
  assert.equal(formatBytes(1610612736), "1.5 GB");
});

test("scrub redacts anything shaped like an access token", () => {
  const token = `hf_${"a".repeat(34)}`;
  assert.equal(scrub(`downloading with Bearer ${token} failed`), "downloading with Bearer hf_*** failed");
  assert.equal(scrub("no tokens here"), "no tokens here");
  assert.equal(scrub(null), "");
});

/* ── the dry-run path, end to end, against a mocked Hub ────────────────── */

const MOCK_TOKEN = `hf_${"t".repeat(34)}`;

/** Minimal stand-in for huggingface.co: whoami + the NDJSON file tree. */
function mockHubFetch(url) {
  const u = String(url);
  if (u.includes("/api/whoami-v2")) {
    return Promise.resolve(new Response(JSON.stringify({
      name: "tester",
      type: "user",
      auth: { accessToken: { displayName: "test", role: "write", createdAt: "2026-01-01T00:00:00.000Z" } },
    }), { status: 200 }));
  }
  if (u.includes("/api/models/org/source-model/tree/")) {
    const tree = [
      { type: "file", path: "config.json", size: 739 },
      { type: "file", path: "tokenizer.json", size: 713_164 },
      { type: "directory", path: "sub" },
      { type: "file", path: "model.safetensors", size: 4_000_000_000, lfs: { oid: "9a03…", size: 4_000_000_000, pointerSize: 134 } },
    ];
    return Promise.resolve(new Response(JSON.stringify(tree), { status: 200 }));
  }
  return Promise.resolve(new Response(JSON.stringify({ error: "unexpected " + u }), { status: 404 }));
}

test("dry run plans the whole mirror and never leaks the token", async () => {
  const lines = [];
  const summary = await runMirrorJob(
    {
      source: "https://huggingface.co/org/source-model",
      target: null,
      dryRun: true,
      writeToken: MOCK_TOKEN,
      fetchImpl: mockHubFetch,
    },
    { onLog: (line) => lines.push(line) },
  );

  assert.equal(summary.dryRun, true);
  assert.equal(summary.ok, true);
  assert.equal(summary.source, "org/source-model");
  assert.equal(summary.target, "tester/source-model");   // derived from the token's account
  assert.equal(summary.files, 3);                        // directories don't count
  assert.equal(summary.totalBytes, 739 + 713_164 + 4_000_000_000);
  assert.deepEqual(summary.failures, []);

  const logText = lines.join("\n");
  assert.match(logText, /plan: 3 files/);
  assert.match(logText, /account tester/);
  assert.match(logText, /dry run — nothing was created or uploaded/);
  assert.ok(!logText.includes(MOCK_TOKEN), "the token must never appear in the job log");
});

test("a bad source repo id aborts before any Hub call", async () => {
  await assert.rejects(
    () => runMirrorJob({ source: "not-a-repo-id", dryRun: true, writeToken: MOCK_TOKEN, fetchImpl: mockHubFetch }),
    /owner\/name/,
  );
});

/* ── the real run: duplicate-first, resume-into-existing ───────────────── */

const HF_ALREADY = "You already created this model repo: tester/source-model. URL: https://huggingface.co/api/repos/create";

/** A mock hub that records every call, so tests can assert what the engine
 *  did (and did NOT) ask the Hub to do. */
function realRunHub({ duplicateStatus, duplicateBody, destTree, createStatus = 201 }) {
  const calls = [];
  const respond = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },   // the lib reads the error body only under this type
  });
  return {
    calls,
    fetch(url, init) {
      const u = String(url);
      calls.push(`${init?.method || "GET"} ${u}`);
      if (u.includes("/api/whoami-v2")) {
        return Promise.resolve(respond(200, {
          name: "tester", type: "user",
          auth: { accessToken: { displayName: "test", role: "write", createdAt: "2026-01-01T00:00:00.000Z" } },
        }));
      }
      if (u.includes("/api/models/org/source-model/tree/")) {
        return Promise.resolve(respond(200, [
          { type: "file", path: "config.json", size: 739 },
          { type: "file", path: "tokenizer.json", size: 713_164 },
          { type: "file", path: "model.safetensors", size: 4_600_000_000, lfs: { oid: "x", size: 4_600_000_000 } },
        ]));
      }
      if (u.includes("/api/models/org/source-model/duplicate")) {
        return Promise.resolve(respond(duplicateStatus, duplicateBody));
      }
      if (u.includes("/api/repos/create")) {
        return Promise.resolve(respond(createStatus, createStatus === 409 ? JSON.stringify({ error: HF_ALREADY }) : { name: "tester/source-model" }));
      }
      if (u.includes("/api/models/tester/source-model/tree/")) {
        return Promise.resolve(respond(200, destTree));
      }
      return Promise.resolve(respond(404, { error: "unexpected " + u }));
    },
  };
}

const runReal = (hub) => {
  const lines = [];
  return runMirrorJob(
    { source: "org/source-model", dryRun: false, writeToken: MOCK_TOKEN, fetchImpl: hub.fetch },
    { onLog: (line) => lines.push(line) },
  ).then((summary) => ({ summary, lines, calls: hub.calls }));
};

test("a real run duplicates server-side — no model bytes cross this process", async () => {
  const hub = realRunHub({ duplicateStatus: 200, duplicateBody: { url: "https://huggingface.co/tester/source-model", filesCopyPending: true } });
  const { summary, lines, calls } = await runReal(hub);

  assert.equal(summary.duplicated, true);
  assert.equal(summary.ok, true);
  assert.equal(summary.transferredBytes, 0, "the Hub copies the weights — nothing moved through the mirror");
  assert.equal(summary.failures.length, 0);
  assert.match(lines.join("\n"), /no model bytes moved through this server/);
  assert.match(lines.join("\n"), /copying the LFS\/xet files in the background/);
  assert.ok(!calls.some((c) => c.includes("/api/repos/create")), "the duplicate creates the repo — no separate create");
  assert.ok(!calls.some((c) => c.includes("tester/source-model/tree")), "no per-file work — the destination tree is never even listed");
  assert.ok(!calls.some((c) => c.includes("resolve/")), "no file downloads");
});

test("an existing destination resumes file-by-file instead of aborting", async () => {
  // The OOM-restart incident: duplicate → 409, create → HF's "already
  // created" phrasing, and a destination holding the small files already.
  const hub = realRunHub({
    duplicateStatus: 409,
    duplicateBody: { error: HF_ALREADY },
    createStatus: 409,
    destTree: [
      { type: "file", path: "config.json", size: 739 },
      { type: "file", path: "tokenizer.json", size: 713_164 },
      { type: "file", path: "model.safetensors", size: 4_600_000_000, lfs: { oid: "x", size: 4_600_000_000 } },
    ],
  });
  const { summary, lines, calls } = await runReal(hub);

  assert.equal(summary.duplicated, false);
  assert.equal(summary.ok, true);
  assert.equal(summary.copied, 3, "every file already in the destination counts as done");
  assert.equal(summary.failures.length, 0);
  assert.match(lines.join("\n"), /already exists — resuming into it file-by-file/);
  assert.match(lines.join("\n"), /already in the destination, skipped \(resume\)/);
  assert.ok(!calls.some((c) => c.includes("resolve/")), "nothing re-downloads — the shards stay where they are");
});

test("a refused duplicate falls back to create + per-file transfer", async () => {
  const hub = realRunHub({
    duplicateStatus: 404,
    duplicateBody: { error: "not supported here" },
    createStatus: 201,
    destTree: [{ type: "file", path: "config.json", size: 739 }],
  });
  const { summary, lines, calls } = await runReal(hub);

  assert.equal(summary.duplicated, false);
  assert.match(lines.join("\n"), /server-side duplicate refused \(404\)/);
  assert.match(lines.join("\n"), /created tester\/source-model \(private\)/);
  assert.ok(calls.some((c) => c.includes("/api/repos/create")), "the fallback creates the destination itself");
  assert.match(lines.join("\n"), /config\.json.*already in the destination/);
});

/* ── source-level wiring ───────────────────────────────────────────────── */

test("the engine streams from source URLs — nothing touches RAM or disk", () => {
  assert.match(engineSrc, /from "@huggingface\/hub"/, "the official hub client");
  assert.match(engineSrc, /\/resolve\/\$\{encodeURIComponent\(revision\)\}\//, "files are addressed by their source resolve URL");
  assert.match(engineSrc, /content: url/, "uploadFiles streams from that URL (lazy WebBlob, no temp file)");
  assert.match(engineSrc, /useXet: false/, "per-file uploads ride a single stream — the xet sharder's parallel buffers OOM small instances");
  assert.doesNotMatch(engineSrc, /createWriteStream|mkdtemp|openAsBlob/, "no temp files — Render's small disk stays untouched");
  assert.match(engineSrc, /visibility: isPrivate \? "private" : "public"/, "destination visibility is honoured");
  assert.match(engineSrc, /scrub\(friendly\)/, "even failure messages are token-scrubbed");
  assert.match(engineSrc, /dryRun = true/, "dry run is the engine default");
  assert.match(engineSrc, /isPrivate = true/, "private is the engine default");
});

test("the console routes are key-guarded with safe defaults", () => {
  assert.match(routesSrc, /HF_MIRROR_KEY/, "console shared secret");
  assert.match(routesSrc, /x-hf-mirror-key/, "the key rides a header");
  assert.match(routesSrc, /dryRun: req\.body\?\.dryRun !== false/, "absent dryRun means dry run");
  assert.match(routesSrc, /private !== false/, "absent private means private");
  assert.match(routesSrc, /409/, "a running job can't double-start");
  assert.match(routesSrc, /HF_TOKEN/, "the write token gate");
  assert.match(routesSrc, /CONSOLE_HTML/, "the console page exists");
  assert.match(routesSrc, /\/mirror\/status/, "the status endpoint exists");
  assert.match(routesSrc, /textContent/, "the log renders as text, never innerHTML");
  assert.match(routesSrc, /setInterval\(refresh, 10000\)/, "polling is throttled to 10s (metered connections)");
  assert.match(routesSrc, /keep this tab open/i, "the console tells the operator to keep the tab open while a job runs");
});

test("the mirror is mounted and its env contract is documented", () => {
  assert.match(appSrc, /from "\.\/modules\/hfmirror\/routes\.js"/);
  assert.match(appSrc, /app\.use\("\/api\/hf"/);
  assert.match(pkg, /"@huggingface\/hub"/, "the hub client is a real dependency");
  assert.match(envExample, /HF_MIRROR_KEY/);
  assert.match(envExample, /HF_TOKEN/);
  assert.match(envExample, /HF_SOURCE_TOKEN/);
  assert.match(envExample, /HF_MAX_FILE_MB/);
});
