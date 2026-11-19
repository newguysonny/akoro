/**
 * lib/conceptResolution.js — subject + topic → an APPROVED catalogue concept.
 *
 * Extracted from adaptive-learning/learner/learning-events.js (Phase 19, S8a)
 * so the question-signal recorder and the event recorder share one lookup
 * without either importing the other's module. Never invents a concept: a
 * topic that matches nothing returns null.
 */
import db from "../db.js";

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** An approved catalogue concept for subject + topic (topic_key, then title). Never invented. */
export async function resolveConceptId({ subject, topic }) {
  const label = clip(topic, 160);
  if (!label) return null;
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  // Two plain filters, not an or() string: a label with a comma broke or() syntax.
  const approved = () => {
    let q = db.schema("edu").from("concept_catalog").select("id").eq("status", "approved");
    if (clip(subject, 80)) q = q.ilike("subject", `%${clip(subject, 80)}%`);
    return q;
  };
  try {
    let { data, error } = await approved().ilike("topic_key", `%${slug}%`).limit(1);
    if (!error && !data?.length) ({ data, error } = await approved().ilike("title", `%${label}%`).limit(1));
    return !error && data?.length ? data[0].id : null;
  } catch { return null; }
}
