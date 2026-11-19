/**
 * adaptive-learning/activityFields.js — the activity's important fields must
 * come from the TEACHER, not the model.
 *
 * Before prepare_activity (and the brief of schedule_activity_routine, and an
 * audience change in revise_activity_draft) runs from the instructor's chat,
 * each field it depends on must be traceable to the teacher's own words in
 * the conversation:
 *
 *   subject    named: the subject, an alias ("maths"), or one of its own words
 *              ("science" for Basic Science) — never inferred from the topic
 *   audience   named: every learner it picks (by username, email or name), or
 *              the class (by its name), or "the whole class" / "everyone"
 *   topic      named: one of its words
 *
 * Anything the teacher didn't say comes back as ONE question for the agent to
 * ask; nothing is prepared until they answer. Battles have no subject.
 */

const GENERIC = new Set(["basic", "general", "language", "studies", "education", "further", "and", "the", "of", "for", "with", "science"]);
const ALIASES = {
  mathematics: ["maths", "math", "mathematics", "mths"],
  "further mathematics": ["further maths", "further math", "further mathematics"],
  "english language": ["english"],
  "basic science": ["basic science", "science", "integrated science", "basic sci"],
  "basic technology": ["basic tech", "basic technology", "technology"],
  "civic education": ["civic", "civics"],
  "social studies": ["social studies", "social"],
  "computer studies": ["computer", "ict", "computing"],
  "christian religious studies": ["crs", "christian religious"],
  "islamic religious studies": ["irs", "islamic"],
  "agricultural science": ["agric", "agriculture", "agricultural"],
  "physical and health education": ["phe", "physical education", "p.e"],
};
const TOPIC_STOP = new Set(["about", "their", "these", "those", "which", "where", "what", "into", "from", "with", "and", "the", "for", "how", "why", "of", "in", "on", "a", "an", "to"]);

const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const squash = (s) => norm(s).replace(/[^a-z0-9]/g, "");
const words = (s) => norm(s).split(/[^a-z0-9@.]+/).filter(Boolean);
const hasWord = (text, w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(norm(text));

/** PURE: did the teacher name this subject? */
export function subjectNamed(subject, text) {
  const s = norm(subject).trim();
  if (!s) return false;
  if (hasWord(text, s)) return true;
  for (const a of ALIASES[s] || []) if (hasWord(text, a)) return true;
  // One of the subject's own distinctive words ("chemistry", "economics", "civic").
  return words(s).some((w) => w.length >= 4 && !GENERIC.has(w) && hasWord(text, w))
    || (s === "basic science" && hasWord(text, "science"));
}

/** PURE: did the teacher name the topic (one of its words, loosely: "fraction" names "Fractions")? */
export function topicNamed(topic, text) {
  const ws = words(topic).filter((w) => w.length >= 4 && !TOPIC_STOP.has(w));
  if (!ws.length) return !!norm(topic).trim() && norm(text).includes(norm(topic).trim());
  const tw = words(text);
  return ws.some((w) => tw.some((t) => t.length >= 4 && (t.startsWith(w.slice(0, 5)) || w.startsWith(t.slice(0, 5)))));
}

/** PURE: did the teacher name one learner (username, email, or their name)? */
function learnerNamed(handle, text, fullName) {
  const h = norm(handle).replace(/^@/, "");
  if (h && (hasWord(text, h) || hasWord(text, `@${h}`))) return true;
  const first = words(fullName)[0];
  return !!fullName && (norm(text).includes(norm(fullName)) || (!!first && first.length >= 3 && hasWord(text, first)));
}

// "My three strongest learners", "a few students": SOME of a class — the class alone doesn't say who.
const SUBSET = /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|a few|few|some|several|a couple of|top|best|strongest|weakest|brightest|fastest|slowest|struggling|selected|certain)\s+(?:(?:best|top|strongest|weakest|brightest|struggling|fastest|slowest|good|bright|selected)\s+)?(?:learners?|students?|pupils?|kids|children)\b/i;
// Said outright: everyone in it.
const EXPLICIT_WHOLE = /\b(whole|entire|full) class\b|\beveryone\b|\ball (of )?((my|the|our) )?(learners|students|pupils|class)\b/i;
const WHOLE_CLASS = /\b(whole|entire|full) class\b|\beveryone\b|\ball (of )?(my|the|our) (learners|students|pupils|class)\b|\ball (the )?(learners|students|pupils)\b|\bthe (whole )?class\b|\bmy class\b/i;

/**
 * PURE: what the teacher didn't name. → [{ field, question }]
 *   input: prepare_activity's input (or a routine's brief, or a revise's { audience })
 *   text:  every message the teacher sent in this conversation
 *   known: { learners: { <handle or id>: full name }, classes: { <id>: name } } — looked up by the caller
 *   check: which fields to check (default all three)
 */
