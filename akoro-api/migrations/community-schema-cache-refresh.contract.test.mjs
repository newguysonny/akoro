import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile(new URL("./manifest.json", import.meta.url), "utf8"));
const sql = await readFile(new URL("./2026-community-schema-cache-refresh.sql", import.meta.url), "utf8");

test("community schema-cache refresh runs after community relations exist", () => {
  const tables = manifest.schema.indexOf("2026-communities.sql");
  const activities = manifest.schema.indexOf("2026-community-activities.sql");
  const refresh = manifest.schema.indexOf("2026-community-schema-cache-refresh.sql");
  const seed = manifest.schema.indexOf("2026-demo-community-membership.sql");

  assert.ok(tables >= 0 && activities >= 0 && refresh > activities);
  assert.ok(seed > refresh, "the seed must run after the cache refresh");
});

test("community schema-cache refresh grants the service role and reloads PostgREST", () => {
  assert.match(sql, /GRANT USAGE ON SCHEMA edu TO service_role/);
  assert.match(sql, /edu\.communities/);
  assert.match(sql, /edu\.community_members/);
  assert.match(sql, /NOTIFY pgrst, 'reload config'/);
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/);
});
