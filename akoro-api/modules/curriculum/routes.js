/**
 * curriculum/routes.js — the curriculum bank (NERDC and the bodies after it).
 *
 * Mounted at /api/curriculum.
 *
 * Reading is open to any signed-in user and returns PUBLISHED curricula only.
 * Writing is admin only — this is the national curriculum, quoted back to
 * teachers as authority, so it is not editable by whoever happens to be logged
 * in.
 *
 * WHY ITS OWN MODULE, next to syllabus and past questions: the three answer
 * different questions and a tutor wants different ones at different moments.
 *   syllabus       — what the exam will test
 *   past questions — how it has actually been examined
 *   curriculum     — what the class is supposed to be taught, and how
 * Retrieval is deliberately identical in shape across all three, so grounding
 * one is grounding any of them.
 */
import { Router } from "express";
import multer from "multer";
import db from "../../db.js";
import { openai } from "../../lib/aiModel.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { embed } from "../adaptive-learning/syllabus.js";
import { embedForSearch } from "../../lib/searchEmbedding.js";
import { renderPdfToImages } from "../adaptive-learning/pdfRender.js";
import { serverError } from "../../lib/httpError.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } }).single("file");

const T_COLS = "id, title, class_label, performance_objectives, content, teacher_activities, student_activities, materials, evaluation, periods, detailed, source_page, subtheme_id, sort_order";

/* ══════════════════════ Read ══════════════════════ */

// GET /api/curriculum/bodies — the catalog, with what's actually in it.
router.get("/bodies", authenticateToken, async (req, res) => {
  try {
    const { data: bodies } = await db.schema("edu").from("curriculum_bodies")
      .select("*").eq("is_active", true).order("sort_order");
    const { data: docs } = await db.schema("edu").from("curricula")
      .select("body_slug, subject").eq("status", "published");

    const byBody = {};
    for (const d of docs || []) {
      (byBody[d.body_slug] ||= { count: 0, subjects: new Set() });
      byBody[d.body_slug].count++;
      if (d.subject) byBody[d.body_slug].subjects.add(d.subject);
    }
    res.json({
      success: true,
      data: (bodies || []).map((b) => ({
        ...b,
        curriculumCount: byBody[b.slug]?.count || 0,
        subjects: [...(byBody[b.slug]?.subjects || [])].sort(),
      })),
    });
  } catch (e) { serverError(res, e, req); }
});