export function unnamedFields(input = {}, text = "", { known = {}, check = ["topic", "subject", "audience"] } = {}) {
  const out = [];
  const topic = String(input.topic || "").trim();
  if (check.includes("topic") && topic && !topicNamed(topic, text)) {
    out.push({ field: "topic", question: "What topic should it cover?" });
  }
  if (check.includes("subject") && input.type !== "battle") {
    const subjects = input.type === "multi_stage" && !input.subject
      ? [...new Set((input.stages || []).map((s) => s?.subject).filter(Boolean))]
      : [input.subject].filter(Boolean);
    // No subject at all is the tool's own question (createActivityDraft asks).
    const unnamed = subjects.filter((s) => !subjectNamed(s, text));
    if (unnamed.length) out.push({ field: "subject", question: `Which subject is ${topic ? `"${topic}"` : "it"} for?` });
  }
  if (check.includes("audience")) {
    const a = input.audience && typeof input.audience === "object" ? input.audience : {};
    const picked = [...(a.usernames || []), ...(a.user_ids || [])];
    let ok;
    if (picked.length) {
      ok = picked.every((raw) => {
        const h = String(raw).replace(/^@/, "");
        return learnerNamed(known.learners?.[h]?.username || h, text, known.learners?.[h]?.name);
      });
    } else if (a.whole_class || a.classroom_name || a.classroom_id) {
      const cls = a.classroom_name || known.classes?.[a.classroom_id] || "";
      ok = (!!cls && squash(text).includes(squash(cls))) || (a.classroom_id && norm(text).includes(norm(a.classroom_id))) || WHOLE_CLASS.test(text);
      // Some of the class was asked for: who, by name — or "the whole class" said outright.
      if (ok && SUBSET.test(text) && !EXPLICIT_WHOLE.test(text)) ok = false;
    } else ok = true;   // no audience at all: the tool's own question
    if (!ok) out.push({ field: "audience", question: "Who is this for — which class, or which learners?" });
  }
  return out;
}

/** PURE: the one question the agent asks for everything unnamed. */
export function askFor(missing) {
  if (!missing.length) return null;
  if (missing.length === 1) return missing[0].question;
  return `Before I prepare it, tell me: ${missing.map((m) => m.question.replace(/\?$/, "").replace(/^./, (c) => c.toLowerCase())).join("; ")}?`;
}

/** The teacher's own words: every user message in the conversation (attachments' notes aside). */
export function teacherTextOf(messages = []) {
  return messages.filter((m) => m?.role === "user").map((m) => (typeof m.content === "string" ? m.content
    : Array.isArray(m.content) ? m.content.filter((p) => p?.type === "text").map((p) => p.text).join(" ") : "")).join("\n");
}

/** The names behind the ids the model picked (learners' handles and names, classes' names). */
export async function knownNames(db, input = {}) {
  const a = input.audience || {};
  const known = { learners: {}, classes: {} };
  const ids = (a.user_ids || []).filter(Boolean);
  const handles = (a.usernames || []).map((u) => String(u).replace(/^@/, "")).filter(Boolean);
  if (ids.length) {
    const { data } = await db.from("users").select("id, username, full_name").in("id", ids);
    for (const u of data || []) known.learners[u.id] = { username: u.username, name: u.full_name };
  }
  if (handles.length) {
    const { data } = await db.from("users").select("username, email, full_name").or(`username.in.(${handles.map((h) => `"${h}"`).join(",")}),email.in.(${handles.map((h) => `"${h}"`).join(",")})`);
    for (const u of data || []) for (const h of handles) if (h === u.username || h === u.email) known.learners[h] = { username: u.username, name: u.full_name };
  }
  if (a.classroom_id) {
    const { data } = await db.from("classrooms").select("id, name").eq("id", a.classroom_id).maybeSingle();
    if (data) known.classes[data.id] = data.name;
  }
  return known;
}

/* ── Which activity the teacher asked for, and the details since they asked ── */

const TYPE_WORDS = [
  ["self_study", /\bself[\s-]?stud(?:y|ies)\b/i],
  ["assignment", /\b(?:assignments?|homework)\b/i],
  ["project", /\bprojects?\b/i],
  ["live_course", /\blive (?:course|class|lesson)s?\b/i],
  ["multi_stage", /\b(?:journeys?|multi[\s-]?stage)\b/i],
  ["battle", /\b(?:battles?|study reviews?|quiz battles?)\b/i],
];
const NEGATED = /\b(?:not|no|instead of|rather than)\s+(?:an?\s+|the\s+)?(?:review\s+|quiz\s+)?(?:self[\s-]?stud(?:y|ies)|assignments?|homework|projects?|live (?:course|class|lesson)s?|journeys?|multi[\s-]?stage|battles?)\b/gi;
export const TYPE_LABEL = { self_study: "self study", assignment: "assignment", project: "project", live_course: "live course", multi_stage: "multi-stage journey", battle: "battle" };

/** PURE: the activity type a message asks for ("Assignment activity not battle" → assignment). → type | null */
export function activityTypeNamed(text) {
  const t = String(text || "").replace(NEGATED, " ");
  let best = null;
  for (const [type, re] of TYPE_WORDS) {
    const m = t.match(re);
    if (m && (best == null || m.index < best.at)) best = { type, at: m.index };
  }
  return best?.type || null;
}

const userText = (m) => (typeof m?.content === "string" ? m.content
  : Array.isArray(m?.content) ? m.content.filter((p) => p?.type === "text").map((p) => p.text).join(" ") : "");

/**
 * PURE: the activity the teacher is asking for now, and what they've said since
 * asking. The details of an EARLIER activity don't carry over to a new one on
 * their own ("let's create an assignment" after a battle on cells is not "an
 * assignment on cells") — unless they say so ("the same topic", "same as before").
 * → { type, text, earlier }   text: the teacher's words since the request; earlier: before it
 */
export function currentRequest(messages = []) {
  const teacher = messages.filter((m) => m?.role === "user");
  for (let i = teacher.length - 1; i >= 0; i--) {
    const type = activityTypeNamed(userText(teacher[i]));
    if (!type) continue;
    const since = teacher.slice(i).map(userText).join("\n");
    const earlier = teacher.slice(0, i).map(userText).join("\n");
    const same = /\b(?:same|as before|as earlier|that one|those)\b/i.test(since);
    return { type, text: same ? `${earlier}\n${since}` : since, earlier };
  }
  return { type: null, text: teacher.map(userText).join("\n"), earlier: "" };
}
