/**
 * modules/records/record-search.contract.test.mjs
 *
 * Guards the library's semantic search (2026-record-search.sql):
 *   • chunks are file-and-record-faithful — kinds, cascades, one vector dim;
 *   • the match function is the house RRF hybrid (vector + lexical), scoped
 *     to ONE learner, with a lexical-only fallback arm;
 *   • indexing is fire-and-forget at every birthplace of text (create,
 *     extraction, transcription) — it must never fail the flow that
 *     produced the text, and the sweeper backfills whatever it missed;
 *   • the learner surface: server-searched Library, honest empty states,
 *     hits that open the record's teaching session.
 *
 * Everything runs offline — no OpenAI, no database.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");

const [manifest, manifestRaw, migration, searchLibSrc, routesSrc, sweeperSrc,
  recordsApiSrc, librarySrc, libraryHeaderSrc, libraryContentSrc, libraryDataSrc] = await Promise.all([
  read("../../migrations/manifest.json"),
  read("../../migrations/manifest.json"),
  read("../../migrations/2026-record-search.sql"),
  read("searchLib.js"),
  read("routes.js") + read("service-records.js") + read("service-extract.js") + read("service-transcribe.js"),
  read("../../lib/embeddingSweeper.js"),
  read("../../../akoro-learner/src/services/recordsApi.js"),
  read("../../../akoro-learner/src/features/library/LibraryPage.jsx"),
  read("../../../akoro-learner/src/features/library/components/LibraryHeader.jsx"),
  read("../../../akoro-learner/src/features/library/components/LibraryContent.jsx"),
  read("../../../akoro-learner/src/features/library/hooks/useLibraryData.js"),
]);

test("the migration exists, is registered, and keeps the learner-data rules", () => {
  const parsed = JSON.parse(manifest);
  const idx = parsed.schema.indexOf("2026-record-search.sql");
  assert.ok(idx > parsed.schema.indexOf("2026-content-cache.sql"), "registered, after the content cache it indexes");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS edu\.record_chunks/);
  assert.match(migration, /kind[^\n]*CHECK \(kind IN \('name', 'paste', 'page', 'transcript'\)\)/, "the four chunk kinds");
  assert.match(migration, /vector\(1536\)/, "the platform's one embedding dimension");
  assert.match(migration, /user_id[^\n]*REFERENCES public\.users\(id\) ON DELETE CASCADE/, "chunks die with their learner");
  assert.match(migration, /record_id[^\n]*REFERENCES edu\.records\(id\) ON DELETE CASCADE/, "chunks die with their record");
  assert.match(migration, /USING ivfflat \(embedding vector_cosine_ops\)/, "the vector arm has its index");
  assert.match(migration, /WHERE embedding IS NULL AND embedded_at IS NULL/, "the sweeper's question is indexed");
});

test("the match function is the house hybrid, scoped to one learner", () => {
  assert.match(migration, /DROP FUNCTION IF EXISTS/, "overloads are dropped before CREATE (the arity-trap fix)");
  assert.match(migration, /CREATE FUNCTION public\.match_record_chunks\(/);
  assert.match(migration, /WHERE c\.user_id = p_user_id/, "search never crosses learners");
  assert.match(migration, /p_record_id IS NULL OR c\.record_id = p_record_id/, "an optional single-record scope");
  assert.match(migration, /JOIN edu\.records r ON r\.id = c\.record_id/, "hits carry their record's identity");
  assert.match(migration, /1\.0 \/ \(60 \+ v\.rank\)/, "RRF with the paper's k=60 — no tunable score scales");
  assert.match(migration, /public\.or_tsquery\(p_query_text\)/, "the shared OR-lexed lexical arm");
  assert.match(migration, /WHERE p_query_embedding IS NOT NULL AND f\.embedding IS NOT NULL/, "a missing vector arm is one unvote, not an error");
  assert.match(migration, /WHERE public\.or_tsquery\(p_query_text\) IS NOT NULL/, "and so is a missing lexical arm");
});

test("shaping cuts on boundaries, never mid-sentence or mid-segment", () => {
  assert.match(searchLibSrc, /lastIndexOf\("\\n", maxChars\)/, "prefers a paragraph break");
  assert.match(searchLibSrc, /lastIndexOf\("\. ", maxChars\)/, "then a sentence end");
  assert.match(searchLibSrc, /const startMs = Number/, "windows keep their start");
  // windowsFromSegments: a segment (a diarized paragraph) is never split
  assert.match(searchLibSrc, /cur\.texts\.push\(text\)/, "segments join whole");
  assert.match(searchLibSrc, /cur\.endMs = Math\.max\(cur\.endMs/, "windows span their members");
  assert.match(searchLibSrc, /export function snippetOf/, "snippets are shaped once, shared");
});

test("embedding is batched, metered, and fails soft", () => {
  assert.match(searchLibSrc, /text-embedding-3-small/, "the platform model");
  assert.match(searchLibSrc, /const BATCH = 64/, "few OpenAI calls, not one per chunk");
  assert.match(searchLibSrc, /__userId: userId/, "metered to the acting learner");
  assert.match(searchLibSrc, /if \(!clean\.length \|\| !hasOpenAI\(\)\) return clean\.map\(\(\) => null\);/, "no key → nulls, rows still insert");
  assert.match(searchLibSrc, /out\[i \+ d\.index\] = d\.embedding/, "batch indices map back to their rows");
});

test("the write path is idempotent and bounded", () => {
  assert.match(searchLibSrc, /\.delete\(\)\n    \.eq\("record_id", recordId\)\.eq\("kind", kind\)/, "delete-then-insert per kind — re-running a page can't double-index it");
  assert.match(searchLibSrc, /\.slice\(0, 200\)/, "a malformed write cannot insert thousands");
  assert.match(searchLibSrc, /text\.length >= 3/, "no empty chunks");
  assert.match(searchLibSrc, /\.eq\("file_key", contentKey\)/, "shared keys index under the record that owns the file");
  assert.match(searchLibSrc, /if \(!rec\) return;/, "lesson keys resolve to no record and are skipped — the library indexes records");
});

test("indexing never blocks the flow that produced the text", () => {
  assert.match(routesSrc, /void indexRecord\(\{/, "record create fires and forgets");
  assert.match(routesSrc, /if \(saved\.length\) void indexByContentKey\(\{ contentKey, pages: saved \}\)/, "each status poll indexes the pages it saved");
  assert.match(routesSrc, /void indexByContentKey\(\{ contentKey, segments: result\.segments \}\)/, "a transcription indexes after finishing the job");
  assert.match(searchLibSrc, /console\.warn\(`\[record-search\] indexing record \$\{recordId\} failed \(sweeper will repair\)/, "failures warn and defer to the sweeper");
});

test("the sweeper owns record_chunks like every other store", () => {
  assert.ok(sweeperSrc.includes('table: "record_chunks", schema: "edu"'), "registered as a store");
  assert.ok(sweeperSrc.includes("stamp: null,"), "immutable rows pass no stamp — missing is the only staleness");
  assert.ok(sweeperSrc.includes("text: (r) => r.chunk_text ?? \"\""), "the row's text is what gets embedded");
});

test("the route: learner-scoped, query-honest, degrading safely", () => {
  assert.match(routesSrc, /router\.get\("\/search", authenticateToken/, "learner-authenticated");
  assert.match(routesSrc, /if \(!q\) return res400\(res, "A search query is required\."\)/, "no empty queries");
  assert.match(searchLibSrc, /Math\.min\(Math\.max\(wanted \* 3, wanted\), 96\)/, "the limit is clamped server-side");
  assert.match(routesSrc, /results: \[\], query: q, error: "Search is unavailable right now\."/ , "an outage is an empty page, not a 500");
  assert.match(recordsApiSrc, /export async function searchRecords/, "the learner seam exists");
  assert.ok(recordsApiSrc.includes("} catch { return []; }"), "offline → the shelf stays browsable");
});

test("the Library search box: debounced, honest, hits open sessions", () => {
  assert.match(libraryHeaderSrc, /placeholder="Search inside your records…"/, "the box promises what it does");
  assert.match(libraryDataSrc, /setTimeout\(async/, "debounced");
  assert.match(libraryDataSrc, /, 350\)/, "…by 350ms");
  assert.match(libraryDataSrc, /searchRecords\(query, qLimit\)/, "server-searched, not a client filter of a capped cache");
  assert.match(libraryDataSrc, /const openSearchHit =/, "a hit resolves the record through the normal open flow");
  assert.match(libraryDataSrc, /That record is no longer on your shelf/, "a stale hit says so");
  assert.match(libraryContentSrc, /No matches for/, "an empty search says so");
  assert.match(libraryHeaderSrc, /setQ\(''\)/, "clearing returns to the shelf");
});
