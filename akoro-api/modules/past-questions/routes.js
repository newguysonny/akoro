/**
 * past-questions/routes.js — the past questions & answers bank.
 *
 * Mounted at /api/past-questions.
 *
 * Reading is open to any signed-in user and only ever returns PUBLISHED papers.
 * Writing — creating papers, ingesting scans, editing questions — is admin
 * only: this is reference data students will be told is fact, so it doesn't get
 * edited by whoever happens to be logged in.
 *
 * INGESTION. The source papers are scanned images with no text layer, so a PDF
 * text extract yields nothing. Pages are rasterised and read by the vision
 * model, exactly like the syllabus ingest already does. Parsed questions land
 * `verified: false` and are excluded from practice until a human has checked
 * them — a mis-OCR'd answer key is worse than no answer key.
 *
 * AGENT USE. getPastQuestionGrounding() mirrors getSyllabusGrounding(): it
 * returns a prompt-ready context block plus source refs, so a tutor can say
 * "this came up in NCEE 2017" and cite it.
 */
import { Router } from "express";
import multer from "multer";
import db from "../../db.js";
import { openai } from "../../lib/aiModel.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { embed } from "../adaptive-learning/syllabus.js";
import { renderPdfToImages } from "../adaptive-learning/pdfRender.js";
import { serverError } from "../../lib/httpError.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } }).single("file");
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o";

const Q_COLS = "id, number, type, stem, image_url, options, answer, explanation, marks, subject, topic, difficulty, verified, section_id, passage_id, source_page";

/* ══════════════════════ Read ══════════════════════ */

// GET /api/past-questions/exams — the catalog, with how much is actually in it.
router.get("/exams", authenticateToken, async (req, res) => {
  try {
    const { data: bodies } = await db.schema("edu").from("exam_bodies")
      .select("*").eq("is_active", true).order("sort_order");
    const { data: papers } = await db.schema("edu").from("past_papers")
      .select("exam_slug, year, status").eq("status", "published");

    const byExam = {};
    for (const p of papers || []) {
      (byExam[p.exam_slug] ||= { papers: 0, years: new Set() });
      byExam[p.exam_slug].papers++;
      byExam[p.exam_slug].years.add(p.year);
    }
    res.json({
      success: true,
      data: (bodies || []).map((b) => ({
        ...b,
        paperCount: byExam[b.slug]?.papers || 0,
        years: [...(byExam[b.slug]?.years || [])].sort((a, z) => z - a),
      })),
    });
  } catch (e) { serverError(res, e, req); }
});

