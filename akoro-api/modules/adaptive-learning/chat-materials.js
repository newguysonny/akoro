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

const ALLOWED = [/^\/blog\/[\w-]+$/, /^\/write\/blog\/[\w-]+$/, /^\/course\/[\w-]+$/, /^\/library\?record=[0-9a-f-]{36}(?:&tool=(?:quiz|flashcards|summary|notes|podcast))?$/i, /^\/library\?folder=[0-9a-f-]{36}$/i, /^\/library\?record=[0-9a-f-]{36}&artifact=[0-9a-f-]{36}$/i, /^\/activities\/[\w-]+$/];
const MAX = 8;
const TOOL_LABEL = { quiz: "Quiz", flashcards: "Flashcards", summary: "Summary", notes: "Notes", podcast: "Podcast" };
const clip = (s, n = 90) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const link = (kind, title, href) => (title && ALLOWED.some((re) => re.test(href)) ? { kind, title: clip(title), href } : null);
const withSub = (m, sub) => (m && sub ? { ...m, sub: clip(sub, 90) } : m);
const teach = (topic, subject) => (topic ? { kind: "topic", title: clip(topic), action: { type: "teach", topic: clip(topic, 120), subject: clip(subject, 80) || null } } : null);

/** One tool's result → its materials. */
export function materialsFrom(tool, result) {
  const r = result && typeof result === "object" ? result : {};
  switch (tool) {
    case "search_blog_posts":
      // The passages the answer used come first (post title + the section they're from), then the posts.
      return [
        ...(r.passages || []).map((p) => withSub(link("blog_passage", p.title, `/blog/${p.slug}`), `Akoro blog${p.heading ? ` · ${p.heading}` : ""}`)),
        ...(r.posts || []).map((p) => link("blog", p.title, `/blog/${p.slug}`)),
      ];
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
    case "make_study_material": {
      // What chat made: a saved reader tab — the card opens the reader on it.
      // Several documents in the folder: tapping one chooses it (sent as the learner's reply).
      if (!r.made) return (r.records || []).map((x) => (x.name ? { kind: "choice", title: clip(x.name), action: { type: "reply", text: clip(`Make the ${r.tool || "quiz"} from ${x.name}`, 160) } } : null));
      const unit = r.tool === "quiz" ? "questions" : r.tool === "flashcards" ? "cards" : "points";
      // Provenance rides the card, not the model's prose: a platform-tier
      // build (Discover free notes, copied into the learner's Library) says
      // so on the card itself, whoever wrote the reply text.
      const fromDiscover = r.source === "platform"
        ? (r.sourceOwner ? `from ${clip(r.sourceOwner, 40)}'s free notes in Discover` : "from free notes in Discover")
        : null;
      const sub = r.tool === "podcast"
        ? ["Being made — ready in a minute or two", fromDiscover].filter(Boolean).join(" · ")
        : [r.count ? `${r.count} ${unit}` : null, fromDiscover].filter(Boolean).join(" · ") || null;
      const m = withSub(link("study_output", `${TOOL_LABEL[r.tool] || r.tool} · ${r.name}`, r.href), sub);
      return [m ? { ...m, tool: r.tool } : null];
    }
    case "ask_to_be_taught":
      // Not taught yet: Akoro's own courses and posts on it, to read before teaching the protégé.
      return (r.materials || []).map((m) => link(m.kind, m.title, m.href));
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
    const key = m.href || `${m.action?.type}:${String(m.action?.topic ?? m.action?.text).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
    if (out.length >= MAX) break;
  }
  return out;
}
