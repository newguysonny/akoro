#!/usr/bin/env node
/**
 * The frontend gate — run the learner app's journeys in a real browser and
 * print a verdict (README.md beside this file).
 *
 *   node ui-gate/run.mjs [--target local|live] [--suite reader|auth|all]
 *                        [--scenario name] [--device phone,desktop]
 *                        [--learner tester17] [--headed] [--out dir]
 *                        [--no-build]   (local: reuse the last build)
 *
 * Exit code 0 only for PASS.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGate } from './lib/gate.mjs';
import { SUITES, ALL } from './scenarios/index.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const flag = (name) => args.includes(`--${name}`);

const target = opt('target', process.env.UI_GATE_APP ? 'live' : 'local');
const suite = opt('suite', 'all');
const only = opt('scenario');
let scenarios = SUITES[suite];
if (!scenarios) { console.error(`Unknown suite "${suite}". Suites: ${Object.keys(SUITES).join(', ')}`); process.exit(2); }
if (only) {
  // A scenario brings the ones it needs (and theirs) along.
  const byName = new Map(ALL.map((s) => [s.name, s]));
  if (!byName.has(only)) { console.error(`Unknown scenario "${only}". Scenarios: ${ALL.map((s) => s.name).join(', ')}`); process.exit(2); }
  const want = new Set();
  const add = (n) => { if (want.has(n)) return; want.add(n); (byName.get(n).needs || []).forEach(add); };
  add(only);
  scenarios = ALL.filter((s) => want.has(s.name));
}
const deviceNames = String(opt('device', 'phone,desktop')).split(',').map((s) => s.trim()).filter(Boolean);
const outDir = path.resolve(opt('out', path.join(path.dirname(fileURLToPath(import.meta.url)), '.out')));

const report = await runGate({ target, app: opt('app', process.env.UI_GATE_APP), api: opt('api', process.env.UI_GATE_API || 'https://api.akoro.name.ng'),
  learner: opt('learner', process.env.UI_GATE_LEARNER || 'tester17'), scenarios, deviceNames, outDir, headed: flag('headed'), build: !flag('no-build') });

console.log(`\nFrontend gate · ${report.target} · ${report.app || '(no app)'} → ${report.api} · as ${report.learner}`);
for (const s of report.scenarios) {
  console.log(`  ${s.verdict.padEnd(12)} ${s.name} [${s.device}]${s.reason ? ` — ${s.reason}` : ''}`);
  for (const c of s.checks || []) if (!c.passed) console.log(`      ✗ ${c.name}${'expected' in c ? ` (expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.actual)})` : 'actual' in c ? ` (got ${JSON.stringify(c.actual)})` : ''}`);
}
if (report.network && !report.network.websocket) console.log("  (this network's proxy doesn't carry WebSockets — the live-session check is BLOCKED here)");
console.log(`Verdict: ${report.verdict}   report: ${path.join(outDir, 'report.json')}\n`);
process.exit(report.verdict === 'PASS' ? 0 : 1);
