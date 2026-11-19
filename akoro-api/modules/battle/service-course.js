/**
 * battle/service-course.js — course roster and the course invite: one creation
 * path for "challenge these people", with duels, group battles, recurring
 * series, drafts and the question source all behaving as they always have.
 */
import { addLater } from "../../lib/deferredJobs.js";
import { InsufficientCoins } from "../../lib/coins.js";
import { cleanHpPerMiss } from "./hp.js";
import { entryCheck } from "./entry.js";
import { buildQuestions } from "./questionSource.js";
import { createSeries } from "./series.js";
import { seriesTemplate } from "./seriesCore.js";
import {
  res200, res201, res400, res403, now, resolveAgent, canRunCourseBattles,
  notifyUser, getBattleQueue, queueIdleExpiry, challengeCardFor, draftPreset,
} from "./service-core.js";
import { acceptDeadline, idleDeadline, isFuture, expiryDelay, startDelay, IDLE_HOURS } from "./rules.js";
import { battles, seats, people } from "./store.js";

/**
 * GET /api/battle/courses/:courseId/roster
 * Everyone who could be challenged in this course, for the "who do you want to
 * battle?" picker: username, name, and whether they have an agent yet (no
 * agent = cannot fight, so the UI can grey them out instead of failing later).
 */
export async function courseRoster(req, res) {
  const { eligible } = await canRunCourseBattles(req.user.id, req.user.role, req.params.courseId);
  if (!eligible) return res403(res, "Not enrolled in this course");

  const { data: rows } = await people.enrolledUsers(req.params.courseId);

  const ids = (rows ?? []).map((r) => r.user_id);
  const { data: agents } = await people.agentsForUsers(ids);
  const withAgent = new Set((agents ?? []).map((a) => a.user_id));

  res200(res, (rows ?? [])
    .filter((r) => r.user_id !== req.user.id)
    .map((r) => ({
      id:        r.users.id,
      username:  r.users.username,
      full_name: r.users.full_name,
      avatar:    r.users.avatar_url ?? null,
      emoji:     r.users.avatar_emoji ?? null,
      has_agent: withAgent.has(r.user_id),
    })));
}

/**
 * POST /api/battle/courses/:courseId/battles/invite
 *
 * One creation path for "challenge these people". Targets come from any mix of:
 *   usernames:   ["priya", "amaka@student.akoro.app"]   (username or email)
 *   user_ids:    ["uuid", …]
 *   whole_class: true                                    (every active enrolment)
 *
 * One opponent produces a 1v1 challenge they must accept; two or more produces
 * a classroom-style battle with everyone pre-registered — the same shape the
 * existing /challenge and /classroom routes create, so nothing downstream
 * (worker, results, leaderboard) needs to know this route exists.
 */
