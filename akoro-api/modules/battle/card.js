/**
 * battle/card.js — a battle as the learner's cards show it (Battles tab,
 * Challenges tab, the live 'new_challenge' push). One shape everywhere, so a
 * card that arrives live has everything a reloaded one has.
 */
import { HP_PER_MISS_DEFAULT } from "./hp.js";
import { requirementsOf } from "./entry.js";

export function toCard(b, extra = {}) {
  const mins = Math.round((b.time_limit_seconds ?? 900) / 60);
  return {
    id:            b.id,
    battleId:      b.id,
    courseId:      b.course_id,
    classroomId:   b.classroom_id ?? null,
    scope:         b.course_id ? "course" : b.classroom_id ? "class" : "network",
    title:         b.title,
    description:   b.description ?? null,
    topic:         b.topic ?? null,
    subject:       b.subject ?? "science",
    difficulty:    b.difficulty ?? "intermediate",
    status:        b.status,
    // From what it IS, not its status: a scheduled duel deliberately waits in
    // "lobby" until accepted, and was labelled "Immediate" for it.
    battleType:    b.battle_type === "review" ? "review"
                 : (b.scheduled_start && new Date(b.scheduled_start) > new Date()) || b.status === "scheduled" ? "scheduled"
                 : b.battle_type === "classroom" || b.battle_type === "team" ? "classroom" : "immediate",
    type:          b.battle_type,
    // The daily battle: platform-made, recurs every day (agent-network/activities.js).
    daily:         String(b.recurring_key || "").startsWith("daily:"),
    xpPrize:       `+${b.xp_prize ?? b.xp_pool ?? 0} XP`,
    xpPool:        b.xp_pool ?? b.xp_prize ?? 0,
    // What a miss costs, set by the creator — on the challenge sheet before accepting.
    hpPerMiss:     b.hp_per_miss ?? HP_PER_MISS_DEFAULT,
    // What it takes to join (battle/entry.js): coins for your agent's answers, and the creator's minimum XP.
    entry:         requirementsOf(b),
    totalQuestions: b.total_questions ?? 0,
    timeLimit:     `${mins} min`,
    durationMin:   mins,
    maxParticipants: b.max_participants ?? null,
    participantCount: b.total_participants ?? 0,
    scheduledFor:  b.scheduled_start ?? null,
    scheduledAt:   b.scheduled_start ?? null,
    // The live card says "Started {min}m ago" and the scheduled one "{startsIn}",
    // and neither field was ever sent — the same omission as agentA/agentB, so
    // the card read "Started undefinedm ago". Both are derived here rather than
    // in the client, which has no actual_start to work from.
    startedAt:     b.actual_start ?? null,
    startedAgo:    b.actual_start
      ? Math.max(0, Math.round((Date.now() - new Date(b.actual_start)) / 60000))
      : null,
    startsIn:      b.scheduled_start
      ? (() => {
          const mins = Math.round((new Date(b.scheduled_start) - Date.now()) / 60000);
          if (mins <= 0)  return "now";
          if (mins < 60)  return `in ${mins} min`;
          const hrs = Math.round(mins / 60);
          return hrs < 24 ? `in ${hrs}h` : `in ${Math.round(hrs / 24)} day${hrs >= 48 ? "s" : ""}`;
        })()
      : null,
    expiresAt:     b.expires_at ?? null,
    // The UI counts down from expiresAt itself; this stays for older callers.
    // null here means "no deadline", which is now the common case.
    expiresIn:     b.expires_at
      ? `${Math.max(0, Math.round((new Date(b.expires_at) - Date.now()) / 60000))} min`
      : null,
    createdBy:     b.created_by,
    challenger:    b.users?.full_name ?? null,
    avatar:        b.users?.avatar_url ?? null,
    ...extra,
  };
}
