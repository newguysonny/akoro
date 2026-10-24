/**
 * challengeItems.js — every challenge as ONE item shape, so the Challenges tab
 * draws one card for all of them (reference/Akoro Battles — Model.md):
 *
 *   invites   GET /api/battle/my-challenges        (battle cards, battle/card.js)
 *   requests  GET /api/agent-network/challenge-requests (open / mine / joined)
 *   series    one card per recurring series, in my-challenges (battle/series.js)
 *
 * PURE: no React, no fetch, so the shape is testable.
 *
 *   { key, source, status, format, scope:{kind,label}, timing:{kind,label},
 *     title, statusLine, from:{name, sub, initial, online, host}, sortAt, raw }
 *
 * status drives the sheet's buttons: invite · open · joined · mine · review.
 * source picks the sheet: invite (ChallengeModal) · request · series.
 */

const FORMAT_BY_TYPE = { '1v1': '1v1', classroom: 'Group', team: 'Team 2v2', open: 'Open lobby', review: 'Review', check: 'Review' };
const FORMAT_BY_KIND = { '1v1': '1v1', group: 'Group', team: 'Team 2v2' };
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'invite', label: 'Invites' },
  { key: 'open', label: 'Open' },
  { key: 'joined', label: 'Joined' },
  { key: 'review', label: 'Reviews' },
  { key: 'recurring', label: 'Recurring' },
  { key: 'mine', label: 'Mine' },
];

const when = (iso, now = new Date()) => {
  const d = new Date(iso || '');
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now.getTime() + 86400000).toDateString() === d.toDateString();
  if (sameDay) return `Today · ${time}`;
  if (tomorrow) return `Tomorrow · ${time}`;
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${time}`;
};

const left = (iso, now = Date.now()) => {
  const ms = new Date(iso || '').getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)} days`;
};

