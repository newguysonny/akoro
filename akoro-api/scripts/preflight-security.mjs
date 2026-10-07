#!/usr/bin/env node
/**
 * preflight-security.mjs
 * ─────────────────────────────────────────────────────────────
 * Deploy gate for the SECURITY_CHECKLIST.md §1 "Must confirm" items.
 * Verifies the PRODUCTION environment/config is safe, then (optionally)
 * probes a running instance to confirm live behaviour.
 *
 * The config checks live in lib/preflightChecks.js and are shared with the
 * GET /internal/preflight endpoint, so CLI and endpoint never drift.
 *
 * Run it with the PROD env loaded (on the platform, or with the env file):
 *   NODE_ENV=production node scripts/preflight-security.mjs
 *   node scripts/preflight-security.mjs --url=https://api.yourdomain.com
 *
 * Exit code: 0 → all blockers passed · 1 → a blocker FAILED (do not ship).
 * Warnings (⚠️) never fail the gate — they're advisories.
 */

import { runConfigChecks } from "../lib/preflightChecks.js";

const urlArg = process.argv.find((a) => a.startsWith("--url="))?.split("=")[1];
const ICON = { pass: "✅", warn: "⚠️ ", fail: "❌" };

console.log("\n── Akoro production security preflight ──────────────────────\n");

const { summary, checks } = runConfigChecks(process.env);
for (const c of checks) console.log(`${ICON[c.status]}  ${c.label}${c.detail ? `  — ${c.detail}` : ""}`);
let fail = summary.fail, warn = summary.warn, pass = summary.pass;

// ── Optional: probe a running instance (things env alone can't prove) ──────────
async function probe(base) {
  console.log(`\n── Live probe: ${base} ──────────────────────────────────────\n`);
  const root = base.replace(/\/+$/, "");
  const ok = (l, d) => { pass++; console.log(`✅  ${l}${d ? `  — ${d}` : ""}`); };
  const bad = (l, d) => { fail++; console.log(`❌  ${l}${d ? `  — ${d}` : ""}`); };
  const soft = (l, d) => { warn++; console.log(`⚠️   ${l}${d ? `  — ${d}` : ""}`); };

  try {
    const r = await fetch(`${root}/health`, { redirect: "manual" });
    r.ok ? ok("GET /health responds", `${r.status}`) : soft("GET /health non-200", `${r.status}`);
  } catch (e) { bad("GET /health unreachable", e.message); }

  try {
    const r = await fetch(`${root}/api/auth/me`, { headers: { "X-Akoro-Portal": "school" } });
    r.status === 401 ? ok("Protected route returns 401 when unauthenticated") : bad("Protected route did not return 401", `got ${r.status}`);
  } catch (e) { soft("Could not probe protected route", e.message); }

  root.startsWith("https://") ? ok("API served over HTTPS") : bad("API not over HTTPS", root);

  try {
    const r = await fetch(`${root}/health`);
    const h = r.headers;
    (h.get("x-frame-options") || h.get("x-content-type-options") || h.get("x-dns-prefetch-control"))
      ? ok("Security headers present (helmet)") : soft("Expected helmet headers not seen", "check helmet is applied");
  } catch { /* covered above */ }

  try {
    const evil = "https://evil.example.com";
    const r = await fetch(`${root}/health`, { headers: { Origin: evil } });
    const acao = r.headers.get("access-control-allow-origin");
    (acao === evil || acao === "*")
      ? bad("CORS reflects an untrusted origin", `access-control-allow-origin: ${acao}`)
      : ok("CORS does not reflect an untrusted origin", acao ? `ACAO: ${acao}` : "no ACAO for foreign origin");
  } catch (e) { soft("Could not probe CORS", e.message); }
}

const done = () => {
  console.log(`\n────────────────────────────────────────────────────────────`);
  console.log(`  ${pass} passed · ${warn} warning(s) · ${fail} blocker(s) failed`);
  if (fail) { console.log(`  ❌ NOT ready to ship — fix the blockers above.\n`); process.exit(1); }
  console.log(`  ✅ Config blockers are GREEN.${warn ? " Review warnings before launch." : ""}\n`);
  process.exit(0);
};

if (urlArg) probe(urlArg).then(done); else done();