// GET /api/curriculum?body=&subject=&stage=&class=
router.get("/", authenticateToken, async (req, res) => {
  try {
    let q = db.schema("edu").from("curricula")
      .select("id, body_slug, title, subject, edition_year, stage, classes, page_count, status")
      .order("edition_year", { ascending: false }).order("title");
    if (req.user.role !== "admin") q = q.eq("status", "published");
    else if (req.query.status) q = q.eq("status", req.query.status);
    if (req.query.body) q = q.eq("body_slug", req.query.body);
    if (req.query.subject) q = q.ilike("subject", req.query.subject);
    if (req.query.stage) q = q.eq("stage", req.query.stage);
    if (req.query.class) q = q.contains("classes", [req.query.class]);

    const { data, error } = await q;
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (e) { serverError(res, e, req); }
});

// GET /api/curriculum/topics?subject=&class= — a flat, picker-ready list of
// syllabus topics for one subject (what a "choose a topic" dropdown needs):
// each topic carries its content points (subtopics / concepts) and its
// performance objectives, so choosing one can fill a whole lesson outline.
// With ?class= it keeps that class's topics; when the class has none (or the
// label is spelled differently in the document) it returns the subject's
// topics for every class instead, flagged matchedClass:false, so the picker
// is never empty just because of a label.
const SUBJECT_ALIASES = {
  science:     ["Science", "Basic Science", "Integrated Science", "Basic Science and Technology", "Primary Science"],
  maths:       ["Maths", "Mathematics"],
  mathematics: ["Mathematics", "Maths"],
  english:     ["English", "English Language", "English Studies"],
};
const classKey = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
router.get("/topics", authenticateToken, async (req, res) => {
  try {
    const subject = String(req.query.subject || "").trim();
    if (!subject) return res.status(400).json({ error: "subject is required" });
    const names = [...new Set([subject, ...(SUBJECT_ALIASES[subject.toLowerCase()] || [])])]
      .map((n) => n.replace(/[^A-Za-z0-9 &'-]/g, "")).filter(Boolean);

    const { data: docs, error: dErr } = await db.schema("edu").from("curricula")
      .select("id").eq("status", "published")
      .or(names.map((n) => `subject.ilike.${n}`).join(","));
    if (dErr) throw dErr;
    const ids = (docs || []).map((d) => d.id);
    if (!ids.length) return res.json({ success: true, data: [], matchedClass: false });

    const { data: rows, error } = await db.schema("edu").from("curriculum_topics")
      .select("id, curriculum_id, title, class_label, content, performance_objectives, sort_order")
      .in("curriculum_id", ids).order("sort_order").limit(600);
    if (error) throw error;

    const want = classKey(req.query.class);
    const mine = want ? (rows || []).filter((r) => classKey(r.class_label) === want) : [];
    const list = (mine.length ? mine : rows || []).map((r) => ({
      id: r.id, title: r.title, class_label: r.class_label || null,
      content: Array.isArray(r.content) ? r.content : [],
      performance_objectives: Array.isArray(r.performance_objectives) ? r.performance_objectives : [],
    }));
    res.json({ success: true, data: list, matchedClass: mine.length > 0 });
  } catch (e) { serverError(res, e, req); }
});

// GET /api/curriculum/:id?class= — the whole document, assembled as a tree.
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { data: doc } = await db.schema("edu").from("curricula")
      .select("*").eq("id", req.params.id).maybeSingle();
    if (!doc) return res.status(404).json({ error: "Curriculum not found" });
    if (doc.status !== "published" && req.user.role !== "admin") {
      return res.status(404).json({ error: "Curriculum not found" });
    }

    const [{ data: themes }, { data: subthemes }, { data: topics }] = await Promise.all([
      db.schema("edu").from("curriculum_themes").select("*").eq("curriculum_id", doc.id).order("sort_order"),
      db.schema("edu").from("curriculum_subthemes").select("*")
        .in("theme_id", (await db.schema("edu").from("curriculum_themes").select("id").eq("curriculum_id", doc.id)).data?.map((t) => t.id) || ["00000000-0000-0000-0000-000000000000"])
        .order("sort_order"),
      db.schema("edu").from("curriculum_topics").select(T_COLS).eq("curriculum_id", doc.id).order("sort_order"),
    ]);

    // A class filter is how a teacher actually reads this — "show me Primary 5"
    // — so it prunes the tree rather than returning everything with a flag.
    const klass = req.query.class || null;
    const subs = (subthemes || []).filter((s) => !klass || s.class_label === klass);
    const subIds = new Set(subs.map((s) => s.id));
    const tops = (topics || []).filter((t) => !klass || subIds.has(t.subtheme_id));

    const tree = (themes || []).map((th) => ({
      ...th,
      subthemes: subs.filter((s) => s.theme_id === th.id).map((s) => ({
        ...s,
        topics: tops.filter((t) => t.subtheme_id === s.id),
      })),
    })).filter((th) => th.subthemes.length);

    res.json({ success: true, data: { ...doc, themes: tree, topicCount: tops.length } });
  } catch (e) { serverError(res, e, req); }
});

/* ══════════════════════ Agent grounding ══════════════════════ */

/**
 * Prompt-ready curriculum context, shaped like the syllabus and past-question
 * grounding so a tutor can hold all three without special-casing any.
 * Returns { context, refs }; empty when nothing clears the bar.
 */
export async function getCurriculumGrounding(query, { body = null, subject = null, klass = null, limit = 4, minSimilarity = 0.32 } = {}) {
  try {
    const { data } = await db.rpc("match_curriculum", {
      p_query_embedding: await embedForSearch(query, { feature: "curriculum_grounding" }),
      p_body: body, p_subject: subject, p_class: klass, p_limit: limit, p_query_text: query,
    });
    // A text match (no vector in time) already matched the words; the cosine floor is for vectors.
    const hits = (data || []).filter((h) => h.lexical || (h.similarity ?? 0) >= minSimilarity);
    if (!hits.length) return { context: "", refs: [] };

    const list = (label, arr) => (arr?.length ? `\n   ${label}: ${arr.join("; ")}` : "");
    const context = "Official curriculum entries covering this — teach to these, and name the class and theme they sit under:\n" +
      hits.map((h, i) =>
        `${i + 1}. [${String(h.body_slug || "").toUpperCase()} · ${h.class_label || ""} · ${h.theme || ""} › ${h.subtheme || ""}] ${h.topic}` +
        list("Objectives", h.performance_objectives) +
        list("Content", h.content) +
        list("Teacher activities", h.teacher_activities) +
        list("Student activities", h.student_activities) +
        list("Materials", h.materials) +
        (h.detailed ? "" : "\n   (table-of-contents entry — the printed detail for this topic is not loaded yet)")
      ).join("\n\n");

    const refs = hits.slice(0, 3).map((h) => ({
      body: String(h.body_slug || "").toUpperCase(),
      curriculum: h.curriculum_title, class: h.class_label,
      theme: h.theme, subtheme: h.subtheme, topic: h.topic, topicId: h.id,
    }));
    return { context, refs };
  } catch (e) {
    console.warn("[curriculum] grounding failed:", e.message);
    return { context: "", refs: [] };
  }
}

/** The OpenAI function-tool definition agents expose to the model. */
export const CURRICULUM_TOOL = {
  type: "function",
  function: {
    name: "search_curriculum",
    description: "Look up what the official curriculum (NERDC and others) says a class should be taught on a topic — performance objectives, content, teacher and student activities, and materials. Use when planning a lesson, checking whether a topic belongs to a class, or asking what a scheme of work should cover.",
    parameters: {
      type: "object",
      properties: {
        topic:   { type: "string", description: "Topic or question to look up" },
        body:    { type: "string", description: "Curriculum body: nerdc, waec, neco, ub, cambridge" },
        subject: { type: "string", description: "Restrict to a subject" },
        class:   { type: "string", description: "Restrict to a class, e.g. 'Primary 5'" },
        limit:   { type: "integer", description: "How many entries (default 4, max 10)" },
      },
      required: ["topic"],
    },
  },
};

export async function runCurriculumTool({ topic, body = null, subject = null, class: klass = null, limit = 4 }) {
  const { data } = await db.rpc("match_curriculum", {
    p_query_embedding: await embedForSearch(String(topic || ""), { feature: "curriculum_tool" }),
    p_body: body ? String(body).toLowerCase() : null,
    p_subject: subject || null, p_class: klass || null,
    p_limit: Math.min(Number(limit) || 4, 10),
    p_query_text: String(topic || ""),
  });
  return {
    entries: (data || []).map((h) => ({
      body: String(h.body_slug || "").toUpperCase(), curriculum: h.curriculum_title,
      class: h.class_label, theme: h.theme, subtheme: h.subtheme, topic: h.topic,
      performanceObjectives: h.performance_objectives, content: h.content,
      teacherActivities: h.teacher_activities, studentActivities: h.student_activities,
      materials: h.materials, evaluation: h.evaluation,
      detailLoaded: h.detailed,
    })),
  };
}

/* ══════════════════════ Admin ══════════════════════ */

router.post("/", adminOnly, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.bodySlug || !b.title) return res.status(400).json({ error: "bodySlug and title are required" });
    const { data, error } = await db.schema("edu").from("curricula").insert({
      body_slug: String(b.bodySlug).toLowerCase(), title: b.title, subject: b.subject || null,
      edition_year: b.editionYear || null, stage: b.stage || null,
      classes: Array.isArray(b.classes) ? b.classes : [],
      source_url: b.sourceUrl || null, meta: b.meta || {}, created_by: req.user.id,
    }).select("*").single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (e) { serverError(res, e, req); }
});