// GET /api/past-questions/papers?exam=&year=&subject=
router.get("/papers", authenticateToken, async (req, res) => {
  try {
    let q = db.schema("edu").from("past_papers")
      .select("id, exam_slug, year, title, subject, paper_code, variant, duration_min, page_count, status")
      .order("year", { ascending: false }).order("title");
    // Admins can see drafts so they can work on them; nobody else can.
    if (req.user.role !== "admin") q = q.eq("status", "published");
    else if (req.query.status) q = q.eq("status", req.query.status);
    if (req.query.exam) q = q.eq("exam_slug", req.query.exam);
    if (req.query.year) q = q.eq("year", Number(req.query.year));
    if (req.query.subject) q = q.ilike("subject", req.query.subject);

    const { data, error } = await q;
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (e) { serverError(res, e, req); }
});

// GET /api/past-questions/papers/:id — the whole paper, assembled.
router.get("/papers/:id", authenticateToken, async (req, res) => {
  try {
    const { data: paper } = await db.schema("edu").from("past_papers")
      .select("*").eq("id", req.params.id).maybeSingle();
    if (!paper) return res.status(404).json({ error: "Paper not found" });
    if (paper.status !== "published" && req.user.role !== "admin") {
      return res.status(404).json({ error: "Paper not found" });
    }

    const [{ data: sections }, { data: passages }, { data: questions }] = await Promise.all([
      db.schema("edu").from("paper_sections").select("*").eq("paper_id", paper.id).order("sort_order"),
      db.schema("edu").from("paper_passages").select("*").eq("paper_id", paper.id).order("sort_order"),
      db.schema("edu").from("past_questions").select(Q_COLS).eq("paper_id", paper.id).order("number"),
    ]);

    // Answers are withheld from drafts for everyone but an admin: an unverified
    // answer is a guess, and shipping a guess as an answer key is the one thing
    // this bank must never do.
    const safe = (questions || []).map((q) =>
      (q.verified || req.user.role === "admin") ? q : { ...q, answer: null, explanation: null });

    res.json({ success: true, data: { ...paper, sections: sections || [], passages: passages || [], questions: safe } });
  } catch (e) { serverError(res, e, req); }
});

// GET /api/past-questions/search?q=&exam=&subject=&limit=
// Semantic when a query is given, plain filters otherwise.
router.get("/search", authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const q = String(req.query.q || "").trim();

    if (q) {
      const { data, error } = await db.rpc("match_past_questions", {
        p_query_embedding: await embed(q),
        p_exam: req.query.exam || null,
        p_subject: req.query.subject || null,
        p_limit: limit,
      });
      if (error) throw error;
      return res.json({ success: true, data: data || [] });
    }

    let sel = db.schema("edu").from("past_questions")
      .select(`${Q_COLS}, past_papers!inner(id, exam_slug, year, title, status)`)
      .eq("past_papers.status", "published").limit(limit);
    if (req.query.exam) sel = sel.eq("past_papers.exam_slug", req.query.exam);
    if (req.query.subject) sel = sel.ilike("subject", req.query.subject);
    if (req.query.topic) sel = sel.ilike("topic", `%${req.query.topic}%`);
    const { data, error } = await sel;
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (e) { serverError(res, e, req); }
});

// GET /api/past-questions/practice?exam=&subject=&count= — a quiz set.
// Verified only: practice is where a wrong answer key does real damage.
router.get("/practice", authenticateToken, async (req, res) => {
  try {
    const count = Math.min(Number(req.query.count) || 10, 60);
    let sel = db.schema("edu").from("past_questions")
      .select(`${Q_COLS}, past_papers!inner(exam_slug, year, status)`)
      .eq("type", "mcq").eq("verified", true).not("answer", "is", null)
      .eq("past_papers.status", "published")
      .limit(count * 4);
    if (req.query.exam) sel = sel.eq("past_papers.exam_slug", req.query.exam);
    if (req.query.subject) sel = sel.ilike("subject", req.query.subject);

    const { data, error } = await sel;
    if (error) throw error;

    // Shuffled in JS: ORDER BY random() over a large table is a full scan, and
    // the over-fetch above gives enough of a pool for a varied set.
    const pool = [...(data || [])];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    res.json({ success: true, data: pool.slice(0, count) });
  } catch (e) { serverError(res, e, req); }
});

/* ══════════════════════ Agent grounding ══════════════════════ */

/**
 * Prompt-ready past-question context, shaped like getSyllabusGrounding.
 * Returns { context, refs } — empty when nothing clears the similarity bar, so
 * an unrelated question injects nothing rather than dragging in weak matches.
 */
export async function getPastQuestionGrounding(query, { exam = null, subject = null, limit = 5, minSimilarity = 0.32 } = {}) {
  try {
    const { data } = await db.rpc("match_past_questions", {
      p_query_embedding: await embed(query),
      p_exam: exam, p_subject: subject, p_limit: limit,
    });
    const hits = (data || []).filter((h) => (h.similarity ?? 0) >= minSimilarity);
    if (!hits.length) return { context: "", refs: [] };

    const context = "Past examination questions on this topic — use them to show the student how it is actually examined, and say which exam and year each came from:\n" +
      hits.map((h, i) => {
        const opts = Array.isArray(h.options) && h.options.length
          ? "\n" + h.options.map((o) => `   ${o.label}. ${o.text}`).join("\n") : "";
        return `${i + 1}. [${String(h.exam_slug || "").toUpperCase()} ${h.year}${h.subject ? ` · ${h.subject}` : ""}] Q${h.number || ""}: ${h.stem}${opts}` +
          (h.answer ? `\n   Answer: ${h.answer}` : "") +
          (h.explanation ? `\n   Why: ${h.explanation}` : "");
      }).join("\n\n");

    const refs = hits.slice(0, 3).map((h) => ({
      exam: String(h.exam_slug || "").toUpperCase(), year: h.year,
      subject: h.subject || null, topic: h.topic || null, questionId: h.id,
    }));
    return { context, refs };
  } catch (e) {
    console.warn("[past-questions] grounding failed:", e.message);
    return { context: "", refs: [] };
  }
}

