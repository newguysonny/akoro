/**
 * instructor/service-battles.js — battle list/create/update/delete, including
 * the creator's participant row, the socket event and student invites.
 */
import { mapBattle, VALID_BATTLE_TYPES, VALID_BATTLE_STATUS } from "./rules.js";
import {
  asyncHandler, created, ok, err400, err403, err404, err500, now,
  notify, notifyMany, enrolledStudentIds,
} from "./service-core.js";
import { courseForOwnership, latestCourseOfTeacher } from "./store-courses.js";
import { activeAgent } from "./store-people.js";
import {
  battlesByCreator, battleById, insertBattle,
  updateBattle as updateBattleRow, deleteBattle as deleteBattleRow,
  insertBattleParticipant,
} from "./store-battles.js";

// ─── § BATTLES ────────────────────────────────────────────────────────────────

export const listBattles = asyncHandler(async (req, res) => {
  try {
    const { status } = req.query;

    const { data, error } = await battlesByCreator(req.user.id, status);
    if (error) throw new Error(error.message);

    ok(res, (data ?? []).map(mapBattle));
  } catch (e) {
    err500(res, e);
  }
});

export const createBattle = asyncHandler(async (req, res) => {
  try {
    const b = req.body;
    const title  = b.title;
    if (!title) return err400(res, "title is required");

    // battles.course_id is NOT NULL — resolve a course to attach the battle to.
    let courseId = b.courseId;
    if (courseId) {
      const { data: course } = await courseForOwnership(courseId);
      if (!course)                              return err404(res, "Course not found");
      if (course.instructor_id !== req.user.id) return err403(res, "You do not own this course");
    } else {
      // Default to the teacher's most recent course.
      const { data: first } = await latestCourseOfTeacher(req.user.id);
      if (!first) return err400(res, "Create a course before launching a battle");
      courseId = first.id;
    }

    const battleType = VALID_BATTLE_TYPES.includes(b.battleType) ? b.battleType : "open";
    const durationMin = Number(b.duration ?? 15);
    const scheduledStart = b.scheduledAt || null;
    // status: schema has no 'draft' — unscheduled battles sit in 'lobby'.
    let battleStatus = b.status === "scheduled" || scheduledStart ? "scheduled" : "lobby";
    if (VALID_BATTLE_STATUS.includes(b.status)) battleStatus = b.status;
    // expires_at is NOT NULL.
    const expiresAt = scheduledStart
      ? new Date(new Date(scheduledStart).getTime() + 24 * 3600000).toISOString()
      : new Date(Date.now() + 7 * 24 * 3600000).toISOString();

    const { data: battle, error: battleErr } = await insertBattle({
      course_id:          courseId,
      battle_type:        battleType,
      title,
      description:        b.description ?? null,
      topic:              b.topic ?? null,
      difficulty:         b.difficulty ?? "intermediate",
      total_questions:    Number(b.questionCount ?? 15),
      time_limit_seconds: durationMin * 60,
      max_participants:   Number(b.maxParticipants ?? 10),
      scheduled_start:    scheduledStart,
      expires_at:         expiresAt,
      status:             battleStatus,
      created_by:         req.user.id,
      created_at:         now(),
      updated_at:         now(),
    });

    if (battleErr) throw new Error(battleErr.message);

    // battle_participants.agent_id is NOT NULL — only add the creator as a
    // participant if they have an active agent.
    const { data: agent } = await activeAgent(req.user.id);
    if (agent) {
      await insertBattleParticipant({
        battle_id: battle.id,
        user_id:   req.user.id,
        agent_id:  agent.id,
        role:      "creator",
        joined_at: now(),
      });
    }

    global.io?.to(`user:${req.user.id}`).emit("battle.created", { battleId: battle.id });

    notify(req.user.id, { type: "battle_created", title: `Battle "${title}" created`, content: `${battleType} battle`, relatedId: battle.id });
    // Recipient side — invite enrolled students to the battle.
    notifyMany(await enrolledStudentIds(courseId), {
      type:      "battle_invite",
      title:     `New battle: "${title}"`,
      content:   `A ${battleType} battle is open — join in!`,
      relatedId: battle.id,
    });
    created(res, mapBattle(battle));
  } catch (e) {
    err500(res, e);
  }
});

export const updateBattle = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing } = await battleById(id);

    if (!existing)                         return err404(res, "Battle not found");
    if (existing.created_by !== req.user.id) return err403(res, "You did not create this battle");

    const b = req.body;
    const updates = {};
    if (b.title       !== undefined) updates.title       = b.title;
    if (b.description !== undefined) updates.description = b.description;
    if (b.topic       !== undefined) updates.topic       = b.topic;
    if (b.difficulty  !== undefined) updates.difficulty  = b.difficulty;
    if (b.maxParticipants !== undefined) updates.max_participants   = Number(b.maxParticipants);
    if (b.duration        !== undefined) updates.time_limit_seconds = Number(b.duration) * 60;
    if (b.scheduledAt     !== undefined) updates.scheduled_start    = b.scheduledAt || null;
    if (b.status !== undefined && VALID_BATTLE_STATUS.includes(b.status)) updates.status = b.status;
    if (Object.keys(updates).length === 0) return err400(res, "No updatable fields provided");
    updates.updated_at = now();

    const { data, error } = await updateBattleRow(id, updates);

    if (error) throw new Error(error.message);
    notify(req.user.id, { type: "battle_updated", title: `Battle "${data.title}" updated`, content: "Changes saved", relatedId: data.id });
    ok(res, mapBattle(data));
  } catch (e) {
    err500(res, e);
  }
});

export const deleteBattle = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing } = await battleById(id);

    if (!existing)                         return err404(res, "Battle not found");
    if (existing.created_by !== req.user.id) return err403(res, "You did not create this battle");

    const { error } = await deleteBattleRow(id);
    if (error) throw new Error(error.message);

    notify(req.user.id, { type: "battle_deleted", title: "Battle deleted", content: "A battle was removed" });
    ok(res, { message: "Battle deleted" });
  } catch (e) {
    err500(res, e);
  }
});