router.patch("/:id", adminOnly, async (req, res) => {
  try {
    const MAP = {
      title: "title", subject: "subject", editionYear: "edition_year", stage: "stage",
      classes: "classes", status: "status", sourceUrl: "source_url", meta: "meta",
      foreword: "foreword", preface: "preface", introduction: "introduction", objectives: "objectives",
    };
    const patch = { updated_at: new Date().toISOString() };
    for (const [k, col] of Object.entries(MAP)) if (req.body?.[k] !== undefined) patch[col] = req.body[k];
    const { data, error } = await db.schema("edu").from("curricula")
      .update(patch).eq("id", req.params.id).select("*").single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) { serverError(res, e, req); }
});

router.delete("/:id", adminOnly, async (req, res) => {
  try {
    const { error } = await db.schema("edu").from("curricula").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) { serverError(res, e, req); }
});

// What a topic is embedded on: everything a teacher would search it by.
const topicEmbedText = (t, ctx) => [
  `${String(ctx.body || "").toUpperCase()} ${ctx.subject || ""} ${t.class_label || ""}`.trim(),
  [ctx.theme, ctx.subtheme, t.title].filter(Boolean).join(" › "),
  (t.performance_objectives || []).join("\n"),
  (t.content || []).join("\n"),
].filter(Boolean).join("\n");

