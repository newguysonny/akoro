/**
 * edu-blogs-public.contract.test.mjs — learner blogs on the public website.
 *
 * A published learner blog is mirrored into content.blog_posts under the
 * "Community" category, so the landing homepage carousel (listPosts limit 8)
 * and the /blog page render it with no new surface. Edits re-sync, unpublish
 * and delete remove the mirror; mirroring is best-effort (the learner's save
 * never fails on a mirror hiccup).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { markdownToBlogBlocks, blogReadMinutes } from "./lib/blogBody.js";

const API = path.dirname(fileURLToPath(import.meta.url));
const LEARNER = path.join(API, "..", "akoro-learner");
const read = (root, ...p) => readFileSync(path.join(root, ...p), "utf8");

const sql = read(API, "migrations/2026-edu-blogs-public.sql");
const mirror = read(API, "modules/blogs/mirror.js");
const routes = read(API, "modules/blogs/routes.js");
const service = read(API, "modules/blogs/service.js");
const blogData = read(LEARNER, "src/data/blogPosts.js");

test("public mirror · markdown-subset converts to the blog's block types", () => {
  const md = [
    "Intro line",
    "",
    "## The plan",
    "Body with **bold** and `code`.",
    "- bullet one",
    "- bullet two",
    "1. numbered stays visible",
    "",
    "> A pull quote",
    "### Deep heading",
    "Closing.",
  ].join("\n");
  const blocks = markdownToBlogBlocks(md);
  assert.deepEqual(blocks.map((b) => b.type), ["p", "h", "p", "list", "quote", "h", "p"]);
  assert.equal(blocks[0].text, "Intro line");
  assert.equal(blocks[1].text, "The plan");
  assert.equal(blocks[2].text, "Body with bold and code.");   // markers stripped
  assert.deepEqual(blocks[3].items, ["bullet one", "bullet two", "1. numbered stays visible"]);
  assert.equal(blocks[4].text, "A pull quote");
  assert.deepEqual(markdownToBlogBlocks(""), []);
  assert.deepEqual(markdownToBlogBlocks(null), []);
  // read time ~200 wpm, minimum 1
  assert.equal(blogReadMinutes("word ".repeat(400).trim()), 2);
  assert.equal(blogReadMinutes("short"), 1);
});

test("public mirror · syncs on publish, re-syncs edits, removes on unpublish/delete", () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS public_slug TEXT/);
  // the mirror IS a content.blog_posts row in the Community category
  assert.match(mirror, /COMMUNITY_CATEGORY = "Community"/);
  assert.match(mirror, /category: COMMUNITY_CATEGORY/);
  assert.match(mirror, /status: "published"/);
  assert.match(mirror, /featured: false/);   // never displaces the marketing featured post
  assert.match(mirror, /markdownToBlogBlocks\(blog\.body\)/);
  assert.match(mirror, /blogReadMinutes\(blog\.body\)/);
  // stable slug embedding the blog id; update-vs-insert by slug; public_slug remembered
  assert.match(mirror, /blog\.public_slug \|\| `\$\{slugify\(blog\.title\)\}-\$\{String\(blog\.id\)\.slice\(0, 8\)\}`/);
  assert.match(mirror, /\.from\("blog_posts"\)\.update\(row\)\.eq\("id", existing\.id\)/);
  assert.match(mirror, /\.from\("blogs"\)\.update\(\{ public_slug: slug \}\)/);
  // the mirror exists only while published
  assert.match(mirror, /export async function removeBlogMirror\(publicSlug\)/);
  assert.match(mirror, /\.from\("blog_posts"\)\.delete\(\)\.eq\("slug", publicSlug\)/);
  // service wiring (the one write path): every transition, best-effort
  assert.match(service, /const mirrorBlog = async \(userId, blog\) => \{[\s\S]*?catch \(e\) \{ console\.warn\("\[blogs\] public mirror sync failed:"/);
  assert.match(service, /if \(data\.status === "published"\) await mirrorBlog\(userId, data\);/);
  assert.match(service, /await mirrorBlog\(userId, \{ \.\.\.data, public_slug: existing\.public_slug \}\);/);
  assert.match(service, /await unmirrorBlog\(existing\);            \/\/ unpublished → off the public blog/);
  assert.match(service, /if \(doomed\.public_slug\) await unmirrorBlog\(doomed\);/);
  assert.match(service, /\.select\("id, user_id, title, body, status, published_at, public_slug"\)/);
});

test("public surfaces · Community is a first-class category chip", () => {
  assert.match(blogData, /export const CATS = \['All', 'Learning Science', 'Product', 'Education', 'AI & Future', 'Case Studies', 'Community'\];/);
  assert.match(blogData, /'Community':\s+\{ Icon: Users,\s+color: '#E0F2FE' \}/);
  // unknown categories still fall back — mirrored posts can never break the page
  assert.match(blogData, /export const catMeta = \(cat\) => CAT_META\[cat\] \|\| \{ Icon: BookOpen, color: '#EDE9FF' \};/);
});
