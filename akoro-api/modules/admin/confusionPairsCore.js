/** modules/admin/confusionPairsCore.js — the pure part of the confusion-pair review (§7.15.1). */
export const REVIEW_STATUSES = Object.freeze(["open", "content_fixed", "noted", "ignored"]);
const keyOf = (r) => `${r.subject || ""}\u0000${r.concept || ""}\u0000${r.confused_with || ""}`;

/** PURE: the view's pairs with their review (open when never reviewed), filtered, most learners first. */
export function mergePairs(pairs = [], reviews = [], { status = null, subject = null } = {}) {
  const byKey = new Map((reviews || []).map((r) => [keyOf(r), r]));
  return (pairs || []).map((p) => {
    const r = byKey.get(keyOf(p));
    return { subject: p.subject || "", concept: p.concept || "", confusedWith: p.confused_with, times: p.times, learners: p.learners, lastSeen: p.last_seen,
      status: r?.status || "open", note: r?.note || null, reviewedAt: r ? r.reviewed_at : null };
  }).filter((p) => (!status || p.status === status) && (!subject || p.subject.toLowerCase() === String(subject).toLowerCase()))
    .sort((a, b) => b.learners - a.learners || b.times - a.times);
}

