/**
 * chat-trace.js — the live, learner-safe trace of one Agent Chat turn.
 *
 * The Agent Chat tab renders a turn the way a coding agent does: thinking
 * rows, collapsible tool rows (grouped when consecutive), plain activity text,
 * interleaved as many times as the tool loop iterates (Grand Plan §13.4, D41).
 * This module is the server half: it turns each tool call into a row the
 * learner can read ("Checking your goals ✓ 120ms"), never a backend name, and
 * keeps a bounded copy of the trace so a reloaded chat shows the same blocks.
 *
 * Pure apart from the injected `send` — no db, no model, no clock unless
 * passed in — so the contract test can drive it directly.
 *
 * What NEVER enters the stored trace: raw tool arguments, raw tool results,
 * model reasoning tokens, answer keys. A row carries a learner-language
 * headline, a short outcome line, at most a few short labels of what was
 * found (the learner's own data, e.g. goal titles), and for a change the
 * title and a few whitelisted fields. Thinking rows carry harness narration
 * (D10) or, in Think mode, the provider's reasoning SUMMARY (D9).
 *
 * Developer mode (opt-in per request) adds the raw tool name, arguments and
 * output to the LIVE events only — never to the stored trace.
 */

/** Learner-language display for every Agent Chat tool. Unknown tools fall back to a neutral row. */
export const CHAT_TOOL_DISPLAY = Object.freeze({
  get_learner_context:            { category: "research", headline: "Reviewing your study profile",        description: "Looking at your class, subjects and recent activity" },
  get_agent_capabilities:         { category: "research", headline: "Checking what I can do for you",      description: "Reading the list of things your agent can help with" },
  check_progress:                 { category: "research", headline: "Checking your progress",              description: "Looking at your recent results and streaks" },
  get_my_school:                  { category: "research", headline: "Checking your school",                description: "Looking up your school and class" },
  list_school_subjects:           { category: "research", headline: "Checking your subjects",              description: "Listing the subjects your class takes" },
  list_my_teachers:               { category: "research", headline: "Checking your teachers",              description: "Listing the teachers for your class" },
  find_teacher:                   { category: "research", headline: "Looking up a teacher",                description: "Finding the teacher you asked about" },
  get_my_learning_sessions:       { category: "research", headline: "Reading your learning sessions",      description: "Looking at your recent teaching sessions" },
  create_task:                    { category: "action",   headline: "Creating a task",                     description: "Adding the task to your list", done: "Created a task" },
  suggest_help:                   { category: "action",   headline: "Preparing a suggestion",              description: "Adding an idea to your suggestions inbox", done: "Added a suggestion" },
  schedule_chat_follow_up:        { category: "action",   headline: "Scheduling a follow-up",              description: "Setting a time for me to check in with you", done: "Scheduled a follow-up" },
  list_scheduled_chat_follow_ups: { category: "research", headline: "Checking your scheduled check-ins",   description: "Listing the follow-ups already planned" },
  cancel_scheduled_chat_follow_up:{ category: "action",   headline: "Cancelling a follow-up",              description: "Removing a planned check-in", done: "Cancelled a follow-up" },
  consult_peer_agents:            { category: "research", headline: "Asking other learners' agents",       description: "Collecting ideas from other study agents" },
  search_agents:                  { category: "research", headline: "Finding agents",                       description: "Looking for other learners' agents that match" },
  update_agent_network_settings:  { category: "action",   headline: "Updating your privacy",                description: "Who can find and message your agent", done: "Updated your privacy" },
  block_agent:                    { category: "action",   headline: "Blocking an agent",                    description: "They can no longer reach you", done: "Blocked an agent" },
  log_past_question_practice:     { category: "action",   headline: "Logging past-question practice",       description: "Adding it to your practice record", done: "Logged your practice" },
  find_competitors:               { category: "research", headline: "Finding opponents",                    description: "Agents open to a battle" },
  challenge_agent:                { category: "action",   headline: "Sending a challenge",                  description: "Inviting agents to a battle", done: "Sent a challenge" },
  post_challenge_request:         { category: "action",   headline: "Posting a challenge request",          description: "Others can find and accept it", done: "Posted a challenge request" },
  search_challenge_requests:      { category: "research", headline: "Looking for challenge requests",       description: "Open battles you can take" },
  accept_challenge_request:       { category: "action",   headline: "Accepting a challenge",                description: "Taking a seat in the battle", done: "Accepted a challenge" },
  cancel_challenge_request:       { category: "action",   headline: "Cancelling a challenge request",       description: "Taking your request down", done: "Cancelled a request" },
  rematch_battle:                 { category: "action",   headline: "Setting up a rematch",                 description: "Same battle, same agents", done: "Sent a rematch" },
  message_agent:                  { category: "action",   headline: "Messaging another agent",              description: "Asking or telling another learner's agent", done: "Sent a message" },
  check_agent_inbox:              { category: "read",     headline: "Opening your agent inbox",             description: "Messages from other learners' agents" },
  reply_to_agent:                 { category: "action",   headline: "Replying to an agent",                 description: "Answering a question left for your agent", done: "Sent a reply" },
  study_buddy:                    { category: "action",   headline: "Study buddies",                        description: "Checking in with your study buddy's agent", done: "Updated your study buddies" },
  daily_challenge:                { category: "action",   headline: "Today's daily challenge",              description: "Five shared questions, ranked", done: "Daily challenge updated" },
  revision_circle:                { category: "action",   headline: "Revision circles",                     description: "Revising a topic with other agents", done: "Revision circle updated" },
  get_weekly_league:              { category: "research", headline: "Checking this week's league",          description: "XP earned this week, ranked" },
  ask_to_be_taught:               { category: "read",     headline: "Checking what you've taught me",      description: "Asking you to teach this topic" },
  consult_teaching_guide:         { category: "read",     headline: "Asking NaNa, my teaching guide",      description: "Something you haven't taught me yet" },
  search_blog_posts:              { category: "read",     headline: "Searching the Akoro blog",            description: "Looking for articles on this topic" },
  read_blog_post:                 { category: "read",     headline: "Reading a blog article",              description: "Reading the article in full" },
  list_my_goals:                  { category: "research", headline: "Checking your goals",                 description: "Looking at your active study goals" },
  create_goal:                    { category: "action",   headline: "Creating a goal",                     description: "Adding the goal to your list", done: "Saved a goal" },
  update_goal_progress:           { category: "action",   headline: "Updating a goal",                     description: "Recording progress on your goal", done: "Updated a goal" },
  list_my_proposals:              { category: "research", headline: "Checking your agent's proposals",     description: "Looking at ideas waiting for your approval" },
  list_my_blogs:                  { category: "research", headline: "Checking your blog drafts",           description: "Listing your posts" },
  save_blog_draft:                { category: "action",   headline: "Saving a blog draft",                 description: "Saving your post as a draft", done: "Saved a blog draft" },
  publish_blog:                   { category: "action",   headline: "Publishing your post",                description: "Making your post public", done: "Published your post" },
  list_tasks:                     { category: "research", headline: "Checking your tasks",                 description: "Looking at what's due and what's done" },
  find_battles:                   { category: "research", headline: "Looking for battles",                 description: "Finding battles you can join" },
  get_ranking:                    { category: "research", headline: "Checking the rankings",               description: "Looking at where you stand" },
  get_weak_topics:                { category: "research", headline: "Finding your weaker topics",          description: "Looking for topics that need more work" },
  get_learning_overview:          { category: "research", headline: "Reviewing your learning overview",    description: "Looking across your subjects and topics" },
  get_knowledge_map:              { category: "research", headline: "Reading your knowledge map",          description: "Looking at what your agent knows so far" },
  search_my_study_knowledge:      { category: "read",     headline: "Searching your notes",                description: "Looking through what you've taught your agent" },
  get_concept_tracker_summary:    { category: "research", headline: "Checking your concept tracker",       description: "Looking at concepts you've mastered and ones still open" },
  get_learning_insights_summary:  { category: "research", headline: "Reviewing your learning insights",    description: "Looking at patterns in how you learn" },
  get_exam_prep_status:           { category: "research", headline: "Checking your exam prep",             description: "Looking at your practice runs" },
  get_chat_memory:                { category: "research", headline: "Recalling our earlier chats",         description: "Looking at what you've told me before" },
  get_agent_preferences:          { category: "research", headline: "Checking your agent settings",        description: "Looking at how you've set up your agent" },
  get_autonomy_status:            { category: "research", headline: "Checking your agent's status",        description: "Seeing whether your agent is online" },
  start_study_prep_session:       { category: "action",   headline: "Starting a study plan",               description: "Setting up a study-prep session for you", done: "Started a study plan" },
  get_study_prep_session:         { category: "research", headline: "Checking your study plan",            description: "Looking at your current study-prep session" },
  submit_tool_request:            { category: "action",   headline: "Sending your feature request",        description: "Passing your idea to the Akoro team", done: "Sent your feature request" },
  prepare_activity:               { category: "action",   headline: "Drafting an activity",                description: "Preparing an activity for your review", done: "Drafted an activity" },
  list_activity_drafts:           { category: "research", headline: "Checking your activity drafts",       description: "Listing drafts waiting for review" },
  discard_activity_draft:         { category: "action",   headline: "Discarding a draft",                  description: "Removing the activity draft", done: "Discarded a draft" },
  list_my_classrooms:             { category: "research", headline: "Checking your classes",               description: "Listing the classes you teach" },
  get_my_profile:                 { category: "research", headline: "Checking your profile",               description: "Looking at your account details" },
  check_activity_outcomes:        { category: "research", headline: "Checking activity results",           description: "Looking at how learners did" },
  schedule_activity_routine:      { category: "action",   headline: "Scheduling a routine",                description: "Setting up a repeating activity", done: "Scheduled a routine" },
  list_activity_routines:         { category: "research", headline: "Checking your routines",              description: "Listing the routines you've set" },
  cancel_activity_routine:        { category: "action",   headline: "Cancelling a routine",                description: "Stopping a repeating activity", done: "Cancelled a routine" },
  get_activity_draft:             { category: "read",     headline: "Opening an activity draft",           description: "Reading the draft" },
  revise_activity_draft:          { category: "action",   headline: "Revising the draft",                  description: "Updating the activity draft", done: "Revised the draft" },
});

