// One RPC for the tenant render, with the old per-query path as fallback.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = path.join(HERE, "..", "..");
const read = (...p) => readFileSync(path.join(API, ...p), "utf8");

test("the site context migration is registered and complete", () => {
  const manifest = JSON.parse(read("migrations", "manifest.json"));
  assert.ok(manifest.schema.includes("2026-school-site-context.sql"));
  const sql = read("migrations", "2026-school-site-context.sql");
  assert.match(sql, /function public\.school_site_context/);
  for (const key of ["website", "portal", "profile", "teachers", "courses", "classes", "admission", "gateway_ok", "notices", "events", "menus"]) {
    assert.match(sql, new RegExp(`'${key}'`), key);
  }
  assert.match(sql, /grant execute .* to service_role/);
  // Aggregates must limit the INNER rows, not the single aggregate row.
  assert.match(sql, /order by c\.title limit 24/);
  assert.match(sql, /order by coalesce\(n\.pinned, false\) desc, n\.publish_on desc limit 6/);
});

test("the renderer takes the RPC fast path and keeps the fallback", () => {
  const store = read("modules", "school", "store-site.js");
  assert.match(store, /rpc\("school_site_context"/);
  const svc = read("modules", "school", "service-site.js");
  assert.match(svc, /siteContextRpc\(school\.id, today\)/);
  assert.match(svc, /if \(bundle\) \{/);
  assert.match(svc, /bundle\?\.website/);
  // The cache + parallel fallback remain in place.
  assert.match(svc, /SITE_HTML_TTL_MS/);
  assert.match(svc, /Promise\.all\(\[/);
});
