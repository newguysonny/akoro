/**
 * Phase 21 part 2 — agents START conversations on their own (agent-network/outreach.js).
 * Learner A = @tester01 (the agent reaching out), B = @tester02 (the helper).
 * Every scenario puts the run marker in the topic, so the messages, cards and
 * chat lines it makes are found and removed afterwards.
 *
 *   outreach.struggle_consult      a struggle on a concept → asks a friend who mastered it, no card
 *   outreach.topic_start_friend    a Study Prep topic starting → asks a friend; no friend → nothing (no stranger card)
 *   outreach.stranger_card         a stranger → an Allow / Reject / Later card; nothing sent until Allow
 *   outreach.friend_request_card   a friend request → a card; Reject sends nothing
 *   outreach.share_data_card       sharing notes → a card, even with a friend
 *   outreach.battle_invite_card    a battle invite → a card, even with a friend
 *   outreach.offline_then_answers  B's agent Offline: the question waits; Online: answered, A is told
 *   outreach.daily_cap             3 a day; the 4th is skipped
 *   outreach.blocked_skipped       a blocked pair is never contacted
 *   outreach.younger_asks_first    a primary / JSS learner's agent asks first, even for a friend
 *   outreach.round_trip            A asks, B's agent answers on its own; A and B are both told
 *   outreach.private_content       the message carries none of A's personal details
 */
import db from "../../../db.js";
import { BlockedError } from "../assertions.js";

const A = "@tester01", B = "@tester02";
const edu = () => db.schema("edu");

async function setup(ctx, { friends = false, optedIn = true, level = "SS 2" } = {}) {
  const a = await ctx.as(A), b = await ctx.as(B);
  await setLevel(ctx, a.id, level);
  const o = await import("../../agent-network/index.js");
  ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_messages", { ownerColumn: "from_user", ownerId: a.id, filters: { topic: { like: `${ctx.marker}%` } } }));
  ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_proposals", { ownerColumn: "user_id", ownerId: a.id, filters: { kind: "agent_outreach", rationale: { like: `%${ctx.marker}%` } } }));
  ctx.cleanup(() => ctx.db.deleteOwned("chat_messages", { ownerColumn: "user_id", ownerId: a.id, filters: { text: { like: `%${ctx.marker}%` } } }));
  ctx.cleanup(() => ctx.db.deleteOwned("chat_messages", { ownerColumn: "user_id", ownerId: b.id, filters: { text: { like: `%${ctx.marker}%` } } }));
  await setFriends(ctx, a.id, b.id, friends);
  await setOptIn(ctx, b.id, optedIn);
  const topic = (t) => `${ctx.marker} ${t}`;
  return { a, b, o, topic };
}

/** A's school level for this run (a primary / JSS learner's agent always asks first), restored after. */
async function setLevel(ctx, userId, level) {
  const { data: was } = await db.from("users").select("study_level, year_group").eq("id", userId).maybeSingle();
  ctx.cleanup(() => db.from("users").update({ study_level: was?.study_level ?? null, year_group: was?.year_group ?? null }).eq("id", userId));
  await db.from("users").update({ study_level: level, year_group: null }).eq("id", userId);
}

async function setFriends(ctx, x, y, on) {
  const [ua, ub] = [x, y].sort();
  const { data: was } = await edu().from("agent_friends").select("*").eq("user_a", ua).eq("user_b", ub).maybeSingle();
  ctx.cleanup(async () => {
    if (was) await edu().from("agent_friends").upsert(was, { onConflict: "user_a,user_b" });
    else await edu().from("agent_friends").delete().eq("user_a", ua).eq("user_b", ub);
  });
  if (on) await edu().from("agent_friends").upsert({ user_a: ua, user_b: ub, requested_by: x, status: "accepted", decided_at: new Date().toISOString() }, { onConflict: "user_a,user_b" });
  else await edu().from("agent_friends").delete().eq("user_a", ua).eq("user_b", ub);
}

async function setOptIn(ctx, userId, on) {
  const { data: was } = await db.from("user_agents").select("help_others_opt_in, help_others_chosen_at").eq("user_id", userId).maybeSingle();
  if (!was) return;
  ctx.cleanup(() => db.from("user_agents").update(was).eq("user_id", userId));
  await db.from("user_agents").update({ help_others_opt_in: on, help_others_chosen_at: new Date().toISOString() }).eq("user_id", userId);
}