router.patch("/topics/:id", adminOnly, async (req, res) => {
  try {
    const MAP = {
      title: "title", classLabel: "class_label", periods: "periods", detailed: "detailed",
      performanceObjectives: "performance_objectives", content: "content",
      teacherActivities: "teacher_activities", studentActivities: "student_activities",
      materials: "materials", evaluation: "evaluation",
    };
    const patch = { updated_at: new Date().toISOString() };
    for (const [k, col] of Object.entries(MAP)) if (req.body?.[k] !== undefined) patch[col] = req.body[k];

    const { data, error } = await db.schema("edu").from("curriculum_topics")
      .update(patch).eq("id", req.params.id).select("*").single();
    if (error) throw error;

    // Re-embed when the searchable text changed, so search can't keep matching
    // wording that is no longer there.
    if (patch.title || patch.performance_objectives || patch.content) {
      const ctx = await topicContext(data);
      try {
        await db.schema("edu").from("curriculum_topics")
          .update({ embedding: await embed(topicEmbedText(data, ctx)) }).eq("id", data.id);
      } catch (e) { console.warn("[curriculum] re-embed failed:", e.message); }
    }
    res.json({ success: true, data });
  } catch (e) { serverError(res, e, req); }
});

async function topicContext(topic) {
  const { data: c } = await db.schema("edu").from("curricula")
    .select("body_slug, subject").eq("id", topic.curriculum_id).maybeSingle();
  const { data: st } = topic.subtheme_id
    ? await db.schema("edu").from("curriculum_subthemes").select("title, theme_id").eq("id", topic.subtheme_id).maybeSingle()
    : { data: null };
  const { data: th } = st?.theme_id
    ? await db.schema("edu").from("curriculum_themes").select("title").eq("id", st.theme_id).maybeSingle()
    : { data: null };
  return { body: c?.body_slug, subject: c?.subject, theme: th?.title, subtheme: st?.title };
}

