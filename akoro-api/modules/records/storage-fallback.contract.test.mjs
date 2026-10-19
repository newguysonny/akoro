/**
 * modules/records/storage-fallback.contract.test.mjs
 *
 * Guards the storage contract after the failure-fallback upgrade:
 * R2 is PRIMARY for record + task files. The Supabase bucket is no longer
 * only a no-R2 deployment mode — it is also the FAILURE lane: when the r2
 * breaker reports the store unreachable at presign time, files up to
 * MAX_FALLBACK_FILE_BYTES (5 MB) ride Supabase instead of failing. Files
 * too big for the fallback are R2-only and skip the liveness probe
 * entirely (nothing else can hold them). Which store an object lives in
 * is encoded in the file_key prefix, so reads and deletes keep
 * dispatching on the key no matter which store took the upload.
 *
 * Presigning is OFFLINE SigV4 — it cannot see an outage — so liveness is
 * a HeadBucket through the SAME r2 breaker every other R2 op uses, with
 * a 60s success cache. Everything here is a source pin: the storage
 * module pulls in config/db/aws-sdk at import, and the suite runs offline.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");

const [storageSrc, recordsRoutesSrc, tasksRoutesSrc] = await Promise.all([
  read("./lib/storage.js"),
  read("./routes.js"),
  read("../tasks/routes.js"),
]);

test("the fallback is a FAILURE lane, not the primary — R2 stays primary", () => {
  assert.match(storageSrc, /R2 is PRIMARY/, "the header states the primacy");
  assert.match(storageSrc, /recordsStorageEnabled\(\)\) \{[\s\S]*?store: "r2"/, "R2 enabled → the R2 branch presigns");
  assert.match(storageSrc, /records\/\$\{userId\}\/\$\{Date\.now\(\)\}-\$\{safe\}/, "R2 keys keep the records/ prefix");
});

test("liveness: a tiny PUT probe through the r2 breaker, trusted for 60s", () => {
  // 2026-10-19: HeadBucket is refused to an object-scoped token (the app's keys) — every probe failed,
  // small files all went to the fallback, and the failures opened the shared r2 breaker. A PUT is what uploads need.
  assert.doesNotMatch(storageSrc, /new HeadBucketCommand/, "no bucket-level probe");
  assert.match(storageSrc, /await r2Send\(s3, new PutObjectCommand\(\{ Bucket: BUCKET, Key: R2_PROBE_KEY, Body: "1"/, "the probe rides the SAME breaker as every other R2 op — a tripped breaker answers instantly");
  assert.match(storageSrc, /R2_PROBE_OK_MS = 60 \* 1000/, "one probe per minute, not one per upload");
  assert.match(storageSrc, /r2ProbeOkUntil = Date\.now\(\) \+ R2_PROBE_OK_MS/, "a success is cached");
});

test("the size gate: ≤5 MB may fall back; bigger files are R2-only and skip the probe", () => {
  assert.match(storageSrc, /sizeBytes > MAX_FALLBACK_FILE_BYTES/, "the cap is THE cap — no second number");
  assert.match(storageSrc, /tooBigForFallback \|\| \(await r2Reachable\(\)\)/, "oversize short-circuits past the probe — no plan B exists for it");
  assert.match(storageSrc, /\{ sizeBytes \} = \{\}/, "size arrives as an optional 4th arg — unknown size stays fallback-eligible (Supabase's fileSizeLimit backstops the PUT)");
});

test("both branches return a store marker on the same protocol", () => {
  assert.match(storageSrc, /return \{ uploadUrl, fileKey: key, store: "r2" \};/, "R2 branch names its store");
  assert.match(storageSrc, /return \{ uploadUrl: data\.signedUrl, fileKey: key, store: "supabase" \};/, "fallback branch names its store");
  assert.match(storageSrc, /FALLBACK_PREFIX\}\$\{userId\}\/\$\{Date\.now\(\)\}-\$\{safe\}/, "fallback keys keep the records-supabase/ prefix — the prefix IS the store dispatch");
  assert.match(storageSrc, /if \(isFallbackFileKey\(fileKey\)\)/, "reads/deletes dispatch on the prefix — a fallback-written file stays fully readable");
});

test("the records route passes the size it already requires, and surfaces the store", () => {
  assert.match(recordsRoutesSrc, /if \(!Number\.isFinite\(bytes\) \|\| bytes <= 0\) return res400\(res, "A file size is required\."\);/, "size is mandatory at the route — the gate always has a real number");
  assert.match(recordsRoutesSrc, /createPresignedUpload\(String\(name\)\.trim\(\), mime, req\.user\.id, \{ sizeBytes: bytes \}\)/, "the known size flows down");
  assert.match(recordsRoutesSrc, /res200\(res, \{ uploadUrl, fileKey, store \}\)/, "the response says which store took it");
  assert.match(recordsRoutesSrc, /!recordsStorageEnabled\(\) && bytes > MAX_FALLBACK_FILE_BYTES/, "the no-R2 503 for big files is intact");
});

test("the tasks upload route passes the sizeBytes it already accepts", () => {
  assert.match(tasksRoutesSrc, /createPresignedUpload\(fileName, fileType, req\.user\.id, \{ sizeBytes \}\)/, "task files get the same failure lane");
});