/** The OpenAI function-tool definition agents expose to the model. */
export const PAST_QUESTIONS_TOOL = {
  type: "function",
  function: {
    name: "search_past_questions",
    description: "Find real past examination questions (WAEC, NECO, JAMB, NCEE, BECE) on a topic. Use when the student asks what a topic looks like in the exam, wants practice, or asks 'has this come up before?'.",
    parameters: {
      type: "object",
      properties: {
        topic:   { type: "string", description: "The topic or question to search for" },
        exam:    { type: "string", description: "Restrict to one exam body: waec, neco, jamb, ncee, bece, pslc, gce" },
        subject: { type: "string", description: "Restrict to a subject, e.g. Mathematics" },
        limit:   { type: "integer", description: "How many questions (default 5, max 10)" },
      },
      required: ["topic"],
    },
  },
};

/** Executor for the tool above — returns plain data for the model to answer from. */
export async function runPastQuestionsTool({ topic, exam = null, subject = null, limit = 5 }) {
  const { data } = await db.rpc("match_past_questions", {
    p_query_embedding: await embed(String(topic || "")),
    p_exam: exam ? String(exam).toLowerCase() : null,
    p_subject: subject || null,
    p_limit: Math.min(Number(limit) || 5, 10),
  });
  return {
    questions: (data || []).map((h) => ({
      exam: String(h.exam_slug || "").toUpperCase(), year: h.year, number: h.number,
      subject: h.subject, topic: h.topic, question: h.stem, options: h.options,
      answer: h.answer, explanation: h.explanation, hasDiagram: !!h.image_url,
    })),
  };
}

/* ══════════════════════ Admin: papers ══════════════════════ */

router.post("/papers", adminOnly, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.examSlug || !b.year || !b.title) return res.status(400).json({ error: "examSlug, year and title are required" });
    const { data, error } = await db.schema("edu").from("past_papers").insert({
      exam_slug: String(b.examSlug).toLowerCase(), year: Number(b.year), title: b.title,
      subject: b.subject || null, paper_code: b.paperCode || null, variant: b.variant || null,
      duration_min: b.durationMin || null, source_url: b.sourceUrl || null,
      meta: b.meta || {}, created_by: req.user.id,
    }).select("*").single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (e) { serverError(res, e, req); }
});

router.patch("/papers/:id", adminOnly, async (req, res) => {
  try {
    const MAP = { title: "title", subject: "subject", paperCode: "paper_code", variant: "variant",
      durationMin: "duration_min", sourceUrl: "source_url", status: "status", year: "year", meta: "meta" };
    const patch = { updated_at: new Date().toISOString() };
    for (const [k, col] of Object.entries(MAP)) if (req.body?.[k] !== undefined) patch[col] = req.body[k];
    const { data, error } = await db.schema("edu").from("past_papers")
      .update(patch).eq("id", req.params.id).select("*").single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) { serverError(res, e, req); }
});

router.delete("/papers/:id", adminOnly, async (req, res) => {
  try {
    const { error } = await db.schema("edu").from("past_papers").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) { serverError(res, e, req); }
});

/* ══════════════════════ Admin: questions ══════════════════════ */

// Embedding text is stem + options + topic: a student searching "ratio of girls
// to boys" should match on the options as much as the stem.
const embedTextFor = (q, paper) => [
  `${String(paper?.exam_slug || "").toUpperCase()} ${paper?.year || ""} ${q.subject || paper?.subject || ""} ${q.topic || ""}`.trim(),
  q.stem,
  (q.options || []).map((o) => `${o.label}. ${o.text}`).join("\n"),
].filter(Boolean).join("\n");

