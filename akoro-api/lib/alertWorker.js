// lib/alertWorker.js
//
// Runs the alert rules on a schedule.
//
// Every five minutes, not every minute: the rules look at a one-hour window, so
// checking more often measures almost the same numbers again and only adds
// database load. The "must hold for N minutes before telling anyone" rule in
// lib/alerts.js is what actually decides how fast an alert reaches a person.
//
// Off by default in development. An alert that fires on a laptop, against
// seed data, is the fastest way to teach someone to ignore alerts.

import cron from "node-cron";
import { evaluateAll } from "./alerts.js";
import { workerTick } from "./workerLog.js";

const ENABLED = process.env.ALERTS === "on" ||
  (process.env.NODE_ENV === "production" && process.env.ALERTS !== "off");

export function startAlertWorker() {
  if (!ENABLED) {
    console.log("[alerts] not scheduled (set ALERTS=on to enable outside production)");
    return;
  }
  cron.schedule("*/5 * * * *", async () => {
    const start = Date.now();
    let jobsFound = 0, jobsProcessed = 0;
    try {
      const results = await evaluateAll();
      jobsFound = results.length;
      const noteworthy = results.filter(r => ["fired", "resolved", "reminder"].includes(r.kind));
      jobsProcessed = noteworthy.length;
      // The alert line itself only says something when something happened — a
      // human line every five minutes saying "all fine" is the log-noise
      // version of the same mistake the alerts themselves are designed to
      // avoid. The structured [worker] tick in the finally is the deliberate
      // exception: an always-on probe that makes every wake-up visible, idle
      // ones included, so a poll that finds nothing is never silent.
      if (noteworthy.length) {
        console.log(`[alerts] ${noteworthy.map(r => `${r.key}:${r.kind}`).join(", ")}`);
      }
    } catch (e) {
      // The alerting system failing is itself worth seeing in the logs — it is
      // the one failure nothing else will report.
      console.error("[alerts] evaluation failed:", e.message);
    } finally {
      workerTick("alert-rules", { reason: "cron", jobsFound, jobsProcessed, durationMs: Date.now() - start });
    }
  });
  console.log("[alerts] rules scheduled (every 5 min)");
}
