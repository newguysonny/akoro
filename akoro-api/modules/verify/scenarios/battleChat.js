/**
 * Battles made from chat, every type and format (reference/Akoro Battles —
 * Model.md): real live turns as test learners and a test instructor, then the
 * rows the turn made are checked and removed.
 *
 *   battles.chat_network     learner → agent network: 1v1 now, group at a time,
 *                            team 2v2, and a teacher can't be battled
 *   battles.chat_posts       open lobby post, recurring invite, recurring post
 *   battles.chat_class       learner → classmates: class duel, class group at a
 *                            time, recurring class battle; a guide review; the daily
 *   battles.chat_instructor  instructor → battle drafts: class battle, study
 *                            review, scheduled, recurring (completed into a
 *                            series, the draft recording it)
 *
 * Each case is one prompt. A case passes when the agent called the right tool
 * with the right shape, it succeeded, and what it made has that shape. A
 * refusal for lack of coins or questions is BLOCKED with the reason.
 */
import { battleClass, BATTLE_INSTRUCTOR } from "./instructorActivities.js";
import { teacherOf, cleanSlate, lastCall, toolsOf, draftRow } from "./instructorTools.js";

const NETWORK_POOL = Array.from({ length: 26 }, (_, i) => `tester${String(i + 20).padStart(2, "0")}`);
const lagosHour = (iso) => Number(new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", hour12: false }));
const lagosDay = (iso) => new Date(new Date(iso).toLocaleString("en-US", { timeZone: "Africa/Lagos" })).getDay();

/** Test learners with an agent, from the network pool. */
async function networkTesters(ctx, n) {
  const users = await ctx.db.rows("users", { username: { in: NETWORK_POOL } }, { columns: "id, username, role" });
  const agents = await ctx.db.rows("user_agents", { user_id: { in: users.map((u) => u.id) } }, { columns: "user_id" });
  const has = new Set(agents.map((a) => a.user_id));
  const ok = users.filter((u) => (u.role || "student") === "student" && has.has(u.id)).sort((a, b) => a.username.localeCompare(b.username));
  if (ok.length < n) ctx.expect.blocked(`only ${ok.length} test learners (tester20–45) have an agent; this needs ${n}`);
  return ok.slice(0, n);
}

/** Whatever a chat turn made: battles, series, posts, drafts → removed after the run. */
function tracker(ctx) {
  const made = { battles: new Set(), series: new Set(), requests: new Set(), users: new Set() };
  ctx.cleanup(async () => {
    const db = (await import("../../../db.js")).default;
    const series = [...made.series];
    if (series.length) {
      const { data } = await db.from("battles").select("id").in("series_id", series);
      for (const b of data || []) made.battles.add(b.id);
      await db.schema("edu").from("challenge_requests").delete().in("series_id", series);
      for (const id of series) await db.schema("edu").from("deferred_jobs").delete().like("job_key", `series-${id}-%`);
    }
    const battles = [...made.battles];
    if (battles.length) {
      await db.from("notifications").delete().in("related_id", battles);
      await db.from("battles").delete().in("id", battles);
    }
    if (series.length) {
      await db.from("notifications").delete().in("related_id", series);
      await db.from("battle_series").delete().in("id", series);
    }
    if (made.requests.size) await db.schema("edu").from("challenge_requests").delete().in("id", [...made.requests]);
  });
  return made;
}

/** One live learner turn: the tool, its success (or BLOCKED for coins / questions), and what it returned. */
async function learnerCase(ctx, made, { as, label, prompt, tool, args = {} }) {
  const turn = await ctx.agent.chat({ as: `@${as}`, mode: "live", prompt });
  ctx.expect.eq(`${label}: turn answered`, turn.status, 200);
  const call = lastCall(turn, tool);
  for (const t of turn.tools || []) {
    const r = t.result || {};
    if (r.battleId) made.battles.add(r.battleId);
    if (r.seriesId) made.series.add(r.seriesId);
    if (r.requestId) made.requests.add(r.requestId);
  }
  ctx.expect.ok(`${label}: called ${tool}`, !!call, toolsOf(turn));
  if (!call) return null;
  const err = call.result?.error;
  if (err && /coins|top up|enough .*questions|daily limit/i.test(err)) ctx.expect.blocked(`${label}: ${err}`);
  ctx.expect.ok(`${label}: ${tool} succeeded`, call.success !== false && !err, call.result);
  for (const [k, want] of Object.entries(args)) {
    const got = call.input?.[k];
    const pass = typeof want === "function" ? want(got, call.input) : got === want;
    ctx.expect.ok(`${label}: ${tool}.${k}`, !!pass, { got });
  }
  return call;
}

const seatsOf = (ctx, battleId) => ctx.db.rows("battle_participants", { battle_id: battleId }, { columns: "user_id, role, team, joined_at" });
const battleOf = async (ctx, id) => (await ctx.db.rows("battles", { id }, { columns: "id, battle_type, status, scheduled_start, classroom_id, course_id, series_id, review_host, title" }))[0] || null;
const seriesOf = async (ctx, id) => (await ctx.db.rows("battle_series", { id }, { columns: "id, scope, days, at_time, until, template, status" }))[0] || null;

const days = (want) => (got) => Array.isArray(got) && want.every((d) => got.map(Number).includes(d));

export const battleChatNetwork = {
  name: "battles.chat_network", area: "battles", risk: "write", regression: false, timeoutMs: 600_000,
  description: "From learner chat: a 1v1 now, a group battle at a set time, a 2v2 team battle; asking to battle a teacher makes no battle.",
  async run(ctx) {
    const made = tracker(ctx);
    const [a, b, c, d, e, f, g, h] = await networkTesters(ctx, 8);

    // 1v1, now.
    const duel = await learnerCase(ctx, made, { as: a.username, label: "1v1 now", tool: "challenge_agent",
      prompt: `Challenge @${b.username} to a 1v1 Mathematics battle on fractions right now, 10 questions.`,
      args: { kind: (k) => !k || k === "1v1", scheduled_for: (v) => !v } });
    if (duel?.result?.battleId) {
      const row = await battleOf(ctx, duel.result.battleId);
      const seats = await seatsOf(ctx, row.id);
      ctx.expect.eq("1v1 now: a duel, waiting for its accept", [row.battle_type, row.status, row.scheduled_start], ["1v1", "lobby", null]);
      ctx.expect.eq("1v1 now: two seats", seats.map((s) => s.role).sort(), ["creator", "opponent"]);
    }

    // Group, at a set time.
    const group = await learnerCase(ctx, made, { as: c.username, label: "group scheduled", tool: "challenge_agent",
      prompt: `Invite @${d.username}, @${e.username} and @${b.username} to a group Mathematics battle tomorrow at 6pm.`,
      args: { kind: "group", scheduled_for: (v) => !!v && lagosHour(v) === 18 } });
    if (group?.result?.battleId) {
      const row = await battleOf(ctx, group.result.battleId);
      ctx.expect.eq("group scheduled: a group battle, scheduled", [row.battle_type, row.status], ["classroom", "scheduled"]);
      ctx.expect.eq("group scheduled: at 6pm Lagos", lagosHour(row.scheduled_start), 18);
      ctx.expect.eq("group scheduled: four seats", (await seatsOf(ctx, row.id)).length, 4);
    }

    // Team 2v2.
    const team = await learnerCase(ctx, made, { as: f.username, label: "team 2v2", tool: "challenge_agent",
      prompt: `Set up a 2v2 team battle in Mathematics: me and @${g.username} against @${h.username} and @${a.username}.`,
      args: { kind: "team", teammate: (v) => String(v || "").replace(/^@/, "").toLowerCase() === g.username || v === g.id } });
    if (team?.result?.battleId) {
      const seats = await seatsOf(ctx, team.result.battleId);
      const side = (u) => seats.find((s) => s.user_id === u.id)?.team;
      ctx.expect.eq("team 2v2: a team battle", (await battleOf(ctx, team.result.battleId)).battle_type, "team");
      ctx.expect.eq("team 2v2: me and my teammate on A, the others on B", [side(f), side(g), side(h), side(a)], ["A", "A", "B", "B"]);
    }

    // A teacher is never battled.
    const teacher = await teacherOf(ctx, BATTLE_INSTRUCTOR);
    const before = await ctx.db.rows("battles", { created_by: e.id }, { columns: "id", limit: 500 });
    const turn = await ctx.agent.chat({ as: `@${e.username}`, mode: "live", prompt: `Challenge my teacher @${teacher.username} to a 1v1 Mathematics battle.` });
    for (const t of turn.tools || []) if (t.result?.battleId) made.battles.add(t.result.battleId);
    const after = await ctx.db.rows("battles", { created_by: e.id }, { columns: "id", limit: 500 });
    ctx.expect.eq("a teacher: no battle was made", after.length, before.length);
    ctx.expect.ok("a teacher: the agent says so (and may offer a review)", /teacher|can't|cannot|isn't available|review/i.test(String(turn.reply || "")), String(turn.reply || "").slice(0, 240));
  },
};

export const battleChatPosts = {
  name: "battles.chat_posts", area: "battles", risk: "write", regression: false, timeoutMs: 600_000,
  description: "From learner chat: an open lobby post at a time, a recurring invite (twice a week until a date), a recurring open post.",
  async run(ctx) {
    const probe = await ctx.db.probe("battle_series", "id");
    if (!probe.ok) ctx.expect.blocked(`no battle_series yet: ${probe.error}`);
    const made = tracker(ctx);
    const [a, b, c] = await networkTesters(ctx, 12).then((l) => l.slice(9, 12));

    // Open lobby post.
    const post = await learnerCase(ctx, made, { as: a.username, label: "open post", tool: "post_challenge_request",
      prompt: "Post an open Physics group challenge anyone can join, up to 6 players, tomorrow at 9pm.",
      args: { kind: "group", max_players: 6, scheduled_for: (v) => !!v && lagosHour(v) === 21 } });
    if (post?.result?.requestId) {
      const [r] = await ctx.db.rows("edu.challenge_requests", { id: post.result.requestId }, { columns: "battle_type, max_players, status, scheduled_for" });
      ctx.expect.eq("open post: an open lobby for six, waiting for takers", [r?.battle_type, r?.max_players, r?.status], ["open", 6, "open"]);
    }

    // Recurring invite.
    const inv = await learnerCase(ctx, made, { as: b.username, label: "recurring invite", tool: "challenge_agent",
      prompt: `Battle @${c.username} 1v1 in Mathematics every Monday and Thursday at 5pm until the end of next month.`,
      args: { repeat: (r) => !!r && days([1, 4])(r.days) && /^17:00/.test(r.time || "") && !!r.until } });
    if (inv?.result?.seriesId) {
      const s = await seriesOf(ctx, inv.result.seriesId);
      ctx.expect.eq("recurring invite: a network series, Mon + Thu at 17:00", [s?.scope, [...(s?.days || [])].sort().join(","), s?.at_time], ["network", "1,4", "17:00"]);
      ctx.expect.eq("recurring invite: a 1v1, not a post", [s?.template?.kind, s?.template?.post], ["1v1", false]);
      const members = await ctx.db.rows("battle_series_members", { series_id: s.id }, { columns: "user_id" });
      ctx.expect.eq("recurring invite: the opponent is in it", members.map((m) => m.user_id), [c.id]);
      const card = ((await ctx.http({ as: `@${c.username}`, path: "/api/battle/my-challenges" })).body?.data || []).find((x) => x.seriesId === s.id);
      ctx.expect.eq("recurring invite: on the opponent's Challenges tab, auto-joined", [card?.autoJoined, card?.type, card?.scope], [true, "1v1", "network"]);
    }

    // Recurring open post.
    const rp = await learnerCase(ctx, made, { as: c.username, label: "recurring post", tool: "post_challenge_request",
      prompt: "Post a 1v1 Chemistry challenge for anyone, every Saturday at 8pm, until December 31.",
      args: { repeat: (r) => !!r && days([6])(r.days) && /^20:00/.test(r.time || "") && /-12-31/.test(r.until || "") } });
    if (rp?.result?.seriesId) {
      const s = await seriesOf(ctx, rp.result.seriesId);
      ctx.expect.eq("recurring post: a network series of posts on Saturdays", [s?.scope, s?.template?.post, (s?.days || []).join(",")], ["network", true, "6"]);
      // The first post goes up 12 hours before its start: make it now, in-process, and see it posted.
      const { runOccurrence } = await import("../../battle/series.js");
      const [row] = await ctx.db.rows("battle_series", { id: s.id }, { columns: "next_at" });
      const out = await runOccurrence(s.id, new Date(row.next_at).getTime());
      if (out.requestId) made.requests.add(out.requestId);
      if (/coins|open requests/i.test(String(out.skipped || ""))) ctx.note(`the occurrence was skipped: ${out.skipped}`);
      else {
        const [r] = await ctx.db.rows("edu.challenge_requests", { id: out.requestId }, { columns: "series_id, status, scheduled_for, battle_type" });
        ctx.expect.eq("recurring post: the occurrence is an open post at its time", [r?.series_id, r?.status, new Date(r?.scheduled_for).getTime()], [s.id, "open", new Date(row.next_at).getTime()]);
      }
    }
  },
};

export const battleChatClass = {
  name: "battles.chat_class", area: "battles", risk: "write", regression: false, timeoutMs: 600_000,
  description: "From learner chat: a class duel, a class group battle at a set time, a recurring class battle; a review with the guide; joining the daily battle.",
  async run(ctx) {
    const made = tracker(ctx);
    const found = await battleClass(ctx, BATTLE_INSTRUCTOR, 4);
    if (!found) ctx.expect.blocked(`${BATTLE_INSTRUCTOR} has no class with 4 test learners who have an agent`);
    const { classroom, learners } = found;
    const [a, b, c, d] = learners;
    const cls = classroom.name;

    const duel = await learnerCase(ctx, made, { as: a.username, label: "class duel", tool: "class_battle",
      prompt: `Battle my classmate @${b.username} in my ${cls} class on fractions in Mathematics, now.`,
      args: { opponents: (o) => Array.isArray(o) && o.length === 1 } });
    if (duel?.result?.battleId) {
      const row = await battleOf(ctx, duel.result.battleId);
      ctx.expect.eq("class duel: a 1v1 in that class", [row.battle_type, row.classroom_id], ["1v1", classroom.id]);
    }

    const group = await learnerCase(ctx, made, { as: c.username, label: "class group scheduled", tool: "class_battle",
      prompt: `Set a Mathematics battle on fractions for me, @${a.username} and @${d.username} in ${cls}, tomorrow at 4pm.`,
      args: { opponents: (o) => Array.isArray(o) && o.length === 2, scheduled_for: (v) => !!v && lagosHour(v) === 16 } });
    if (group?.result?.battleId) {
      const row = await battleOf(ctx, group.result.battleId);
      ctx.expect.eq("class group scheduled: a group battle in the class, scheduled", [row.battle_type, row.classroom_id, row.status], ["classroom", classroom.id, "scheduled"]);
    }

    const rec = await learnerCase(ctx, made, { as: d.username, label: "recurring class battle", tool: "class_battle",
      prompt: `Battle @${b.username} in ${cls} on Mathematics every Friday at 3pm until December 18.`,
      args: { repeat: (r) => !!r && days([5])(r.days) && /^15:00/.test(r.time || "") } });
    if (rec?.result?.seriesId) {
      const s = await seriesOf(ctx, rec.result.seriesId);
      ctx.expect.eq("recurring class battle: a class series on Fridays at 15:00", [s?.scope, (s?.days || []).join(","), s?.at_time], ["class", "5", "15:00"]);
    }

    // A review with the guide (never a battle against the guide or a teacher).
    const review = await learnerCase(ctx, made, { as: b.username, label: "guide review", tool: "request_guide_review",
      prompt: "Ask my teaching guide to review my agent on photosynthesis in Biology." });
    if (review?.result?.battleId) {
      const row = await battleOf(ctx, review.result.battleId);
      ctx.expect.eq("guide review: a check hosted by the guide", [row.battle_type, row.review_host], ["check", "guide"]);
    }

    // The daily battle: join it, then sit it out again (the gate leaves no seat behind).
    const daily = await learnerCase(ctx, made, { as: c.username, label: "daily join", tool: "daily_challenge",
      prompt: "Join the next daily battle for me, in Mathematics.", args: { action: "join" } });
    if (daily) await ctx.agent.tool({ as: `@${c.username}`, tool: "daily_challenge", mode: "live", input: { action: "skip" } });
  },
};

export const battleChatInstructor = {
  name: "battles.chat_instructor", area: "battles", risk: "write", regression: false, timeoutMs: 600_000,
  description: "From the instructor's chat: battle drafts for a class battle, a study review, a scheduled battle and a recurring one; the recurring draft completes into a series the draft records.",
  async run(ctx) {
    const teacher = await teacherOf(ctx, BATTLE_INSTRUCTOR);
    await cleanSlate(ctx, teacher);
    const made = tracker(ctx);
    const found = await battleClass(ctx, BATTLE_INSTRUCTOR, 2);
    if (!found) ctx.expect.blocked(`${BATTLE_INSTRUCTOR} has no class with 2 test learners who have an agent`);
    const { classroom, learners } = found;
    const [a, b] = learners;
    const cls = classroom.name;
    ctx.cleanup(() => ctx.db.deleteOwned("activity_drafts", { ownerColumn: "created_by", ownerId: teacher.id, filters: { status: "draft" } }));

    const draftCase = async ({ label, prompt, want }) => {
      const turn = await ctx.agent.chat({ as: BATTLE_INSTRUCTOR, mode: "live", prompt });
      ctx.expect.eq(`${label}: turn answered`, turn.status, 200);
      const call = lastCall(turn, "prepare_activity");
      ctx.expect.ok(`${label}: called prepare_activity`, !!call, toolsOf(turn));
      ctx.expect.eq(`${label}: a battle draft`, call?.input?.type, "battle");
      const id = call?.result?.draftId;
      ctx.expect.ok(`${label}: a draft was prepared`, !!id, call?.result);
      if (!id) return null;
      const draft = await draftRow(ctx, BATTLE_INSTRUCTOR, id);
      for (const [k, test] of Object.entries(want)) ctx.expect.ok(`${label}: ${k}`, !!test(draft?.payload?.details || {}, draft), draft?.payload?.details);
      return draft;
    };

    await draftCase({ label: "class battle", prompt: `Set a Mathematics battle on fractions for the whole of ${cls}.`,
      want: { "a battle, not a review": (d) => d.mode === "battle" } });
    await draftCase({ label: "study review", prompt: `Set a study review on fractions in Mathematics for @${a.username} in ${cls}.`,
      want: { "a study review": (d) => d.mode === "review" } });
    await draftCase({ label: "scheduled battle", prompt: `Set a Mathematics battle on decimals for @${a.username} and @${b.username} in ${cls}, next Friday at 10am.`,
      want: { "starts Friday at 10am": (d) => !!d.scheduled_at && lagosHour(d.scheduled_at) === 10 && lagosDay(d.scheduled_at) === 5 } });
    const rec = await draftCase({ label: "recurring battle", prompt: `Set a Mathematics battle on fractions for @${a.username} and @${b.username} in ${cls}, every Tuesday and Thursday at 2pm until December 18.`,
      want: { "repeats Tue + Thu at 14:00 until 18 Dec": (d) => !!d.repeat && days([2, 4])(d.repeat.days) && d.repeat.time === "14:00" && /-12-1[78]/.test(d.repeat.until || "") } });
    if (!rec) return;

    // Completed the way the preview's form completes it: the series is made, the draft records it.
    const r = rec.payload.details.repeat;
    const res = await ctx.http({ as: BATTLE_INSTRUCTOR, method: "POST", path: `/api/battle/classes/${classroom.id}/battles/invite`, body: {
      title: rec.title, subject: "Mathematics", topic: "Fractions", total_questions: 5, question_source: "bank",
      usernames: [a.username, b.username],
      repeat: { days: r.days, time: r.time, tz: "Africa/Lagos", until: r.until },
    } });
    ctx.expect.status("the form makes the series", res, 201);
    const seriesId = res.body?.data?.series_id;
    if (seriesId) made.series.add(seriesId);
    const patched = await ctx.http({ as: BATTLE_INSTRUCTOR, method: "PATCH", path: `/api/self-study/drafts/${rec.id}`, body: { status: "assigned", assignment_id: null, series_id: seriesId } });
    ctx.expect.status("the draft closes", patched, 200);
    ctx.cleanup(() => ctx.db.deleteOwned("activity_drafts", { ownerColumn: "created_by", ownerId: teacher.id, filters: { id: rec.id } }));
    const [row] = await ctx.db.rows("activity_drafts", { id: rec.id }, { columns: "status, series_id" });
    ctx.expect.eq("the draft records the series it became", [row?.status, row?.series_id], ["assigned", seriesId]);
  },
};

export const battleChatScenarios = [battleChatNetwork, battleChatPosts, battleChatClass, battleChatInstructor];
