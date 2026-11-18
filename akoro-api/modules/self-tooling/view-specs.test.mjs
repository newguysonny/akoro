/*
 * view-specs.test.mjs — the data-driven Data View registry (2026-11-18):
 * stored specs are validated by shape (pure) and against the live schema
 * (pure, given the columns) before they may activate; the live registry
 * merges active rows as additions only — a stored view can never shadow a
 * built-in, and removing the row removes the view. A database view carries
 * its own area for tool derivation.
 */
import "../../test-env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateViewShape, validateViewAgainstSchema, normalizeViewSpec } from "./viewSpecs.js";
import { DATA_VIEWS, BUILTIN_DATA_VIEWS, applyDbViewRows, dbViewNameSet } from "./views.js";
import { deriveToolArea } from "./areas.js";

const goodSpec = {
  description: "The learner's scheduled chat follow-ups: title and when they are due.",
  keywords: ["follow-up", "follow-ups", "reminder", "scheduled"],
  scope: "self",
  area: "plans",
  source: { schema: "edu", table: "scheduled_chat_follow_ups", owner: "user_id" },
  fields: {
    title: { type: "string" },
    status: { type: "string" },
    scheduled_at: { type: "timestamp" },
  },
};
const COLUMNS = [
  { column_name: "id", data_type: "uuid" },
  { column_name: "user_id", data_type: "uuid" },
  { column_name: "title", data_type: "text" },
  { column_name: "status", data_type: "text" },
  { column_name: "scheduled_at", data_type: "timestamp with time zone" },
];

test("shape: a well-formed self spec passes", () => {
  const r = validateViewShape("my_followups", goodSpec);
  assert.equal(r.ok, true, r.errors.join("; "));
});

test("shape: a stored spec can never shadow a built-in", () => {
  const r = validateViewShape("my_tasks", goodSpec);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /built-in/);
});

test("shape: sensitive columns are refused as fields, owners and where keys", () => {
  const asField = validateViewShape("my_x", { ...goodSpec, fields: { email: { type: "string" } } });
  assert.equal(asField.ok, false);
  assert.match(asField.errors.join(" "), /sensitive/);
  const asOwner = validateViewShape("my_x", { ...goodSpec, source: { ...goodSpec.source, owner: "contact_email" } });
  assert.equal(asOwner.ok, false);
  const asWhere = validateViewShape("my_x", { ...goodSpec, source: { ...goodSpec.source, where: { reset_token: "x" } } });
  assert.equal(asWhere.ok, false);
});

test("shape: self scope needs an owner; public scope needs a fixed where", () => {
  const noOwner = validateViewShape("my_x", { ...goodSpec, source: { schema: "edu", table: "t" } });
  assert.equal(noOwner.ok, false);
  const pub = { ...goodSpec, scope: "public", source: { schema: "content", table: "blog_posts" } };
  assert.equal(validateViewShape("pub_x", pub).ok, false);
  const pubOk = { ...pub, source: { ...pub.source, where: { status: "published" } } };
  assert.equal(validateViewShape("pub_x", pubOk).ok, true);
});

test("shape: v1 refuses embed, ownerPath and joined fields", () => {
  assert.equal(validateViewShape("my_x", { ...goodSpec, embed: { t: ["a"] } }).ok, false);
  assert.equal(validateViewShape("my_x", { ...goodSpec, source: { ...goodSpec.source, ownerPath: "t.user_id" } }).ok, false);
  assert.equal(validateViewShape("my_x", { ...goodSpec, fields: { x: { type: "string", path: "t.x" } } }).ok, false);
});

test("shape: the owner column is never exposed as a field; unknown areas are refused", () => {
  const r = validateViewShape("my_x", { ...goodSpec, fields: { user_id: { type: "string" } } });
  assert.equal(r.ok, false);
  assert.equal(validateViewShape("my_x", { ...goodSpec, area: "nope" }).ok, false);
});

test("schema: columns must exist and types must be compatible", () => {
  const norm = normalizeViewSpec(goodSpec);
  assert.equal(validateViewAgainstSchema(norm, COLUMNS).ok, true);
  const missing = validateViewAgainstSchema(normalizeViewSpec({ ...goodSpec, fields: { nope: { type: "string" } } }), COLUMNS);
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join(" "), /does not exist/);
  const wrongType = validateViewAgainstSchema(normalizeViewSpec({ ...goodSpec, fields: { scheduled_at: { type: "string" } } }), COLUMNS);
  assert.equal(wrongType.ok, false);
  assert.match(wrongType.errors.join(" "), /claims type string/);
  const noTable = validateViewAgainstSchema(norm, []);
  assert.equal(noTable.ok, false);
});

test("normalize: field defaults filled, unknown keys dropped", () => {
  const n = normalizeViewSpec({ ...goodSpec, bogus: 1, fields: { title: { type: "string", sort: false, junk: 2 } } });
  assert.equal("bogus" in n, false);
  assert.deepEqual(n.fields.title, { type: "string", filter: true, sort: false });
  assert.equal(n.area, "plans");
});

test("registry: active rows merge as additions, removal unmerges, built-ins are untouchable", () => {
  const before = Object.keys(DATA_VIEWS).length;
  const spec = normalizeViewSpec(goodSpec);
  const r1 = applyDbViewRows([{ name: "my_followups", spec }]);
  assert.deepEqual(r1.applied, ["my_followups"]);
  assert.equal(Object.keys(DATA_VIEWS).length, before + 1);
  assert.ok(dbViewNameSet().has("my_followups"));
  const shadow = applyDbViewRows([{ name: "my_tasks", spec }, { name: "my_followups", spec }]);
  assert.equal(shadow.skipped.length, 1);
  assert.equal(DATA_VIEWS.my_tasks, BUILTIN_DATA_VIEWS.my_tasks);
  const r2 = applyDbViewRows([]);
  assert.equal(Object.keys(DATA_VIEWS).length, before);
  assert.equal(dbViewNameSet().size, 0);
});

test("areas: a database view's own spec area drives derivation", () => {
  const spec = normalizeViewSpec({ ...goodSpec, area: "network" });
  applyDbViewRows([{ name: "my_followups", spec }]);
  try {
    const d = deriveToolArea({ views: ["my_followups"], capabilities: [] });
    assert.equal(d.area, "network");
  } finally {
    applyDbViewRows([]);
  }
});

test("registry: my_tools is a built-in view over the learner's own tools", () => {
  const v = BUILTIN_DATA_VIEWS.my_tools;
  assert.ok(v);
  assert.equal(v.scope, "self");
  assert.equal(v.source.table, "agent_tools");
  assert.equal(v.source.owner, "owner_id");
});
