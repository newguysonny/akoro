/** Journey stages — the pure part, kept apart from the db-bound drafts module so it can be tested. */

/** The kinds a journey stage can be. A battle stage is a real battle, created for the same
 *  learners when the journey is assigned. */
export const STAGE_KINDS = Object.freeze(["self_study", "assignment", "project", "battle"]);

/** A journey's stages as the model or the teacher sent them → what the draft keeps. */
export function normalizeStages(list, subject) {
  return (Array.isArray(list) ? list : []).slice(0, 6)
    .map((st, i) => {
      const kind = STAGE_KINDS.includes(st?.kind) ? st.kind : "self_study";
      const out = {
        kind,
        title: String(st?.title || st?.topic || `Stage ${i + 1}`).trim(),
        topic: String(st?.topic || st?.title || "").trim(),
        subject: String(st?.subject || subject || "General").trim(),
      };
      if (kind === "battle") {
        const n = Math.round(Number(st?.questions));
        out.questions = Number.isFinite(n) ? Math.min(20, Math.max(5, n)) : 5;
      }
      return out;
    })
    .filter((st) => st.topic);
}
