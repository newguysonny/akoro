/**
 * curriculum/importDoc.js — publish a reviewed curriculum import (the
 * importer's curriculum mode, adaptive-learning/syllabus-import/curriculum.js)
 * into the curriculum bank: edu.curricula → curriculum_themes →
 * curriculum_subthemes → curriculum_topics.
 *
 * A curriculum is matched by body + subject + stage (one NERDC Mathematics
 * for Primary 4–6, one for JSS 1–3). Publishing a full document replaces that
 * curriculum's themes/sub-themes/topics with the printed detail (the seeded
 * table-of-contents skeleton included); a front-matter-only document (the
 * forewords) fills the foreword / preface / introduction / objectives of the
 * same curriculum, creating it if it doesn't exist yet. Embeddings are built
 * afterwards by reembedMissingCurriculum.
 */
import db from "../../db.js";

const E = () => db.schema("edu");
const now = () => new Date().toISOString();
const FRONT = ["foreword", "preface", "introduction", "objectives"];

async function findOrCreate(doc) {
  let q = E().from("curricula").select("*").eq("body_slug", doc.body || "nerdc").eq("subject", doc.subject);
  q = doc.stage ? q.eq("stage", doc.stage) : q.is("stage", null);
  const { data: found } = await q.order("created_at", { ascending: true }).limit(1);
  if (found?.[0]) return found[0];
  const { data, error } = await E().from("curricula").insert({
    body_slug: doc.body || "nerdc", title: doc.title || `${doc.subject} Curriculum`, subject: doc.subject,
    edition_year: doc.edition_year || null, stage: doc.stage || null, classes: doc.classes || [],
    status: "draft", meta: { imported: true },
  }).select("*").single();
  if (error) throw error;
  return data;
}

/** → { curriculumId, themes, subthemes, topics, frontMatter: [fields filled] } */
export async function publishCurriculumDoc(doc, { source = null, pageCount = null } = {}) {
  if (doc?.kind !== "curriculum" || !doc.subject) throw Object.assign(new Error("Not a curriculum import"), { status: 422 });
  const cur = await findOrCreate(doc);
  const front = Object.fromEntries(FRONT.filter((k) => doc[k]).map((k) => [k, doc[k]]));

  if (doc.frontMatterOnly || !doc.topics?.length) {
    await E().from("curricula").update({ ...front, updated_at: now() }).eq("id", cur.id);
    return { curriculumId: cur.id, themes: 0, subthemes: 0, topics: 0, frontMatter: Object.keys(front) };
  }

  await E().from("curricula").update({
    ...front, title: doc.title || cur.title, edition_year: doc.edition_year || cur.edition_year,
    classes: doc.classes?.length ? doc.classes : cur.classes, page_count: pageCount || cur.page_count,
    status: "published", meta: { ...(cur.meta || {}), imported: true, source },
    updated_at: now(),
  }).eq("id", cur.id);

  // The printed detail replaces whatever was there (themes cascade to sub-themes; topics go with them).
  await E().from("curriculum_topics").delete().eq("curriculum_id", cur.id);
  await E().from("curriculum_themes").delete().eq("curriculum_id", cur.id);

  const themeId = {};
  for (const [i, th] of (doc.themes || []).entries()) {
    const { data } = await E().from("curriculum_themes").insert({ curriculum_id: cur.id, title: th.title, sort_order: i }).select("id, title").single();
    if (data) themeId[data.title] = data.id;
  }
  const subId = {};
  for (const [i, st] of (doc.subthemes || []).entries()) {
    const tid = themeId[st.theme];
    if (!tid) continue;
    const { data } = await E().from("curriculum_subthemes")
      .insert({ theme_id: tid, title: st.title, class_label: st.class || null, sort_order: i }).select("id").single();
    if (data) subId[`${st.theme}|${st.title}|${st.class || ""}`] = data.id;
  }
  let topics = 0;
  const rows = (doc.topics || []).map((t, i) => ({
    curriculum_id: cur.id, subtheme_id: subId[`${t.theme}|${t.subtheme}|${t.class || ""}`] || null,
    title: t.title, class_label: t.class || null,
    performance_objectives: t.performanceObjectives || [], content: t.content || [],
    teacher_activities: t.teacherActivities || [], student_activities: t.studentActivities || [],
    materials: t.materials || [], evaluation: t.evaluation || [],
    source_page: t.sourcePage ?? null, detailed: true, sort_order: i,
  }));
  for (let i = 0; i < rows.length; i += 50) {
    const { data, error } = await E().from("curriculum_topics").insert(rows.slice(i, i + 50)).select("id");
    if (error) throw error;
    topics += data?.length || 0;
  }
  // Embeddings in the background — search finds the topics once they land.
  import("./routes.js").then(async ({ reembedMissingCurriculum }) => {
    for (let round = 0; round < 40; round++) { const r = await reembedMissingCurriculum({ limit: 100 }); if (!r.embedded || !r.remaining) break; }
  }).catch((e) => console.warn("[curriculum import] embeddings:", e?.message || e));
  return { curriculumId: cur.id, themes: Object.keys(themeId).length, subthemes: Object.keys(subId).length, topics, frontMatter: Object.keys(front) };
}
