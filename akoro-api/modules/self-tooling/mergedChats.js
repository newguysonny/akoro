// Merged chats tool (rollout of the library merge, commit edc274a5, to the
// chats domain — Matt's order 2026-11-15, after the same-minute triple check
// proved the my_chats view count and list_chats agree exactly).
//
// The learner sees ONE tool, `my_chats`, whose actions are served from two
// sides with no duplicates:
//   - count            → the platform side: the my_chats view count, the true
//                        uncapped total (list_chats caps at 30 rows).
//   - list, search     → the platform side: the existing hand-written
//                        handlers (list = recent chats WITH chatIds, newest
//                        first; search = message-content search). The view
//                        cannot supply chatIds or content matches.
//   - anything else    → the learner's own saved delta actions, run through
//                        their personal my_chats domain tool row.
// Pure module (no imports) so the contract tests exercise the real def shape.

export const CHATS_BASE_ACTIONS = ["count"];
export const CHATS_PLATFORM_ACTIONS = ["list", "search"];
export const CHATS_MERGED_ACTIONS = [...CHATS_BASE_ACTIONS, ...CHATS_PLATFORM_ACTIONS];

export function mergedChatsEnabled() {
  return process.env.AKORO_MERGED_CHATS !== "false";
}

/** True when every requested action is already served by the merged tool —
 *  a build asking only for these has nothing new to save. */
export function chatsBuildIsCovered(actions) {
  return Array.isArray(actions) && actions.length > 0
    && actions.every((a) => CHATS_MERGED_ACTIONS.includes(a));
}

/** The learner's own extra actions on their my_chats row: stored actions
 *  minus the merged set, minus anything switched off. Accepts both the DB
 *  (disabled_actions) and API (disabledActions) shapes. */
export function chatsDeltaActions(row) {
  if (!row) return [];
  const off = new Set(row.disabledActions || row.disabled_actions || []);
  return (row.actions || []).filter((a) => !CHATS_MERGED_ACTIONS.includes(a) && !off.has(a));
}

export function mergedChatsDef({ delta = [] } = {}) {
  const actions = [...CHATS_MERGED_ACTIONS, ...delta];
  const extra = delta.length
    ? ` This learner also saved extra actions on their own copy of this tool: ${delta.join(", ")} — those run from their copy.`
    : "";
  return {
    type: "function",
    function: {
      name: "my_chats",
      description: `Your chats with your agent — one tool for all of it. Actions: count = the exact total number of chats (never capped); list = the most recent chats, newest activity first, each with its chatId (use a chatId with read_chat or post_to_chat); pass query with list to match titles; search = find chats by what was talked about in them (message content) — pass query.${extra} Never invent a chat or a title.`,
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: actions, description: "Which action to run." },
          query: { type: "string", description: "Words to match: titles for list, message content for search." },
          limit: { type: "integer", description: "Max chats for list/search (default 15, max 30)." },
        },
        required: ["action"],
      },
    },
  };
}
