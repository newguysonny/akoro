/**
 * modules/self-tooling/writeArgs.js — the value a change carries (PURE).
 *
 * A change capability may take values from the learner's goal (`args` in
 * capabilities.js): "move my overdue tasks to tomorrow" → { date: "tomorrow" },
 * "make them high priority" → { priority: "high" }. They're checked when the
 * tool is built, worked out when it runs (dates against the learner's today),
 * and shown on the Confirm card, so the learner sees exactly what will be set.
 *
 *   "date"        YYYY-MM-DD | today | tomorrow | +Nd (1–365) | a weekday (the next one)
 *   [a, b, …]     one of these
 */

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** PURE: problems with a write's args for this capability (when the tool is built). → [string] */
export function checkArgs(capName, cap, args) {
  const spec = cap?.args;
  const errors = [];
  if (!spec) {
    if (args && Object.keys(args).length) errors.push(`${capName} takes no values — leave "args" out`);
    return errors;
  }
  const given = args && typeof args === "object" ? args : {};
  for (const [k, type] of Object.entries(spec)) {
    const v = given[k];
    const hint = Array.isArray(type) ? `one of ${type.join(", ")}` : "YYYY-MM-DD, today, tomorrow, +3d or a weekday";
    if (v == null || v === "") { errors.push(`${capName} needs "args": {"${k}": …} (${hint})`); continue; }
    if (typeof v === "string" && /^\$[a-zA-Z]\w*$/.test(v)) continue;   // a declared param, filled in when it runs
    if (Array.isArray(type) ? !type.includes(String(v)) : !dateValue(String(v), "2026-01-01")) errors.push(`${capName} args.${k} "${v}" isn't ${hint}`);
  }
  for (const k of Object.keys(given)) if (!(k in spec)) errors.push(`${capName} takes no "${k}"`);
  return errors;
}

/** PURE: a date value as YYYY-MM-DD, from the learner's `today` (YYYY-MM-DD). → string | null */
export function dateValue(v, today) {
  const s = String(v || "").trim().toLowerCase();
  const base = new Date(`${today}T12:00:00Z`);
  const plus = (n) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  if (ISO.test(s)) return Number.isNaN(new Date(`${s}T12:00:00Z`).getTime()) ? null : s;
  if (s === "today") return plus(0);
  if (s === "tomorrow") return plus(1);
  const m = s.match(/^\+(\d{1,3})d$/);
  if (m && +m[1] >= 1 && +m[1] <= 365) return plus(+m[1]);
  const day = DAYS.indexOf(s.replace(/^next\s+/, ""));
  if (day >= 0) return plus(((day - base.getUTCDay() + 7) % 7) || 7);
  return null;
}

const label = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** PURE: the args as the change will apply them (dates worked out), plus labels for the card. Throws on a bad value. */
export function resolveArgs(capName, cap, args, today) {
  if (!cap?.args) return null;
  const out = {};
  for (const [k, type] of Object.entries(cap.args)) {
    const v = args?.[k];
    if (Array.isArray(type)) {
      if (!type.includes(String(v))) throw new Error(`${capName}: ${k} must be one of ${type.join(", ")}`);
      out[k] = String(v);
    } else {
      const d = dateValue(v, today);
      if (!d) throw new Error(`${capName}: "${v}" isn't a date`);
      out[k] = d; out[`${k}Label`] = label(d);
    }
  }
  return out;
}
