/**
 * modules/communities/rules.js — pure membership / deadline / visibility
 * predicates for communities.
 *
 * Nothing here touches the database or the request. Each predicate is the
 * single statement of one gate, so the route flow in service.js reads as
 * "find → gate → act" and the ownership contract tests can pin the gate
 * without stubbing Supabase.
 */

/** The caller created (owns) this community. */
export const isOwner = (community, userId) => community?.owner_id === userId;

/** The caller created this activity. */
export const isActivityCreator = (activity, userId) => activity?.creator_id === userId;

/** A private community's work is for its members (Phase 15 item 6). */
export const requiresMembership = (community) => !community?.is_public;

/** Joining is public-only; a private community is invite/owner territory. */
export const canJoin = (community) => !!community?.is_public;

/** The membership row is the community's owner. */
export const isOwnerRole = (member) => member?.role === "owner";

/** A membership row exists — members (owner included) only. */
export const isMemberRow = (member) => !!member;

/** Parse an activity due date into ISO, or null when absent/invalid. */
export function parseDueAt(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
