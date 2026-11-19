/**
 * ladderPrewarm.js — pre-build lesson ladders for upcoming scheme-of-work topics.
 *
 * Why: the FIRST learner on a new topic pays for retrieval + an LLM call before
 * their session starts. On slow connections that wait is the worst part of the
 * experience. Schools already tell us what's coming (mgmt.scheme_of_work), so we
 * warm those ladders off-peak — after which every learner hits the cache and
 * session start is a single DB read.
 *
 * Safe by design: bounded per run, skips topics already cached, and every
 * failure is swallowed (a warm miss just means the old on-demand path runs).
 *
 * Env:
 *   LADDER_PREWARM=off        disable entirely
 *   LADDER_PREWARM_CRON       schedule (default 02:20 daily — off-peak)
 *   LADDER_PREWARM_MAX        max ladders built per run (default 40)
 */

import cron from "node-cron";
import { registerTick, cronSource } from "../../../lib/cronTicks.js";
import db from "../../../db.js";
import { resolveLadder } from "./lessonLadder.js";
import { NaNaEsumai } from "../agents/nana-esumai/guide.js";
import { workerTick } from "../../../lib/workerLog.js";

const MAX_PER_RUN = Math.max(1, parseInt(process.env.LADDER_PREWARM_MAX ?? "40", 10));
const key = (s) => String(s || "").toLowerCase().trim();

/**
 * Walk each school's scheme of work and warm any topic that has no cached
 * ladder yet. Returns { scanned, warmed }.
 */
export async function prewarmLadders({ max = MAX_PER_RUN } = {}) {
  const guide = new NaNaEsumai();
  let scanned = 0, warmed = 0;

  try {
    // Upcoming/current plan rows — most schools keep this small.
    const { data: rows } = await db.schema("mgmt").from("scheme_of_work")
      .select("school_id, class_id, topic, subjects(name)")
      .not("topic", "is", null)
      .order("term").order("week")
      .limit(600);
    if (!rows?.length) return { scanned: 0, warmed: 0 };

    // Dedupe to distinct (school, class, subject, topic).
    const seen = new Set();
    const targets = [];
    for (const r of rows) {
      const subject = r.subjects?.name;
      if (!subject || !r.topic) continue;
      const k = `${r.school_id}|${r.class_id}|${key(subject)}|${key(r.topic)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      targets.push({ schoolId: r.school_id, classId: r.class_id, subject, topic: r.topic });
    }

    // Which of those are already cached? One query instead of N.
    const { data: cachedRows } = await db.schema("edu").from("lesson_ladders")
      .select("school_id, class_id, subject, topic_key").limit(2000);
    const cached = new Set((cachedRows || []).map(
      (c) => `${c.school_id}|${c.class_id}|${key(c.subject)}|${c.topic_key}`
    ));

    for (const t of targets) {
      if (warmed >= max) break;
      scanned++;
      if (cached.has(`${t.schoolId}|${t.classId}|${key(t.subject)}|${key(t.topic)}`)) continue;

      // A representative learner in that class gives resolveLadder the same
      // school/class context a real session would have.
      const { data: stu } = await db.schema("mgmt").from("students")
        .select("user_id").eq("school_id", t.schoolId)
        .eq("class_id", t.classId).not("user_id", "is", null)
        .limit(1).maybeSingle();
      if (!stu?.user_id) continue;   // nobody in that class yet — nothing to warm for

      try {
        await resolveLadder({ studentId: stu.user_id, topic: t.topic, subject: t.subject, guide });
        warmed++;
      } catch (e) {
        console.warn("[ladder prewarm]", t.topic, e.message);
      }
    }
  } catch (e) {
    console.warn("[ladder prewarm] scan failed:", e.message);
  }

  if (warmed) console.log(`[ladder prewarm] warmed ${warmed} ladder(s) from ${scanned} scheme topic(s)`);
  return { scanned, warmed };
}

// Off-peak by default so it never competes with lesson traffic.
const runLadderPrewarm = () => {
  const start = Date.now();
  return prewarmLadders()
    .then(({ scanned, warmed }) => workerTick("ladder-prewarm", {
      reason: "cron", jobsFound: scanned, jobsProcessed: warmed, durationMs: Date.now() - start,
    }))
    .catch((e) => workerTick("ladder-prewarm", {
      reason: "cron", jobsFound: 0, jobsProcessed: 0, durationMs: Date.now() - start, error: e.message,
    }));
};
registerTick("ladder-prewarm", runLadderPrewarm);
if (!process.env.NODE_TEST_CONTEXT && process.env.LADDER_PREWARM !== "off" && cronSource() !== "cloudflare") {
  const schedule = process.env.LADDER_PREWARM_CRON || "20 2 * * *";
  if (cron.validate(schedule)) {
    cron.schedule(schedule, () => { runLadderPrewarm(); });
    console.log(`[ladder prewarm] scheduled (${schedule})`);
  } else {
    console.warn(`[ladder prewarm] invalid LADDER_PREWARM_CRON "${schedule}" — disabled`);
  }
}
