/**
 * modules/autonomy/readyKinds.js — ready proposals and goal work (Grand Plan
 * §7.16.3–§7.16.5). Pure: no db, no model.
 *
 * The planner proposes; code checks every proposal against what is really
 * there (a record of theirs, a goal of theirs, a topic their evidence calls
 * weak) and writes the preview from those facts — never from the model's
 * prose. Nothing here executes; approval does (agent-proposals/inbox.js).
 *
 *   shapeReady(p, refs)       a planner proposal of a ready kind → { payload, preview } | null
 *   fixIts(signals)           code-found problems in their own things (fix_it)
 *   progressLine(facts)       a goal's progress note, from numbers only
 *   READY                     per kind: what Yes does, its button, its cost
 */
export const LEARNER_KINDS = Object.freeze([
  "task", "session", "goal", "practice",
  "quiz_from_records", "teach_weak_topic", "study_plan", "revision_battle", "follow_up_question", "goal_nudge",
]);
export const INSTRUCTOR_KINDS = Object.freeze(["revise_low_scores", "chase_missing", "next_activity"]);

/** What "Yes" does, said on the button and after (D46: anything that costs says so). */
export const READY = Object.freeze({
  task:               { yes: "Add it to my tasks", doing: "I'll add it to your tasks" },
  practice:           { yes: "Add the practice", doing: "a short focused practice" },
  session:            { yes: "Yes, check in then", doing: "I'll check in with you then" },
  goal:               { yes: "Make it a goal", doing: "I'll add it to your goals" },
  goal_nudge:         { yes: "Add it to my tasks", doing: "a first step toward it" },
  quiz_from_records:  { yes: "Yes, open the quiz", doing: "a quiz from your own notes", cost: "free" },
  teach_weak_topic:   { yes: "Teach my agent", doing: "you teach it to your agent — the fastest way to fix it" },
  study_plan:         { yes: "Plan it", doing: "a plan from the syllabus — you'll see its coin estimate before anything is charged" },
  revision_battle:    { yes: "Start the check", doing: "a 5-question Agent Check on it", cost: "free" },
  follow_up_question: { yes: "Yes, let's do it", doing: "we pick it up in this chat" },
  fix_it:             { yes: "Fix it", doing: "I'll sort it" },
  revise_low_scores:  { yes: "Draft it", doing: "a revision activity drafted for you to check — nothing is sent until you assign it" },
  chase_missing:      { yes: "Send the reminder", doing: "a reminder to those learners" },
  next_activity:      { yes: "Draft it", doing: "the next activity drafted for you to check — nothing is sent until you assign it" },
});

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const pick = (list, n) => (Number.isInteger(n) && n >= 1 && n <= list.length ? list[n - 1] : null);

/**
 * refs: what the planner was shown, numbered as it saw them —
 *   records [{ id, name, pages, topics }], goals [{ id, title, days_left, subject, exam }],
 *   weak [{ concept, subject, mastery }], notes [{ kind, note, chatId }]
 * p.payload carries record / goal / note numbers and topic names.
 */
export function shapeReady(p, refs = {}) {
  const pl = p?.payload || {};
  switch (p?.kind) {
    case "quiz_from_records": {
      const r = pick(refs.records || [], Number(pl.record));
      if (!r) return null;
      return {
        payload: { recordId: r.id, recordName: r.name, tool: "quiz" },
        preview: { kind: "quiz", record: r.name, pages: r.pages || null, topics: (r.topics || []).slice(0, 4), focus: clip(pl.topic, 60) || null },
      };
    }
    case "teach_weak_topic":
    case "revision_battle": {
      const w = (refs.weak || []).find((x) => norm(x.concept) === norm(pl.topic)) || pick(refs.weak || [], Number(pl.weak));
      if (!w) return null;
      return {
        payload: { topic: w.concept, subject: w.subject || null },
        preview: { kind: p.kind === "revision_battle" ? "check" : "teach", topic: w.concept, subject: w.subject || null, mastery: w.mastery ?? null, questions: p.kind === "revision_battle" ? 5 : null },
      };
    }
    case "study_plan": {
      const g = pick(refs.goals || [], Number(pl.goal));
      // An exam countdown: a goal with a date between a week and four months away.
      if (!g || g.days_left == null || g.days_left < 7 || g.days_left > 120) return null;
      return {
        payload: { goalId: g.id, goal: g.title, subject: clip(pl.subject || g.subject, 60) || null, examBoard: clip(g.exam, 20) || null },
        preview: { kind: "plan", goal: g.title, daysLeft: g.days_left, subject: clip(pl.subject || g.subject, 60) || null },
      };
    }
    case "follow_up_question": {
      const n = pick(refs.notes || [], Number(p.from_note));
      const ask = clip(pl.message || pl.title || p.title, 300);
      if (!n || n.kind !== "open_thread" || ask.length < 8) return null;
      return { payload: { prompt: ask }, preview: { kind: "follow_up", note: clip(n.note, 160) }, sourceChatId: n.chatId || null };
    }
    case "goal_nudge": {
      const g = pick(refs.goals || [], Number(pl.goal));
      // Stale (a week untouched) or close (three weeks or less): only then a nudge.
      if (!g || !((g.days_since_update ?? 0) >= 7 || (g.days_left != null && g.days_left <= 21 && g.days_left >= 0))) return null;
      const title = clip(pl.title || p.title, 120);
      if (!title) return null;
      return {
        payload: { title, description: clip(pl.description, 300) || null, priority: ["high", "medium", "low"].includes(pl.priority) ? pl.priority : "medium", dueAt: pl.dueAt || null, goalId: g.id },
        preview: { kind: "step", goal: g.title, daysLeft: g.days_left, daysSince: g.days_since_update ?? null },
      };
    }
    default: return null;
  }
}

