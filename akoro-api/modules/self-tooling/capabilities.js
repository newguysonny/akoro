/**
 * modules/self-tooling/capabilities.js — operations a created tool may call.
 * Plan §7.2. Code-owned (rule 27): the agent and learner can REQUEST a
 * capability; only an admin grant turns a `locked` one on (for everyone,
 * decision S10); `forbidden` can never be requested or granted.
 *
 *   enabled    usable now          (read capabilities — wrap existing read tools)
 *   locked     exists, requestable (writes, other learners' data)  → admin grant
 *   forbidden  never
 *
 * `tool` is the existing learner chat tool the capability runs through, so every
 * permission, scope and privacy check that tool has still applies (§7.5).
 * `returns` names the fields a recipe can filter, sort and join on.
 * `audience` "instructor" marks capabilities only instructor tools may use
 * (default "learner"); a tool never mixes the two (S7).
 */
const read = (tool, description, keywords, returns) => ({ kind: "read", status: "enabled", scope: "self", tool, description, keywords, returns });
const locked = (description, keywords, extra = {}) => ({ kind: "write", status: "locked", scope: "self", description, keywords, ...extra });

export const CAPABILITIES = Object.freeze({
  // ── read: the learner's own data ──────────────────────────────────────
  "learner.context":        read("get_learner_context", "The learner's profile: name, school, class, subjects, timezone and today's date.", ["profile", "today", "date", "class", "school"], ["name", "school", "yearGroup", "subjects", "timeZone", "today"]),
  "tasks.list_mine":        read("list_tasks", "The learner's pending tasks.", ["task", "todo", "due"], ["items[].title", "items[].priority", "items[].dueAt"]),
  "goals.list_mine":        read("list_my_goals", "The learner's goals.", ["goal"], ["goals[].title", "goals[].status", "goals[].targetDate"]),
  "progress.overview":      read("check_progress", "Course progress and overall XP and rank.", ["progress", "xp", "rank", "course"], ["courses[].title", "courses[].progress", "xp", "rank"]),
  "ranking.mine":           read("get_ranking", "The learner's leaderboard position.", ["rank", "ranking", "leaderboard", "position"], ["rank", "totalXp", "battlesWon"]),
  "learning.weak_topics":   read("get_weak_topics", "Topics the agent is weakest on.", ["weak", "struggle", "topic"], ["topics[].subject", "topics[].topic", "topics[].confidence"]),
  "learning.sessions":      read("get_my_learning_sessions", "Recent teaching sessions with the agent.", ["session", "lesson"], ["sessions[].subject", "sessions[].topic", "sessions[].status"]),
  "learning.overview":      read("get_learning_overview", "Summary of what the agent has learnt by subject.", ["overview", "learnt", "summary"], ["subjects[].subject", "subjects[].topics"]),
  "learning.knowledge_map": read("get_knowledge_map", "Subject → topic map of what the agent knows, with health.", ["map", "knowledge", "topics"], ["subjects[].topics[].topic", "subjects[].topics[].confidence"]),
  "practice.past_questions": read("get_past_question_practice", "Past-question practice by exam and subject: attempted, correct, accuracy, years, last practised.", ["past question", "past questions", "accuracy", "practice", "exam"], ["bySubject[].exam", "bySubject[].subject", "bySubject[].attempted", "bySubject[].correct", "bySubject[].accuracy", "totals"]),
  "school.mine":            read("get_my_school", "The learner's school and class.", ["school", "class"], ["school", "class"]),
  "school.subjects":        read("list_school_subjects", "Subjects the learner's class takes.", ["subject", "subjects", "timetable"], ["subjects[].name"]),
  "school.teachers":        read("list_my_teachers", "The learner's teachers and what they teach.", ["teacher", "teachers"], ["teachers[].name", "teachers[].subject"]),
  "chats.list_mine":        read("list_chats", "The learner's chats (titles, dates).", ["chat", "conversation"], ["chats[].chatId", "chats[].title", "chats[].lastMessageAt"]),
  "followups.list_mine":    read("list_scheduled_chat_follow_ups", "Messages the agent has scheduled for the learner.", ["reminder", "scheduled", "follow-up"], ["followUps[].scheduledAt", "followUps[].title"]),
  "battles.find":           read("find_battles", "Battles the learner is in or can join.", ["battle", "upcoming", "join"], ["battles[].title", "battles[].subject", "battles[].status", "battles[].startsAt"]),
  "league.weekly":          read("get_weekly_league", "This week's XP league table (scope: class, school, subject, exam).", ["league", "week", "weekly", "table"], ["rows[].name", "rows[].xp", "rows[].rank"]),
  "inbox.mine":             read("check_agent_inbox", "Messages and answers in the agent's inbox.", ["inbox", "messages", "asked"], ["incoming[].kind", "incoming[].subject", "answers[]"]),
  "blogs.mine":             read("list_my_blogs", "The learner's own blog drafts and posts.", ["blog", "draft", "post"], ["blogs[].title", "blogs[].status"]),
  "proposals.mine":         read("list_my_proposals", "Suggestions the agent proposed to the learner.", ["proposal", "suggestion"], ["proposals[].title", "proposals[].kind"]),

  // ── read: other learners, through the network's privacy rules ─────────
  "agents.search":          { ...read("search_agents", "Find other learners' agents who are visible to this learner (privacy, blocks and visibility applied).", ["agent", "agents", "classmate", "online", "learners", "who"], ["agents[].username", "agents[].level", "agents[].xp", "agents[].presence", "agents[].subjects"]), scope: "network" },
  "challenges.search":      { ...read("search_challenge_requests", "Open challenge requests the learner could accept.", ["challenge", "request", "open"], ["requests[].title", "requests[].subject", "requests[].battleType"]), scope: "network" },
  "blogs.search_public":    { ...read("search_blog_posts", "Search published Akoro blog articles.", ["blog", "article", "how to", "study tips"], ["posts[].title", "posts[].slug", "posts[].category"]), scope: "public" },

  // ── read: instructors (S7) — through the instructor chat tools, so their checks apply ──
  "activities.outcomes":    { ...read("check_activity_outcomes", "How one of the instructor's assigned activities went: completion counts and class-average understanding, confusion and engagement (args: assignmentId; without it, their recent activities).", ["outcome", "outcomes", "how did", "went", "understanding", "engagement", "confusion"], ["recent[].title", "recent[].type", "completed", "assigned", "averages"]), audience: "instructor" },

  // ── locked: requestable, need an admin grant ──────────────────────────
  // Runs in capRuntime.js (no chat tool): other players' results in battles the learner took part in.
  "battles.class_results":  locked("Results of the other players in battles the learner took part in: their name, score, rank and whether they won (blocked learners left out).", ["classmates", "beat", "class results", "others", "other players", "opponents", "compare", "versus"], { kind: "read", scope: "network", runtime: true,
    returns: ["results[].battleTitle", "results[].subject", "results[].player", "results[].score", "results[].rank", "results[].isWinner", "results[].isMe"] }),
  // The gate's harmless probe (scenario selftool.escalate_and_resume): returns the time and nothing else.
  // Never offered by schema_lookup; reachable only through a hint, so a grant left on changes nothing.
  "verify.probe":           locked("Gate probe: returns the current time (testing escalation only).", [], { kind: "read", runtime: true, hidden: true, returns: ["checkedAt", "ok"] }),
  // The gate's write probe (scenario selftool.write_confirm): marks a task done like
  // tasks.mark_done, hidden from schema_lookup; granted only during a gate run.
  "verify.task_done":       locked("Gate probe: mark the learner's tasks as done (testing confirmations only).", [], { hidden: true, target: "my_tasks", item: (r) => r.title || "a task" }),
  // Writes (S6): a recipe's final `write` step applies one to rows of `target`
  // (the learner's own rows, by their private id) — only after the learner
  // confirms the exact list on a card. Runners: capRuntime.js WRITE_RUNNERS.
  "tasks.delete":           locked("Delete the learner's tasks (a running task is never deleted).", ["delete", "remove", "clear", "delete task", "remove task", "clear tasks", "old tasks"], { target: "my_tasks", item: (r) => r.title || "a task" }),
  "tasks.mark_done":        locked("Mark the learner's tasks as done.", ["done", "complete", "finish task", "mark", "tick off"], { target: "my_tasks", item: (r) => r.title || "a task" }),
  "buddies.end":            locked("End the learner's study buddy pairings.", ["end buddy", "stop buddy"], { target: "my_buddies", item: (r) => `Study buddy${r.subject ? ` for ${r.subject}` : ""}` }),
  "circles.leave":          locked("Leave a revision circle the learner joined.", ["leave circle"]),
  "challenges.cancel_mine": locked("Cancel one of the learner's own open challenge requests.", ["cancel challenge"]),
});