/** PURE: "Repeats Mon, Thu · 4:00 PM · until 12 Dec". */
export function repeatsLabel(series) {
  if (!series) return '';
  const days = (series.days || []).slice().sort((a, b) => a - b).map((d) => DAY_SHORT[d]).filter(Boolean).join(', ');
  const [h, m] = String(series.time || '').split(':').map(Number);
  const t = Number.isFinite(h) ? new Date(2000, 0, 1, h, m || 0).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
  const until = series.until ? new Date(series.until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
  return `Repeats ${[days, t].filter(Boolean).join(' · ')}${until ? ` · until ${until}` : ''}`;
}

function scopeOf(kind, name) {
  if (kind === 'course') return { kind, label: name ? `Course · ${name}` : 'Course' };
  if (kind === 'class') return { kind, label: name ? `Class · ${name}` : 'Class' };
  if (kind === 'session') return { kind: 'class', label: name || 'Your teaching session' };
  return { kind: 'network', label: 'Network' };
}

/** PURE: a battle invitation (battle/card.js shape) → item. */
export function fromInvite(c, now = new Date()) {
  const isReview = c.type === 'review' || c.type === 'check';
  const scheduled = c.scheduledFor && new Date(c.scheduledFor) > now;
  const series = c.series || null;
  const expires = c.expiresAt ? left(c.expiresAt, now.getTime()) : null;
  const teacher = c.hostRole === 'teacher';
  const guide = c.reviewHost === 'guide';
  const status = isReview ? 'review' : series && c.mine ? 'mine' : series && c.autoJoined ? 'joined' : 'invite';
  const statusLine = series && c.mine ? (c.lastNote ? 'Your series · last one skipped' : c.post ? 'Your recurring post · open to anyone' : 'Your series · everyone is in')
    : series && c.skippingNext ? "You're in · sitting out the next one"
    : isReview
    ? (guide ? 'Review · with your teaching guide' : 'Review · set by your teacher')
    : series ? (c.autoJoined ? "You're in every occurrence · opt out any time" : 'Invite · recurring')
    : teacher ? 'Invite · hosted by your teacher'
    : expires ? `Invite · expires in ${expires}` : 'Invite';
  return {
    key: `b:${c.id}`,
    source: c.seriesId ? 'series' : 'invite',
    status,
    format: c.daily ? 'Daily' : FORMAT_BY_TYPE[c.type] || '1v1',
    scope: scopeOf(c.reviewHost === 'guide' && c.sessionTitle ? 'session' : c.scope, c.sessionTitle || c.scopeName),
    timing: series ? { kind: 'repeat', label: repeatsLabel(series) }
      : scheduled ? { kind: 'scheduled', label: when(c.scheduledFor, now) }
      : { kind: 'now', label: 'Now' },
    recurring: !!series,
    title: c.title || 'Battle',
    statusLine,
    from: c.seriesId && c.mine ? { name: 'You', sub: `${c.players ?? 1} in it`, initial: 'Y', host: c.hostRole === 'teacher' ? 'teacher' : 'player' }
      : guide ? { name: 'Teaching guide', sub: 'Asks the questions · your protégé answers', initial: 'G', host: 'guide' }
      : { name: c.challenger || 'Someone', sub: teacher ? 'Teacher · hosts, doesn’t compete' : null, initial: (c.challenger || '?').trim().charAt(0).toUpperCase(), avatar: c.avatar || null, host: teacher ? 'teacher' : 'player' },
    sortAt: new Date(c.scheduledFor || c.expiresAt || 0).getTime() || Number.MAX_SAFE_INTEGER,
    next: series && c.nextAt ? when(c.nextAt, now) : null,
    raw: c,
  };
}

/** PURE: an agent-network challenge request → item. `as` is open | mine | joined. */
export function fromRequest(r, as = 'open', now = new Date()) {
  const kind = r.kind || (r.battle_type === 'open' ? 'group' : r.battle_type);
  const at = r.scheduledFor || r.scheduled_for;
  // The API sends seats as "3/8" on some lists and max_players + accepted_by on others.
  const [seatTaken, seatMax] = String(r.seats || '').split('/').map(Number);
  const max = r.max_players || (Number.isFinite(seatMax) ? seatMax : null);
  const taken = Number.isFinite(seatTaken) && r.seats ? seatTaken : 1 + (r.accepted_by || []).length;
  const seatsLeft = max ? Math.max(0, max - taken) : null;
  const statusLine = as === 'mine' ? 'Your post · waiting for a challenger'
    : as === 'joined' ? "You're in · waiting to fill"
    : seatsLeft != null && max > 2 ? `Open · ${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left` : 'Open';
  const agent = typeof r.by?.agent === 'string' ? r.by.agent.split(' ').slice(-1)[0] : r.by?.agent?.name;
  return {
    key: `r:${r.id}`,
    source: 'request',
    status: as,
    format: FORMAT_BY_KIND[kind] || '1v1',
    scope: scopeOf('network'),
    timing: at && new Date(at) > now ? { kind: 'scheduled', label: when(at, now) } : { kind: 'now', label: 'Now' },
    recurring: false,
    title: r.title || 'Challenge',
    statusLine,
    from: {
      name: as === 'mine' ? 'You' : r.by?.name || 'Someone',
      sub: [r.by?.username, agent && `Agent ${agent}`, r.by?.level != null && `Lv ${r.by.level}`].filter(Boolean).join(' · ') || null,
      initial: (as === 'mine' ? 'You' : r.by?.name || '?').trim().charAt(0).toUpperCase(),
      online: !!r.by?.online,
      host: 'player',
    },
    seats: max ? `${taken}/${max}` : null,
    sortAt: new Date(at || 0).getTime() || Number.MAX_SAFE_INTEGER,
    raw: r,
  };
}

/** PURE: the one list: what needs an answer first (invites, reviews), then by start time. */
export function mergeItems({ invites = [], open = [], mine = [], joined = [] }, now = new Date()) {
  const rank = { invite: 0, review: 1, joined: 2, open: 3, mine: 4 };
  const items = [
    ...invites.map((c) => fromInvite(c, now)),
    ...joined.map((r) => fromRequest(r, 'joined', now)),
    ...open.map((r) => fromRequest(r, 'open', now)),
    ...mine.map((r) => fromRequest(r, 'mine', now)),
  ];
  const seen = new Set();
  return items.filter((i) => (seen.has(i.key) ? false : seen.add(i.key)))
    .sort((a, b) => (rank[a.status] - rank[b.status]) || (a.sortAt - b.sortAt));
}

/** PURE: the items a filter chip keeps. */
export function filterItems(items, key) {
  if (key === 'all') return items;
  if (key === 'recurring') return items.filter((i) => i.recurring);
  return items.filter((i) => i.status === key);
}
