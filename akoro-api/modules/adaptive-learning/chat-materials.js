/**
 * modules/adaptive-learning/chat-materials.js — the learning materials an
 * Agent Chat reply can point to, as clickable links: built from what the
 * tools actually returned (ids, slugs), never from the model's prose, and
 * only to the app's own pages.
 *
 *   { kind, title, href? , action? }
 *     href     an in-app route (/blog/…, /course/…, /library?record=…, /library?folder=…)
 *     action   { type: "teach", topic, subject } — a topic opens a teaching session
 */

const ALLOWED = [/^\/blog\/[\w-]+$/, /^\/write\/blog\/[\w-]+$/, /^\/course\/[\w-]+$/, /^\/library\?record=[0-9a-f-]{36}(?:&tool=(?:quiz|flashcards|summary|notes|podcast))?$/i, /^\/library\?folder=[0-9a-f-]{36}$/i, /^\/activities\/[\w-]+$/];
const MAX = 8;
const TOOL_LABEL = { quiz: "Quiz", flashcards: "Flashcards", summary: "Summary", notes: "Notes", podcast: "Podcast" };
const clip = (s, n = 90) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const link = (kind, title, href) => (title && ALLOWED.some((re) => re.test(href)) ? { kind, title: clip(title), href } : null);
const teach = (topic, subject) => (topic ? { kind: "topic", title: clip(topic), action: { type: "teach", topic: clip(topic, 120), subject: clip(subject, 80) || null } } : null);

/** One tool's result → its materials. */
export function materialsFrom(tool, result) {
  const r = result && typeof result === "object" ? result : {};
  switch (tool) {
    case "search_blog_posts":
      return (r.posts || []).map((p) => link("blog", p.title, `/blog/${p.slug}`));
    case "read_blog_post":
      return [r.found !== false && r.slug ? link("blog", r.title, `/blog/${r.slug}`) : null, ...(r.related || []).map((p) => link("blog", p.title, `/blog/${p.slug}`))];
    case "list_my_blogs":
      return (r.blogs || []).map((b) => link("my_blog", b.title, `/write/blog/${b.blogId}`));
    case "save_blog_draft":
      return [r.blogId ? link("my_blog", r.title, `/write/blog/${r.blogId}`) : null];
    case "check_progress":
      return (r.courses || []).map((c) => (c.slug ? link("course", c.title, `/course/${c.slug}`) : null));
    case "get_learning_overview":
      return (r.courses || []).map((c) => (c.slug ? link("course", c.title, `/course/${c.slug}`) : null));
    case "analyse_past_papers":
    case "search_my_library":
      // With a study tool asked for, the link opens the reader on it ("Quiz · Cell notes").
      return (r.records || []).map((x) => link(x.tool ? "study_tool" : "record", x.tool ? `${TOOL_LABEL[x.tool] || x.tool} · ${x.name}` : x.name,
        `/library?record=${x.recordId}${x.tool ? `&tool=${x.tool}` : ""}`));
    case "get_weak_topics":
      return (r.weak_topics || []).map((t) => teach(t.topic, t.subject));
    default:
      return [];
  }
}

/** All of a turn's materials, deduped, capped. */
export function collectMaterials(list) {
  const seen = new Set();
  const out = [];
  for (const m of (Array.isArray(list) ? list : []).flat()) {
    if (!m) continue;
    const key = m.href || `${m.action?.type}:${String(m.action?.topic).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
    if (out.length >= MAX) break;
  }
  return out;
}