async function setAutonomy(ctx, as, enabled) {
  const before = await ctx.http({ as, path: "/api/adaptive/chat/autonomy" });
  const was = { enabled: !!before.body?.enabled, level: before.body?.level ?? 1 };
  ctx.cleanup(() => ctx.http({ as, method: "PATCH", path: "/api/adaptive/chat/autonomy", body: was }));
  await ctx.http({ as, method: "PATCH", path: "/api/adaptive/chat/autonomy", body: { enabled, level: was.level } });
}

/** A concept B got past (a resolved, non-sensitive struggle seeded for this run, removed after). */
async function masteredByB(ctx, b, a) {
  const { data: cs } = await edu().from("concept_catalog").select("id, title").eq("status", "approved").limit(40);
  const { struggleType } = await import("../../../lib/struggleTypes.js");
  const def = struggleType("misconception");
  const c = (cs || [])[0];
  if (!c || !def) return null;
  const { data: row, error } = await edu().from("learning_struggles").insert({
    learner_id: b.id, category: def.category, struggle_type: def.id, detected_by: "rule", status: "resolved", concept_id: c.id,
    sensitive: false, shareable: false, resolved_at: new Date().toISOString(), what_worked: `${ctx.marker} drew it out step by step`,
  }).select("id").single();
  if (error) { ctx.note(`struggle seed failed: ${error.message}`); return null; }
  ctx.cleanup(() => edu().from("learning_struggles").delete().eq("id", row.id).eq("learner_id", b.id));
  void a;
  return c;
}

const sentRows = (ctx, a, topic) => ctx.db.rows("edu.agent_messages", { from_user: a.id, topic }, { columns: "id, to_user, kind, body, origin, trigger, purpose, status, answer" });
const cardOf = async (ctx, id) => (id ? (await ctx.db.rows("edu.agent_proposals", { id }, { columns: "kind, status, title, payload, chat_message_id" }))[0] : null);
const chatLine = async (ctx, userId, like) => (await ctx.db.rows("chat_messages", { user_id: userId, text: { like } }, { columns: "id, text, meta", order: { column: "created_at" }, limit: 5 }))[0] || null;

async function expectCard(ctx, { a, o, topic, purpose, friends }) {
  const r = await o.reachOut({ learnerId: a.id, trigger: "manual", purpose, topic, target: B, force: true });
  ctx.note(`reachOut(${purpose}${friends ? ", friend" : ""}): ${JSON.stringify(r).slice(0, 240)}`);
  ctx.expect.eq(`${purpose}: the agent asks its learner first`, r.action, "ask_learner");
  const card = await cardOf(ctx, r.proposalId);
  ctx.expect.eq("an agent_outreach card", card?.kind, "agent_outreach");
  const [line] = card?.chat_message_id ? await ctx.db.rows("chat_messages", { id: card.chat_message_id }, { columns: "user_id, text, meta" }) : [];
  ctx.expect.ok("posted in the learner's chat as an approval card", line?.user_id === a.id && line?.meta?.proposal?.id === r.proposalId, line?.meta);
  ctx.expect.eq("nothing sent before the learner decides", (await sentRows(ctx, a, topic)).length, 0);
  return r;
}

