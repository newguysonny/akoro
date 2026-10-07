// lib/alerts.js
//
// Alerting for the deployed agents: spend, latency, failures, and work that has
// silently stopped moving.
//
// The dashboard answers "what is happening" — but only while someone is
// looking. This is the other half. The design decision that matters is that an
// alert is a TRANSITION, not an observation: a check that sends a message every
// time it runs is a metronome, and the first thing anyone does with a metronome
// is mute it. So each rule has state, and only fired/resolved/reminder are
// delivered.
//
// Rules live here rather than in a table because they are logic — they want
// reviewing in a diff, and a threshold editable in a row with no record of who
// changed it is how alerting quietly stops working. Thresholds are env-tunable
// so an environment can be noisier or quieter without a code change.
//
// Delivery is deliberately dull: a structured log line always, an email to the
// admins when configured, and an optional webhook — sent through safeFetch, so
// the alerting path cannot itself be turned into an SSRF.

import db from "../db.js";
import { safeFetch } from "./safeFetch.js";

const num = (v, d) => (v != null && !Number.isNaN(Number(v)) ? Number(v) : d);

// How long a rule must stay breached before it is worth telling anyone. A
// single bad minute is noise; the same minute repeated is a problem.
const FOR_MINUTES     = num(process.env.ALERT_FOR_MINUTES, 10);
// A still-firing alert repeats at most this often, so an ongoing incident does
// not go quiet but does not shout either.
const RENOTIFY_HOURS  = num(process.env.ALERT_RENOTIFY_HOURS, 6);

/**
 * Each rule answers one question and returns { value, breached, detail }.
 *
 * `window` is the lookback in hours; keep it short enough that a rule reacts,
 * long enough that a handful of calls cannot swing it.
 */
