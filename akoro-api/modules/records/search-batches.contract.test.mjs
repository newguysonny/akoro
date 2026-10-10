import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";

const { replaceRecordChunks } = await import("./searchLib.js");

/**
 * Pages arrive from POST /extract in batches of ≤8. A batch must replace
 * only its own pages' search chunks: deleting every page chunk made a long
 * PDF searchable on its last batch alone.
 */
function fakeDb() {
  let rows = [];
  const db = {
    get rows() { return rows; },
    schema: () => ({
      from: (table) => {
        assert.equal(table, "record_chunks");
        return {
          delete() {
            const filters = [];
            const q = {
              eq(col, val) { filters.push((r) => r[col] === val); return q; },
              in(col, vals) { filters.push((r) => vals.includes(r[col])); return q; },
              then(resolve) {
                rows = rows.filter((r) => !filters.every((f) => f(r)));
                resolve({ error: null });
              },
            };
            return q;
          },
          insert(newRows) { rows.push(...newRows); return Promise.resolve({ error: null }); },
        };
      },
    }),
  };
  return db;
}

const deps = (db) => ({ db, embedMany: async (texts) => texts.map(() => null) });
const page = (n, text = `Text of page ${n}`) => ({ pageNumber: n, text });
const batch = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => page(from + i));
const pagesOf = (db) => db.rows.filter((r) => r.kind === "page").map((r) => r.page_number).sort((a, b) => a - b);
const base = { userId: "u1", recordId: "r1", contentKey: "k1", kind: "page" };

test("each extract batch keeps the pages earlier batches indexed", async () => {
  const db = fakeDb();
  await replaceRecordChunks({ ...base, rows: batch(1, 8), pageNumbers: [1, 2, 3, 4, 5, 6, 7, 8] }, deps(db));
  await replaceRecordChunks({ ...base, rows: batch(9, 16), pageNumbers: [9, 10, 11, 12, 13, 14, 15, 16] }, deps(db));
  await replaceRecordChunks({ ...base, rows: batch(17, 20), pageNumbers: [17, 18, 19, 20] }, deps(db));
  assert.deepEqual(pagesOf(db), Array.from({ length: 20 }, (_, i) => i + 1));
});

test("re-extracting a page replaces its chunk, and a page that comes back empty is cleared", async () => {
  const db = fakeDb();
  await replaceRecordChunks({ ...base, rows: batch(1, 3), pageNumbers: [1, 2, 3] }, deps(db));
  await replaceRecordChunks({ ...base, rows: [page(2, "Fresh text of page 2")], pageNumbers: [2, 3] }, deps(db));
  assert.deepEqual(pagesOf(db), [1, 2]);
  assert.equal(db.rows.find((r) => r.page_number === 2).chunk_text, "Fresh text of page 2");
});

test("other kinds still replace everything of their kind; other records are untouched", async () => {
  const db = fakeDb();
  await replaceRecordChunks({ ...base, kind: "transcript", rows: [{ text: "old window one" }, { text: "old window two" }] }, deps(db));
  await replaceRecordChunks({ ...base, recordId: "r2", rows: [page(1)], pageNumbers: [1] }, deps(db));
  await replaceRecordChunks({ ...base, kind: "transcript", rows: [{ text: "new window" }] }, deps(db));
  assert.deepEqual(db.rows.filter((r) => r.kind === "transcript").map((r) => r.chunk_text), ["new window"]);
  assert.equal(db.rows.filter((r) => r.record_id === "r2").length, 1);
});

test("a failed embedding leaves the existing chunks in place", async () => {
  const db = fakeDb();
  await replaceRecordChunks({ ...base, rows: batch(1, 2), pageNumbers: [1, 2] }, deps(db));
  await assert.rejects(replaceRecordChunks(
    { ...base, rows: batch(1, 2), pageNumbers: [1, 2] },
    { db, embedMany: async () => { throw new Error("embeddings down"); } },
  ));
  assert.deepEqual(pagesOf(db), [1, 2]);
});
