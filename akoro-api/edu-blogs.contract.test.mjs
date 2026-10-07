/**
 * edu-blogs.contract.test.mjs — learner-authored blogs (higherEd library).
 *
 * The Library + menu becomes a choice (Upload → the existing sheet,
 * Blog → a new editor page, higher-ed gated). The editor writes the
 * platform's markdown-subset (preview through the shared RichText path,
 * no HTML anywhere) and saves draft / publishes. Backend: edu.blogs +
 * /api/blogs with author ownership, drafts private (404, never 403),
 * publish requires a body, first publish stamps published_at.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const API = path.dirname(fileURLToPath(import.meta.url));
const LEARNER = path.join(API, "..", "akoro-learner");
const read = (root, ...p) => readFileSync(path.join(root, ...p), "utf8");

const sql = read(API, "migrations/2026-edu-blogs.sql");
const routes = read(API, "modules/blogs/routes.js");
const service = read(API, "modules/blogs/service.js");
const appJs = read(API, "app.js");
const editor = read(LEARNER, "src/pages/BlogEditorPage.jsx");
const library = read(LEARNER, "src/pages/LibraryPage.jsx");
const libraryApi = read(LEARNER, "src/services/libraryApi.js");
const appTsx = read(LEARNER, "src/App.jsx");

test("edu.blogs · draft/published with the learner owning their posts", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS edu\.blogs/);
  assert.match(sql, /user_id\s+UUID NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
  assert.match(sql, /status\s+TEXT NOT NULL DEFAULT 'draft' CHECK \(status IN \('draft','published'\)\)/);
  assert.match(sql, /idx_edu_blogs_user/);
  assert.match(appJs, /app\.use\("\/api\/blogs",\s+standardLimit, blogsModule\)/);
});

test("blogs API · ownership, private drafts, publish needs a body", () => {
  // routes are thin over the service — the ONE write path the chat tools share
  assert.match(routes, /import \{ listMyBlogs, getBlogFor, createBlogPost, updateBlogPost, deleteBlogPost \} from "\.\/service\.js";/);
  // every write is scoped to the author (inside the service)
  assert.match(service, /\.eq\("id", id\)\.eq\("user_id", userId\)/);
  // drafts are invisible to other learners — 404-shaped, never a 403 existence leak
  assert.match(service, /data\.status !== "published" && data\.user_id !== userId\) return \{ notFound: true \};/);
  // publish requires content — the rule lives once, in the shared validator;
  // create AND patch merge-validate through it
  assert.equal((service.match(/Write something before publishing/g) || []).length, 1);
  assert.match(service, /const cleanStatus = BLOG_STATUSES\.includes\(status\) \? status : "draft";/);
  assert.match(service, /const v = validateBlogInput\(\{\s*\n\s*title: patch\.title !== undefined \? patch\.title : existing\.title,/);
  // first publish stamps; unpublish clears; re-publish keeps the first date
  assert.match(service, /existing\.published_at \?\? new Date\(\)\.toISOString\(\)/);
  assert.match(service, /: null;/);
  // title/body caps
  assert.match(service, /TITLE_MAX = 120/);
  assert.match(service, /BODY_MAX = 50_000/);
});

test("library + menu · a choice modal — Upload opens the sheet, Blog opens the editor", () => {
  // + opens the choice modal, not the sheet directly
  assert.match(library, /onClick=\{\(\) => setAddOpen\(true\)\}/);
  assert.match(library, /aria-label="Add to library"/);
  // Upload chains into the existing AddRecordModal sheet
  assert.match(library, /\{\s*setAddOpen\(false\);\s*setSheetOpen\(true\);\s*\}/);
  // Blog row is higher-ed gated through the one studyLevel gate (the
  // useHigherEd hook since the tier-cache round — same gate, cached tier)
  assert.match(library, /import \{ useHigherEd \} from '\.\.\/hooks\/useStudyTier\.js';/);
  assert.match(library, /const higherEd = useHigherEd\(\);/);
  assert.match(library, /\{higherEd && \(/);
  assert.match(library, /navigate\('\/write\/blog\/new'\)/);
  // the sheet itself is untouched
  assert.match(library, /<AddRecordModal\s+open=\{sheetOpen\}/);
});

test("blog editor page · markdown-subset toolbar, RichText preview, draft + publish", () => {
  // routes (marketing /blog/:slug is untouched — editor lives under /write)
  assert.match(appTsx, /\/write\/blog\/new/);
  assert.match(appTsx, /\/write\/blog\/:id/);
  assert.match(appTsx, /BlogEditorPage/);
  // no HTML path: preview renders through the shared RichText component
  assert.match(editor, /import RichText from '\.\.\/components\/common\/RichText\.jsx';/);
  assert.match(editor, /\? <RichText text=\{body\} \/>/);
  assert.doesNotMatch(editor, /dangerouslySetInnerHTML|contentEditable/);
  // toolbar inserts markdown-subset markers around the selection
  assert.match(editor, /before: '\*\*', after: '\*\*'/);
  assert.match(editor, /const next = body\.slice\(0, start\) \+ lead \+ tool\.before \+ selected \+ tool\.after \+ body\.slice\(end\);/);
  // draft / publish with honest client-side validation + one request at a time
  assert.match(editor, /import { useInFlight } from '\.\.\/hooks\/useInFlight\.js';/);
  assert.match(editor, /const saveRun = useInFlight\(\);/);
  assert.match(editor, /Write something before publishing/);
  assert.match(editor, /\{saveRun\.busy \? <Spinner size=\{11\} color="#fff" \/> : <Icon name="ti-world-upload"/);
  // edit mode loads by id; delete goes through the shared confirm
  assert.match(editor, /fetchBlog\(id\)/);
  assert.match(editor, /await confirmDialog\(\{/);
  assert.match(editor, /await deleteBlog\(id\)/);
});

test("library · blogs are a first-class kind with draft/published cards", () => {
  assert.match(libraryApi, /import \{ fetchMyBlogs \} from '\.\/blogApi\.js';/);
  assert.match(libraryApi, /kind:\s+'blog'/);
  assert.match(libraryApi, /fetchBlogs\(\), fetchFolders\(\)/);
  assert.match(library, /blog:\s+\{ icon: 'ti-news',\s+color: '#0EA5E9' \}/);
  assert.match(library, /\{ key: 'blog',\s+label: 'Blogs'\s+\}/);
  // card shows the honest state; tapping opens the editor
  assert.match(library, /\{published \? 'Published' : 'Draft'\}/);
  // card opens route through openLibraryItem, which parks the item on the
  // Now-Studying bar and navigates (blogs to the editor, courses to /course)
  assert.match(library, /it\.kind === 'blog' \? `\/write\/blog\/\$\{it\.id\}` : `\/course\/\$\{it\.slug \|\| it\.id\}`/);
  assert.match(library, /onOpen=\{openLibraryItem\}/);
});