export const RULES = [
  {
    key: "ai_spend_hourly",
    severity: "warning",
    title: "AI spend is above budget",
    // A budget is per-environment, so it must be set to mean anything. Unset =
    // rule disabled, rather than a made-up number that cries wolf everywhere.
    enabled: () => num(process.env.ALERT_USD_PER_HOUR, 0) > 0,
    async check() {
      const cap = num(process.env.ALERT_USD_PER_HOUR, 0);
      const { data } = await db.schema("edu").rpc("ai_spend_by_feature", { p_hours: 1 });
      const usd = (data ?? []).reduce((s, r) => s + Number(r.usd || 0), 0);
      return {
        value: Number(usd.toFixed(6)),
        breached: usd > cap,
        detail: `$${usd.toFixed(4)} in the last hour (budget $${cap}/h)` +
                (data?.length ? ` · biggest: ${data[0].feature} $${Number(data[0].usd || 0).toFixed(4)}` : ""),
      };
    },
  },

  {
    key: "ai_failure_rate",
    severity: "critical",
    title: "AI calls are failing",
    async check() {
      const { data } = await db.schema("edu").rpc("ai_spend_by_feature", { p_hours: 1 });
      const calls  = (data ?? []).reduce((s, r) => s + Number(r.calls || 0), 0);
      const failed = (data ?? []).reduce((s, r) => s + Number(r.failed || 0), 0);
      // Below a floor of traffic a percentage is meaningless — one failure out
      // of two calls is 50% and tells you nothing.
      const floor = num(process.env.ALERT_MIN_CALLS, 20);
      const rate  = calls ? failed / calls : 0;
      const cap   = num(process.env.ALERT_FAILURE_RATE, 0.1);
      const worst = (data ?? []).filter(r => Number(r.failed)).sort((a, b) => b.failed - a.failed)[0];
      return {
        value: Number((rate * 100).toFixed(2)),
        breached: calls >= floor && rate > cap,
        detail: `${failed} of ${calls} calls failed in the last hour (${(rate * 100).toFixed(1)}%)` +
                (worst ? ` · worst: ${worst.feature}` : ""),
      };
    },
  },

  {
    key: "ai_latency_p95",
    severity: "warning",
    title: "AI calls are slow",
    async check() {
      const { data } = await db.schema("edu").rpc("ai_spend_by_model", { p_hours: 1 });
      const cap = num(process.env.ALERT_P95_MS, 15000);
      const floor = num(process.env.ALERT_MIN_CALLS, 20);
      // Per MODEL, not overall: one slow tier is the finding, and averaging it
      // with a fast one is how a real regression stays hidden.
      const worst = (data ?? [])
        .filter(r => Number(r.calls || 0) >= floor)
        .sort((a, b) => Number(b.p95_ms || 0) - Number(a.p95_ms || 0))[0];
      const p95 = Number(worst?.p95_ms || 0);
      return {
        value: p95,
        breached: p95 > cap,
        detail: worst
          ? `${worst.model} p95 ${p95}ms over ${worst.calls} calls (limit ${cap}ms)`
          : "not enough calls to judge",
      };
    },
  },

  {
    key: "battles_stuck",
    severity: "warning",
    title: "Live battles are not playing",
    async check() {
      // A battle that went live and has no answers after several minutes is
      // the failure the health endpoint was built to name — worth telling
      // someone rather than waiting for a learner to report a frozen screen.
      const { data: live } = await db.from("battles")
        .select("id, title, actual_start").eq("status", "live").limit(50);
      const stale = (live ?? []).filter(b =>
        b.actual_start && Date.now() - new Date(b.actual_start).getTime() > 5 * 60_000);
      if (!stale.length) return { value: 0, breached: false, detail: "no live battles running long enough to judge" };

      const ids = stale.map(b => b.id);
      const { data: answers } = await db.from("battle_answers").select("battle_id").in("battle_id", ids);
      const withAnswers = new Set((answers ?? []).map(a => a.battle_id));
      const stuck = stale.filter(b => !withAnswers.has(b.id));
      return {
        value: stuck.length,
        breached: stuck.length > 0,
        detail: stuck.length
          ? `${stuck.length} live battle(s) with no answers after 5 min — e.g. "${stuck[0].title}"`
          : `${stale.length} live battles, all playing`,
      };
    },
  },

  {
    key: "task_runs_failing",
    severity: "critical",
    title: "Agent task runs are failing",
    async check() {
      const since = new Date(Date.now() - 60 * 60_000).toISOString();
      const { data } = await db.from("task_runs")
        .select("status").gt("created_at", since).limit(500);
      const rows   = data ?? [];
      const failed = rows.filter(r => r.status === "failed").length;
      const floor  = num(process.env.ALERT_MIN_RUNS, 5);
      const cap    = num(process.env.ALERT_RUN_FAILURE_RATE, 0.34);
      const rate   = rows.length ? failed / rows.length : 0;
      return {
        value: Number((rate * 100).toFixed(2)),
        breached: rows.length >= floor && rate > cap,
        detail: `${failed} of ${rows.length} task runs failed in the last hour`,
      };
    },
  },
];

/* ── Evaluation ─────────────────────────────────────────────────────────── */

async function stateFor(key) {
  const { data } = await db.schema("edu").from("alert_state").select("*").eq("rule_key", key).maybeSingle();
  return data ?? null;
}

async function saveState(key, patch) {
  const row = { rule_key: key, updated_at: new Date().toISOString(), ...patch };
  const { error } = await db.schema("edu").from("alert_state").upsert(row, { onConflict: "rule_key" });
  if (error) console.warn("[alerts] could not save state:", error.message);
}

async function recordEvent(rule, kind, value, detail) {
  const { error } = await db.schema("edu").from("alert_events").insert({
    rule_key: rule.key, severity: rule.severity, kind, value, detail, notified: true,
  });
  if (error) console.warn("[alerts] could not record event:", error.message);
}

/**
 * evaluateAll — run every rule, update state, deliver transitions.
 *
 * Returns what it did, so the endpoint and the tests can see it without
 * reading the log.
 */
