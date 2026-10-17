/**
 * ui-gate/lib/gate.mjs — the frontend gate's runner.
 *
 * Drives the REAL learner app in a real browser, signed in as a seeded test
 * learner (tester01–tester50 @demo.akoro.app, never a real account), and
 * gives every scenario a verdict like the API gate does:
 *
 *   PASS     every check held
 *   FAIL     a check did not hold (screenshot + video kept)
 *   BLOCKED  a precondition was missing (no network, no login, no deploy)
 *   ERROR    the scenario itself broke
 *
 * Two targets:
 *   live   the deployed app (UI_GATE_APP, e.g. https://akoro.name.ng) and
 *          its API (UI_GATE_API)
 *   local  this checkout, served by Vite on localhost with /api and
 *          /socket.io passed through to UI_GATE_API (vite.gate.config.mjs)
 *
 * Sign-in is the app's own login (POST /api/auth/login) — the gate adds no
 * way in. The password comes from UI_GATE_PASSWORD, else the demo password
 * documented in migrations/2026-seed-agent-testers.sql.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices as pwDevices } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '../..');
const DEMO_PASSWORD = 'Password123!';
export const TESTER = /^tester\d{2}$/i;

export const DEVICES = {
  // An Android phone with touch — how most learners use the app.
  phone: { ...pwDevices['Pixel 7'] },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};

class Blocked extends Error { constructor(m) { super(m); this.name = 'Blocked'; } }

/* ── local target: this checkout, built and served, API passed through ── */
function runVite(args, env) {
  const child = spawn(process.execPath, [path.join(APP_ROOT, 'node_modules/vite/bin/vite.js'), ...args, '--config', path.join(HERE, '../vite.gate.config.mjs')],
    { cwd: APP_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  return { child, log: () => log };
}

async function startLocalApp({ api, port, dist, build = true }) {
  const env = {
    ...process.env,
    UI_GATE_API: api, UI_GATE_PORT: String(port), UI_GATE_DIST: dist,
    VITE_API_URL: `http://127.0.0.1:${port}`,
  };
  if (build) {
    const b = runVite(['build', '--logLevel', 'warn'], env);
    const code = await new Promise((r) => b.child.on('exit', r));
    if (code !== 0) throw new Blocked(`building the app failed: ${b.log().slice(-600)}`);
  }
  const { child, log } = runVite(['preview'], env);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode != null) throw new Blocked(`the local app did not start: ${log().slice(-400)}`);
    try { const r = await fetch(url); if (r.ok) return { url, stop: () => child.kill('SIGTERM'), log }; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill('SIGTERM');
  throw new Blocked(`the local app did not answer on ${url} within 30s`);
}

/* ── what this network can carry ────────────────────────────────────────── */
/** Can a WebSocket reach the API from here? (Some outbound proxies drop the upgrade.) */
async function probeWebSocket(api) {
  const https = await import('node:https');
  const agent = process.env.HTTPS_PROXY ? new (await import('https-proxy-agent')).HttpsProxyAgent(process.env.HTTPS_PROXY) : undefined;
  return new Promise((resolve) => {
    const req = https.request(`${api}/socket.io/?EIO=4&transport=websocket`, {
      agent, timeout: 15_000,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', Origin: process.env.UI_GATE_ORIGIN || 'https://akoro.name.ng' },
    });
    req.on('upgrade', (_res, socket) => { socket.destroy(); resolve(true); });
    req.on('response', (res) => { res.resume(); resolve(false); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
}

/* ── sign-in, through the app's own login ───────────────────────────────── */
async function signIn(context, { authBase, learner }) {
  const username = String(learner || '').replace(/^@/, '');
  if (!TESTER.test(username)) throw new Blocked(`the frontend gate signs in only as a test learner (tester01–tester50), not "${learner}"`);
  const email = `${username.toLowerCase()}@demo.akoro.app`;
  let r;
  try {
    r = await context.request.post(`${authBase}/api/auth/login`, {
      headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'student' },
      data: { email, password: process.env.UI_GATE_PASSWORD || DEMO_PASSWORD },
    });
  } catch (e) { throw new Blocked(`the API did not answer the login: ${e.message}`); }
  const body = await r.json().catch(() => ({}));
  if (!r.ok()) throw new Blocked(`login as ${username} answered ${r.status()}: ${body?.message || 'no message'}`);
  const data = body.data || body;
  if (data.twoFactorRequired) throw new Blocked(`${username} has two-factor sign-in on; the gate can't pass it`);
  return { user: data.user, accessExpiresAt: data.accessExpiresAt, accessToken: data.accessToken };
}

/* ── one scenario's toolkit ─────────────────────────────────────────────── */
function toolkit({ page, context, app, api, session, state, outDir, scenario, device, network }) {
  const checks = [];
  const notes = [];
  const cleanups = [];
  const shots = [];
  const slug = `${scenario.name}.${device}`.replace(/[^a-z0-9._-]+/gi, '_');
  const check = (name, passed, detail = {}) => { checks.push({ name, passed: !!passed, ...detail }); return !!passed; };
  return {
    page, context, app, state, device, network,
    learner: session.user,
    /** An API call as the signed-in learner (the browser's own cookies). */
    api: async (method, p, data) => {
      // The learner's own access cookie, sent explicitly: over http://127.0.0.1
      // the request client holds back a Secure cookie the browser would send.
      const headers = { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'student', Cookie: `akoro_access_student=${session.accessToken}` };
      const r = await context.request.fetch(`${api}${p}`, { method, headers, ...(data !== undefined ? { data } : {}) });
      const body = await r.json().catch(() => null);
      return { status: r.status(), body };
    },
    check,
    equal: (name, actual, expected) => check(name, actual === expected, { expected, actual }),
    note: (text) => notes.push(String(text)),
    block: (reason) => { throw new Blocked(reason); },
    cleanup: (fn) => cleanups.push(fn),
    shot: async (name) => { const f = path.join(outDir, `${slug}.${name}.png`); await page.screenshot({ path: f }).catch(() => {}); shots.push(f); return f; },
    _result: () => ({ checks, notes, shots }),
    _cleanups: cleanups,
  };
}

/**
 * Run scenarios. → { verdict, target, app, api, learner, scenarios: [...] }
 * `scenarios`: [{ name, description, devices?, needs?, run(t) }], run in
 * order per device, sharing `state` (a record one uploads, the next reads);
 * `needs` names scenarios that must have passed first.
 */
export async function runGate({ target = 'local', app = process.env.UI_GATE_APP, api = process.env.UI_GATE_API || 'https://api.akoro.name.ng',
  learner = process.env.UI_GATE_LEARNER || 'tester17', scenarios, deviceNames = ['phone', 'desktop'], outDir, port = 4321, headed = false, video = true, build = true } = {}) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const report = { target, app: null, api, learner, startedAt: new Date().toISOString(), scenarios: [] };
  let local = null;
  let browser = null;
  const blockAll = (reason) => {
    for (const d of deviceNames) for (const s of scenarios) report.scenarios.push({ name: s.name, device: d, verdict: 'BLOCKED', reason, checks: [] });
  };
  try {
    if (target === 'local') {
      local = await startLocalApp({ api, port, dist: path.join(path.dirname(outDir), '.dist'), build });
      report.app = local.url;
    } else {
      if (!app) throw new Blocked('live target needs UI_GATE_APP (the deployed app URL)');
      report.app = app.replace(/\/+$/, '');
    }
    // Behind an outbound proxy (a cloud sandbox) the browser uses it for the
    // internet but reaches the local app directly. Chromium's own flags:
    // Playwright's proxy option sends loopback through the proxy too.
    const proxy = process.env.HTTPS_PROXY || null;
    browser = await chromium.launch({ headless: !headed,
      args: proxy ? [`--proxy-server=${proxy}`, '--proxy-bypass-list=127.0.0.1;localhost'] : [] });
    // Through an inspecting proxy the browser sees the proxy's certificate.
    const ignoreHTTPSErrors = !!proxy;
    const authBase = target === 'local' ? report.app : api;
    // What the gate's own network can carry; a scenario that needs what it
    // can't is BLOCKED with that reason, never passed or failed.
    const network = { websocket: await probeWebSocket(api) };
    report.network = network;

    for (const deviceName of deviceNames) {
      const dev = DEVICES[deviceName];
      if (!dev) { report.scenarios.push({ name: '(device)', device: deviceName, verdict: 'ERROR', reason: `unknown device ${deviceName}`, checks: [] }); continue; }
      // No service worker: a cached build or cached API answer would hide what is deployed.
      const context = await browser.newContext({ ...dev, ignoreHTTPSErrors, serviceWorkers: 'block', ...(video ? { recordVideo: { dir: path.join(outDir, 'video', deviceName), size: dev.viewport } } : {}) });
      const consoleErrors = [];
      let session;
      try {
        session = await signIn(context, { authBase, learner });
      } catch (e) {
        for (const s of scenarios) report.scenarios.push({ name: s.name, device: deviceName, verdict: 'BLOCKED', reason: e.message, checks: [] });
        await context.close();
        continue;
      }
      // What the app keeps after a sign-in (AuthContext + services/api.js).
      await context.addInitScript(({ user, exp }) => {
        try { localStorage.setItem('akoro_user', JSON.stringify(user)); localStorage.setItem('akoro_access_exp', String(exp)); } catch { /* storage off */ }
      }, { user: session.user, exp: session.accessExpiresAt });
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
      page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 300)}`));
      const state = {};
      const allCleanups = [];
      const verdictOf = new Map();
      for (const scenario of scenarios) {
        if (scenario.devices && !scenario.devices.includes(deviceName)) continue;
        // A scenario that builds on another (`needs`) runs only after it passed.
        const unmet = (scenario.needs || []).filter((n) => verdictOf.get(n) !== 'PASS');
        if (unmet.length) {
          report.scenarios.push({ name: scenario.name, device: deviceName, verdict: 'BLOCKED', reason: `${unmet.join(', ')} did not pass`, checks: [] });
          verdictOf.set(scenario.name, 'BLOCKED');
          continue;
        }
        const t = toolkit({ page, context, app: report.app, api: authBase, session, state, outDir, scenario, device: deviceName, network });
        const t0 = Date.now();
        const errorsBefore = consoleErrors.length;
        let verdict, reason = null;
        try {
          await scenario.run(t);
          const { checks } = t._result();
          verdict = checks.length && checks.every((c) => c.passed) ? 'PASS' : checks.length ? 'FAIL' : 'INCONCLUSIVE';
          if (verdict === 'INCONCLUSIVE') reason = 'the scenario made no checks';
        } catch (e) {
          verdict = e instanceof Blocked ? 'BLOCKED' : 'ERROR';
          reason = String(e.message || e).slice(0, 500);
        }
        if (verdict !== 'PASS') await t.shot('end');
        allCleanups.push(...t._cleanups);
        verdictOf.set(scenario.name, verdict);
        const { checks, notes, shots } = t._result();
        report.scenarios.push({ name: scenario.name, device: deviceName, verdict, reason, ms: Date.now() - t0, checks, notes, shots,
          consoleErrors: consoleErrors.slice(errorsBefore, errorsBefore + 20) });
      }
      // Undo what the scenarios created, newest first — always.
      for (const fn of allCleanups.reverse()) {
        try { await fn(); } catch (e) { report.scenarios.push({ name: 'cleanup', device: deviceName, verdict: 'ERROR', reason: e.message, checks: [] }); }
      }
      await context.close();
    }
  } catch (e) {
    blockAll(e instanceof Blocked ? e.message : `gate error: ${e.message}`);
  } finally {
    await browser?.close().catch(() => {});
    local?.stop();
  }
  const verdicts = report.scenarios.map((s) => s.verdict);
  report.verdict = verdicts.length && verdicts.every((v) => v === 'PASS') ? 'PASS'
    : verdicts.includes('FAIL') ? 'FAIL' : verdicts.includes('ERROR') ? 'ERROR' : verdicts.includes('BLOCKED') ? 'BLOCKED' : 'INCONCLUSIVE';
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  return report;
}
