/**
 * needsYouHome.js — what the Home "Needs you" card shows (2026-11-07: the
 * resume card and the Tasks → Needs you list are ONE thing). PURE.
 *
 *   homeNeedsYou(data) → null | { lead, more, total, working }
 *     lead   the one item most worth continuing: an open workflow first (a
 *            lesson, a review, a Study Prep), else the list's first item
 *     more   how many other items wait in Tasks → Needs you
 *     working  healthy running work (one small line), when nothing waits
 */
import { APP_HOME } from '../config/target.js';

export function homeNeedsYou(data) {
  const items = Array.isArray(data?.needsYou?.items) ? data.needsYou.items : [];
  const working = (Array.isArray(data?.workflows) ? data.workflows : []).filter((w) => w && !w.needsYou && w.action);
  if (!items.length && !working.length) return null;
  const lead = items.find((it) => it.source === 'workflow' && it.action?.href) || items[0] || null;
  return { lead, more: Math.max(0, items.length - (lead ? 1 : 0)), total: items.length, working };
}

/** Where a Needs you link opens from Home: a workflow its own screen; anything in the chat's inbox the Tasks list. */
export function homeHref(item) {
  const href = item?.action?.href || '';
  if (!href) return NEEDS_YOU_HREF;
  if (href.includes('inbox=')) return `${APP_HOME}?tab=agent&tasks=suggestions`;
  return href;
}
export const NEEDS_YOU_HREF = `${APP_HOME}?tab=agent&tasks=needs`;