router.patch("/questions/:id", adminOnly, async (req, res) => {
  try {
    const MAP = { stem: "stem", options: "options", answer: "answer", explanation: "explanation",
      marks: "marks", subject: "subject", topic: "topic", difficulty: "difficulty",
      verified: "verified", imageUrl: "image_url", number: "number", type: "type" };
    const patch = { updated_at: new Date().toISOString() };
    for (const [k, col] of Object.entries(MAP)) if (req.body?.[k] !== undefined) patch[col] = req.body[k];

    const { data, error } = await db.schema("edu").from("past_questions")
      .update(patch).eq("id", req.params.id).select("*").single();
    if (error) throw error;

    // Re-embed when the searchable text changed, so search doesn't quietly
    // keep matching the old wording.
    if (patch.stem || patch.options || patch.topic || patch.subject) {
      const { data: paper } = await db.schema("edu").from("past_papers")
        .select("exam_slug, year, subject").eq("id", data.paper_id).maybeSingle();
      try {
        await db.schema("edu").from("past_questions")
          .update({ embedding: await embed(embedTextFor(data, paper)) }).eq("id", data.id);
      } catch (e) { console.warn("[past-questions] re-embed failed:", e.message); }
    }
    res.json({ success: true, data });
  } catch (e) { serverError(res, e, req); }
});

router.delete("/questions/:id", adminOnly, async (req, res) => {
  try {
    const { error } = await db.schema("edu").from("past_questions").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) { serverError(res, e, req); }
});

// POST /api/past-questions/papers/:id/questions — bulk insert (used by the
// importer and by hand-entry). Embeds as it goes.
router.post("/papers/:id/questions", adminOnly, async (req, res) => {
  try {
    const { data: paper } = await db.schema("edu").from("past_papers")
      .select("*").eq("id", req.params.id).maybeSingle();
    if (!paper) return res.status(404).json({ error: "Paper not found" });

    const rows = Array.isArray(req.body?.questions) ? req.body.questions : [];
    if (!rows.length) return res.status(400).json({ error: "questions[] is required" });

    const out = [];
    for (const q of rows) {
      const record = {
        paper_id: paper.id, section_id: q.sectionId || null, passage_id: q.passageId || null,
        number: q.number ?? null, type: q.type || "mcq", stem: q.stem || "",
        image_url: q.imageUrl || null, options: q.options || [], answer: q.answer ?? null,
        explanation: q.explanation ?? null, marks: q.marks ?? null,
        subject: q.subject || paper.subject || null, topic: q.topic || null,
        difficulty: q.difficulty || null, verified: !!q.verified, source_page: q.sourcePage ?? null,
      };
      try { record.embedding = await embed(embedTextFor(record, paper)); }
      catch (e) { console.warn("[past-questions] embed failed:", e.message); }

      const { data, error } = await db.schema("edu").from("past_questions")
        .upsert(record, { onConflict: "paper_id,section_id,number" }).select("id, number").single();
      if (error) throw error;
      out.push(data);
    }
    res.status(201).json({ success: true, data: { imported: out.length, questions: out } });
  } catch (e) { serverError(res, e, req); }
});