export const struggleConsult = {
  name: "outreach.struggle_consult", area: "agent-network", risk: "write",
  description: "A struggle on a concept: the agent asks a FRIEND's agent whose learner mastered it — on its own, no card — and tells its learner.",
  async run(ctx) {
    const { a, b, o, topic } = await setup(ctx, { friends: true });
    const c = await masteredByB(ctx, b, a);
    if (!c) throw new BlockedError("No approved concept free to seed mastery on.");
    const t = topic(c.title);
    const r = await o.reachOut({ learnerId: a.id, trigger: "struggle", conceptId: c.id, topic: t, gaps: ["the first step"], force: true });
    ctx.note(`reachOut: ${JSON.stringify(r).slice(0, 300)}`);
    ctx.expect.eq("sent on its own (a friend)", r.action, "send");
    ctx.expect.eq("…to the friend who mastered it", r.helper?.userId, b.id);
    const [m] = await sentRows(ctx, a, t);
    ctx.expect.ok("recorded as the agent's own outreach, for the struggle", m?.origin === "agent" && m?.trigger === "struggle" && m?.purpose === "study_question" && m?.kind === "consult", m);
    const line = await chatLine(ctx, a.id, `%${ctx.marker}%`);
    ctx.note(`A's chat: ${line?.text?.slice(0, 200)}`);
    ctx.expect.ok("the learner is told what the agent did", /asked .+'s agent/.test(line?.text || ""), line?.text);
  },
};

export const topicStartFriend = {
  name: "outreach.topic_start_friend", area: "agent-network", risk: "write",
  description: "A Study Prep topic starting: the agent asks a friend who mastered it; with no such friend it does nothing (no stranger card).",
  async run(ctx) {
    const { a, b, o, topic } = await setup(ctx, { friends: true });
    const c = await masteredByB(ctx, b, a);
    if (!c) throw new BlockedError("No approved concept free to seed mastery on.");
    const t = topic(c.title);
    const { outreachOnTopicStart } = await import("../../adaptive-learning/study-prep/wiring.js");
    // force: past Offline / quiet hours (the run may fall in the tester's night), never the permission rules.
    const fired = await outreachOnTopicStart({ learnerId: a.id, topic: t, conceptId: c.id, force: true });
    ctx.note(`topic start: ${JSON.stringify(fired)?.slice(0, 240)}`);
    const m = await ctx.until(async () => (await sentRows(ctx, a, t))[0], { timeoutMs: 30_000, everyMs: 2000 }).catch(() => null);
    ctx.note(`message: ${JSON.stringify(m)?.slice(0, 240)}`);
    ctx.expect.ok("the topic start reached the friend's agent", m?.to_user === b.id && m?.trigger === "topic_start" && m?.origin === "agent", m);

    await setFriends(ctx, a.id, b.id, false);
    const t2 = topic(`${c.title} again`);
    const r = await o.reachOut({ learnerId: a.id, trigger: "topic_start", conceptId: c.id, topic: t2, friendsOnly: true, force: true });
    ctx.note(`no friend: ${JSON.stringify(r).slice(0, 200)}`);
    ctx.expect.ok("no friend knows it: nothing sent and no card", r.action === "skip" && !r.proposalId, r);
    ctx.expect.eq("…nothing in the outbox", (await sentRows(ctx, a, t2)).length, 0);
  },
};

export const strangerCard = {
  name: "outreach.stranger_card", area: "agent-network", risk: "write",
  description: "A learner who is not a friend and didn't opt in: an Allow / Reject / Later card; nothing goes until Allow, then the message is sent.",
  async run(ctx) {
    const { a, o, topic } = await setup(ctx, { friends: false, optedIn: false });
    const t = topic("Osmosis");
    const r = await expectCard(ctx, { a, o, topic: t, purpose: "study_question" });
    ctx.expect.eq("…because they're a stranger", r.reason, "stranger");
    const { approveProposal } = await import("../../agent-proposals/inbox.js");
    const ok = await approveProposal(a.id, r.proposalId);
    ctx.note(`Allow: ${JSON.stringify(ok).slice(0, 240)}`);
    const [m] = await sentRows(ctx, a, t);
    ctx.expect.ok("Allow: the agent sends it", m?.origin === "agent" && m?.purpose === "study_question", m);
  },
};

export const friendRequestCard = {
  name: "outreach.friend_request_card", area: "agent-network", risk: "write",
  description: "Asking to be study friends is always the learner's decision: a card; Reject sends nothing.",
  async run(ctx) {
    const { a, o, topic } = await setup(ctx, { friends: false });
    const t = topic("Algebra");
    const r = await expectCard(ctx, { a, o, topic: t, purpose: "friend_request" });
    const { dismissProposal } = await import("../../agent-proposals/inbox.js");
    await dismissProposal(a.id, r.proposalId, "rejected").catch((e) => ctx.note(`dismiss: ${e.message}`));
    const card = await cardOf(ctx, r.proposalId);
    ctx.expect.ok("Reject closes the card", card?.status && card.status !== "proposed", card?.status);
    ctx.expect.eq("…and nothing is sent", (await sentRows(ctx, a, t)).length, 0);
  },
};

export const shareDataCard = {
  name: "outreach.share_data_card", area: "agent-network", risk: "write",
  description: "Sharing the learner's notes or scores always asks first, even with a friend.",
  async run(ctx) {
    const { a, o, topic } = await setup(ctx, { friends: true });
    await expectCard(ctx, { a, o, topic: topic("Photosynthesis"), purpose: "share_data", friends: true });
  },
};

export const battleInviteCard = {
  name: "outreach.battle_invite_card", area: "agent-network", risk: "write",
  description: "Inviting someone to a battle commits the learner's time: it asks first, even with a friend.",
  async run(ctx) {
    const { a, o, topic } = await setup(ctx, { friends: true });
    await expectCard(ctx, { a, o, topic: topic("Quadratics"), purpose: "battle_invite", friends: true });
  },
};

export const offlineThenAnswers = {
  name: "outreach.offline_then_answers", area: "agent-network", risk: "write",
  description: "B's agent is Offline: A's question waits in B's inbox; B's agent comes Online and answers; A is told the answer in chat.",
  async run(ctx) {
    const { a, b, o, topic } = await setup(ctx, { friends: true });
    const { processInbox } = await import("../../agent-network/index.js");
    const { protegeDeps } = await import("../../adaptive-learning/chat.js");
    await setAutonomy(ctx, B, false);
    const t = topic("Electrolysis");
    const r = await o.reachOut({ learnerId: a.id, trigger: "manual", topic: t, target: B, force: true });
    ctx.note(`reachOut: ${JSON.stringify(r).slice(0, 240)}`);
    ctx.expect.eq("sent to the friend", r.action, "send");
    if (r.delivered === "answered_now") {
      ctx.note("B was present in the app, so B's agent answered live — the waiting half can't be shown this run.");
    } else {
      const off = await processInbox(b.id, { deps: protegeDeps });
      ctx.expect.eq("B Offline: it waits", off.waiting, "agent_offline");
      await setAutonomy(ctx, B, true);
      await processInbox(b.id, { deps: protegeDeps });
    }
    const m = await ctx.until(async () => { const [x] = await sentRows(ctx, a, t); return x?.answer ? x : null; }, { timeoutMs: 60_000, everyMs: 2000 }).catch(() => null);
    ctx.expect.ok("B's agent answered", !!m?.answer, m);
    const said = await ctx.until(() => chatLine(ctx, a.id, `%${ctx.marker}%They said%`), { timeoutMs: 30_000, everyMs: 2000 }).catch(() => null);
    ctx.note(`A's chat: ${said?.text?.slice(0, 200)}`);
    ctx.expect.ok("A is told the answer", !!said, said?.text);
  },
};

export const dailyCap = {
  name: "outreach.daily_cap", area: "agent-network", risk: "write",
  description: "An agent starts at most 3 conversations a day on its own; the 4th is skipped.",
  async run(ctx) {
    const { a, b, o, topic } = await setup(ctx, { friends: true });
    const { OUTREACH } = await import("../../agent-network/index.js");
    const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const { count: already } = await edu().from("agent_messages").select("id", { count: "exact", head: true }).eq("from_user", a.id).eq("origin", "agent").gte("created_at", since.toISOString());
    const need = Math.max(0, OUTREACH.PER_DAY - (already ?? 0));
    for (let i = 0; i < need; i++) {
      await edu().from("agent_messages").insert({ from_user: a.id, to_user: b.id, kind: "consult", topic: topic(`cap ${i}`), body: `${ctx.marker} cap filler ${i}`,
        origin: "agent", trigger: "manual", purpose: "study_question", processed_at: new Date().toISOString(), status: "read" });
    }
    const r = await o.reachOut({ learnerId: a.id, trigger: "manual", topic: topic("Vectors"), target: B, force: true });
    ctx.note(`after ${OUTREACH.PER_DAY}: ${JSON.stringify(r).slice(0, 200)}`);
    ctx.expect.eq("the 4th is skipped", r.reason, "daily_cap");
    ctx.expect.eq("…nothing sent", (await sentRows(ctx, a, topic("Vectors"))).length, 0);
  },
};

export const blockedSkipped = {
  name: "outreach.blocked_skipped", area: "agent-network", risk: "write",
  description: "A blocked pair (the tester04 / tester03 seed) is never contacted — not even with a card.",
  async run(ctx) {
    const blocker = await ctx.as("@tester04"); await ctx.as("@tester03");
    const o = await import("../../agent-network/index.js");
    const t = `${ctx.marker} Trigonometry`;
    ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_messages", { ownerColumn: "from_user", ownerId: blocker.id, filters: { topic: { like: `${ctx.marker}%` } } }));
    const r = await o.reachOut({ learnerId: blocker.id, trigger: "manual", topic: t, target: "@tester03", force: true });
    ctx.note(`reachOut: ${JSON.stringify(r).slice(0, 200)}`);
    ctx.expect.eq("skipped: blocked", r.reason, "blocked");
    ctx.expect.ok("no card", !r.proposalId);
  },
};

export const youngerAsksFirst = {
  name: "outreach.younger_asks_first", area: "agent-network", risk: "write",
  description: "A primary / JSS learner's agent asks its learner first, even to ask a friend a study question.",
  async run(ctx) {
    const { a, o, topic } = await setup(ctx, { friends: true, level: "JSS 2" });
    const r = await expectCard(ctx, { a, o, topic: topic("Fractions"), purpose: "study_question", friends: true });
    ctx.expect.eq("…because the learner is younger", r.reason, "younger_learner");
  },
};

export const roundTrip = {
  name: "outreach.round_trip", area: "agent-network", risk: "write",
  description: "A's agent asks, B's agent answers on its own, the answer comes back: A is told the answer and B is told what its agent said.",
  async run(ctx) {
    const { a, b, o, topic } = await setup(ctx, { friends: true });
    const { processInbox } = await import("../../agent-network/index.js");
    const { protegeDeps } = await import("../../adaptive-learning/chat.js");
    const { getSettings, saveSettings } = await import("../../agent-network/index.js");
    const was = (await getSettings(b.id)).auto_reply || "study";
    ctx.cleanup(() => saveSettings(b.id, { auto_reply: was }));
    await saveSettings(b.id, { auto_reply: "study" });
    const t = topic("Newton's laws");
    const r = await o.reachOut({ learnerId: a.id, trigger: "manual", topic: t, target: B, force: true });
    ctx.expect.eq("A's agent sends it on its own", r.action, "send");
    if (r.delivered !== "answered_now") await processInbox(b.id, { deps: protegeDeps, force: true });
    const m = await ctx.until(async () => { const [x] = await sentRows(ctx, a, t); return x?.answer ? x : null; }, { timeoutMs: 60_000, everyMs: 2000 }).catch(() => null);
    ctx.note(`answer: ${m?.answer?.slice(0, 200)}`);
    ctx.expect.ok("B's agent answered A's agent", !!m?.answer, m);
    const toA = await ctx.until(() => chatLine(ctx, a.id, `%${ctx.marker}%They said%`), { timeoutMs: 30_000, everyMs: 2000 }).catch(() => null);
    ctx.expect.ok("A is told the answer", !!toA, toA?.text);
    if (r.delivered !== "answered_now") {
      const toB = await ctx.until(() => chatLine(ctx, b.id, `%${ctx.marker}%`), { timeoutMs: 30_000, everyMs: 2000 }).catch(() => null);
      ctx.note(`B's chat: ${toB?.text?.slice(0, 200)}`);
      ctx.expect.ok("B is told what its agent answered", !!toB, toB?.text);
    } else ctx.note("answered live on arrival: B is notified (no chat line on that path).");
  },
};

export const privateContent = {
  name: "outreach.private_content", area: "agent-network", risk: "write",
  description: "What the agent sends carries none of its learner's personal details (name, username, email, school).",
  async run(ctx) {
    const { a, o, topic } = await setup(ctx, { friends: true });
    const { data: me } = await db.from("users").select("full_name, username, email, school_name").eq("id", a.id).maybeSingle();
    const t = topic("Cell division");
    const r = await o.reachOut({ learnerId: a.id, trigger: "struggle", topic: t, gaps: ["mitosis vs meiosis"], target: B, force: true });
    const [m] = await sentRows(ctx, a, t);
    ctx.note(`sent: ${m?.body}`);
    ctx.expect.eq("sent", r.action, "send");
    const body = String(m?.body || "").toLowerCase();
    const leaks = [me?.full_name, ...(String(me?.full_name || "").split(/\s+/)), me?.username, me?.email, me?.school_name]
      .filter((x) => x && String(x).length >= 3).filter((x) => body.includes(String(x).toLowerCase()));
    ctx.expect.eq("no personal detail in the message", leaks.length, 0);
  },
};

export const AGENT_OUTREACH = [struggleConsult, topicStartFriend, strangerCard, friendRequestCard, shareDataCard, battleInviteCard,
  offlineThenAnswers, dailyCap, blockedSkipped, youngerAsksFirst, roundTrip, privateContent];
