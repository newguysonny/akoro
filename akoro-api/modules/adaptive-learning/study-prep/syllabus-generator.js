/**
 * study-prep/syllabus-generator.js — Grand Plan §8.7 (D30): an AI-drafted
 * outline when no real syllabus exists for a subject + class.
 *
 *   checkOutline(raw, scope)   pure — the code checks a draft must pass
 *   generateOutline(scope)     reuse the provisional outline for this scope, or
 *                              draft one (one metered model call, one retry on
 *                              a failed check), check it, save it
 *   generatedTopics(id)        the topics a session planned against
 *
 * Never the first choice: the harness only calls this after the real
 * syllabus came back empty (`syllabus_exists` otherwise).
 */
import db from "../../../db.js";
import { OPENAI_MODEL, openai } from "../../../lib/aiModel.js";
import { parseJsonLoose } from "../../tasks/tools/_json.js";
import { topicSlug } from "./syllabus-resolver.js";

const edu = () => db.schema("edu");
export const OUTLINE_PROMPT_VERSION = "study-prep-outline-v1";
export const OUTLINE_LIMITS = Object.freeze({ minTopics: 3, maxTopics: 15, minObjectives: 2, maxObjectives: 5, labelMax: 80, objectiveMax: 200 });

const tidy = (v) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const unsafe = (s) => /https?:\/\/|www\.|<[a-z/!]|[*_#`]{2,}|\[[^\]]*\]\(/i.test(s);
export const normaliseClassLevel = (v) => tidy(v).toUpperCase().replace(/\s+/g, "");
export const normaliseSubject = (v) => tidy(v);

/**
 * The checks a draft must pass before it is saved (§8.7): 3–15 topics, no
 * duplicates, each a short label with 2–5 objectives, plain learner-safe text,
 * and — when the draft names them — the requested subject and class.
 * → { ok: true, topics } | { ok: false, errors }
 */
export function checkOutline(raw, { subject, classLevel }) {
  const L = OUTLINE_LIMITS;
  const errors = [];
  const list = Array.isArray(raw?.topics) ? raw.topics : null;
  if (!list) return { ok: false, errors: ["no topics list"] };
  if (raw.subject && tidy(raw.subject).toLowerCase() !== normaliseSubject(subject).toLowerCase()) errors.push(`subject is "${tidy(raw.subject)}", not "${subject}"`);
  if (raw.classLevel && normaliseClassLevel(raw.classLevel) !== normaliseClassLevel(classLevel)) errors.push(`class is "${tidy(raw.classLevel)}", not "${classLevel}"`);
  if (list.length < L.minTopics || list.length > L.maxTopics) errors.push(`${list.length} topics (need ${L.minTopics}-${L.maxTopics})`);
  const seen = new Set();
  const topics = [];
  for (const [i, t] of list.entries()) {
    const label = tidy(t?.label ?? t?.title);
    const objectives = (Array.isArray(t?.objectives) ? t.objectives : []).map(tidy).filter(Boolean);
    if (label.length < 3 || label.length > L.labelMax) { errors.push(`topic ${i + 1}: label must be 3-${L.labelMax} characters`); continue; }
    if (unsafe(label) || objectives.some(unsafe)) { errors.push(`topic ${i + 1}: links or markup are not allowed`); continue; }
    if (objectives.length < L.minObjectives || objectives.length > L.maxObjectives) { errors.push(`"${label}": needs ${L.minObjectives}-${L.maxObjectives} objectives`); continue; }
    if (objectives.some((o) => o.length < 3 || o.length > L.objectiveMax)) { errors.push(`"${label}": an objective is too short or too long`); continue; }
    const id = topicSlug(label);
    if (!id || seen.has(id)) { errors.push(`"${label}" appears twice`); continue; }
    seen.add(id);
    topics.push({ id, label, objectives });
  }
  return errors.length ? { ok: false, errors } : { ok: true, topics };
}

function outlinePrompt({ subject, classLevel, examBoard, goal, fix = null }) {
  return [
    `Draft a study outline for ${classLevel} ${subject} in Nigeria${examBoard ? ` (exam board: ${examBoard})` : ""}.`,
    "Follow the Nigerian national curriculum (NERDC; WAEC/NECO/BECE where relevant) for that class as closely as you can.",
    goal ? `The learner's goal: ${String(goal).slice(0, 300)}` : "",
    `Give ${OUTLINE_LIMITS.minTopics}-${OUTLINE_LIMITS.maxTopics} topics in a sensible teaching order. Each topic: a short label (under ${OUTLINE_LIMITS.labelMax} characters) and ${OUTLINE_LIMITS.minObjectives}-${OUTLINE_LIMITS.maxObjectives} learning objectives a ${classLevel} learner can understand.`,
    "Plain text only: no links, no markdown, no numbering inside labels.",
    fix ? `Your previous draft failed these checks — fix them: ${fix.join("; ")}` : "",
    `Return JSON only: {"subject":"${subject}","classLevel":"${classLevel}","topics":[{"label":"...","objectives":["...","..."]}]}`,
  ].filter(Boolean).join("\n");
}

/** One drafted outline that passed the checks, or throws. Metered to the learner (planning cost). */
export async function draftOutline({ subject, classLevel, examBoard, goal }) {
  let fix = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL, max_tokens: 1800, response_format: { type: "json_object" },
      messages: [{ role: "user", content: outlinePrompt({ subject, classLevel, examBoard, goal, fix }) }],
      __feature: "study_prep_syllabus", __timeoutMs: 45_000, __maxRetries: 1,
    });
    const checked = checkOutline(parseJsonLoose(response.choices?.[0]?.message?.content || ""), { subject, classLevel });
    if (checked.ok) return { topics: checked.topics, model: OPENAI_MODEL };
    fix = checked.errors.slice(0, 6);
  }
  const error = new Error(`The drafted outline failed its checks: ${fix.join("; ")}`);
  error.code = "outline_invalid";
  throw error;
}

