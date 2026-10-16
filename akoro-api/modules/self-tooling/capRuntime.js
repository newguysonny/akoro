/**
 * modules/self-tooling/capRuntime.js — capabilities that run here rather than
 * through an existing chat tool (`runtime: true` in capabilities.js). Each one
 * takes the learner's id from the server, never from tool arguments, and
 * applies its own scope rules. Only reachable once the capability is enabled
 * (an admin grant for locked ones), and that is re-checked on every run.
 */
import db from "../../db.js";
import { blockedWith } from "../agent-network/network.js";

const MAX_BATTLES = 30;

export const CAP_RUNNERS = {
  /** Other players' results in battles this learner took part in. */
  async "battles.class_results"(learnerId) {
    const { data: mine, error } = await db.from("battle_participants").select("battle_id")
      .eq("user_id", learnerId).order("joined_at", { ascending: false, nullsFirst: false }).limit(MAX_BATTLES);
    if (error) throw new Error("couldn't read battles");
    const ids = [...new Set((mine || []).map((r) => r.battle_id))];
    if (!ids.length) return { results: [] };
    const [{ data: rows, error: e2 }, { data: battles }, blocked] = await Promise.all([
      db.from("battle_participants").select("battle_id, user_id, score, final_rank, is_winner").in("battle_id", ids).limit(1000),
      db.from("battles").select("id, title, subject").in("id", ids),
      blockedWith(learnerId).catch(() => new Set()),
    ]);
    if (e2) throw new Error("couldn't read battle results");
    const others = [...new Set((rows || []).map((r) => r.user_id).filter((u) => u !== learnerId))];
    const { data: users } = others.length ? await db.from("users").select("id, full_name, username").in("id", others) : { data: [] };
    const name = new Map((users || []).map((u) => [u.id, (u.full_name || "").split(" ")[0] || u.username || "A player"]));
    const battle = new Map((battles || []).map((b) => [b.id, b]));
    return {
      results: (rows || []).filter((r) => r.user_id === learnerId || !blocked.has(r.user_id)).map((r) => ({
        battleTitle: battle.get(r.battle_id)?.title || null, subject: battle.get(r.battle_id)?.subject || null,
        player: r.user_id === learnerId ? "You" : name.get(r.user_id) || "A player",
        score: r.score, rank: r.final_rank, isWinner: r.is_winner, isMe: r.user_id === learnerId,
      })),
    };
  },

  async "verify.probe"() {
    return { checkedAt: new Date().toISOString(), ok: true };
  },
};
