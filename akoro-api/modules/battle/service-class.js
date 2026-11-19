/**
 * battle/service-class.js — classroom battles and the class-facing lists:
 * the learner's classes and their subjects, a class roster, and the class
 * invite (including study reviews and recurring series).
 */
import { addLater } from "../../lib/deferredJobs.js";
import { InsufficientCoins } from "../../lib/coins.js";
import { cleanHpPerMiss } from "./hp.js";
import { entryCheck } from "./entry.js";
import { buildQuestions } from "./questionSource.js";
import { createSeries } from "./series.js";
import { seriesTemplate } from "./seriesCore.js";
import {
  res200, res201, res400, res403, now, resolveAgent, notifyUser,
  getBattleQueue, queueIdleExpiry, challengeCardFor, draftPreset,
} from "./service-core.js";
import { acceptDeadline, idleDeadline, isFuture, expiryDelay, startDelay } from "./rules.js";
import { battles, seats, people } from "./store.js";

// ─── the learner's classes, for the battle form ───────────────────────────────

/**
 * GET /api/battle/my-classes
 * The learner's classes and the subjects taught in each, for the battle form.
 *
 * public.classrooms (who is in the room) and mgmt.classes (the academic
 * structure) are separate tables with no foreign key between them — they line
 * up by school and name. So resolve the room first, then look up its subjects
 * by that pair, and fall back to the subjects the past-questions bank can
 * actually supply if the school hasn't set its curriculum up yet.
 */
export async function myClasses(req, res) {
  // Learners get the classes they are IN; teachers and school admins get the
  // ones they run. Same shape either way, so one form serves all three apps —
  // and unioned rather than branched on role, so a head of department who both
  // teaches and administers sees all of theirs.
  const { data: memberships } = await people.classroomMemberships(req.user.id);

  const byId = new Map();
  for (const m of (memberships ?? [])) if (m.classrooms) byId.set(m.classrooms.id, m.classrooms);

  const { data: school } = await people.schoolAdministeredBy(req.user.id);

  const { data: taught } = await people.classroomsTaughtBy(req.user.id, school?.id);
  for (const r of (taught ?? [])) byId.set(r.id, r);

  const rooms = [...byId.values()];
  if (!rooms.length) return res200(res, []);

  const out = [];
  for (const room of rooms) {
    let subjects = [];
    if (room.school_id) {
      const { data: cls } = await people.curriculumClass(room.school_id, room.name);
      if (cls?.length) {
        const { data: cs } = await people.classSubjects(cls[0].id);
        subjects = [...new Set((cs ?? []).map((r) => r.subjects?.name).filter(Boolean))];
      }
    }
    // No curriculum configured — offer what we can actually set questions on
    // rather than an empty dropdown that looks broken.
    if (!subjects.length) subjects = await subjectsWithQuestions();

    const { count } = await people.classroomStudentCount(room.id);

    out.push({ id: room.id, name: room.name, subjects, student_count: count ?? 0 });
  }
  res200(res, out);
}

/** Subjects the past-questions bank can actually supply verified MCQs for. */
async function subjectsWithQuestions() {
  const { data } = await people.pastQuestionSubjects();
  return [...new Set((data ?? []).map((r) => r.subject))].sort();
}

/** GET /api/battle/classes/:id/roster — classmates who can battle. */
export async function classRoster(req, res) {
  if (!(await classroomRole(req.user.id, req.user.role, req.params.id)))
    return res403(res, "You don't have access to this class");

  const { data: rows } = await people.classroomStudentsWithProfiles(req.params.id);

  const ids = (rows ?? []).map((r) => r.user_id);
  const { data: agents } = await people.agentsForUsers(ids);
  const withAgent = new Set((agents ?? []).map((a) => a.user_id));

  res200(res, (rows ?? [])
    .filter((r) => r.user_id !== req.user.id)
    .map((r) => ({
      id: r.users.id, username: r.users.username, full_name: r.users.full_name,
      avatar: r.users.avatar_url ?? null, emoji: r.users.avatar_emoji ?? null,
      has_agent: withAgent.has(r.user_id),
    })));
}

async function inClassroom(userId, classroomId) {
  const { data } = await people.classEnrolment(userId, classroomId);
  return !!data;
}

/**
 * canUseClassroom — who may run a battle for a class.
 *
 * Membership is the learner's answer, and it is the wrong question for a
 * teacher: the person most likely to set a class battle is precisely the one
 * who is not IN the class. So three ways in — you're a member, you teach it, or
 * you administer the school that owns it — and the caller gets told which,
 * because a teacher joins the battle as a teacher, not as a competitor.
 */
export async function classroomRole(userId, role, classroomId) {
  if (await inClassroom(userId, classroomId)) return "member";
  if (role === "admin") return "teacher";

  const { data: room } = await people.classroom(classroomId);
  if (!room) return null;
  if (room.teacher_id === userId) return "teacher";

  if (room.school_id) {
    const { data: school } = await people.schoolAdminOfClass(userId, room.school_id);
    if (school) return "teacher";
  }
  return null;
}

