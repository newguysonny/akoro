/**
 * modules/school/learnerStruggles.js — what a school sees of its learners'
 * struggles (Grand Plan D39, §7.15, Phase 11).
 *
 *   GET /api/school/mgmt/learning/struggles[?class_id=]
 *       class totals and, per learner, the non-sensitive struggles (type,
 *       topic, open/resolved, what worked) of students LINKED to the school
 *       (mgmt.students.user_id). Sensitive types never show here: a learner
 *       with 2+ open sensitive struggles in 14 days carries a neutral
 *       "may need support" flag instead.
 *   GET /api/school/mgmt/learning/struggles/:studentId/support
 *       opens that flag: the sensitive types, topics and dates. Every opening
 *       is logged first (who, when, which learner) — no log, no detail.
 *
 * Who: the school admin sees every class; an approved teacher sees only the
 * classes they teach — all subjects as the class teacher (mgmt.class_teachers),
 * their own subjects as a subject teacher (mgmt.class_subjects). Anyone else
 * is refused. Nothing is ever returned about a student without a linked
 * account, or about a learner outside the school.
 *
 * Sources: edu.learning_struggles when it exists (the recorder, §7.13.1), plus
 * rule types derived from edu.learner_concept_evidence (misconception,
 * partial understanding, decay, retest failure) — the evidence every workflow
 * already writes. A recorded struggle wins over a derived one of the same
 * learner, type and concept.
 */
import { Router } from "express";
import db from "../../db.js";
import { STRUGGLE_CATEGORIES, STRUGGLE_TYPES_VERSION, struggleType, HEALTH_EXPIRY_DAYS } from "../adaptive-learning/learner/struggleTypes.js";

export const SUPPORT_FLAG = Object.freeze({ minOpen: 2, windowDays: 14 });
export const SCHOOL_ROLES = Object.freeze(["school", "school_admin", "admin"]);
export const STRUGGLE_VIEW_ROLES = Object.freeze([...SCHOOL_ROLES, "instructor"]);
const DAY = 86_400_000;
const EVIDENCE_DAYS = 180;
const RESOLVED_SHOWN_DAYS = 30;
const PASS = 0.5;
const MISSING_TABLE = new Set(["42P01", "PGRST205", "PGRST200"]);
const clip = (s, n) => (s == null ? null : String(s).replace(/\s+/g, " ").trim().slice(0, n) || null);
const iso = (t) => (t ? new Date(t).toISOString() : null);
const lower = (s) => String(s || "").trim().toLowerCase();

/* ── Pure core ───────────────────────────────────────────────────────────── */

/**
 * Rule-type struggles from concept evidence. Per learner and concept, in time
 * order, the latest episode of each type: { learnerId, conceptId, type,
 * status: open|resolved, detectedAt, resolvedAt, detectedBy: "rule", source: "evidence" }.
 */