// GET /api/past-questions/review — everything still awaiting a human check.
// One query rather than walking every paper: the admin queue is the whole point
// of the verified flag, so it shouldn't cost N+1 requests to look at.
router.get("/review", adminOnly, async (req, res) => {
  try {
    const { data, error } = await db.schema("edu").from("past_questions")
      .select(`${Q_COLS}, past_papers!inner(id, exam_slug, year, title)`)
      .eq("verified", false)
      .order("created_at", { ascending: true })
      .limit(Math.min(Number(req.query.limit) || 200, 500));
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (e) { serverError(res, e, req); }
});

// POST /api/past-questions/reembed — fill in missing embeddings.
// Questions written by SQL seed have no vector, so they'd be invisible to
// semantic search until this runs. Bounded per call so it can't hang a request.
/** Embed up to `limit` questions that have no vector. Also the embeddings switch's re-embed (lib/embeddingCutover.js). */
export async function reembedMissingPastQuestions({ limit = 100 } = {}) {
    const { data: rows } = await db.schema("edu").from("past_questions")
      .select("id, paper_id, stem, options, subject, topic").is("embedding", null).limit(Math.min(Number(limit) || 100, 300));
    if (!rows?.length) return { embedded: 0, remaining: 0 };

    const paperIds = [...new Set(rows.map((r) => r.paper_id))];
    const { data: papers } = await db.schema("edu").from("past_papers")
      .select("id, exam_slug, year, subject").in("id", paperIds);
    const paperById = Object.fromEntries((papers || []).map((p) => [p.id, p]));

    let embedded = 0;
    for (const q of rows) {
      try {
        await db.schema("edu").from("past_questions")
          .update({ embedding: await embed(embedTextFor(q, paperById[q.paper_id])) }).eq("id", q.id);
        embedded++;
      } catch (e) { console.warn("[past-questions] embed failed:", q.id, e.message); }
    }

    const { count } = await db.schema("edu").from("past_questions")
      .select("id", { count: "exact", head: true }).is("embedding", null);
    return { embedded, remaining: count ?? 0 };
}

router.post("/reembed", adminOnly, async (req, res) => {
  try {
    res.json({ success: true, data: await reembedMissingPastQuestions({ limit: req.body?.limit }) });
  } catch (e) { serverError(res, e, req); }
});

/* ══════════════════════ Admin: ingest a scanned paper ══════════════════════ */

const INGEST_SYSTEM = `You transcribe scanned Nigerian examination papers into structured JSON. Transcribe EXACTLY what is printed — never correct, complete or invent a question, an option or an answer.

Return ONLY JSON:
{"sections":[{"part":string|null,"title":string,"subject":string|null,"instructions":string|null}],
 "passages":[{"label":string,"body":string,"sectionTitle":string|null}],
 "questions":[{"number":number,"sectionTitle":string|null,"passageLabel":string|null,
               "stem":string,"options":[{"label":"A","text":string}],
               "answer":string|null,"type":"mcq"|"theory","isDiagram":boolean,"sourcePage":number}]}

Rules:
- Options run A to E on these papers. Include every option printed, in order.
- "answer" ONLY if the paper itself prints an answer key. Otherwise null. Never guess.
- If a question is a DIAGRAM the text cannot capture (shapes, figures, number puzzles), set "isDiagram": true and describe the figure in "stem" as plainly as you can.
- Keep mathematical notation readable: fractions as 2/3, powers as x^2.
- Omit page numbers, headers and footers.`;

// POST /api/past-questions/papers/:id/ingest   multipart: file=<pdf>
// Body: pageFrom, pageTo — the scans have no text layer, so pages are
// rasterised and read by the vision model in bounded batches.
router.post("/papers/:id/ingest", adminOnly, (req, res) => {
  upload(req, res, async (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });
    let ingestId = null;
    try {
      const { data: paper } = await db.schema("edu").from("past_papers")
        .select("*").eq("id", req.params.id).maybeSingle();
      if (!paper) return res.status(404).json({ error: "Paper not found" });
      if (!req.file?.buffer) return res.status(400).json({ error: "Attach the paper as `file` (PDF)" });

      const pageFrom = Math.max(1, Number(req.body?.pageFrom) || 1);
      const pageTo = Math.min(Number(req.body?.pageTo) || pageFrom + 3, pageFrom + 7);   // ≤8 pages a call

      const { data: ing } = await db.schema("edu").from("paper_ingests").insert({
        paper_id: paper.id, page_from: pageFrom, page_to: pageTo, status: "pending", created_by: req.user.id,
      }).select("id").single();
      ingestId = ing?.id || null;

      const all = await renderPdfToImages(req.file.buffer, { maxPages: pageTo, scale: 2 });
      const images = all.slice(pageFrom - 1, pageTo);
      if (!images.length) return res.status(400).json({ error: "That page range is empty" });

      const content = [{ type: "text", text: `Transcribe pages ${pageFrom}-${pageTo} of this ${String(paper.exam_slug).toUpperCase()} ${paper.year} paper ("${paper.title}").` }];
      for (const url of images) content.push({ type: "image_url", image_url: { url, detail: "high" } });

      const resp = await openai.chat.completions.create({
        model: VISION_MODEL, max_tokens: 6000, temperature: 0.1,
        messages: [{ role: "system", content: INGEST_SYSTEM }, { role: "user", content }],
      });
      let raw = (resp.choices?.[0]?.message?.content || "").trim();
      const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) raw = fence[1].trim();
      const parsed = JSON.parse(raw);

      await db.schema("edu").from("paper_ingests").update({
        raw_text: raw.slice(0, 20000), parsed, found: (parsed.questions || []).length, status: "parsed",
      }).eq("id", ingestId);

      // Parsed, NOT imported. A human reviews before anything reaches students.
      res.json({
        success: true,
        data: { ingestId, pages: [pageFrom, pageTo], ...parsed, note: "Parsed only — review, then POST /import to write them in." },
      });
    } catch (e) {
      if (ingestId) {
        await db.schema("edu").from("paper_ingests")
          .update({ status: "failed", error: String(e.message).slice(0, 500) }).eq("id", ingestId);
      }
      serverError(res, e, req);
    }
  });
});

