/**
 * modules/self-tooling/sandbox — stage 3 (plan §7.7): run one small function
 * the tool builder wrote, safely.
 *
 *   function run(input, data, akoro) { … return rows; }
 *
 * DATA IN, ANSWER OUT. The code never calls Akoro: the tool's definition
 * declares which views/capabilities it reads, the host reads them (forced to
 * the learner's own rows, as for every tool) and passes them in as `data`.
 * So there is no bridge to misuse, and nothing in the sandbox can reach the
 * network, files, the database or another learner.
 *
 * Containment: static checks before running; a fresh QuickJS (WebAssembly)
 * runtime in a fresh worker thread per run; 32 MB QuickJS memory, a CPU
 * deadline via QuickJS's interrupt handler, a hard wall deadline (the worker
 * is terminated), a V8 heap cap on the worker, and a 64 KB answer limit.
 */
import { Worker } from "node:worker_threads";

export const CODE_LIMITS = Object.freeze({
  sourceBytes: 8 * 1024,
  memoryBytes: 32 * 1024 * 1024,
  stackBytes: 512 * 1024,
  cpuMs: 500,
  wallMs: 2_000,
  outputBytes: 64 * 1024,
  longLiteral: 400,
});

// ON by default (2026-11-03): stage 3 is how new tools — and Phase 20 plugin
// blocks — get logic a recipe can't express. Set the variable to
// false / 0 / off to turn sandboxed code off on a server.
export const codeEnabled = () => !/^(false|0|off|no)$/.test(String(process.env.AKORO_SELF_TOOLING_CODE_ENABLED ?? "").trim().toLowerCase());

// Names that have no business in a data tool. The sandbox has none of the
// host's objects anyway; these keep generated code plain and reviewable.
const BANNED = [
  [/\beval\b/, "eval"], [/\bFunction\b/, "Function"], [/\bimport\b/, "import"], [/\brequire\b/, "require"],
  [/\bglobalThis\b/, "globalThis"], [/\bconstructor\b/, "constructor"], [/__proto__|\bprototype\b/, "prototypes"],
  [/\bprocess\b/, "process"], [/\bReflect\b/, "Reflect"], [/\bProxy\b/, "Proxy"], [/\bWebAssembly\b/, "WebAssembly"],
  [/\bSharedArrayBuffer\b|\bAtomics\b/, "shared memory"], [/\bfetch\b|\bXMLHttpRequest\b|\bWebSocket\b/, "network"],
  [/\bsetTimeout\b|\bsetInterval\b|\bqueueMicrotask\b/, "timers"], [/\basync\b|\bawait\b/, "async code"],
  [/\bwith\s*\(/, "with"], [/\bthis\b/, "this"],
];

/** → errors[] (empty = passes). */
export function staticCheck(source) {
  const errors = [];
  const src = String(source ?? "");
  if (!src.trim()) return ["the code is empty"];
  if (Buffer.byteLength(src) > CODE_LIMITS.sourceBytes) errors.push(`the code is over ${CODE_LIMITS.sourceBytes / 1024} KB`);
  if (!/\bfunction\s+run\s*\(/.test(src)) errors.push("the code must define function run(input, data, akoro)");
  // Strip strings and comments before looking for names, so "Function" in a label isn't flagged.
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
    .replace(/`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (m) => {
      if (m.length > CODE_LIMITS.longLiteral) errors.push("a text literal is too long");
      if (m.startsWith("`") && m.includes("${")) errors.push("template literals with ${…} aren't allowed — join strings with +");
      return '""';
    });
  for (const [re, what] of BANNED) if (re.test(bare)) errors.push(`not allowed in a tool: ${what}`);
  return [...new Set(errors)];
}

const WORKER = new URL("./worker.js", import.meta.url);

/**
 * Run checked source. → { ok: true, value } | { ok: false, error }
 * `payload`: { input, data, akoro } — plain JSON only.
 */
export function runCode(source, payload, limits = CODE_LIMITS) {
  const problems = staticCheck(source);
  if (problems.length) return Promise.resolve({ ok: false, error: problems.join("; ") });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
    let worker;
    try {
      worker = new Worker(WORKER, {
        workerData: { source, payload: JSON.parse(JSON.stringify(payload ?? {})), limits },
        resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, codeRangeSizeMb: 16, stackSizeMb: 4 },
        env: {}, stdout: true, stderr: true,     // no host env; its output isn't forwarded
      });
    } catch (e) {
      return resolve({ ok: false, error: `sandbox unavailable: ${e.message}` });
    }
    const timer = setTimeout(() => { worker.terminate().catch(() => {}); finish({ ok: false, error: "the code ran too long" }); }, limits.wallMs);
    worker.once("message", (m) => {
      worker.terminate().catch(() => {});
      if (!m?.ok) return finish({ ok: false, error: m?.error || "the code failed" });
      try { finish({ ok: true, value: JSON.parse(m.json) }); }
      catch { finish({ ok: false, error: "the code's answer isn't valid JSON" }); }
    });
    worker.once("error", (e) => finish({ ok: false, error: /memory|heap/i.test(String(e?.message)) ? "the code used too much memory" : `sandbox error: ${String(e?.message || e).slice(0, 200)}` }));
    worker.once("exit", (code) => finish({ ok: false, error: `sandbox stopped (${code})` }));
  });
}

/** The answer as rows: an array of plain objects (a bare array of values becomes { value }). */
export function asRows(value) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.rows) ? value.rows : value == null ? [] : [value];
  return list.map((r) => (r && typeof r === "object" && !Array.isArray(r) ? r : { value: r }));
}