/**
 * A capability the LEARNER may turn on for themselves (approving a card in their
 * chat): a change to their own rows that a tool can target, where every change
 * still waits for their Confirm. Other learners' data, and reads of it, stay
 * admin-only.
 */
export function learnerGrantable(name) {
  const c = CAPABILITIES[name];
  return !!c && !c.hidden && c.status === "locked" && c.kind === "write" && !!c.target && (c.scope || "self") === "self" && capAudience(c) === "learner";
}

// "Delete my old tasks", "mark my tasks done": a change to the learner's own tasks no
// built-in tool makes. (Ending a study buddy has its own tool, study_buddy.)
const OWN_CHANGES = [
  { cap: "tasks.delete", re: /\b(delete|remove|clear(?: out)?|get rid of|erase|wipe)\b[^.?!\n]{0,40}\b(tasks?|to-?dos?)\b|\b(tasks?|to-?dos?)\b[^.?!\n]{0,30}\b(deleted|removed)\b/i },
  { cap: "tasks.mark_done", re: /\b(mark|tick(?: off)?|check off)\b[^.?!\n]{0,40}\b(tasks?|to-?dos?)\b|\b(tasks?|to-?dos?)\b[^.?!\n]{0,30}\b(as )?(done|complete|completed|finished)\b/i },
];
/** PURE: the own-data change a learner's message asks for, if any. → capability | null */
export function ownChangeAsked(message) {
  const m = String(message || "");
  return OWN_CHANGES.find((x) => x.re.test(m))?.cap || null;
}