const FALLBACK_DISPLAY = Object.freeze({ category: "research", headline: "Checking your study data", description: "Looking up what I need to help" });

/** Display for one tool. The raw name stays server-side (developer mode only). */
export function chatToolDisplay(tool) {
  const { done, ...display } = CHAT_TOOL_DISPLAY[String(tool || "")] || FALLBACK_DISPLAY;
  return display;
}

const MAX_RESULT_CHARS = 120;
const clip = (text, max) => {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
/** Like clip, but keeps paragraph breaks — reasoning summaries are multi-paragraph. */
const clipParagraphs = (text, max) => {
  const value = String(text ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

/** The largest list in a result, by length — "3 found" lines come from this. */
function primaryCount(result) {
  if (!result || typeof result !== "object") return null;
  let best = null;
  for (const value of Object.values(result)) {
    if (Array.isArray(value) && (best === null || value.length > best)) best = value.length;
  }
  return best;
}

/**
 * One short, learner-safe outcome line — never the raw result. Counts and
 * outcomes only; anything richer stays in the model's observation.
 */
export function chatToolResultLine(toolResult) {
  if (toolResult == null) return { ok: true, result: "Done" };
  if (typeof toolResult !== "object") return { ok: true, result: "Done" };
  if (toolResult.needsClarification) return { ok: true, result: "Needs one detail from you" };
  if (toolResult.success === false || toolResult.error) return { ok: false, result: "Couldn't complete this step" };
  if (toolResult.disabled) return { ok: true, result: "Not available yet" };
  const count = primaryCount(toolResult);
  if (count !== null) return { ok: true, result: count === 0 ? "Nothing found" : `${count} found` };
  return { ok: true, result: "Done" };
}

// "What I found": a few short labels from the result's main list.
const FOUND_ITEMS_MAX = 6;
const ITEM_CHARS = 80;
const LABEL_KEYS = ["title", "name", "topic", "subject", "label", "concept", "question", "full_name", "displayName", "headline"];

function primaryList(result) {
  if (!result || typeof result !== "object") return null;
  let best = null;
  for (const value of Object.values(result)) {
    if (Array.isArray(value) && (best === null || value.length > best.length)) best = value;
  }
  return best;
}

function itemLabel(item) {
  if (typeof item === "string" || typeof item === "number") return clip(item, ITEM_CHARS);
  if (!item || typeof item !== "object") return "";
  for (const key of LABEL_KEYS) {
    if (typeof item[key] === "string" && item[key].trim()) return clip(item[key], ITEM_CHARS);
  }
  return "";
}

/** Up to six short labels of what a research step found — never whole records. */
export function chatToolFoundItems(toolResult) {
  const list = primaryList(toolResult);
  if (!list) return [];
  return list.map(itemLabel).filter(Boolean).slice(0, FOUND_ITEMS_MAX);
}

// Change rows: the only fields a change may show, in learner language.
const CHANGE_FIELDS = [
  ["dueAt", "Due"], ["due_at", "Due"], ["scheduledAt", "When"], ["scheduled_at", "When"],
  ["targetDate", "Target date"], ["target_date", "Target date"], ["priority", "Priority"],
  ["status", "Status"], ["progressNote", "Progress note"], ["kind", "Type"], ["category", "Type"],
  ["subject", "Subject"], ["topic", "Topic"], ["day", "Day"],
];

/**
 * A change row for a successful action ("Created a task · Revise photosynthesis"),
 * or null. Built from the result first, then what the agent asked for.
 */
export function chatToolChange(tool, toolResult, input = {}) {
  const done = CHAT_TOOL_DISPLAY[String(tool || "")]?.done;
  if (!done) return null;
  if (!toolResult || typeof toolResult !== "object") return null;
  if (toolResult.success === false || toolResult.error || toolResult.needsClarification || toolResult.disabled) return null;
  const sources = [toolResult, toolResult.task, toolResult.goal, toolResult.post, toolResult.session, input].filter((v) => v && typeof v === "object");
  const pick = (key) => sources.map((source) => source[key]).find((value) => typeof value === "string" || typeof value === "number");
  const title = pick("title") ?? pick("message") ?? "";
  const seen = new Set();
  const fields = [];
  for (const [key, label] of CHANGE_FIELDS) {
    const value = pick(key);
    if (value === undefined || value === "" || seen.has(label)) continue;
    seen.add(label);
    fields.push({ label, value: clip(value, ITEM_CHARS) });
  }
  return { label: done, title: clip(title, ITEM_CHARS), fields: fields.slice(0, 5) };
}

/** Developer mode: raw tool I/O, bounded, live only. */
const RAW_CHARS = 4_000;
function rawJson(value) {
  let text;
  try { text = JSON.stringify(value ?? null, null, 2); } catch { text = String(value); }
  return text.length > RAW_CHARS ? `${text.slice(0, RAW_CHARS - 1)}…` : text;
}

/** Harness narration for a decision step (D10) — built from what the agent chose, not from its reasoning. */
export function decisionNarration(calls) {
  const names = (calls || []).map((call) => call?.function?.name).filter(Boolean);
  if (!names.length) return "I have what I need — writing your answer.";
  const headlines = [...new Set(names.map((name) => chatToolDisplay(name).headline.toLowerCase()))];
  const list = headlines.length === 1
    ? headlines[0]
    : `${headlines.slice(0, -1).join(", ")} and ${headlines[headlines.length - 1]}`;
  return clip(`Next: ${list}.`, 240);
}

/** Bounded copy kept for reload. */
export const TRACE_LIMITS = Object.freeze({ MAX_BLOCKS: 60, MAX_TEXT_CHARS: 4_000 });

/**
 * createChatTrace({ send, now, developer }) — emits the live events and keeps the
 * bounded trace. `send(event, data)` is the route's SSE writer (or null for
 * the JSON path, which still returns the trace on the response).
 *
 * Events (all carry a stable `id` per block):
 *   think_start { id }                 — a decision step began
 *   think_delta { id, text }           — Think mode: real reasoning-summary text, streamed
 *   think_end   { id, ms, text, source } — step done; text = the reasoning
 *                                        summary (source "reasoning") or, when
 *                                        none streamed, harness narration
 *   tool_start  { id, category, headline, description, raw? }
 *   tool_end    { id, ok, result, ms, items?, change?, raw? }
 *                                        items = short labels of what was found;
 *                                        change = { label, title, fields } for a
 *                                        successful action; raw = developer mode
 *                                        only ({ name, args } / { output }), live only
 *   activity    { id, text }           — text the model wrote between steps (whole)
 *   activity_start / activity_delta { id, text } / activity_end { id, text }
 *                                      — the same, streamed word by word
 *   activity_promote { id }            — that streamed text was the answer:
 *                                        it moves to the reply (not stored here)
 *   activity_drop { id }               — discard streamed text (a failed call)
 */
export function createChatTrace({ send = null, now = () => Date.now(), developer = false } = {}) {
  const blocks = [];
  const open = new Map();
  const reasoning = new Map();   // think id → streamed reasoning-summary text
  const streaming = new Map();   // activity id → words streamed so far
  let seq = 0;
  const nextId = (prefix) => `${prefix}_${++seq}`;
  const emit = (event, data) => { try { send?.(event, data); } catch { /* a trace line must never break the turn */ } };
  const keep = (block) => { if (blocks.length < TRACE_LIMITS.MAX_BLOCKS) blocks.push(block); };

  return {
    thinkStart() {
      const id = nextId("think");
      open.set(id, now());
      emit("think_start", { id });
      return id;
    },
    /** Real reasoning-summary text for a running think row (Think mode). */
    thinkDelta(id, text) {
      if (!id || !text || !open.has(id)) return;
      reasoning.set(id, (reasoning.get(id) || "") + text);
      emit("think_delta", { id, text });
    },
    /** A reasoning summary, when one streamed, wins over the fallback text. */
    thinkEnd(id, text = "") {
      const started = open.get(id) ?? now();
      open.delete(id);
      const summary = (reasoning.get(id) || "").trim();
      reasoning.delete(id);
      const block = {
        type: "thinking", id, ms: Math.max(0, now() - started),
        text: summary ? clipParagraphs(summary, TRACE_LIMITS.MAX_TEXT_CHARS) : clip(text, TRACE_LIMITS.MAX_TEXT_CHARS),
        ...(summary ? { source: "reasoning" } : {}),
      };
      keep(block);
      emit("think_end", block);
      return block;
    },
    toolStart(tool, input = {}) {
      const id = nextId("tool");
      const display = chatToolDisplay(tool);
      open.set(id, now());
      emit("tool_start", { id, ...display, ...(developer ? { raw: { name: String(tool || ""), args: rawJson(input) } } : {}) });
      return { id, display, tool, input };
    },
    toolEnd({ id, display, tool, input }, toolResult) {
      const started = open.get(id) ?? now();
      open.delete(id);
      const { ok, result } = chatToolResultLine(toolResult);
      const change = ok ? chatToolChange(tool, toolResult, input) : null;
      const items = ok && !change ? chatToolFoundItems(toolResult) : [];
      const block = {
        type: "tool", id, ...display, ok, result: clip(result, MAX_RESULT_CHARS), ms: Math.max(0, now() - started),
        ...(items.length ? { items } : {}),
        ...(change ? { change } : {}),
      };
      keep(block);
      emit("tool_end", {
        id, ok: block.ok, result: block.result, ms: block.ms,
        ...(items.length ? { items } : {}),
        ...(change ? { change } : {}),
        ...(developer ? { raw: { output: rawJson(toolResult) } } : {}),
      });
      return block;
    },
    activity(text) {
      const value = clipParagraphs(text, TRACE_LIMITS.MAX_TEXT_CHARS);
      if (!value) return null;
      const block = { type: "activity", id: nextId("act"), text: value };
      keep(block);
      emit("activity", block);
      return block;
    },
    /** Streamed activity: the words appear as the model writes them. */
    activityStart() {
      const id = nextId("act");
      streaming.set(id, "");
      emit("activity_start", { id });
      return id;
    },
    activityDelta(id, text) {
      if (!streaming.has(id) || !text) return;
      streaming.set(id, streaming.get(id) + text);
      emit("activity_delta", { id, text });
    },
    activityEnd(id, text) {
      if (!streaming.has(id)) return null;
      const value = clipParagraphs(text ?? streaming.get(id), TRACE_LIMITS.MAX_TEXT_CHARS);
      streaming.delete(id);
      const block = { type: "activity", id, text: value };
      if (value) keep(block);
      emit("activity_end", block);
      return block;
    },
    /** The streamed words were the answer — the reply carries them, not the trace. */
    activityPromote(id) {
      if (!streaming.delete(id)) return;
      emit("activity_promote", { id });
    },
    activityDrop(id) {
      if (!streaming.delete(id)) return;
      emit("activity_drop", { id });
    },
    /** The stored trace — the final reply itself is the message text, not a block. */
    blocks() { return blocks.slice(); },
  };
}