// POST /api/curriculum/reembed — fill in missing vectors (SQL-seeded rows).
/** Embed up to `limit` topics that have no vector. Also the embeddings switch's re-embed (lib/embeddingCutover.js). */
export async function reembedMissingCurriculum({ limit = 100 } = {}) {
  const { data: rows } = await db.schema("edu").from("curriculum_topics")
    .select("*").is("embedding", null).limit(Math.min(Number(limit) || 100, 300));
  if (!rows?.length) return { embedded: 0, remaining: 0 };
  let embedded = 0;
  for (const t of rows) {
    try {
      const ctx = await topicContext(t);
      await db.schema("edu").from("curriculum_topics")
        .update({ embedding: await embed(topicEmbedText(t, ctx)) }).eq("id", t.id);
      embedded++;
    } catch (e) { console.warn("[curriculum] embed failed:", t.id, e.message); }
  }
  const { count } = await db.schema("edu").from("curriculum_topics")
    .select("id", { count: "exact", head: true }).is("embedding", null);
  return { embedded, remaining: count ?? 0 };
}

router.post("/reembed", adminOnly, async (req, res) => {
  try {
    res.json({ success: true, data: await reembedMissingCurriculum({ limit: req.body?.limit }) });
  } catch (e) { serverError(res, e, req); }
});

/* ══════════════════════ Ingest a scanned curriculum ══════════════════════ */

const INGEST_SYSTEM = `You transcribe scanned Nigerian curriculum documents into structured JSON. Transcribe EXACTLY what is printed — never invent an objective, an activity or a material.

Curriculum pages are printed as a table whose columns are, in order:
TOPIC | PERFORMANCE OBJECTIVES | CONTENT | TEACHER ACTIVITIES | STUDENT ACTIVITIES | TEACHING AND LEARNING MATERIALS | EVALUATION GUIDE
(some editions merge or omit a column — map what is there, leave the rest empty).

Return ONLY JSON:
{"themes":[{"title":string}],
 "subthemes":[{"theme":string,"title":string,"class":string|null}],
 "topics":[{"theme":string|null,"subtheme":string|null,"title":string,"class":string|null,
            "performanceObjectives":[string],"content":[string],
            "teacherActivities":[string],"studentActivities":[string],
            "materials":[string],"evaluation":[string],"sourcePage":number}]}

Rules:
- One entry per numbered item in a cell; do not merge a list into one string.
- Keep the wording of objectives verbatim — they are assessed against.
- If a page carries only front matter (foreword, preface, contents), return empty arrays.`;

// POST /api/curriculum/:id/ingest   multipart: file=<pdf>, pageFrom, pageTo
router.post("/:id/ingest", adminOnly, (req, res) => {
  upload(req, res, async (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });
    let ingestId = null;
    try {
      const { data: doc } = await db.schema("edu").from("curricula")
        .select("*").eq("id", req.params.id).maybeSingle();
      if (!doc) return res.status(404).json({ error: "Curriculum not found" });
      if (!req.file?.buffer) return res.status(400).json({ error: "Attach the curriculum as `file` (PDF)" });

      const pageFrom = Math.max(1, Number(req.body?.pageFrom) || 1);
      const pageTo = Math.min(Number(req.body?.pageTo) || pageFrom + 3, pageFrom + 5);  // ≤6 pages: these are dense tables

      const { data: ing } = await db.schema("edu").from("curriculum_ingests").insert({
        curriculum_id: doc.id, page_from: pageFrom, page_to: pageTo, status: "pending", created_by: req.user.id,
      }).select("id").single();
      ingestId = ing?.id || null;

      const all = await renderPdfToImages(req.file.buffer, { maxPages: pageTo, scale: 2 });
      const images = all.slice(pageFrom - 1, pageTo);
      if (!images.length) return res.status(400).json({ error: "That page range is empty" });

      const content = [{ type: "text", text: `Transcribe pages ${pageFrom}-${pageTo} of the ${String(doc.body_slug).toUpperCase()} "${doc.title}"${doc.edition_year ? ` (${doc.edition_year})` : ""}.` }];
      for (const url of images) content.push({ type: "image_url", image_url: { url, detail: "high" } });

      const resp = await openai.chat.completions.create({
        __role: "vision", max_tokens: 8000, temperature: 0.1,
        messages: [{ role: "system", content: INGEST_SYSTEM }, { role: "user", content }],
      });
      let raw = (resp.choices?.[0]?.message?.content || "").trim();
      const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) raw = fence[1].trim();
      const parsed = JSON.parse(raw);

      await db.schema("edu").from("curriculum_ingests").update({
        raw_text: raw.slice(0, 20000), parsed, found: (parsed.topics || []).length, status: "parsed",
      }).eq("id", ingestId);

      res.json({
        success: true,
        data: { ingestId, pages: [pageFrom, pageTo], ...parsed, note: "Parsed only — review, then import." },
      });
    } catch (e) {
      if (ingestId) {
        await db.schema("edu").from("curriculum_ingests")
          .update({ status: "failed", error: String(e.message).slice(0, 500) }).eq("id", ingestId);
      }
      serverError(res, e, req);
    }
  });
});