async function findProvisional({ subject, classLevel, examBoard }) {
  let q = edu().from("generated_syllabi").select("id, topics").eq("status", "provisional")
    .ilike("subject", normaliseSubject(subject)).ilike("class_level", normaliseClassLevel(classLevel)).is("term", null);
  q = examBoard ? q.eq("exam_board", examBoard) : q.is("exam_board", null);
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Reuse the provisional outline for this scope, else draft, check and save
 * one. → { id, topics, reused }
 */
export async function generateOutline({ subject, classLevel, examBoard = null, goal = null, learnerId = null, draft = draftOutline }) {
  const scope = { subject: normaliseSubject(subject), classLevel: normaliseClassLevel(classLevel), examBoard: examBoard || null };
  const cached = await findProvisional(scope);
  if (cached) return { id: cached.id, topics: cached.topics, reused: true };
  const drafted = await draft({ ...scope, goal });
  const { data, error } = await edu().from("generated_syllabi").insert({
    created_by_learner: learnerId, subject: scope.subject, class_level: scope.classLevel, exam_board: scope.examBoard,
    topics: drafted.topics, grounding: { platformTopics: 0 }, model: drafted.model || null, prompt_version: OUTLINE_PROMPT_VERSION,
  }).select("id, topics").single();
  if (error?.code === "23505") {
    // Another learner drafted the same scope a moment ago — use theirs.
    const again = await findProvisional(scope);
    if (again) return { id: again.id, topics: again.topics, reused: true };
  }
  if (error) throw error;
  return { id: data.id, topics: data.topics, reused: false };
}

/** The topics of a saved outline, shaped like syllabus.resolve's. */
export async function generatedTopics(id) {
  if (!id) return [];
  const { data, error } = await edu().from("generated_syllabi").select("topics").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data?.topics || []).map((t) => ({ id: t.id, label: t.label, objectives: t.objectives || [] }));
}