export async function evaluateAll({ deliver = true } = {}) {
  const out = [];
  for (const rule of RULES) {
    if (rule.enabled && !rule.enabled()) { out.push({ key: rule.key, skipped: "disabled" }); continue; }

    let result;
    try {
      result = await rule.check();
    } catch (e) {
      // A rule that cannot run is not a rule that passed. Say so rather than
      // reporting silence as health.
      console.warn(`[alerts] rule ${rule.key} could not run:`, e.message);
      out.push({ key: rule.key, error: e.message });
      continue;
    }

    const prev = await stateFor(rule.key);
    const now  = new Date();
    const nowIso = now.toISOString();

    if (result.breached) {
      const since = prev?.firing ? new Date(prev.since ?? nowIso) : now;
      const heldFor = (now - since) / 60_000;
      // Held long enough to be believed?
      const ripe = heldFor >= FOR_MINUTES || FOR_MINUTES === 0;
      const lastNotified = prev?.last_notified ? new Date(prev.last_notified) : null;
      const dueAgain = lastNotified && (now - lastNotified) / 3_600_000 >= RENOTIFY_HOURS;

      const firstTime = ripe && !lastNotified;
      const reminder  = ripe && dueAgain;

      await saveState(rule.key, {
        firing: true,
        since: (prev?.firing ? prev.since : nowIso),
        last_checked: nowIso,
        last_value: result.value,
        last_detail: result.detail,
        ...(firstTime || reminder ? { last_notified: nowIso } : {}),
      });

      if (firstTime || reminder) {
        const kind = firstTime ? "fired" : "reminder";
        await recordEvent(rule, kind, result.value, result.detail);
        if (deliver) await notify(rule, kind, result);
        out.push({ key: rule.key, kind, value: result.value, detail: result.detail });
      } else {
        out.push({ key: rule.key, kind: ripe ? "still_firing" : "pending", value: result.value, heldForMin: Math.round(heldFor) });
      }
    } else {
      // Only worth announcing if somebody was told it started.
      const wasNotified = !!prev?.last_notified;
      if (prev?.firing) {
        await saveState(rule.key, {
          firing: false, since: null, last_checked: nowIso,
          last_value: result.value, last_detail: result.detail, last_notified: null,
        });
        if (wasNotified) {
          await recordEvent(rule, "resolved", result.value, result.detail);
          if (deliver) await notify(rule, "resolved", result);
          out.push({ key: rule.key, kind: "resolved", value: result.value });
          continue;
        }
      } else {
        await saveState(rule.key, { firing: false, last_checked: nowIso, last_value: result.value, last_detail: result.detail });
      }
      out.push({ key: rule.key, kind: "ok", value: result.value });
    }
  }
  return out;
}

/* ── Delivery ───────────────────────────────────────────────────────────── */

async function notify(rule, kind, result) {
  const resolved = kind === "resolved";
  const subject = resolved
    ? `Resolved: ${rule.title}`
    : `${rule.severity === "critical" ? "🔴" : "🟠"} ${rule.title}`;
  const line = `${subject} — ${result.detail}`;

  // Always: a structured line, same shape as the rest of the platform's logs.
  process[resolved ? "stdout" : "stderr"].write(JSON.stringify({
    ts: new Date().toISOString(), event: "ALERT", message: line,
    level: resolved ? "info" : (rule.severity === "critical" ? "error" : "warn"),
    rule: rule.key, kind, severity: rule.severity, value: result.value, detail: result.detail,
  }) + "\n");

  const to = (process.env.ALERT_EMAIL_TO || "").split(",").map(s => s.trim()).filter(Boolean);
  if (to.length && process.env.RESEND_API_KEY) {
    try {
      const { sendOpsAlertEmail } = await import("../modules/auth/emails.js");
      await sendOpsAlertEmail({ to, subject, title: rule.title, detail: result.detail, kind, severity: rule.severity });
    } catch (e) { console.warn("[alerts] email failed:", e.message); }
  }

  const hook = process.env.ALERT_WEBHOOK_URL;
  if (hook) {
    try {
      // Through safeFetch: the alerting path must not become the SSRF hole.
      await safeFetch(hook, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: { text: line, rule: rule.key, kind, severity: rule.severity, value: result.value },
        timeoutMs: 5000,
      });
    } catch (e) { console.warn("[alerts] webhook failed:", e.message); }
  }
}

/** Current state of every rule, for the dashboard. */
export async function currentAlerts() {
  const { data } = await db.schema("edu").from("alert_state").select("*");
  const byKey = new Map((data ?? []).map(r => [r.rule_key, r]));
  return RULES.map(r => {
    const s = byKey.get(r.key);
    return {
      key: r.key, title: r.title, severity: r.severity,
      enabled: r.enabled ? !!r.enabled() : true,
      firing: !!s?.firing,
      since: s?.since ?? null,
      lastChecked: s?.last_checked ?? null,
      value: s?.last_value ?? null,
      detail: s?.last_detail ?? null,
    };
  });
}