/** Code-found problems in the learner's own things — no model involved. */
export function fixIts(signals = {}) {
  const out = [];
  const overdue = signals.tasks?.overdueList || [];
  if (overdue.length >= 2) {
    out.push({
      kind: "fix_it", title: `Spread your ${overdue.length} overdue tasks over the next few days`,
      rationale: `${overdue.length} of your tasks are overdue (${overdue.slice(0, 2).map((t) => `"${clip(t.title, 40)}"`).join(", ")}${overdue.length > 2 ? "…" : ""}).`,
      payload: { fix: "overdue_tasks", taskIds: overdue.slice(0, 6).map((t) => t.id) },
      preview: { kind: "reschedule", tasks: overdue.slice(0, 6).map((t) => clip(t.title, 60)), days: Math.min(overdue.length, 3) },
    });
  }
  return out;
}

/** "This week: 4 tasks done · 2 study sessions · best battle 8/10." — numbers from the harness only. */
export function progressLine({ tasksDone = 0, sessions = 0, bestBattle = null } = {}) {
  const parts = [];
  if (tasksDone) parts.push(`${tasksDone} task${tasksDone === 1 ? "" : "s"} done`);
  if (sessions) parts.push(`${sessions} study session${sessions === 1 ? "" : "s"}`);
  if (bestBattle && bestBattle.total) parts.push(`best battle ${bestBattle.score}/${bestBattle.total}`);
  return parts.length ? `This week: ${parts.join(" · ")}.` : null;
}

/** Spread overdue tasks one or two a day from tomorrow, at their time of day (fix_it overdue_tasks). */
export function spreadDue(tasks = [], from = new Date()) {
  return tasks.map((t, i) => {
    const old = new Date(t.due_at || from);
    const day = new Date(from.getTime() + (1 + Math.floor(i / 2)) * 86_400_000);
    day.setUTCHours(Number.isFinite(old.getTime()) ? old.getUTCHours() : 15, Number.isFinite(old.getTime()) ? old.getUTCMinutes() : 0, 0, 0);
    return { id: t.id, due_at: day.toISOString() };
  });
}

export const IDEAS = Object.freeze({ LIVE: 6, REFRESH_AT: 3, DAYS: 7 });

/**
 * The planner's ideas → what is kept: each tied to a real thing it showed
 * (record / goal / weak concept / note), a brief to send, never a repeat.
 * → [{ title, why, context: { kind, label }, brief, icon }]
 */
export function shapeIdeas(raw = [], refs = {}, { room = IDEAS.LIVE, seen = new Set() } = {}) {
  const out = [];
  for (const i of Array.isArray(raw) ? raw : []) {
    if (out.length >= room) break;
    const title = clip(i?.title, 90), brief = clip(i?.brief, 300), why = clip(i?.why, 160);
    if (title.length < 6 || brief.length < 8 || why.length < 8) continue;
    const list = { record: refs.records, goal: refs.goals, weak: refs.weak, note: refs.notes }[i.from] || [];
    const hit = pick(list, Number(i.ref));
    if (!hit) continue;
    const label = clip(hit.name || hit.title || hit.concept || hit.note, 60);
    const key = norm(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ title, why, brief, icon: ["quiz", "teach", "plan", "notes", "battle", "chat"].includes(i.icon) ? i.icon : "chat",
      context: { kind: i.from, label, ...(hit.id ? { ref: hit.id } : {}) } });
  }
  return out;
}