export function deriveEvidenceStruggles(evidence = []) {
  const byPair = new Map();
  for (const e of evidence) {
    if (!e?.learner_id || !e?.concept_id) continue;
    const key = `${e.learner_id}|${e.concept_id}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(e);
  }
  const out = [];
  for (const rows of byPair.values()) {
    rows.sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
    const latest = new Map();          // type → episode
    const open = (type, at) => { const cur = latest.get(type); if (!cur || cur.status === "resolved") latest.set(type, { type, status: "open", detectedAt: at, resolvedAt: null }); };
    const resolve = (type, at) => { const cur = latest.get(type); if (cur?.status === "open") Object.assign(cur, { status: "resolved", resolvedAt: at }); };
    let knewIt = false; let passedCheck = false;
    for (const e of rows) {
      const at = iso(e.observed_at);
      const q = Number(e.response_quality);
      switch (e.observation_kind) {
        case "misconception_detected": open("misconception", at); break;
        case "misconception_cleared": resolve("misconception", at); break;
        case "partial_understanding": open("partial_understanding", at); break;
        case "demonstrated_understanding": resolve("partial_understanding", at); knewIt = true; break;
        case "recall_success": resolve("decay", at); knewIt = true; break;
        case "recall_gap": if (knewIt) open("decay", at); break;
        case "assessment_result":
          if (q >= PASS) { resolve("retest_failure", at); passedCheck = true; } else if (passedCheck) open("retest_failure", at);
          break;
        default: break;
      }
    }
    for (const ep of latest.values()) out.push({ learnerId: rows[0].learner_id, conceptId: rows[0].concept_id, ...ep, detectedBy: "rule", source: "evidence" });
  }
  return out;
}

/** edu.learning_struggles rows → the same shape. Off-list types, abandoned and expired ones drop. */
export function normaliseRecorded(rows = [], now = Date.now()) {
  const out = [];
  for (const r of rows) {
    const def = struggleType(r?.struggle_type);
    if (!def || !r.learner_id) continue;
    if (!["open", "resolved"].includes(r.status)) continue;
    if (r.expires_at && Date.parse(r.expires_at) <= now) continue;
    if (r.struggle_type === "health_energy" && Date.parse(r.detected_at) <= now - HEALTH_EXPIRY_DAYS * DAY) continue;
    const sensitive = def.sensitive || r.sensitive === true;
    out.push({
      learnerId: r.learner_id, conceptId: r.concept_id || null, type: def.id, status: r.status,
      detectedAt: iso(r.detected_at), resolvedAt: iso(r.resolved_at), detectedBy: r.detected_by || null, source: "recorded",
      subject: r.subject || null, topic: clip(r.topic_label, 120),
      // Sensitive types are type + date (+ concept) only (§7.15.2): no summary, no "what worked".
      ...(sensitive ? { sensitive: true } : {
        summary: clip(r.struggle_summary, 200), whatWorked: clip(r.what_worked, 300), whatWorkedStrategy: clip(r.what_worked_strategy, 60),
      }),
    });
  }
  return out;
}

/** Recorded first; a derived struggle of the same learner, type and concept is dropped. */
export function mergeStruggles(recorded = [], derived = []) {
  const seen = new Set(recorded.map((s) => `${s.learnerId}|${s.type}|${s.conceptId || ""}`));
  return [...recorded, ...derived.filter((s) => !seen.has(`${s.learnerId}|${s.type}|${s.conceptId || ""}`))];
}

/** A learner's support flag: 2+ open sensitive struggles detected in the last 14 days → { open }, else null. */
export function supportFlag(struggles = [], now = Date.now()) {
  const since = now - SUPPORT_FLAG.windowDays * DAY;
  const open = struggles.filter((s) => struggleType(s.type)?.sensitive && s.status === "open" && Date.parse(s.detectedAt) >= since).length;
  return open >= SUPPORT_FLAG.minOpen ? { open } : null;
}

/** May the viewer see this struggle in this class? scope: null = everything; Map<classId, Set<subject>|null>. */
export function inScope(scope, classId, subject) {
  if (scope == null) return true;
  if (!scope.has(classId)) return false;
  const subjects = scope.get(classId);
  if (subjects == null) return true;                       // the class teacher: every subject
  return !!subject && subjects.has(lower(subject));        // a subject teacher: only theirs (unknown → hidden)
}

const itemOf = (s, concepts) => {
  const def = struggleType(s.type);
  const concept = s.conceptId ? concepts.get(s.conceptId) : null;
  return {
    type: def.id, label: def.label, category: def.category,
    topic: s.topic || concept?.title || null, subject: s.subject || concept?.subject || null,
    status: s.status, detectedAt: s.detectedAt, resolvedAt: s.resolvedAt,
    ...(s.whatWorked ? { whatWorked: s.whatWorked } : {}), ...(s.whatWorkedStrategy ? { whatWorkedStrategy: s.whatWorkedStrategy } : {}),
    source: s.source,
  };
};

/**
 * The dashboard view. students: mgmt.students rows (id, user_id, class_id,
 * first_name, last_name); classes: mgmt.classes (id, name); struggles: merged;
 * concepts: Map<conceptId, { title, subject }>; scope as inScope.
 * → { version, classes[], learners[] } — learners with nothing to show are left out.
 */
export function buildStruggleView({ students = [], classes = [], struggles = [], concepts = new Map(), scope = null, now = Date.now() }) {
  const classById = new Map(classes.map((c) => [c.id, c]));
  const linked = students.filter((s) => s.user_id && classById.has(s.class_id));
  const studentByUser = new Map(linked.map((s) => [s.user_id, s]));
  const byLearner = new Map();
  for (const s of struggles) {
    const student = studentByUser.get(s.learnerId);
    if (!student || !struggleType(s.type)) continue;        // never a learner the school isn't linked to
    const subject = s.subject || (s.conceptId ? concepts.get(s.conceptId)?.subject : null);
    if (!inScope(scope, student.class_id, subject)) continue;
    if (!byLearner.has(student.id)) byLearner.set(student.id, []);
    byLearner.get(student.id).push(s);
  }

  const resolvedSince = now - RESOLVED_SHOWN_DAYS * DAY;
  const learners = [];
  const totals = new Map(classes.map((c) => [c.id, {
    classId: c.id, name: c.name || null,
    linked: 0, unlinked: 0, learnersStruggling: 0, open: 0, resolved: 0, mayNeedSupport: 0, sensitiveOpen: 0,
    byCategory: new Map(), byType: new Map(), byTopic: new Map(),
  }]));
  for (const st of students) {
    const t = totals.get(st.class_id);
    if (t) { if (st.user_id) t.linked += 1; else t.unlinked += 1; }
  }

  for (const student of linked) {
    const list = byLearner.get(student.id) || [];
    const t = totals.get(student.class_id);
    const shown = list.filter((s) => !struggleType(s.type).sensitive);
    const flag = supportFlag(list, now);
    const open = shown.filter((s) => s.status === "open").map((s) => itemOf(s, concepts))
      .sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt));
    const resolved = shown.filter((s) => s.status === "resolved" && Date.parse(s.resolvedAt) >= resolvedSince).map((s) => itemOf(s, concepts))
      .sort((a, b) => Date.parse(b.resolvedAt) - Date.parse(a.resolvedAt)).slice(0, 5);
    for (const s of shown) {
      if (s.status === "open") {
        t.open += 1;
        const def = struggleType(s.type);
        t.byCategory.set(def.category, (t.byCategory.get(def.category) || 0) + 1);
        const ty = t.byType.get(def.id) || { type: def.id, label: def.label, category: def.category, open: 0, learners: new Set() };
        ty.open += 1; ty.learners.add(student.id); t.byType.set(def.id, ty);
        const topic = itemOf(s, concepts).topic;
        if (topic) { const tp = t.byTopic.get(topic) || { topic, open: 0, learners: new Set() }; tp.open += 1; tp.learners.add(student.id); t.byTopic.set(topic, tp); }
      } else if (s.status === "resolved") t.resolved += 1;
    }
    if (open.length) t.learnersStruggling += 1;
    if (flag) t.mayNeedSupport += 1;
    // Sensitive struggles are counted for the class, never described (no type, topic or learner).
    t.sensitiveOpen += list.filter((s) => s.status === "open" && struggleType(s.type).sensitive).length;
    if (!open.length && !resolved.length && !flag) continue;  // healthy takes no space
    learners.push({
      studentId: student.id, name: [student.first_name, student.last_name].filter(Boolean).join(" ") || null,
      classId: student.class_id, className: classById.get(student.class_id)?.name || null,
      open, resolved, supportFlag: flag ? { mayNeedSupport: true } : null,
    });
  }
  learners.sort((a, b) => (b.supportFlag ? 1 : 0) - (a.supportFlag ? 1 : 0) || b.open.length - a.open.length || String(a.name).localeCompare(String(b.name)));

  const top = (m, n) => [...m.values()].map((x) => ({ ...x, learners: x.learners.size })).sort((a, b) => b.learners - a.learners || b.open - a.open).slice(0, n);
  return {
    version: STRUGGLE_TYPES_VERSION,
    classes: [...totals.values()].map((t) => ({
      classId: t.classId, name: t.name, linked: t.linked, unlinked: t.unlinked,
      learnersStruggling: t.learnersStruggling, open: t.open, resolved: t.resolved, mayNeedSupport: t.mayNeedSupport, sensitiveOpen: t.sensitiveOpen,
      byCategory: Object.keys(STRUGGLE_CATEGORIES).filter((c) => t.byCategory.get(c)).map((c) => ({ category: c, label: STRUGGLE_CATEGORIES[c], open: t.byCategory.get(c) })),
      topTypes: top(t.byType, 5), topTopics: top(t.byTopic, 5),
    })),
    learners,
  };
}

/** The flag opened: sensitive types, topics and dates only (§7.15.2). */
export function supportDetail(struggles = [], concepts = new Map()) {
  return struggles.filter((s) => struggleType(s.type)?.sensitive && s.status === "open").map((s) => {
    const def = struggleType(s.type);
    const concept = s.conceptId ? concepts.get(s.conceptId) : null;
    return { type: def.id, label: def.label, topic: s.topic || concept?.title || null, detectedAt: s.detectedAt };
  }).sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt));
}

/* ── Data ────────────────────────────────────────────────────────────────── */

const M = () => db.schema("mgmt");
const E = () => db.schema("edu");
const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data || []; };

/** null (every class) for a school admin; else the teacher's classes → subjects (null = all). */
export async function viewerScope(schoolId, viewer) {
  if (SCHOOL_ROLES.includes(viewer.role)) return null;
  const [cs, ct] = await Promise.all([
    M().from("class_subjects").select("class_id, subject_id").eq("school_id", schoolId).eq("teacher_id", viewer.id),
    M().from("class_teachers").select("class_id").eq("school_id", schoolId).eq("teacher_id", viewer.id),
  ]);
  const subjectsRows = must(cs, "class_subjects");
  const scope = new Map();
  for (const r of must(ct, "class_teachers")) scope.set(r.class_id, null);
  const subjectIds = [...new Set(subjectsRows.map((r) => r.subject_id).filter(Boolean))];
  const names = new Map();
  if (subjectIds.length) {
    for (const s of must(await M().from("subjects").select("id, name, code").eq("school_id", schoolId).in("id", subjectIds), "subjects")) {
      names.set(s.id, [s.name, s.code].filter(Boolean).map(lower));
    }
  }
  for (const r of subjectsRows) {
    if (scope.has(r.class_id) && scope.get(r.class_id) === null) continue;
    const set = scope.get(r.class_id) || new Set();
    for (const n of names.get(r.subject_id) || []) set.add(n);
    scope.set(r.class_id, set);
  }
  return scope;
}

async function recordedStruggles(learnerIds) {
  const { data, error } = await E().from("learning_struggles")
    .select("learner_id, struggle_type, category, subject, concept_id, topic_label, detected_by, detected_at, status, struggle_summary, what_worked, what_worked_strategy, resolved_at, sensitive, expires_at")
    .in("learner_id", learnerIds).in("status", ["open", "resolved"]).limit(5000);
  if (error) {
    if (MISSING_TABLE.has(error.code) || /does not exist|schema cache/i.test(error.message || "")) return [];  // the recorder isn't deployed yet
    throw new Error(`learning_struggles: ${error.message}`);
  }
  return data || [];
}

/** Everything the view needs, school- and scope-bounded. → { scope, classes, students, struggles, concepts } */
export async function loadStruggles({ schoolId, viewer, classId = null, now = Date.now() }) {
  const scope = await viewerScope(schoolId, viewer);
  let classes = must(await M().from("classes").select("id, name").eq("school_id", schoolId), "classes");
  if (scope) classes = classes.filter((c) => scope.has(c.id));
  if (classId) classes = classes.filter((c) => c.id === classId);
  const classIds = classes.map((c) => c.id);
  if (!classIds.length) return { scope, classes, students: [], struggles: [], concepts: new Map() };
  const students = must(await M().from("students").select("id, user_id, class_id, first_name, last_name")
    .eq("school_id", schoolId).eq("status", "active").in("class_id", classIds), "students");
  const learnerIds = [...new Set(students.map((s) => s.user_id).filter(Boolean))];
  if (!learnerIds.length) return { scope, classes, students, struggles: [], concepts: new Map() };

  const since = new Date(now - EVIDENCE_DAYS * DAY).toISOString();
  const [evidence, recordedRows] = await Promise.all([
    E().from("learner_concept_evidence").select("learner_id, concept_id, observation_kind, response_quality, observed_at")
      .in("learner_id", learnerIds).gte("observed_at", since).order("observed_at", { ascending: true }).limit(10000)
      .then((r) => must(r, "learner_concept_evidence")),
    recordedStruggles(learnerIds),
  ]);
  const struggles = mergeStruggles(normaliseRecorded(recordedRows, now), deriveEvidenceStruggles(evidence));
  const conceptIds = [...new Set(struggles.map((s) => s.conceptId).filter(Boolean))];
  const concepts = new Map();
  if (conceptIds.length) {
    for (const c of must(await E().from("concept_catalog").select("id, title, subject").in("id", conceptIds), "concept_catalog")) {
      concepts.set(c.id, { title: c.title, subject: c.subject });
    }
  }
  return { scope, classes, students, struggles, concepts };
}

/* ── Routes ──────────────────────────────────────────────────────────────── */

/**
 * getMySchool(req, res) → { id, name } or null (it has answered 404);
 * authenticate: the auth middleware (tests pass their own).
 */
export function createStrugglesRouter({ getMySchool, authenticate }) {
  const router = Router();
  const allowed = (req, res, next) => (STRUGGLE_VIEW_ROLES.includes(req.user?.role) ? next() : res.status(403).json({ error: "Not permitted" }));

  router.get("/struggles", authenticate, allowed, async (req, res) => {
    try {
      const school = await getMySchool(req, res);
      if (!school) return;
      const classId = req.query.class_id ? String(req.query.class_id) : null;
      const data = await loadStruggles({ schoolId: school.id, viewer: { id: req.user.id, role: req.user.role }, classId });
      if (classId && !data.classes.length) return res.status(403).json({ error: "You don't teach this class" });
      res.set("Cache-Control", "private, no-store");
      res.json({ success: true, data: { ...buildStruggleView(data), teaches: data.scope == null || data.scope.size > 0 } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get("/struggles/:studentId/support", authenticate, allowed, async (req, res) => {
    try {
      const school = await getMySchool(req, res);
      if (!school) return;
      const viewer = { id: req.user.id, role: req.user.role };
      const { data: student, error } = await M().from("students").select("id, user_id, class_id, first_name, last_name")
        .eq("id", req.params.studentId).eq("school_id", school.id).eq("status", "active").maybeSingle();
      if (error) throw new Error(error.message);
      if (!student?.user_id) return res.status(404).json({ error: "Learner not found" });
      const data = await loadStruggles({ schoolId: school.id, viewer, classId: student.class_id });
      if (!data.classes.length) return res.status(404).json({ error: "Learner not found" });
      // A subject teacher's flag counts only what their scope shows; the detail follows the same scope.
      const mine = data.struggles.filter((s) => s.learnerId === student.user_id
        && inScope(data.scope, student.class_id, s.subject || (s.conceptId ? data.concepts.get(s.conceptId)?.subject : null)));
      if (!supportFlag(mine)) return res.status(404).json({ error: "No support flag for this learner" });
      const detail = supportDetail(mine, data.concepts);
      // Logged before it is shown: if the log fails, nothing is shown.
      const { error: logError } = await M().from("struggle_support_views").insert({
        school_id: school.id, viewer_user_id: viewer.id, viewer_role: viewer.role, student_id: student.id,
        types: [...new Set(detail.map((d) => d.type))],
      });
      if (logError) throw new Error(`access log: ${logError.message}`);
      res.set("Cache-Control", "private, no-store");
      res.json({ success: true, data: { studentId: student.id, name: [student.first_name, student.last_name].filter(Boolean).join(" "), struggles: detail } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}
