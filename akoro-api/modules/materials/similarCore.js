/**
 * modules/materials/similarCore.js — "Find similar material" (Grand Plan
 * §7.17.2 offering_more, D52): only Akoro's own content — published blog
 * posts and courses — matched to the topics an upload covers. Pure.
 *
 * Each candidate says why it was offered (the upload's topic and, for a past
 * paper, the questions on it) and becomes a folder item the learner chose.
 */
export const SIMILAR_LIMITS = Object.freeze({ TOPICS: 4, PER_TOPIC: 2, MAX: 6, ADD: 6 });

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** The topics to search for, heaviest first, with the questions on each. */
export function searchTopics(structure) {
  const topics = [...(structure?.topics || [])].sort((a, b) => (b.weight || 0) - (a.weight || 0)).slice(0, SIMILAR_LIMITS.TOPICS);
  return topics.map((t) => ({ name: t.name, query: clip(t.name.split(/\s+(?:and|&)\s+/i)[0], 60) }));
}

/** Blog posts and courses found per topic → deduped candidates (the heaviest topic's first). */
export function shapeCandidates(found, { questionsByTopic = {} } = {}) {
  const seen = new Set();
  const out = [];
  for (const { topic, posts = [], courses = [] } of found) {
    const qs = questionsByTopic[topic] || [];
    const why = qs.length ? `${topic} · ${qs.slice(0, 3).map((n) => `Q${n}`).join(", ")}` : topic;
    const add = (c) => { if (!seen.has(c.key) && out.length < SIMILAR_LIMITS.MAX) { seen.add(c.key); out.push({ ...c, why: clip(why, 60) }); } };
    for (const c of courses.slice(0, SIMILAR_LIMITS.PER_TOPIC)) {
      if (c?.slug && c?.title) add({ key: `course:${c.slug}`, kind: "course", title: clip(c.title, 120), sub: c.lessons ? `Course · ${c.lessons} lessons` : "Course", href: `/course/${c.slug}` });
    }
    for (const p of posts.slice(0, SIMILAR_LIMITS.PER_TOPIC)) {
      if (p?.slug && p?.title) add({ key: `blog:${p.slug}`, kind: "blog", title: clip(p.title, 120), sub: p.readMin ? `Blog · ${p.readMin} min read` : "Blog", href: `/blog/${p.slug}` });
    }
  }
  return out;
}

/** A chosen candidate → its folder item (an in-app link; the learner's own pick). */
export function folderItemForCandidate(c) {
  return { item_type: "library", item_ref: c.key, title: clip(c.title, 255), sub: clip(c.sub, 255) || null, kind: c.kind, link: c.href };
}
