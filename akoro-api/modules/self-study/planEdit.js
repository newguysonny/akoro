/**
 * planEdit — how a conversational revision changes a draft's plan entries.
 *
 * The plan (study-plan subtopics / task breakdown / milestones) is written in
 * the background, so the agent that is asked to "add a subtopic" has usually
 * never seen the list. Sending the whole list back from memory replaced the
 * generated plan with whatever the model invented (found by the verification
 * gate: 8 stored entries became 5 different ones). So the common edits are
 * operations on the stored list — add, remove — and only a deliberate rewrite
 * sends the full `subtopics`.
 */
const clean = (list) => (Array.isArray(list) ? list : []).map((x) => String(x ?? "").trim()).filter(Boolean);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * @param current   the draft's stored entries
 * @param edit      { subtopics?: full replacement, add?: entries to append, remove?: entries to drop }
 *                  `remove` matches an entry exactly or by the words given (case-insensitive).
 * @returns the entries after the edit, de-duplicated, in order.
 */
export function mergePlanItems(current, { subtopics, add, remove } = {}) {
  let items = Array.isArray(subtopics) ? clean(subtopics) : clean(current);
  const drops = clean(remove).map((d) => d.toLowerCase());
  if (drops.length) items = items.filter((st) => !drops.some((d) => st.toLowerCase() === d || st.toLowerCase().includes(d)));
  for (const a of clean(add)) if (!items.some((st) => same(st, a))) items.push(a);
  return items;
}

/** Does this revision touch the plan at all? */
export const wantsPlanEdit = (c) =>
  Array.isArray(c?.subtopics) || (c?.objectives && typeof c.objectives === "object")
  || clean(c?.add_subtopics).length > 0 || clean(c?.remove_subtopics).length > 0;
