// modules/adaptive-learning/agents/student/mergeKnowledge.js
//
// Combining what a learner knew with what they just showed.
//
// Reinforcement used to REPLACE the stored note:
//
//     .update({ content, confidence: +0.05, times_seen: +1 })
//
// Teach photosynthesis fully on Monday and one aspect of it on Tuesday, and
// Monday's note is gone — while times_seen goes to 2 and confidence goes UP.
// The counters said "reinforced" as the content shrank, which is the worst
// possible pairing: the number that claims the agent knows more is the one
// that fires as it loses what it knew.
//
// Merging is not appending. An unbounded note gets truncated at the 700
// characters the battle prompt slices, so growth silently destroys the tail —
// the same bug wearing a different hat. So: skip what adds nothing, append what
// does, and consolidate with one model call when it gets long.

import { openai } from "../../../../lib/aiModel.js";

/** Past this many characters a note is consolidated rather than appended to. */
const CAP = 1200;

/** Words that carry no signal when comparing two statements. */
const STOP = new Set("the a an and or of to in is are was were it its this that for on at as with by be been being do does did".split(" "));

const tokens = (s) => new Set(
  String(s ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
);

/**
 * How much of the NEW statement is already covered by the old one.
 *
 * Asymmetric on purpose: "is this new thing already said" is the question, and
 * Jaccard would answer a different one — a two-word addition to a long note
 * scores low on Jaccard while being entirely contained.
 */
export function coverage(existing, incoming) {
  const a = tokens(existing), b = tokens(incoming);
  if (!b.size) return 1;
  let hit = 0;
  for (const w of b) if (a.has(w)) hit++;
  return hit / b.size;
}

/**
 * Merge new content into an existing note.
 *
 * @returns {{ content: string, action: 'unchanged'|'appended'|'consolidated' }}
 */
export async function mergeKnowledge(existing, incoming, { model = "gpt-4o-mini", userId = null } = {}) {
  const old = String(existing ?? "").trim();
  const add = String(incoming ?? "").trim();

  if (!add) return { content: old, action: "unchanged" };
  if (!old) return { content: add, action: "appended" };

  // Already said. Teaching the same thing twice is common and should move the
  // counters without touching the text — rewording a note the learner recognises
  // is a small betrayal of the thing being theirs.
  if (coverage(old, add) >= 0.85) return { content: old, action: "unchanged" };

  const joined = `${old} ${add}`;
  if (joined.length <= CAP) return { content: joined, action: "appended" };

  // Long enough to need consolidating. One call, and it must LOSE NOTHING —
  // the whole point of this file is that facts stopped disappearing.
  try {
    const resp = await openai.chat.completions.create({
      model, max_tokens: 400, temperature: 0,
      __feature: "knowledge_merge", __userId: userId,
      messages: [
        {
          role: "system",
          content:
            "You consolidate a student's own study notes on one topic. Keep EVERY distinct fact from both " +
            "versions — you may reorder, deduplicate and tighten the wording, but you may not drop " +
            "information or add any. Do not correct mistakes: if the notes say something wrong, that is what " +
            "the student believes and it must survive. Reply with the consolidated note only, no preamble.",
        },
        { role: "user", content: `EXISTING NOTE:\n${old}\n\nNEWLY LEARNED:\n${add}` },
      ],
    });
    const merged = resp.choices?.[0]?.message?.content?.trim();
    // A "consolidation" shorter than the new material alone has plainly lost
    // something. Keeping the concatenation over-length beats keeping a summary
    // that quietly deleted half the topic.
    if (merged && merged.length >= Math.max(add.length, old.length * 0.5)) {
      return { content: merged, action: "consolidated" };
    }
    return { content: joined.slice(0, CAP * 2), action: "appended" };
  } catch (e) {
    console.warn("[knowledge/merge] consolidation failed, keeping both:", e.message);
    return { content: joined.slice(0, CAP * 2), action: "appended" };
  }
}