// POST /api/past-questions/ingests/:id/import — write a reviewed parse in.
router.post("/ingests/:id/import", adminOnly, async (req, res) => {
  try {
    const { data: ing } = await db.schema("edu").from("paper_ingests")
      .select("*").eq("id", req.params.id).maybeSingle();
    if (!ing) return res.status(404).json({ error: "Ingest not found" });

    const doc = req.body?.parsed || ing.parsed;
    if (!doc?.questions?.length) return res.status(400).json({ error: "Nothing to import" });

    const { data: paper } = await db.schema("edu").from("past_papers")
      .select("*").eq("id", ing.paper_id).maybeSingle();

    // Sections and passages first — questions reference them by the human
    // labels the parse used, which is all the model can reliably produce.
    const sectionIdByTitle = {};
    for (const [i, s] of (doc.sections || []).entries()) {
      const { data } = await db.schema("edu").from("paper_sections").insert({
        paper_id: paper.id, part: s.part || null, title: s.title || `Section ${i + 1}`,
        subject: s.subject || null, instructions: s.instructions || null, sort_order: i,
      }).select("id, title").single();
      if (data) sectionIdByTitle[data.title] = data.id;
    }
    const passageIdByLabel = {};
    for (const [i, p] of (doc.passages || []).entries()) {
      const { data } = await db.schema("edu").from("paper_passages").insert({
        paper_id: paper.id, section_id: sectionIdByTitle[p.sectionTitle] || null,
        label: p.label || `Passage ${i + 1}`, body: p.body || null, sort_order: i,
      }).select("id, label").single();
      if (data) passageIdByLabel[data.label] = data.id;
    }

    let imported = 0;
    for (const q of doc.questions) {
      const record = {
        paper_id: paper.id,
        section_id: sectionIdByTitle[q.sectionTitle] || null,
        passage_id: passageIdByLabel[q.passageLabel] || null,
        number: q.number ?? null, type: q.type || "mcq", stem: q.stem || "",
        options: q.options || [], answer: q.answer ?? null,
        subject: q.subject || paper.subject || null,
        source_page: q.sourcePage ?? null,
        // Machine-read: never trusted until a human says so.
        verified: false,
      };
      try { record.embedding = await embed(embedTextFor(record, paper)); } catch { /* searchable later */ }
      const { error } = await db.schema("edu").from("past_questions")
        .upsert(record, { onConflict: "paper_id,section_id,number" });
      if (!error) imported++;
    }

    await db.schema("edu").from("paper_ingests")
      .update({ status: "imported", found: imported }).eq("id", ing.id);
    res.json({ success: true, data: { imported } });
  } catch (e) { serverError(res, e, req); }
});

export default router;
