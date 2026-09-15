/**
 * blog-research.contract.test.mjs — the agent's internal research channel.
 *
 * The agent's replacement for web search: search_blog_posts + read_blog_post
 * over content.blog_posts (published-only), bodies flattened to plain text
 * the model can quote and reason over. Pure helpers are behaviour-tested;
 * the wiring is pinned by source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { flattenBlogBody, sanitizeBlogQuery, blogBlockToLines, BLOG_BODY_MAX_CHARS } from "./lib/blogBody.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(ROOT, ...p), "utf8");
const chatJs = read("modules/adaptive-learning/chat.js");
const research = read("modules/adaptive-learning/blogResearch.js");

test("blog body · blocks flatten to model-readable text, tags stripped, capped", () => {
  const body = [
    { type: "h", text: "Spaced <b>repetition</b>" },
    { type: "p", text: "Review at  day 1, 3 and 7." },
    { type: "list", items: ["Day 1", "  Day 3 ", null, "Day 7"] },
    { type: "quote", text: "Little and often beats cramming." },
    { type: "image", src: "https://cdn.example/x.jpg", alt: "A revision timetable" },
    { type: "p", text: null },
    "not-a-block",
  ];
  const text = flattenBlogBody(body);
  assert.match(text, /^## Spaced repetition\n\n/);              // heading first, tags gone
  assert.match(text, /- Day 1\n\n- Day 3\n\n- Day 7/);          // list items, blanks dropped
  assert.match(text, /> Little and often beats cramming\./);    // quote
  assert.match(text, /\[image: A revision timetable\]/);        // image → alt only
  assert.doesNotMatch(text, /<\/?[a-z]|https:\/\/cdn/i);        // no markup tags or asset urls
  assert.equal(flattenBlogBody([]), "");
  assert.equal(flattenBlogBody(null), "");
  assert.equal(blogBlockToLines({ type: "p", text: "hi" })[0], "hi");
  // cap appends an ellipsis, never throws
  const long = flattenBlogBody([{ type: "p", text: "x".repeat(BLOG_BODY_MAX_CHARS + 500) }]);
  assert.equal(long.length, BLOG_BODY_MAX_CHARS + 1);
  assert.ok(long.endsWith("…"));
});

test("blog query · PostgREST .or() breakers stripped, empty/overlong rejected", () => {
  assert.equal(sanitizeBlogQuery("past questions").ok, true);
  assert.equal(sanitizeBlogQuery("past,questions").query, "past questions"); // comma would fork the or()
  assert.equal(sanitizeBlogQuery("  WAEC  ").query, "WAEC");
  assert.equal(sanitizeBlogQuery("").ok, false);
  assert.equal(sanitizeBlogQuery(null).ok, false);
  assert.equal(sanitizeBlogQuery("x".repeat(121)).ok, false);
});

test("chat wiring · search + read ship as gated student tools with honest guidance", () => {
  // schemas exist with the kill-switch gate
  assert.match(chatJs, /name: "search_blog_posts",\s*\n\s*featureGate: "blog_research",/);
  assert.match(chatJs, /name: "read_blog_post",\s*\n\s*featureGate: "blog_research",/);
  assert.match(chatJs, /blog_research: blogResearchEnabled/);
  assert.match(chatJs, /AKORO_BLOG_RESEARCH_ENABLED \?\? "true"/);
  // the description tells the model this replaces web search
  assert.match(chatJs, /This is your internal research channel \(there is no web search\)/);
  // capability card updated: research from the blog, not the live web
  assert.match(chatJs, /Research from Akoro\\u2019s own blog \(search_blog_posts \/ read_blog_post\)/);
  // dispatch cases go through the one executor; missing slug clarifies
  assert.match(chatJs, /case "search_blog_posts": \{[\s\S]*?return await searchBlogPosts\(/);
  assert.match(chatJs, /case "read_blog_post": \{[\s\S]*?return clarify\("slug"/);
  assert.match(chatJs, /import \{ searchBlogPosts, readBlogPost, BLOG_SEARCH_MAX_RESULTS \} from "\.\/blogResearch\.js";/);
  // read-only tools: never in the sideEffecting echo list
  assert.doesNotMatch(chatJs, /sideEffecting: \[[^\]]*search_blog_posts/);
  assert.doesNotMatch(chatJs, /sideEffecting: \[[^\]]*read_blog_post/);
});

test("blog research module · published-only, clamped, related posts follow", () => {
  // both paths only ever see published rows
  assert.ok((research.match(/\.eq\("status", "published"\)/g) || []).length >= 3);
  // search: ILIKE over title/excerpt/category, order + clamp
  assert.match(research, /title\.ilike\.%\$\{s\}%,excerpt\.ilike\.%\$\{s\}%,category\.ilike\.%\$\{s\}%/);
  assert.match(research, /Math\.min\(Math\.max\(Number\.parseInt\(limit, 10\) \|\| 5, 1\), BLOG_SEARCH_MAX_RESULTS\)/);
  assert.match(research, /order\("published_at", \{ ascending: false \}\)/);
  // read: maybeSingle by slug, body flattened, related same-category slugs
  assert.match(research, /\.eq\("slug", clean\)\.eq\("status", "published"\)\s*\n\s*\.maybeSingle\(\)/);
  assert.match(research, /body: flattenBlogBody\(post\.body\)/);
  assert.match(research, /\.neq\("id", post\.id\)/);
  assert.match(research, /\.limit\(3\)/);
  // honest failures — the observation envelope carries them to the learner
  assert.match(research, /No published Akoro blog post with the slug/);
  assert.match(research, /Pass the slug from search_blog_posts\./);
});
