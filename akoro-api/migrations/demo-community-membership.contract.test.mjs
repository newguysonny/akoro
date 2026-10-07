import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile(new URL("./manifest.json", import.meta.url), "utf8"));
const sql = await readFile(new URL("./2026-demo-community-membership.sql", import.meta.url), "utf8");

test("demo community membership seed follows its community tables in the schema deploy", () => {
  const communityTables = manifest.schema.indexOf("2026-communities.sql");
  const membershipTables = manifest.schema.indexOf("2026-community-activities.sql");
  const seed = manifest.schema.indexOf("2026-demo-community-membership.sql");

  assert.ok(communityTables >= 0);
  assert.ok(membershipTables >= 0);
  assert.ok(seed > communityTables && seed > membershipTables);
});

test("demo community seed assigns the requested owner and joined learner idempotently", () => {
  assert.match(sql, /stu\.jss11@demo\.akoro\.app/);
  assert.match(sql, /stu\.jss12@demo\.akoro\.app/);
  assert.match(sql, /INSERT INTO edu\.community_members[\s\S]*owner/);
  assert.match(sql, /INSERT INTO edu\.community_members[\s\S]*member/);
  assert.match(sql, /ON CONFLICT \(community_id, user_id\)/);
});