export const courseInvite = async (req, res) => {
  const { courseId } = req.params;
  const {
    title, description, topic, subject,
    difficulty = "intermediate", total_questions = 15,
    time_limit_seconds = 900, xp_prize = 200,
    expires_in_minutes = 60, scheduled_for = null,
    usernames = [], user_ids = [], whole_class = false, classroom_id = null,
    question_source = "auto",          // 'bank' | 'ai' | 'auto'
  } = req.body;
  // Reviews are set for one learner in a class (the class invite route). Here
  // it would quietly become an ordinary battle — say so instead.
  if (req.body?.mode === "review") return res400(res, "A study review is set from a class, for one learner.");

  if (!title) return res400(res, "title is required");

  const { eligible, isInstructor } = await canRunCourseBattles(req.user.id, req.user.role, courseId);
  if (!eligible) return res403(res, "Not enrolled in this course");

  const myAgent = await resolveAgent(req.user.id);
  if (!myAgent) return res400(res, "Create your agent first");

  // ── Resolve targets ──────────────────────────────────────────────────────
  const targetIds = new Set((Array.isArray(user_ids) ? user_ids : []).filter(Boolean));
  const notFound  = [];

  const handles = (Array.isArray(usernames) ? usernames : [])
    .map((u) => String(u).trim().replace(/^@/, ""))
    .filter(Boolean);

  for (const handle of handles) {
    const { data: found } = await people.userByHandle(handle, "id, username, email");
    if (found?.length) targetIds.add(found[0].id);
    else notFound.push(handle);
  }

  // "Everyone" means one of two different groups and the caller says which.
  // A class (JSS1) is not the same set as a course enrolment, and a battle
  // still lives in a course — so class members who aren't enrolled fall out at
  // the eligibility step below and come back in `skipped.not_enrolled` rather
  // than being silently dropped.
  if (classroom_id) {
    const { data: rows } = await people.classroomStudentIds(classroom_id);
    for (const r of (rows ?? [])) targetIds.add(r.user_id);
  } else if (whole_class) {
    const { data: rows } = await people.enrolledUserIds(courseId);
    for (const r of (rows ?? [])) targetIds.add(r.user_id);
  }

  targetIds.delete(req.user.id);
  if (notFound.length) return res400(res, `No account found for: ${notFound.join(", ")}`);
  if (!targetIds.size) return res400(res, "Pick at least one learner to challenge");

  // ── Filter to people who can actually fight ──────────────────────────────
  const ids = [...targetIds];
  const [{ data: enrolled }, { data: agents }] = await Promise.all([
    people.enrolledUserIdsWithin(courseId, ids),
    people.agentIdsForUsers(ids),
  ]);
  const enrolledSet = new Set((enrolled ?? []).map((e) => e.user_id));
  const agentByUser = new Map((agents ?? []).map((a) => [a.user_id, a.id]));

  const skipped   = { not_enrolled: [], no_agent: [] };
  const opponents = [];
  for (const id of ids) {
    if (!enrolledSet.has(id))   { skipped.not_enrolled.push(id); continue; }
    if (!agentByUser.has(id))   { skipped.no_agent.push(id);     continue; }
    opponents.push({ user_id: id, agent_id: agentByUser.get(id) });
  }
  if (!opponents.length) {
    const why = skipped.not_enrolled.length && !skipped.no_agent.length
      ? "None of them are enrolled in this course, so they can't take its battle."
      : "None of those learners can battle yet — they must be enrolled in this course and have an agent.";
    return res400(res, why);
  }

  // Ids are useless to the UI; send names so it can say who missed out.
  const skippedIds = [...skipped.not_enrolled, ...skipped.no_agent];
  const { data: skippedUsers } = await people.usersByIds(skippedIds, "id, full_name, username");
  const nameById = new Map((skippedUsers ?? []).map((u) => [u.id, u.full_name || u.username]));
  const named = {
    not_enrolled: skipped.not_enrolled.map((id) => nameById.get(id) ?? id),
    no_agent:     skipped.no_agent.map((id) => nameById.get(id) ?? id),
  };

  // ── Create ───────────────────────────────────────────────────────────────
  // A learner challenging one person is a duel. An instructor is the host, not
  // a competitor, so one opponent leaves nobody to compete against — the same
  // dead end the class route had.
  const isDuel = !isInstructor && opponents.length === 1;
  if (!isDuel && opponents.length < 2) {
    return res400(res, "A battle needs two learners to compete. Pick at least one more, or send it to the whole course.");
  }

  // A RECURRING battle: save the series, not a battle. Its battles are made an
  // hour before each start, through this same route (battle/series.js).
  if (req.body?.repeat && !req.series) {
    try {
      const made = await createSeries({ creatorId: req.user.id, scope: "course", courseId,
        template: seriesTemplate(req.body), repeat: req.body.repeat, memberIds: opponents.map((o) => o.user_id) });
      return res201(res, { success: true, series_id: made.id, next_at: made.nextAt, invited: opponents.length, repeats: made.rule });
    } catch (e) { if (e.status === 400) return res400(res, e.message); throw e; }
  }
  const isScheduled = isFuture(scheduled_for);
  // A deadline only where there is a start time to be a deadline. See
  // acceptDeadline; an unscheduled one stays open BATTLE_IDLE_HOURS.
  const expiresAt   = isScheduled ? acceptDeadline(scheduled_for) : idleDeadline();

  // A scheduled DUEL stays in 'lobby': /challenges/:id/accept only accepts from
  // lobby, and it already schedules the start itself once accepted. Marking it
  // 'scheduled' up front would make the invitation unacceptable.
  // A learner who creates a battle plays in it: they need the coins for their own agent's answers.
  if ((isDuel || !isInstructor)) {
    const creatorEntry = await entryCheck(req.user.id, { battle_type: "battle", total_questions, min_xp: 0 });
    if (!creatorEntry.ok) return res.status(402).json({ code: "ENTRY_REQUIREMENTS", error: creatorEntry.message.replace("to join", "to start it"), requirements: creatorEntry });
  }
  const { data: battle, error } = await battles.insertBattle({
    hp_per_miss: cleanHpPerMiss(req.body?.hp_per_miss),
    min_xp: Math.max(0, Math.round(Number(req.body?.min_xp) || 0)),
    course_id: courseId, battle_type: isDuel ? "1v1" : "classroom",
    title, description: description ?? null,
    topic: topic ?? null, subject: subject ?? null, difficulty,
    total_questions, time_limit_seconds, xp_prize, xp_pool: xp_prize,
    total_participants: opponents.length + 1,
    status: (isScheduled && (!isDuel || req.series)) ? "scheduled" : "lobby",
    scheduled_start: scheduled_for ?? null, expires_at: expiresAt,
    created_by: req.user.id,
    // An occurrence of a recurring series (absent otherwise, so the insert is unchanged).
    series_id: req.series?.id,
  });
  if (error) throw new Error(error.message);
  // Unscheduled invitations don't wait for ever: after BATTLE_IDLE_HOURS it
  // runs with whoever accepted (if enough did) or expires.
  if (!isScheduled) await queueIdleExpiry(battle.id);

  await seats.insertSeat({
    battle_id: battle.id, user_id: req.user.id, agent_id: myAgent.id,
    role: isDuel ? "creator" : (isInstructor ? "teacher" : "creator"), joined_at: now(),
  });

  // As on the class route: every battle is an invitation the learner answers,
  // not a fixture they are entered into without being asked.
  for (const o of opponents) {
    await seats.upsertSeat({
      battle_id: battle.id, user_id: o.user_id, agent_id: o.agent_id,
      role: isDuel ? "opponent" : "participant",
      // In a series everyone is in unless they opted out; no accept per occurrence.
      joined_at: req.series ? now() : null,
    });
  }

  // A course battle prefers its own bank and tops up with AI when that bank is
  // thin — which it usually is for a course nobody has written questions for.
  let fill;
  try {
    fill = await buildQuestions({
      battleId: battle.id, source: question_source, total: total_questions,
      courseId, subject: subject || topic || "General", topic, difficulty, userId: req.user.id,
      durationSeconds: time_limit_seconds,
      preset: await draftPreset(req, subject),
    });
  } catch (e) {
    await battles.deleteBattle(battle.id);
    if (e instanceof InsufficientCoins) {
      return res.status(402).json({ success: false, code: "INSUFFICIENT_COINS",
        error: "Not enough coins to generate questions. Use the question bank instead, or top up.",
        needed: e.needed, balance: e.balance });
    }
    throw e;
  }
  if (fill.placed < 5) {
    await battles.deleteBattle(battle.id);
    return res400(res, question_source === "bank"
      ? `Only ${fill.placed} questions in this course's bank. Switch Questions to "Generate with AI" to fill the rest.`
      : `Could not put together enough questions (got ${fill.placed}). Try a different topic.`);
  }
  // Keep the stored duration honest. The QUESTIONS carry the real clock, so the
  // battle's length is however many were placed times their per-question
  // budget. It can differ from what was typed in two ways: fewer questions than
  // asked for, or a per-question share clamped into the 8–180s range — a
  // teacher asking for 1 minute over 30 questions gets 8s each, so the battle
  // takes four minutes, and the card must say four rather than one.
  const realLength = fill.placed * fill.secondsPerQuestion;
  if (fill.placed < total_questions || realLength !== time_limit_seconds) {
    await battles.updateBattle(battle.id, {
      total_questions:    fill.placed,
      time_limit_seconds: realLength,
    });
  }

  const q = await getBattleQueue();
  // No deadline, no expiry job — an unscheduled invitation waits.
  if (expiresAt) {
    await addLater(q, "expire-battle", { action: "expire-battle", battleId: battle.id },
      { delay: expiryDelay(expiresAt) });
  }
  // A duel waits for its accept; a group battle waits for its invitations —
  // until the scheduled time, or until the invite window closes, whichever
  // applies. The accept route starts it early once everyone has answered.
  if (!isDuel || req.series) {
    // A scheduled battle starts at its time. An unscheduled one has no clock
    // to start against any more, so it starts when everyone has answered —
    // the accept and decline routes bring it forward — or when the creator
    // presses Start Now. It will not run off a timer nobody set.
    if (isScheduled) {
      await addLater(q, "start-battle", { action: "start-battle", battleId: battle.id },
        { delay: startDelay(scheduled_for), jobId: `start-${battle.id}` });
    }
  }

  const { data: me } = await people.userProfile(req.user.id);
  const when = isScheduled
    ? `Starts ${new Date(scheduled_for).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })}`
    // Not "Starting shortly" any more — a group battle waits on its
    // invitations, so telling a learner it is about to start would be wrong in
    // exactly the case where they still have to accept it.
    : `Open for ${IDLE_HOURS} hours`;

  for (const o of opponents) {
    if (req.series) {
      await notifyUser(o.user_id, "battle_series", `${title} is on`,
        `Starts ${new Date(scheduled_for).toLocaleString("en-GB", { timeZone: req.series.tz || "Africa/Lagos" })}. You're in; skip it from your Challenges tab.`, battle.id);
      continue;
    }
    await notifyUser(o.user_id, "battle_challenge",
      isDuel ? `${me?.full_name ?? "Someone"} challenged you!`
             : `${me?.full_name ?? "Someone"} invited you to a battle: ${title}`,
      `${title} · ${xp_prize} XP · ${when}`, battle.id);

    { const card = await challengeCardFor(battle.id, me); if (card) global.io?.to(`user:${o.user_id}`).emit("new_challenge", card); }
  }

  res201(res, {
    success: true, battle_id: battle.id,
    battle_type: battle.battle_type,
    status: battle.status,
    // How many of its questions are the draft's own (the ones its preview showed).
    questions_from_draft: fill.fromDraft || 0,
    invited: opponents.length, expires_at: expiresAt, skipped: named,
    questions: fill.placed, fromBank: fill.fromBank, generated: fill.generated, coinsCharged: fill.charged,
  });
};
