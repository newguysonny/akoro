/**
 * battle/service-challenge.js — taking, refusing and running a seat: the
 * challenge responses, open-lobby join, the arena's heartbeat/state, and the
 * creator's Start now / End now.
 */
import { addLater } from "../../lib/deferredJobs.js";
import { entryCheck, minPlayersFor } from "./entry.js";
import {
  res200, res404, now, isEligible, resolveAgent, notifyUser,
  getBattleQueue, maybeStartEarly,
} from "./service-core.js";
import { deadlinePassed, isFuture } from "./rules.js";
import { battles, seats, people } from "./store.js";

/** GET /api/battle/battles/:battleId/entry — can I join it? (the challenge sheet asks before Accept) */
export async function battleEntry(req, res) {
  const { data: battle } = await battles.battleEntryInfo(req.params.battleId);
  if (!battle) return res404(res, "Battle not found");
  res200(res, await entryCheck(req.user.id, battle));
}

export async function acceptChallenge(req, res) {
  // A teacher's battle sits in 'scheduled' until its start time, so restricting
  // this to 'lobby' would have made exactly the invitations we now send
  // impossible to accept.
  const { data: battle } = await battles.openChallengeForAccept(req.params.challengeId);
  if (!battle) return res.status(404).json({ error: "Challenge not found or already resolved" });
  // Too late to accept — for THIS learner. The battle itself is left alone:
  // one late Accept used to mark the whole scheduled group battle expired,
  // and its start job then found nothing to start.
  if (deadlinePassed(battle.expires_at)) {
    return res.status(410).json({ error: "Too late to accept — this battle's accept window has closed." });
  }

  const { data: seat } = await seats.seatRole(battle.id, req.user.id);
  if (!seat) return res.status(403).json({ error: "You are not the challenged person" });

  // Enough coins for your agent's answers, and the creator's minimum XP (a
  // review has no XP gate). Short of either, you can't take the seat — the
  // challenge sheet already showed what it needs.
  const entry = await entryCheck(req.user.id, battle);
  if (!entry.ok) return res.status(402).json({ code: "ENTRY_REQUIREMENTS", error: entry.message, requirements: entry });

  // ── A group battle: take the seat, don't start the battle ────────────────
  // One learner accepting must not drag twenty others in. The battle keeps its
  // own start time; this only records that this learner is in.
  if (seat.role === "participant") {
    await seats.acceptSeat(battle.id, req.user.id);

    const { invited: invitedSeats } = await maybeStartEarly(battle);
    const accepted = invitedSeats.filter((s) => s.joined_at && !s.declined_at).length;

    // A review sent as a challenge has no creator to tell (the teacher sees it on the activity).
    if (battle.created_by) {
      const { data: me } = await people.userName(req.user.id);
      await notifyUser(battle.created_by, "battle_accepted",
        `${me?.full_name} joined ${battle.title}`,
        `${accepted} of ${invitedSeats.length} accepted`, battle.id);
    }
    req.app.get("io")?.to(`user:${req.user.id}`).emit("join_battle_room", { battleId: battle.id });

    return res.json({ success: true, battle_id: battle.id, status: battle.status,
      accepted, invited: invitedSeats.length, is_immediate: false });
  }

  const isScheduled = isFuture(battle.scheduled_start);
  // Only ever to "scheduled" here. The start job flips it to live when it
  // actually starts — it ignores a battle already marked live, so setting
  // "live" here meant every accepted duel sat live forever, never starting.
  if (isScheduled) await battles.setScheduled(battle.id);
  await seats.joinSeat(battle.id, req.user.id, now());

  const q = await getBattleQueue();
  const delay = isScheduled ? new Date(battle.scheduled_start).getTime() - Date.now() : 3000;
  await addLater(q, "start-battle", { action: "start-battle", battleId: battle.id }, { delay: Math.max(delay, 0) });

  const { data: me } = await people.userProfile(req.user.id);
  await notifyUser(battle.created_by, "battle_accepted",
    `${me?.full_name} accepted your challenge!`,
    `${battle.title} · ${isScheduled ? "Scheduled: " + battle.scheduled_start : "Starting now!"}`, battle.id);

  // WebSocket — notify challenger their battle was accepted
  const io = req.app.get("io");
  if (io) {
    io.to(`user:${battle.created_by}`).emit("battle_accepted", {
      battleId:    battle.id,
      title:       battle.title,
      opponent:    me?.full_name ?? "Opponent",
      opponentAvatar: me?.avatar_url ?? null,
      status:      isScheduled ? "scheduled" : "live",
      isImmediate: !isScheduled,
    });
    // Also notify both participants to join the battle room
    io.to(`user:${battle.created_by}`).emit("join_battle_room", { battleId: battle.id });
    io.to(`user:${req.user.id}`).emit("join_battle_room",       { battleId: battle.id });
  }

  res.json({ success: true, battle_id: battle.id, status: isScheduled ? "scheduled" : "live", is_immediate: !isScheduled });
}

