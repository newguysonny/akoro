import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pharmdContentKey, parsePharmdKey } from "../../lib/contentKey.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the PHARM.D key is versioned by the file hash when it exists", () => {
  assert.equal(pharmdContentKey({ file_path: "BIO 111/01.pdf" }), "pharmd:BIO 111/01.pdf");
  assert.equal(pharmdContentKey({ file_path: "BIO 111/01.pdf", file_hash: "abc123" }), "pharmd:BIO 111/01.pdf#abc123");
  assert.equal(pharmdContentKey({}), null);
  assert.deepEqual(parsePharmdKey("pharmd:BIO 111/01.pdf#abc123"), { path: "BIO 111/01.pdf", hash: "abc123" });
  assert.deepEqual(parsePharmdKey("pharmd:BIO 111/01.pdf"), { path: "BIO 111/01.pdf", hash: null });
  assert.equal(parsePharmdKey("record:x"), null);
});

test("uploader, API, access and the backfill all use the versioned key", () => {
  const uploader = read("./uploader.js");
  const routes = read("./routes.js");
  const access = read("../records/access.js");
  const backfill = read("./hashBackfill.js");
  assert.match(uploader, /file_hash: createHash\("sha256"\)/, "new uploads are hashed");
  assert.match(routes, /contentKey: pharmdContentKey\(t\)/, "the API returns the versioned key");
  assert.match(routes, /file_hash: t\.file_hash/, "the client can derive it too");
  assert.match(access, /parsed\.hash && topic\.file_hash && parsed\.hash !== topic\.file_hash/, "an old key is refused after a replacement");
  assert.match(backfill, /update\(\{ content_key: newKey \}\)\.eq\("content_key", oldKey\)/, "cached pages move to the new key");
  assert.match(read("../../migrations/manifest.json"), /2026-pharmd-topic-hash\.sql/, "the column migration is registered");
});
