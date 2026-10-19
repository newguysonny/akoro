/**
 * modules/materials/stepsCore.js — an upload's steps as the chat shows them
 * (2026-10-19): for each step, a tool row (what the protégé did, what it
 * found, how long) and a short message to the learner. PURE — no db, no
 * model call, no clock (`at` is passed in). Every line is written by code
 * from what the step really returned, so it costs nothing and never invents.
 *
 *   sortSteps()     the files sorted (subject + kind each)
 *   folderSteps()   where each group goes: a folder they have, a new one, two to pick from, or none yet
 *   filedSteps()    the files put in their folder (+ Undo, once per message)
 *   readSteps()     each file read into topics (+ a past paper's questions); a move after reading
 *   similarSteps()  Akoro material on its topics
 *   appendSteps()   merged in, by id, the newest STEP_LIMIT kept
 */
import { kindLabel } from "./ingestCore.js";

export const STEP_LIMIT = 40;
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const many = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const list = (items) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

export function toolStep(id, tool, headline, { result = "", ms = null, ok = true, at = null } = {}) {
  return { id: clip(id, 80), type: "tool", tool, headline: clip(headline, 120), result: clip(result, 200), ms: Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : null, ok: ok !== false, at };
}
export function messageStep(id, text, { at = null } = {}) {
  return { id: clip(id, 80), type: "message", text: clip(text, 600), at };
}

/** "a Biology past paper", "Biology notes", "notes (subject not clear yet)". */
export function describeFile({ subject = null, kind = "other" } = {}) {
  const label = kindLabel(kind).toLowerCase();
  const singular = { "past papers": "past paper", slides: "slides", notes: "notes", textbook: "textbook", syllabus: "syllabus", materials: "material" }[label] || label;
  const article = ["past paper", "textbook", "syllabus"].includes(singular) ? "a " : "";
  return subject ? `${article}${clip(subject, 40)} ${singular}` : `${singular} (subject not clear yet)`;
}

/** The files sorted. files: [{ subject, kind }] in the message's order. */
export function sortSteps({ batchId, files = [], ms = null, at = null }) {
  const described = [...new Set(files.map(describeFile))];
  const n = files.length;
  return [
    toolStep(`sort:${batchId}`, "material.classify", n === 1 ? "Sorting your file" : "Sorting your files", { result: described.join(" · "), ms, at }),
    messageStep(`sort:${batchId}:say`, n === 1
      ? `It's **${described[0]}**. I'll file it in your own folders.`
      : `${many(n, "file")}: ${list(described.map((d) => `**${d}**`))}. I'll file them in your own folders.`, { at }),
  ];
}

/**
 * Where each group goes. groups: [{ subject, kind, folderName, created, choices, names }].
 */
export function folderSteps({ batchId, groups = [], ms = null, at = null }) {
  const found = [];
  const said = [];
  for (const g of groups) {
    const what = kindLabel(g.kind).toLowerCase();
    if (g.folderName && !g.created) { found.push(`${clip(g.folderName, 60)} exists`); said.push(`you already have **${clip(g.folderName, 60)}**, so the ${what} go there`); }
    else if (g.folderName && g.created) { found.push(`new: ${clip(g.folderName, 60)}`); said.push(`I've made **${clip(g.folderName, 60)}** for the ${what}`); }
    else if (Array.isArray(g.choices) && g.choices.length > 1) { found.push(`${g.choices.length} folders fit`); said.push(`two of your folders fit the ${g.subject ? `${clip(g.subject, 40)} ` : ""}${what} — pick one on the card`); }
    else { found.push("subject not clear yet"); said.push(`I can't tell the subject of ${g.names?.length === 1 ? `**${clip(g.names[0], 60)}**` : "some of them"} from the name — I'll read ${g.names?.length === 1 ? "it" : "them"} first`); }
  }
  const text = said.join("; ");
  return [
    toolStep(`folders:${batchId}`, "material.folders", "Checking your folders", { result: found.join(" · "), ms, at }),
    messageStep(`folders:${batchId}:say`, text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : "", { at }),
  ].filter((s) => s.type !== "message" || s.text);
}