export const declineChallenge = async (req, res) => {
  const { data: p } = await seats.seatForDecline(req.params.challengeId, req.user.id);
  if (!p || !["lobby", "scheduled"].includes(p.battles?.status)) {
    return res.status(404).json({ error: "Challenge not found" });
  }

  const { data: me } = await people.userName(req.user.id);

  // Declining a DUEL ends it — there is no battle without the other person.
  // Declining a CLASS battle is one empty seat, not a veto: cancelling the
  // whole thing would let any one learner call off the teacher's battle.
  if (p.role === "participant") {
    await seats.declineSeat(p.battle_id, req.user.id);

    // A decline can be the LAST answer, and then there is nothing left to wait
    // for either. Without this the battle sat in its lobby for the full invite
    // window while everyone who said yes waited on someone who had said no.
    const { data: battle } = await battles.battleForDecline(p.battle_id);
    const { invited: declineSeats } = await maybeStartEarly(battle);
    const accepted = declineSeats.filter((s) => s.joined_at).length;
    // Nobody left to compete: cancel rather than run an empty battle at the
    // scheduled time and report a winner who was the only entrant.
    if (declineSeats.every((s) => s.declined_at)) {
      await battles.setBattleStatus(p.battle_id, "cancelled");
    }
    await notifyUser(p.battles.created_by, "battle_declined",
      `${me?.full_name} declined ${p.battles.title}`,
      `${accepted} of ${declineSeats.length} still in`, p.battle_id);
    global.io?.to(`user:${p.battles.created_by}`).emit("battle_declined", { battleId: p.battle_id, by: me?.full_name ?? null });
    return res.json({ success: true, accepted, invited: declineSeats.length });
  }

  await battles.setBattleStatus(req.params.challengeId, "cancelled");
  await notifyUser(p.battles.created_by, "battle_declined", `${me?.full_name} declined your challenge`, p.battles.title, req.params.challengeId);
  // Live, so the creator's card doesn't sit on "Waiting" until a reload.
  global.io?.to(`user:${p.battles.created_by}`).emit("battle_declined", { battleId: req.params.challengeId, by: me?.full_name ?? null, cancelled: true });
  res.json({ success: true });
};

export async function cancelChallenge(req, res) {
  // .select(): zero rows changed is not an error to PostgREST, so this always
  // reported success — even for someone else's battle or one already running.
  const { data: rows, error } = await battles.cancelOwnBattle(req.params.challengeId, req.user.id, ["lobby", "scheduled"]);
  if (error || !rows?.length) return res.status(404).json({ error: "Challenge not found or cannot be cancelled" });
  res.json({ success: true });
}

export async function joinBattle(req, res) {
  const { data: battle } = await battles.battleByIdSingle(req.params.battleId);
  if (!battle) return res.status(404).json({ error: "Battle not found" });
  if (battle.battle_type !== "open") return res.status(400).json({ error: "Not an open lobby" });
  if (!["lobby", "scheduled"].includes(battle.status)) return res.status(400).json({ error: `Battle is ${battle.status}` });
  if (deadlinePassed(battle.expires_at)) return res.status(410).json({ error: "Lobby has expired" });

  const { eligible } = await isEligible(req.user.id, battle.course_id);
  if (!eligible) return res.status(403).json({ error: "Not enrolled" });

  const myAgent = await resolveAgent(req.user.id);
  if (!myAgent) return res.status(400).json({ error: "Create your agent first" });

  const entry = await entryCheck(req.user.id, battle);
  if (!entry.ok) return res.status(402).json({ code: "ENTRY_REQUIREMENTS", error: entry.message, requirements: entry });

  const { data: alreadyIn } = await seats.seatUserId(battle.id, req.user.id);
  if (alreadyIn) return res.status(409).json({ error: "Already in this battle" });

  const { count } = await seats.seatCount(battle.id);
  if ((count ?? 0) >= battle.max_participants) return res.status(409).json({ error: "Battle is full" });

  await seats.insertSeat({ battle_id: battle.id, user_id: req.user.id, agent_id: myAgent.id, role: "participant", joined_at: now() });
  await battles.setTotalParticipants(battle.id, (count ?? 0) + 1);

  global.io?.to(`battle:${battle.id}`).emit("battle:participant-joined", {
    battleId: battle.id, userId: req.user.id, agentName: myAgent.agent_name, agentEmoji: myAgent.agent_emoji,
    totalParticipants: (count ?? 0) + 1, maxParticipants: battle.max_participants,
  });

  if ((count ?? 0) + 1 >= battle.max_participants && !battle.scheduled_start) {
    await addLater(await getBattleQueue(), "start-battle", { action: "start-battle", battleId: battle.id }, { delay: 3000 });
  }

  res.json({ success: true, battle_id: battle.id, current_participants: (count ?? 0) + 1 });
}

