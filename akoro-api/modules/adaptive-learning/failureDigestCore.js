/**
 * adaptive-learning/failureDigestCore.js — the PURE half of the Phase 22
 * failure digest: cluster failed tool steps and turn them into reusable
 * lessons. No db, so the tests drive it directly.
 */

/** PURE: group failed steps by (tool, error_class), strongest first. */
export function clusterFailures(steps, { minCount = 3, top = 6, sampleChars = 160 } = {}) {
  const groups = new Map();
  for (const s of steps || []) {
    const tool = String(s?.tool || "unknown").slice(0, 80);
    const errorClass = String(s?.error_class || "unknown").slice(0, 40);
    const key = `${tool}|${errorClass}`;
    const g = groups.get(key) || { tool, errorClass, count: 0, samples: [] };
    g.count += 1;
    const msg = typeof s?.error_message === "string" ? s.error_message.trim() : "";
    if (msg && g.samples.length < 2 && !g.samples.includes(msg.slice(0, sampleChars))) {
      g.samples.push(msg.slice(0, sampleChars));
    }
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.count >= minCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, top);
}

/** PURE: one plain-language lesson per cluster (for ops + a prompt hint). */
export function lessonFor(cluster) {
  const sample = cluster.samples?.[0] ? ` (“${cluster.samples[0]}”)` : "";
  const advice = {
    timeout: "retry once, then tell the learner it's slow rather than claiming success",
    unavailable: "the backend was briefly down — retry once before reporting failure",
    rate_limit: "back off and retry later; never loop",
    auth: "do not retry — say the learner lacks permission / re-authorise",
    validation: "ask for the missing detail instead of retrying unchanged",
    not_found: "check the id/name with a read tool before retrying",
    database: "a schema/field mismatch — do not retry; report it",
    error: "retry once, then report plainly what didn't work",
    unknown: "report plainly what didn't work",
  }[cluster.errorClass] || "report plainly what didn't work";
  return `${cluster.tool} failed ${cluster.count}× with ${cluster.errorClass}${sample} — ${advice}.`;
}

/** PURE: the digest text stored/shown for the window. */
export function digestText(clusters) {
  if (!clusters?.length) return null;
  const total = clusters.reduce((n, c) => n + c.count, 0);
  return `${total} repeated tool failure${total === 1 ? "" : "s"} in this window:\n` +
    clusters.map((c) => `- ${lessonFor(c)}`).join("\n");
}