// POST /api/curriculum/ingests/:id/import — write a reviewed parse in.
router.post("/ingests/:id/import", adminOnly, async (req, res) => {
  try {
    const { data: ing } = await db.schema("edu").from("curriculum_ingests")
      .select("*").eq("id", req.params.id).maybeSingle();
    if (!ing) return res.status(404).json({ error: "Ingest not found" });

    const doc = req.body?.parsed || ing.parsed;
    if (!doc?.topics?.length) return res.status(400).json({ error: "Nothing to import" });

    const { data: curriculum } = await db.schema("edu").from("curricula")
      .select("*").eq("id", ing.curriculum_id).maybeSingle();

    // Themes and sub-themes are upserted by name: a page range usually repeats
    // a theme that earlier pages already created, and duplicating it would
    // split one theme into several in the tree.
    const themeId = {};
    for (const [i, th] of (doc.themes || []).entries()) {
      const { data } = await db.schema("edu").from("curriculum_themes")
        .upsert({ curriculum_id: curriculum.id, title: th.title, sort_order: i }, { onConflict: "curriculum_id,title" })
        .select("id, title").single();
      if (data) themeId[data.title] = data.id;
    }
    const subId = {};
    for (const [i, st] of (doc.subthemes || []).entries()) {
      const tid = themeId[st.theme];
      if (!tid) continue;
      const { data } = await db.schema("edu").from("curriculum_subthemes")
        .upsert({ theme_id: tid, title: st.title, class_label: st.class || null, sort_order: i }, { onConflict: "theme_id,title,class_label" })
        .select("id, title, class_label").single();
      if (data) subId[`${data.title}|${data.class_label || ""}`] = data.id;
    }

    let imported = 0;
    for (const [i, t] of (doc.topics || []).entries()) {
      const sid = subId[`${t.subtheme}|${t.class || ""}`] || subId[`${t.subtheme}|`] || null;
      const record = {
        curriculum_id: curriculum.id, subtheme_id: sid, title: t.title,
        class_label: t.class || null,
        performance_objectives: t.performanceObjectives || [],
        content: t.content || [], teacher_activities: t.teacherActivities || [],
        student_activities: t.studentActivities || [], materials: t.materials || [],
        evaluation: t.evaluation || [], source_page: t.sourcePage ?? null,
        // Came off the printed page, so this row carries the real detail.
        detailed: true, sort_order: i,
      };
      try {
        record.embedding = await embed(topicEmbedText(record, {
          body: curriculum.body_slug, subject: curriculum.subject, theme: t.theme, subtheme: t.subtheme,
        }));
      } catch { /* embeddable later via /reembed */ }

      const { error } = await db.schema("edu").from("curriculum_topics")
        .upsert(record, { onConflict: "subtheme_id,title" });
      if (!error) imported++;
    }

    await db.schema("edu").from("curriculum_ingests")
      .update({ status: "imported", found: imported }).eq("id", ing.id);
    res.json({ success: true, data: { imported } });
  } catch (e) { serverError(res, e, req); }
});

export default router;
