/**
 * modules/records/discover.contract.test.mjs
 * ─────────────────────────────────────────────────────────────────────────
 * Source-contract tests for the Contents/Materials discovery feed. The
 * feed's guarantees are product rules, so they're pinned to the route
 * source:
 *
 *   · the list EXCLUDES uploads owned by Premium subscribers (the tier
 *     lookup + the .not("user_id", "in", …) filter ride together)
 *   · the list mints NO presigned URLs — browsing the feed must cost
 *     this API zero storage calls; presigning happens once per open
 *   · legacy detail-only rows (no file_key) never reach the feed
 *   · paste rows carry a PREVIEW, never the full text, in the list
 *   · /discover/:id/open hides Premium-owned records behind a 404
 *     (never a 403 — a guessed id must not confirm the record exists)
 *   · the shelf's owner-scoped /:id/file route keeps its owner check —
 *     discovery is a separate seam, not a hole in the shelf
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./routes.js", import.meta.url), "utf8")
  + await readFile(new URL("./service-records.js", import.meta.url), "utf8");
const storeSrc = await readFile(new URL("./store-records.js", import.meta.url), "utf8");
const accessSrc = await readFile(new URL("./access.js", import.meta.url), "utf8");   // the premium helper moved here

const listRoute = storeSrc.slice(
  storeSrc.indexOf("export const listDiscover"),
  storeSrc.indexOf("export const countDiscover"),
) + source.slice(
  source.indexOf("export async function listDiscover"),
  source.indexOf("export async function openDiscover"),
);
const openRoute = source.slice(
  source.indexOf("export async function openDiscover"),
  source.indexOf("export async function patchRecord"),
);

test("the feed list excludes Premium subscribers' uploads", () => {
  assert.ok(listRoute.includes("const premiumIds = await activePremiumUserIds();"));
  assert.match(listRoute, /if \(premiumIds\.length\) query = query\.not\("user_id", "in", `\(\$\{premiumIds\.join\(","\)\}\)`\)/);
});

test("the premium helper targets the paid learner Premium tier's active subscriptions", () => {
  const helper = accessSrc.slice(accessSrc.indexOf("export async function activePremiumUserIds()"));
  assert.match(helper, /\.eq\("platform", "learner"\)\.eq\("access", "paid"\)\.eq\("name", "Premium"\)/);
  assert.match(helper, /\.eq\("tier_id", tierId\)\.in\("status", \["active", "trial", "trialing"\]\)/);
});

test("the feed list mints no presigned URLs — bytes cost nothing until an open", () => {
  assert.equal(listRoute.indexOf("createPresignedDownload"), -1);
});

test("legacy detail-only uploads and links stay out of the feed", () => {
  assert.match(listRoute, /\.in\("kind", \["upload", "paste"\]\)/);
  assert.match(listRoute, /r\.kind === "paste" \|\| r\.file_key/);
});

test("paste rows carry a preview in the list, never the full text", () => {
  assert.match(listRoute, /contentPreview: r\.kind === "paste" \? String\(r\.content \|\| ""\)\.slice\(0, 280\) : ""/);
  assert.doesNotMatch(listRoute, /content: r\.content/);
});

test("opening hides Premium-owned records behind a 404, before presigning", () => {
  assert.match(openRoute, /if \(premiumIds\.includes\(r\.user_id\)\) return res404\(res, "Record not found\."\);/);
  assert.ok(
    openRoute.indexOf("premiumIds.includes") < openRoute.indexOf("createPresignedDownload"),
    "the premium check must run before the presign",
  );
});

test("the open route presigns with the record's download name", () => {
  assert.match(openRoute, /createPresignedDownload\(r\.file_key, \{ downloadName: r\.name \}\)/);
});

test("the shelf's /:id/file route keeps its owner check — discovery is its own seam", () => {
  const fileRoute = source.slice(source.indexOf("export async function openFile"));
  assert.match(fileRoute, /if \(existing\.user_id !== req\.user\.id\) return res403\(res, "Not your record\."\);/);
});