/**
 * PURE: did the learner's latest message say yes to building a tool ("yes",
 * "sure, go ahead", "build it", "make me a tool that…")? A permission card is
 * only shown after they have — the first answer to "delete my tasks" is a
 * conversation (the agent can't yet, offers to build it), not a card.
 */
export function agreesToBuild(text) {
  const t = String(text || "");
  if (/\b(no|nope|don'?t|do not|not now|never ?mind|cancel|stop)\b/i.test(t)) return false;
  return /\b(yes|yeah|yep|yup|sure|ok(?:ay)?|alright|go ahead|go for it|do it|please do|sounds good|let'?s do (?:it|that)|build|make (?:it|one|that|me)|create (?:it|one|that))\b/i.test(t)
    // "Ask for permission to delete my tasks": asking for it outright is a yes.
    || /\b(ask|request|get)\b[^.?!]{0,25}\b(permission|access|approval)\b/i.test(t);
}

/** Never — cannot be requested or granted (rule 27). Matched against goals and requested names. */
export const FORBIDDEN = Object.freeze([
  { name: "others.private_data", description: "Another learner's private data (scores, notes, chats, messages, grades, contact details).",
    pattern: /\b(someone(?: else)?['’]?s?|another (?:learner|student|person)['’]?s?|other (?:learners|students)['’]?|his|her)\b[^.]{0,40}\b(notes?|chats?|messages?|grades?|scores?|results?|email|phone|password|address)\b/i,
    // "Chiamaka's scores" — a capitalised name's possessive (case-sensitive on purpose).
    named: /\b(?!My\b|I\b)[A-Z][a-z]{2,}['’]s\b[^.]{0,40}\b(notes?|chats?|messages?|grades?|scores?|results?|email|phone|password|address)\b/ },
  { name: "accounts.credentials", description: "Passwords, tokens, keys or login details.", pattern: /\b(password|token|api key|secret|credential|login details)\b/i },
  { name: "money.move", description: "Moving or creating coins, payments or refunds.", pattern: /\b(give|send|transfer|add|create|refund)\b[^.]{0,20}\b(coins?|money|credits?|payment)\b/i },
  { name: "accounts.admin", description: "Changing roles, tiers, accounts or other users.", pattern: /\b(make me|grant|promote)\b[^.]{0,20}\b(admin|teacher|instructor|role|tier|premium)\b|\bdelete (an? )?(account|user)s?\b/i },
  { name: "messaging.bulk", description: "Messaging many learners at once.", pattern: /\b(message|text|email|notify)\b[^.]{0,20}\b(everyone|all (the )?(learners|students|users)|whole school)\b/i },
]);

export const forbiddenFor = (goal) => FORBIDDEN.filter((x) => x.pattern.test(String(goal || "")) || (x.named && x.named.test(String(goal || ""))));

/** Who a capability is for: "learner" (default) or "instructor". */
export const capAudience = (cap) => cap?.audience || "learner";

