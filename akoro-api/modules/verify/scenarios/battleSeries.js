/**
 * Recurring battles (reference/Akoro Battles — Model.md): a teacher sets a
 * class battle to repeat on days of the week at a time until an end date.
 * Members are in every occurrence unless they skip one or opt out; the
 * creator can end the series.
 *
 * The occurrence is made in-process (battle/series.js runOccurrence, what the
 * battle worker runs an hour before each start), so the gate needn't wait for
 * the clock.
 */
import { battleClass, BATTLE_SUBJECTS, BATTLE_INSTRUCTOR } from "./instructorActivities.js";

const lagosClock = (ms) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: false });

export const battleSeriesRuns = {
  name: "battles.recurring", area: "battles", risk: "write", regression: false,
  timeoutMs: 240_000,
  description: "A teacher sets a recurring class battle: the series waits in Postgres; an occurrence is made with everyone already in; a learner skips one, another opts out; the teacher ends it and the upcoming one is cancelled.",
  params: { instructor: { default: BATTLE_INSTRUCTOR } },
  async run(ctx, p) {
    const probe = await ctx.db.probe("battle_series", "id, days, at_time, tz, until, status, next_at, last_battle_id");
    if (!probe.ok) ctx.expect.blocked(`no battle_series table yet (migration 2026-battle-series.sql): ${probe.error}`);
    const teacher = await ctx.as(p.instructor);
    const found = await battleClass(ctx, p.instructor, 2);
    if (!found) ctx.expect.blocked(`${p.instructor} has no class with 2 test learners who have an agent`);
    const { classroom, learners } = found;
    const [a, b] = await Promise.all(learners.map((l) => ctx.as(`@${l.username}`)));
    const { runOccurrence } = await import("../../battle/series.js");
    const db = (await import("../../../db.js")).default;

    // Every day, three hours from now (Lagos), for two days: the first start is far enough off to wait in Postgres.
    const time = lagosClock(Date.now() + 3 * 3600_000);
    const until = new Date(Date.now() + 2 * 86400_000).toISOString();
    let seriesId = null, occ = null, firstStart = null;
    const tried = [];
    for (const subject of BATTLE_SUBJECTS) {
      const made = await ctx.http({ as: p.instructor, method: "POST", path: `/api/battle/classes/${classroom.id}/battles/invite`, body: {
        title: `${ctx.marker} Weekly fractions`, subject, topic: "Fractions", total_questions: 5,
        time_limit_seconds: 300, xp_prize: 50, question_source: "bank",
        user_ids: [a.id, b.id], repeat: { days: [0, 1, 2, 3, 4, 5, 6], time, tz: "Africa/Lagos", until },
      } });
      if (made.status !== 201) ctx.expect.blocked(`creating the series was refused (${made.status}): ${made.body?.error}`);
      const id = made.body?.data?.series_id;
      ctx.cleanup(async () => {
        await db.from("battles").delete().eq("series_id", id);
        await db.from("battle_series").delete().eq("id", id);
        await db.schema("edu").from("deferred_jobs").delete().like("job_key", `series-${id}-%`);
        for (const u of [a, b]) await db.from("notifications").delete().eq("user_id", u.id).in("type", ["battle_series", "battle_challenge"]).like("title", `%${ctx.marker}%`);
      });
      const nextAt = made.body?.data?.next_at;
      firstStart = new Date(nextAt).getTime();
      const out = await runOccurrence(id, firstStart);
      if (out.battleId) { seriesId = id; occ = out; ctx.note(`series in ${subject}`); break; }
      tried.push(`${subject}: ${out.skipped}`);
      await db.from("battle_series").update({ status: "ended" }).eq("id", id);
      if (!/bank|enough/i.test(String(out.skipped))) break;
    }
    if (!seriesId) ctx.expect.blocked(`no occurrence could be made: ${tried.join(" | ")}`);

    // The series, its members, and the wait (a Postgres row, not Redis).
    const [s] = await ctx.db.rows("battle_series", { id: seriesId }, { columns: "id, scope, days, at_time, tz, until, status, next_at, last_battle_id" });
    ctx.expect.eq("a class series, every day at the time given", [s?.scope, s?.days?.length, s?.at_time], ["class", 7, time]);
    ctx.expect.eq("the occurrence is recorded on it", s?.last_battle_id, occ.battleId);
    ctx.expect.eq("…and the next one is a day later", new Date(s?.next_at).getTime(), firstStart + 86400_000);
    const waits = await ctx.db.rows("edu.deferred_jobs", { job_key: `series-${seriesId}-${firstStart + 86400_000}` }, { columns: "job_key, due_at" });
    ctx.expect.eq("the next one waits in Postgres", waits.length, 1);

    // The occurrence: a scheduled battle with both learners already in.
    const [battle] = await ctx.db.rows("battles", { id: occ.battleId }, { columns: "id, status, series_id, scheduled_start, battle_type" });
    ctx.expect.eq("the occurrence belongs to the series", battle?.series_id, seriesId);
    ctx.expect.eq("…is scheduled at its start", [battle?.status, new Date(battle?.scheduled_start).getTime()], ["scheduled", firstStart]);
    const seats = await ctx.db.rows("battle_participants", { battle_id: occ.battleId }, { columns: "user_id, role, joined_at" });
    const inSeat = (u) => seats.find((x) => x.user_id === u.id);
    ctx.expect.ok("both learners are in without accepting", !!inSeat(a)?.joined_at && !!inSeat(b)?.joined_at, seats);
    ctx.expect.eq("the teacher hosts", seats.find((x) => x.user_id === teacher.id)?.role, "teacher");

    // Running it again (a duplicate release) makes nothing new.
    const again = await runOccurrence(seriesId, firstStart);
    ctx.expect.eq("a second release finds the same battle", again.battleId, occ.battleId);

    // The Challenges tab: one series card.
    const cardsA = (await ctx.http({ as: `@${learners[0].username}`, path: "/api/battle/my-challenges" })).body?.data || [];
    const card = cardsA.find((c) => c.seriesId === seriesId);
    ctx.expect.ok("the learner's Challenges tab shows the series", !!card, cardsA.map((c) => c.id));
    ctx.expect.eq("…auto-joined, with its rule and the made occurrence next", [card?.autoJoined, card?.series?.days?.length, card?.nextBattleId], [true, 7, occ.battleId]);

    // Learner B skips this one: their seat is declined; the battle stays.
    const skip = await ctx.http({ as: `@${learners[1].username}`, method: "POST", path: `/api/battle/series/${seriesId}/skip`, body: {} });
    ctx.expect.status("skipping one is accepted", skip, 200);
    const [seatB] = await ctx.db.rows("battle_participants", { battle_id: occ.battleId, user_id: b.id }, { columns: "joined_at, declined_at" });
    ctx.expect.ok("…B is out of this one", !!seatB?.declined_at && !seatB?.joined_at, seatB);
    const [stillOn] = await ctx.db.rows("battles", { id: occ.battleId }, { columns: "status" });
    ctx.expect.eq("…and the battle is still on", stillOn?.status, "scheduled");

    // Learner A opts out of the series: gone from their tab.
    const out = await ctx.http({ as: `@${learners[0].username}`, method: "POST", path: `/api/battle/series/${seriesId}/opt-out`, body: {} });
    ctx.expect.status("opting out is accepted", out, 200);
    const [memA] = await ctx.db.rows("battle_series_members", { series_id: seriesId, user_id: a.id }, { columns: "opted_out_at" });
    ctx.expect.ok("…A is marked out", !!memA?.opted_out_at, memA);
    const cardsA2 = (await ctx.http({ as: `@${learners[0].username}`, path: "/api/battle/my-challenges" })).body?.data || [];
    ctx.expect.ok("…and the series card is gone from A's tab", !cardsA2.some((c) => c.seriesId === seriesId), cardsA2.map((c) => c.id));

    // Only the creator ends it.
    const notYours = await ctx.http({ as: `@${learners[1].username}`, method: "POST", path: `/api/battle/series/${seriesId}/end`, body: {} });
    ctx.expect.status("a learner can't end the teacher's series", notYours, 403);
    const end = await ctx.http({ as: p.instructor, method: "POST", path: `/api/battle/series/${seriesId}/end`, body: {} });
    ctx.expect.status("the teacher ends it", end, 200);
    const [ended] = await ctx.db.rows("battle_series", { id: seriesId }, { columns: "status" });
    const [cancelled] = await ctx.db.rows("battles", { id: occ.battleId }, { columns: "status" });
    const left = await ctx.db.rows("edu.deferred_jobs", { job_key: `series-${seriesId}-${firstStart + 86400_000}` }, { columns: "job_key" });
    ctx.expect.eq("ended; the upcoming one cancelled; nothing left waiting", [ended?.status, cancelled?.status, left.length], ["ended", "cancelled", 0]);
  },
};
