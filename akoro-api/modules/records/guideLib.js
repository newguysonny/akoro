/**
 * modules/records/guideLib.js — "Learning with Guide" in the session reader:
 * the guide teacher (NaNa Esumai, or the learner's chosen guide) teaches the
 * learner directly, from the open document.
 *
 * Grounded the same way as Ask (askLib.js): the document's passages that
 * match the learner's message, numbered, and every claim from the document
 * cites its passage [n] so the chat's chips jump the reader there. Unlike
 * Ask it TEACHES: a short explanation, then one check question; it adapts to
 * what the learner shows, and when the document doesn't cover something it
 * says so before teaching it from general knowledge.
 *
 * Without a document (a plain topic session) it teaches the topic, no
 * citations. Pure — the route does the model call and the saving.
 */
import { ASK_LIMITS, passageWhere } from "./askLib.js";

export const GUIDE_LIMITS = Object.freeze({
  MAX_MESSAGE_CHARS: 2000,
  HISTORY_TURNS: 8,        // learner + guide pairs the model sees
  MAX_TOKENS: 700,
});

const clip = (s, n) => String(s ?? "").slice(0, n);

/** The messages for one guide turn. */
export function buildGuideMessages({
  guideName = "NaNa Esumai", docName = null, topic = null, subject = null, classLevel = null,
  passages = [], message = "", history = [], hasDocument = false,
}) {
  const who = clip(guideName || "NaNa Esumai", 60);
  const about = [subject && `Subject: ${clip(subject, 80)}`, topic && `Topic: ${clip(topic, 160)}`, classLevel && `Class: ${clip(classLevel, 40)}`].filter(Boolean).join(" · ");
  const rules = [
    `You are ${who}, a patient guide teacher in a one-to-one lesson with a school learner. You teach; the learner learns.`,
    "Each reply is ONLY 2–3 short paragraphs and nothing else: (1) explain the one idea plainly in 1–2 sentences, (2) give ONE concrete example — prefer the document's own example, otherwise the learner's everyday world, (3) ask ONE check question — short. No headings, no bullet lists, no preamble like \"Let's start…\" — begin with the substance. Never more than one question per reply.",
    "Adapt: if the learner's answer shows a gap, explain that part again a different way; if they got it, build on it and move to the next idea. Praise effort, briefly.",
    "Never just hand over answers to homework-style questions — guide the learner to work it out, step by step.",
    "Use the learner's language. Write maths with Unicode (x², ½, √, π), never LaTeX.",
    "Return only the final answer in Markdown: no <final> tags or XML/HTML wrappers, no reasoning, no repetition.",
  ];
  if (hasDocument) {
    rules.push(
      `You are teaching from the document "${clip(docName || "this document", 160)}". The numbered passages below are the parts that match what the learner said.`,
      "Teach FROM the passages first: take your explanation's facts from them, in your own plain words, and cite the passage number in square brackets right after each sentence that uses one, e.g. [2]. Every reply that uses the document has at least one citation: the learner's chips jump the reader to that place. Never invent page numbers, quotes or facts and attribute them to the document.",
      "If the document doesn't cover what the learner asks, say so in one short sentence, then teach it from general knowledge (no citation).",
      "If the learner quoted a passage, start from THAT passage.",
      "",
      "Passages:",
      passages.length
        ? passages.map((p) => `[${p.n}] (${passageWhere(p)}${p.pinned ? ", quoted by the learner" : ""})\n${p.text}`).join("\n\n")
        : "(no passages matched this message — teach from what the learner asked, and say the document doesn't seem to cover it)",
      ...(passages.length ? ["", "Remember: cite the passages you teach from, [n] after the sentence."] : []),
    );
  } else {
    rules.push("There is no document in this session: teach the topic from general knowledge, at the learner's level.");
  }
  const system = [about, ...rules].filter(Boolean).join("\n");
  const turns = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant" || m.role === "guide"))
    .slice(-GUIDE_LIMITS.HISTORY_TURNS * 2)
    .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: clip(m.text, 2000) }));
  return [{ role: "system", content: system }, ...turns, { role: "user", content: clip(message, GUIDE_LIMITS.MAX_MESSAGE_CHARS) }];
}

/** A client-sent history for a session without a document (not stored). */
export function cleanGuideHistory(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((m) => m && typeof m.text === "string" && ["user", "guide", "assistant"].includes(m.role))
    .slice(-GUIDE_LIMITS.HISTORY_TURNS * 2)
    .map((m) => ({ role: m.role === "user" ? "user" : "assistant", text: clip(m.text, 2000) }));
}

export { ASK_LIMITS };
