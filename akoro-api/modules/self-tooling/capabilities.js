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

  // ── locked: requestable, need an admin grant ──────────────────────────
  "battles.class_results":  locked("Battle results of the learner's classmates (scores and ranks in shared battles).", ["classmates", "beat", "class results", "others"], { kind: "read", scope: "network" }),
  "tasks.mark_done":        locked("Mark one of the learner's tasks as done.", ["done", "complete", "finish task"]),
  "buddies.end":            locked("End one of the learner's study buddy pairings.", ["end buddy", "stop buddy"]),
  "circles.leave":          locked("Leave a revision circle the learner joined.", ["leave circle"]),
  "challenges.cancel_mine": locked("Cancel one of the learner's own open challenge requests.", ["cancel challenge"]),
});

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
