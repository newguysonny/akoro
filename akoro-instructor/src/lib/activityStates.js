/**
 * One vocabulary for the Activities page: every activity — whatever its type —
 * sits in exactly one of four stages. Battles carry their own status; the rest
 * are derived from the dates and learner progress the API already returns.
 *
 *   live       running now (a battle in play, a session on air, work open)
 *   scheduled  set for later
 *   lobby      a battle created and waiting for its players
 *   completed  finished: ended, everyone done, or past its due date
 */
export const STAGES = ['live', 'scheduled', 'lobby', 'completed'];

export function battleStage(b) {
  const s = b?.status;
  if (s === 'cancelled' || s === 'expired') return 'completed';
  return STAGES.includes(s) ? s : 'lobby';
}

export function activityStage(a, now = Date.now()) {
  const p = a?.progress ?? { assigned: 0, complete: 0 };
  const everyoneDone = p.assigned > 0 && p.complete >= p.assigned;
  if (a?.type === 'live_course' && a?.details?.scheduled_at) {
    const start = new Date(a.details.scheduled_at).getTime();
    const end = start + (parseInt(a.details.duration_mins ?? a.details.durationMins, 10) || 60) * 60000;
    if (now < start) return 'scheduled';
    return now < end ? 'live' : 'completed';
  }
  const due = a?.due_at ? new Date(a.due_at).getTime() : null;
  if (everyoneDone || (due && due < now)) return 'completed';
  return 'live';
}

/** Merge the self-study rows and the battles into one list of cards. */
export function toItems(activities = [], battles = [], now = Date.now()) {
  const acts = activities.map((a) => ({
    id: `a:${a.id}`, kind: 'activity', type: a.type || 'self_study', title: a.title,
    subject: a.subject || '', stage: activityStage(a, now),
    created: a.created_at || null,
    when: a.details?.scheduled_at || a.due_at || a.created_at || null,
    whenLabel: a.details?.scheduled_at ? 'Holds' : a.due_at ? 'Due' : 'Created',
    raw: a,
  }));
  const bats = battles.map((b) => ({
    id: `b:${b.id}`, kind: 'battle', type: 'battle', title: b.title,
    subject: b.topic || b.subject || '', stage: battleStage(b),
    created: b.createdAt || b.created_at || b.scheduledAt || b.scheduled_start || null,
    when: b.scheduledAt || b.scheduled_start || b.createdAt || null,
    whenLabel: battleStage(b) === 'completed' ? 'Ended' : 'Starts',
    raw: b,
  }));
  const rank = { live: 0, scheduled: 1, lobby: 2, completed: 3 };
  return [...acts, ...bats].sort((x, y) => {
    if (rank[x.stage] !== rank[y.stage]) return rank[x.stage] - rank[y.stage];
    const tx = x.when ? new Date(x.when).getTime() : 0, ty = y.when ? new Date(y.when).getTime() : 0;
    return x.stage === 'scheduled' ? tx - ty : ty - tx;   // soonest first for upcoming, newest first otherwise
  });
}

export function countStages(items) {
  const c = { total: items.length, live: 0, scheduled: 0, lobby: 0, completed: 0 };
  items.forEach((i) => { c[i.stage] += 1; });
  return c;
}
