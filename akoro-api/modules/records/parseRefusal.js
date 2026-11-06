/**
 * records/parseRefusal.js — PURE: why the parse worker (RunPod) refused a
 * page, as a code the app can act on and a sentence a learner can read.
 * Never RunPod's raw JSON (it reached a learner's screen as such before).
 */
/** PURE: why the parse worker refused a page, as a code the app can act on. */
export function parseRefusalCode(raw) {
  const t = String(raw || "");
  if (/ENDPOINT_PAUSED|max_workers=0|paused/i.test(t)) return "worker_paused";
  if (/not configured/i.test(t)) return "worker_unconfigured";
  if (/in time|timed? ?out|abort/i.test(t)) return "worker_slow";
  return "worker_refused";
}

/** PURE: the learner-facing reason (never RunPod's raw JSON). */
export function parseRefusalMessage(raw) {
  switch (parseRefusalCode(raw)) {
    case "worker_paused":
    case "worker_unconfigured":
      return "Reading photos and scanned pages is switched off right now. Your file is saved — try again later, or paste the text instead.";
    case "worker_slow":
      return "The text reader didn't answer in time — try again in a minute.";
    default:
      return "The text reader couldn't take this page right now — try again in a minute.";
  }
}

/* recordId | contentKey → { contentKey, name } | { status, message }. */
async function resolveAiContent(req) {
  return resolveContentAccess({ userId: req.user.id, recordId: req.body?.recordId, contentKey: req.body?.contentKey });
}