/** The files put in their folder. first: this upload holds the message's first file (Undo is said once). */
export function filedSteps({ ingestId, folderName = null, ms = null, first = false, at = null }) {
  return [
    toolStep(`filed:${ingestId}`, "material.file", folderName ? `Filing into ${clip(folderName, 80)}` : "Saving to your Library", { ms, at }),
    ...(first ? [messageStep(`filed:${ingestId}:say`, `Filed${folderName ? ` in **${clip(folderName, 80)}**` : ""}. Undo on the card puts it in Recently deleted for 30 days. Now I'll read it.`, { at })] : []),
  ];
}

/** "8 topics · 50 questions" for one read file. */
export function readResult(item) {
  const topics = item?.topics?.length || 0;
  if (!topics) return "No clear topics";
  const qs = Number(item?.questionCount) || 0;
  return qs ? `${many(topics, "topic")} · ${many(qs, "question")}` : many(topics, "topic");
}

/**
 * Each file read. items: [{ recordId, name, title, kind, topics:[{name,weight}], questionCount, ms }]
 * moved: { to, subject } when reading moved it to another folder.
 */
export function readSteps({ ingestId, items = [], moved = null, at = null }) {
  const steps = [];
  for (const it of items) {
    const label = clip(it.title || it.name || "your file", 80);
    steps.push(toolStep(`read:${ingestId}:${it.recordId}`, "material.read", `Reading ${label}`, { result: readResult(it), ms: it.ms ?? null, ok: it.ok !== false, at }));
    const top = [...(it.topics || [])].sort((a, b) => (b.weight || 0) - (a.weight || 0)).slice(0, 3).map((t) => `**${clip(t.name, 50)}**`);
    if (top.length) {
      steps.push(messageStep(`read:${ingestId}:${it.recordId}:say`, it.questionCount
        ? `${label} tests ${many(it.topics.length, "topic")} in ${many(it.questionCount, "question")}; the most tested: ${list(top)}.`
        : `${label} covers ${list(top)}${it.topics.length > 3 ? ` and ${it.topics.length - 3} more` : ""}.`, { at }));
    }
  }
  if (moved?.to) {
    steps.push(toolStep(`moved:${ingestId}`, "material.file", `Moving it to ${clip(moved.to, 80)}`, { result: moved.subject ? `it's ${clip(moved.subject, 40)}` : "", at }));
  }
  return steps;
}

/** Akoro material on its topics. candidates: shapeCandidates() output. */
export function similarSteps({ ingestId, candidates = [], folderName = null, ms = null, at = null }) {
  const courses = candidates.filter((c) => c.kind === "course").length;
  const posts = candidates.filter((c) => c.kind === "blog").length;
  const result = candidates.length ? [courses ? many(courses, "course") : null, posts ? many(posts, "blog post") : null].filter(Boolean).join(" · ") : "Nothing matching yet";
  return [
    toolStep(`similar:${ingestId}`, "material.similar", "Finding similar Akoro material", { result, ms, at }),
    messageStep(`similar:${ingestId}:say`, candidates.length
      ? `I found ${many(candidates.length, "piece")} on Akoro that match its topics. Tick what should go in ${folderName ? `**${clip(folderName, 80)}**` : "the folder"}.`
      : "Nothing on Akoro matches its topics yet — I'll keep it as it is.", { at }),
  ];
}

/** Merge new steps in (same id → replaced), the newest STEP_LIMIT kept. */
export function appendSteps(existing = [], add = []) {
  const out = (Array.isArray(existing) ? existing : []).filter((s) => !add.some((a) => a.id === s.id));
  return [...out, ...add].slice(-STEP_LIMIT);
}