export async function battleHeartbeat(req, res) {
  await seats.updateSeat(req.params.battleId, req.user.id, { is_connected: true, last_heartbeat: now() });
  res.json({ ok: true });
}

export async function battleState(req, res) {
  const { data: battle } = await battles.battleStateFields(req.params.battleId);
  if (!battle) return res.status(404).json({ error: "Battle not found" });

  const { data: participants } = await seats.stateSeats(req.params.battleId);

  const { count } = await seats.viewerCount(req.params.battleId);
  // battle_type too: the arena has to know whether the learner answers (a
  // study review) or watches their agent (everything else), and the card it was
  // opened from does not always carry it — accepting an invitation opens the
  // arena with only an id and a status.
  res.json({
    status: battle.status, battleType: battle.battle_type, reviewHost: battle.review_host ?? null,
    totalQuestions: battle.total_questions ?? 0,
    participants: participants ?? [], viewer_count: count ?? 0,
  });
}

export async function startBattleNow(req, res) {
  const { data: battle } = await battles.battleOwnedBy(req.params.battleId, req.user.id);
  if (!battle || !["lobby", "scheduled"].includes(battle.status)) return res.status(404).json({ error: "Battle not found or not authorised" });

  // Count PLAYERS, not seats. Since an unscheduled battle has no deadline to
  // start it, Start Now is the creator's way to run it without waiting for the
  // last learner — so it has to answer the same question the worker asks:
  // whoever accepted and did not decline, excluding the teacher, who hosts it.
  const { data: startSeats } = await seats.seatStarts(battle.id);
  const players = (startSeats ?? []).filter((p) => p.role !== "teacher" && p.joined_at && !p.declined_at).length;
  // A review is one learner; a 2v2 needs all four; anything else two.
  const need = minPlayersFor(battle);
  if (players < need) {
    const waiting = (startSeats ?? []).filter((p) => p.role !== "teacher" && !p.joined_at && !p.declined_at).length;
    return res.status(400).json({
      error: waiting
        ? `Only ${players} learner${players === 1 ? " has" : "s have"} accepted so far — ${waiting} still to answer. This needs ${need}.`
        : `This needs at least ${need} learner${need === 1 ? "" : "s"} who have accepted.`,
    });
  }

  await addLater(await getBattleQueue(), "start-battle", { action: "start-battle", battleId: battle.id }, { delay: 1000 });
  res.json({ success: true, battle_id: battle.id });
}

export async function endBattleNow(req, res) {
  const { data: battle } = await battles.battleEndFields(req.params.battleId);
  if (!battle) return res.status(404).json({ error: "Battle not found" });
  if (req.user.role !== "admin" && battle.created_by !== req.user.id) return res.status(403).json({ error: "Not authorised" });
  // Only a battle that is running can be ended — ending one that never started
  // would rank and pay invitees who never accepted. Cancel that one instead.
  if (battle.status !== "live") return res.status(409).json({ error: `This battle is ${battle.status} — only a live battle can be ended.` });
  await (await getBattleQueue()).add("end-battle", { action: "end-battle", battleId: req.params.battleId }, { delay: 0 });
  res.json({ success: true });
}

/**
 * POST /api/battles/:battleId/answer
 *
 * Gone. Every battle — study review included — is answered by the AGENTS, and
 * the learner watches. Their agent answers from what they have actually
 * learned: its odds come from that learner's own per-topic confidence, so a
 * review still measures the learner, read through the agent that represents
 * them rather than typed in by hand.
 *
 * The route stays so an old client gets an explanation rather than a 404, and
 * so it cannot quietly write a second answer alongside the agent's.
 *
 * The knowledge update this handler used to own now lives in the worker's
 * agentAnswer — see modules/battle/worker.js. That matters: agent accuracy is
 * READ from the same table, so if nothing wrote to it the agents would be
 * frozen at whatever they knew today, and no battle would ever teach anyone
 * anything.
 */
export async function answerNotAccepted(req, res) {
  res.status(409).json({
    code:  "AGENT_ANSWERS",
    error: "Your agent answers for you — watch it play.",
  });
}