/**
 * POST /api/battle/classes/:classroomId/battles/invite
 * Same shape as the course invite — one opponent makes a duel, several make a
 * group battle — but scoped to classmates and a class subject.
 */
export const classInvite = async (req, res) => {
  const { classroomId } = req.params;
  const {
    title, description, subject, topic,
    difficulty = "intermediate", total_questions = 15,
    time_limit_seconds = 900, xp_prize = 200,
    expires_in_minutes = 60, scheduled_for = null,
    usernames = [], user_ids = [], whole_class = false,
    question_source = "auto",          // 'bank' | 'ai' | 'auto'
    mode = "battle",                   // 'battle' | 'review'
  } = req.body;

  if (!title)   return res400(res, "title is required");
  if (!subject) return res400(res, "Pick a subject — a class battle draws its questions from one");
  const myRole = await classroomRole(req.user.id, req.user.role, classroomId);
  if (!myRole) return res403(res, "You don't have access to this class");

  const myAgent = await resolveAgent(req.user.id);
  if (!myAgent) return res400(res, "Create your agent first");

  // ── Targets ──────────────────────────────────────────────────────────────
  const targetIds = new Set((Array.isArray(user_ids) ? user_ids : []).filter(Boolean));
  const notFound  = [];
  for (const raw of (Array.isArray(usernames) ? usernames : [])) {
    const handle = String(raw).trim().replace(/^@/, "");
    if (!handle) continue;
    const { data: found } = await people.userByHandle(handle, "id");
    if (found?.length) targetIds.add(found[0].id);
    else notFound.push(handle);
  }
  if (whole_class) {
    const { data: rows } = await people.classroomStudentIds(classroomId);
    for (const r of (rows ?? [])) targetIds.add(r.user_id);
  }
  targetIds.delete(req.user.id);
  if (notFound.length) return res400(res, `No account found for: ${notFound.join(", ")}`);
  if (!targetIds.size) return res400(res, "Pick at least one classmate to challenge");

  const ids = [...targetIds];
  const [{ data: members }, { data: agents }] = await Promise.all([
    people.classroomMembersWithin(classroomId, ids),
    people.agentIdsForUsers(ids),
  ]);
  const memberSet  = new Set((members ?? []).map((m) => m.user_id));
  const agentByUser = new Map((agents ?? []).map((a) => [a.user_id, a.id]));

  const skipped = { not_in_class: [], no_agent: [] };
  const opponents = [];
  for (const id of ids) {
    if (!memberSet.has(id))    { skipped.not_in_class.push(id); continue; }
    if (!agentByUser.has(id))  { skipped.no_agent.push(id);     continue; }
    opponents.push({ user_id: id, agent_id: agentByUser.get(id) });
  }
  if (!opponents.length) return res400(res, "None of those classmates can battle yet — they need to be in this class and have an agent.");

  // ── Create ───────────────────────────────────────────────────────────────
  // One opponent is a duel only between CLASSMATES: a classmate is IN the
  // battle, so the two of them make a pair. A teacher hosts rather than
  // competes, so a teacher picking one learner leaves that learner with nobody
  // to face — and the battle sat in its lobby saying "waiting for players to
  // accept" for ever, even after the one learner had accepted. Say so at the
  // point of creation instead of building something that can never run.
  // A STUDY REVIEW is one learner working through a paper on their own — no
  // opponent, no winner, a mark sheet at the end. It is the one shape the
  // two-competitors rule must not block, and it must not become a duel either.
  const isReview = mode === "review";
  if (isReview && opponents.length !== 1) {
    return res400(res, "A study review is for one learner. Pick exactly one.");
  }
  if (isReview && myRole === "member") {
    return res403(res, "Only a teacher can set a study review.");
  }

  const isDuel = !isReview && myRole === "member" && opponents.length === 1;
  if (!isReview && !isDuel && opponents.length < 2) {
    return res400(res, "A battle needs two learners to compete. Pick at least one more, or send it to the whole class.");
  }

  // A RECURRING battle: save the series, not a battle. Its battles are made an
  // hour before each start, through this same route (battle/series.js).
  if (req.body?.repeat && !req.series) {
    if (isReview) return res400(res, "A study review is set once; it doesn't repeat.");
    try {
      const made = await createSeries({ creatorId: req.user.id, scope: "class", classroomId,
        template: seriesTemplate(req.body), repeat: req.body.repeat, memberIds: opponents.map((o) => o.user_id) });
      return res201(res, { success: true, series_id: made.id, next_at: made.nextAt, invited: opponents.length, repeats: made.rule });
    } catch (e) { if (e.status === 400) return res400(res, e.message); throw e; }
  }
  const isScheduled = isFuture(scheduled_for);
  // A deadline only where there is a start time to be a deadline. See
  // acceptDeadline; an unscheduled one stays open BATTLE_IDLE_HOURS.
  const expiresAt   = isScheduled ? acceptDeadline(scheduled_for) : idleDeadline();

  // A learner who creates a battle plays in it: they need the coins for their own agent's answers.
  if (myRole !== "teacher" && !isReview) {
    const creatorEntry = await entryCheck(req.user.id, { battle_type: "battle", total_questions, min_xp: 0 });
    if (!creatorEntry.ok) return res.status(402).json({ code: "ENTRY_REQUIREMENTS", error: creatorEntry.message.replace("to join", "to start it"), requirements: creatorEntry });
  }
  const { data: battle, error } = await battles.insertBattle({
    hp_per_miss: cleanHpPerMiss(req.body?.hp_per_miss),
    min_xp: Math.max(0, Math.round(Number(req.body?.min_xp) || 0)),
    course_id: null, classroom_id: classroomId,
    battle_type: isReview ? "review" : isDuel ? "1v1" : "classroom",
    title, description: description ?? null,
    topic: topic ?? null, subject, difficulty,
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

  // Questions before anyone is told about it: a battle with none is worse than
  // no battle, so if we can't fill it, undo and say why.
  let fill;
  try {
    const { data: room } = await people.classroomName(classroomId);
    fill = await buildQuestions({
      battleId: battle.id, source: question_source, total: total_questions,
      subject, topic, difficulty, classLabel: room?.name, userId: req.user.id,
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
      ? `Only ${fill.placed} ${subject} questions in the bank. Switch Questions to "Generate with AI" to fill the rest.`
      : `Could not put together enough ${subject} questions (got ${fill.placed}). Try a different subject or topic.`);
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

  await seats.insertSeat({
    battle_id: battle.id, user_id: req.user.id, agent_id: myAgent.id,
    // A teacher runs the battle; a classmate competes in it.
    role: myRole === "teacher" ? "teacher" : "creator", joined_at: now(),
  });
  // EVERY battle is an INVITATION, whoever set it. Group battles used to enter
  // people with joined_at already set, so the battle simply happened to them —
  // nothing appeared in their Challenges tab and there was nothing to accept.
  // Being picked by a classmate is no more consent than being picked by a
  // teacher, so the seat starts empty either way and the start job waits.
  //
  // Only the creator is in from the start; they are the one who asked for it.
  for (const o of opponents) {
    await seats.upsertSeat({
      battle_id: battle.id, user_id: o.user_id, agent_id: o.agent_id,
      role: isDuel ? "opponent" : "participant",
      // In a series everyone is in unless they opted out; no accept per occurrence.
      joined_at: req.series ? now() : null,
    });
  }

  const q = await getBattleQueue();
  // No deadline, no expiry job — an unscheduled invitation waits.
  if (expiresAt) {
    await addLater(q, "expire-battle", { action: "expire-battle", battleId: battle.id },
      { delay: expiryDelay(expiresAt) });
  }
  if (!isDuel || req.series) {
    // Wait for the invitations: until the scheduled time if there is one,
    // otherwise until the invite window closes. It starts sooner than that —
    // the accept route brings it forward the moment everyone has answered, so
    // a class that all accepts within a minute battles within a minute.
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
  for (const o of opponents) {
    if (req.series) {
      await notifyUser(o.user_id, "battle_series", `${title} is on`,
        `Starts ${new Date(scheduled_for).toLocaleString("en-GB", { timeZone: req.series.tz || "Africa/Lagos" })}. You're in; skip it from your Challenges tab.`, battle.id);
      continue;
    }
    await notifyUser(o.user_id, "battle_challenge",
      isDuel ? `${me?.full_name ?? "A classmate"} challenged you!`
             : `${me?.full_name ?? "Someone"} invited you to a battle: ${title}`,
      `${subject} · ${xp_prize} XP`, battle.id);
    { const card = await challengeCardFor(battle.id, me); if (card) global.io?.to(`user:${o.user_id}`).emit("new_challenge", card); }
  }

  const skippedIds = [...skipped.not_in_class, ...skipped.no_agent];
  const { data: skippedUsers } = await people.usersByIds(skippedIds, "id, full_name, username");
  const nameById = new Map((skippedUsers ?? []).map((u) => [u.id, u.full_name || u.username]));

  res201(res, {
    success: true, battle_id: battle.id,
    // Report what was WRITTEN, not a second guess at it. This re-derived the
    // type and so answered "classroom" for a review.
    battle_type: battle.battle_type,
    status: battle.status,
    // How many of its questions are the draft's own (the ones its preview showed).
    questions_from_draft: fill.fromDraft || 0,
    invited: opponents.length, expires_at: expiresAt,
    questions: fill.placed, fromBank: fill.fromBank, generated: fill.generated, coinsCharged: fill.charged,
    skipped: {
      not_in_class: skipped.not_in_class.map((id) => nameById.get(id) ?? id),
      no_agent:     skipped.no_agent.map((id) => nameById.get(id) ?? id),
    },
  });
};
