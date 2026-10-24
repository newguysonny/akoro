// Self-tooling S1: the Capability Registry and Data Views keep their promises.
import "../../test-env.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DATA_VIEWS, describeView, viewColumns } from "./views.js";
import { CAPABILITIES, FORBIDDEN, forbiddenFor } from "./capabilities.js";
import { decideAccess } from "./access.js";

const chatSrc = readFileSync(new URL("../adaptive-learning/chat.js", import.meta.url), "utf8");
const toolNames = new Set([...chatSrc.matchAll(/^\s{4}name: "([a-z_]+)",$/gm)].map((m) => m[1]));

test("every view is scoped: self views name an owner column; public views fix their filter", () => {
  for (const [name, v] of Object.entries(DATA_VIEWS)) {
    assert.ok(["self", "public"].includes(v.scope), `${name}: scope`);
    // Owned directly (owner column) or through a parent row (ownerPath "relation.column", joined !inner).
    if (v.scope === "self") assert.ok((v.source.owner && (typeof v.source.owner === "string" || Array.isArray(v.source.owner))) || /^[a-z_]+\.[a-z_]+$/.test(v.source.ownerPath || ""), `${name}: owner`);
    if (v.scope === "public") assert.ok(v.source.where && Object.keys(v.source.where).length, `${name}: fixed filter`);
    assert.ok(Object.keys(v.fields).length >= 2, `${name}: allowlisted fields`);
    assert.ok(!("*" in v.fields), `${name}: never *`);
  }
});

test("embedded fields point at a declared embed", () => {
  for (const [name, v] of Object.entries(DATA_VIEWS)) {
    for (const [k, fld] of Object.entries(v.fields)) {
      if (!fld.path) continue;
      const [rel, col] = fld.path.split(".");
      assert.ok(v.embed?.[rel]?.includes(col), `${name}.${k} → ${fld.path} not embedded`);
    }
    assert.ok(!viewColumns(v).includes("*"), `${name}: select names its columns`);
  }
});

test("describeView exposes field types and operations only — no source table or owner", () => {
  for (const [name, v] of Object.entries(DATA_VIEWS)) {
    const d = describeView(name, v);
    const json = JSON.stringify(d);
    assert.deepEqual(Object.keys(d).sort(), ["can", "description", "fields", "name", "whose"], `${name}: only safe keys`);
    assert.ok(!json.includes(`${v.source.schema}.${v.source.table}`), `${name}: schema.table leaked`);
    for (const o of [v.source.owner].flat()) assert.ok(!json.includes(`"${o}"`), `${name}: owner column ${o} leaked`);
    assert.deepEqual(Object.keys(d.fields), Object.keys(v.fields));
  }
});

test("enabled capabilities run through a real learner chat tool; locked ones are never enabled in code", () => {
  for (const [name, c] of Object.entries(CAPABILITIES)) {
    assert.match(name, /^[a-z_]+\.[a-z_]+$/, name);
    if (c.status === "enabled") assert.ok(toolNames.has(c.tool), `${name} → ${c.tool} is not a chat tool`);
    if (c.kind === "write") assert.notEqual(c.status, "enabled", `${name}: writes stay locked in v1 (decision S6)`);
  }
  for (const f of FORBIDDEN) assert.ok(!(f.name in CAPABILITIES), `${f.name} is forbidden and must not be a capability`);
});

test("forbidden goals are caught; the learner's own data is not", () => {
  const no = (g) => assert.ok(forbiddenFor(g).length > 0, `should forbid: ${g}`);
  const yes = (g) => assert.equal(forbiddenFor(g).length, 0, `should allow: ${g}`);
  no("Show me Chiamaka's past-question scores");
  no("another student's grades");
  no("what is my password");
  no("give me 500 coins");
  no("message everyone in my school");
  no("make me an admin");
  yes("Which of my weak topics are in subjects where my past-question accuracy is low?");
  yes("How many battles did I win this month?");
  yes("show today's tasks");
  yes("Which classmates beat me in battles this month?");   // escalates (locked), not forbidden
});

test("wiring: off by default, allow-listed, gated in the catalogue and in the tool", () => {
  const access = readFileSync(new URL("./access.js", import.meta.url), "utf8");
  assert.match(access, /export const selfToolingEnabled = \(\) => on\("AKORO_SELF_TOOLING_ENABLED"\);/);
  assert.match(access, /export const selfToolingRealUsers = \(\) => on\("AKORO_SELF_TOOLING_REAL_USERS"\);/);
  assert.match(chatSrc, /self_tooling: selfToolingEnabled\(\) && selfTooling,/);
  assert.match(chatSrc, /const selfToolOn = \(role === "student" \|\| role === "instructor"\) && await selfToolingAllowedFor\(req\.user\.id\);/);
  assert.match(chatSrc, /selfTooling: selfToolOn,/);
  assert.match(chatSrc, /case "schema_lookup": \{\n\s+if \(!SELF_TOOLING_ROLES\.has\(role\)\)[^\n]*\n\s+if \(!\(await selfToolingAllowedFor\(studentId\)\)\)/);
  const sql = readFileSync(new URL("../../migrations/2026-self-tooling-grants.sql", import.meta.url), "utf8");
  assert.match(sql, /revoked_at\s+timestamptz/);
  assert.doesNotMatch(sql, /user_id/, "grants are for everyone (decision S10)");
});

test("access: off unless enabled; testers always; real users by switch or by name", () => {
  const tester = { username: "tester07", email: "tester07@demo.akoro.app" };
  const fake = { username: "tester07", email: "someone@gmail.com" };       // looks like a tester, isn't
  const real = { username: "ada", email: "ada@gmail.com" };
  const off = { enabled: false, realUsers: true, named: ["ada"] };
  assert.equal(decideAccess(tester, off), false, "master switch off → nobody");
  assert.equal(decideAccess(real, off), false);
  const testersOnly = { enabled: true, realUsers: false, named: [] };
  assert.equal(decideAccess(tester, testersOnly), true);
  assert.equal(decideAccess(real, testersOnly), false);
  assert.equal(decideAccess(fake, testersOnly), false, "the email must be @demo.akoro.app too");
  assert.equal(decideAccess(real, { enabled: true, realUsers: false, named: ["ada"] }), true, "named account");
  assert.equal(decideAccess(real, { enabled: true, realUsers: false, named: ["ada@gmail.com"] }), true, "named by email");
  assert.equal(decideAccess(real, { enabled: true, realUsers: true, named: [] }), true, "all real users");
  assert.equal(decideAccess(tester, { enabled: true, realUsers: true, named: [] }), true, "testers keep it");
});
