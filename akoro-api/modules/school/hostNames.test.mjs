import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { hostOf, subdomainOf, isReservedSubdomain, RESERVED_SUBDOMAINS } from "./hostNames.js";

test("hostOf: the learner app on app.<base> never changes the base domain", () => {
  assert.equal(hostOf("https://akoro.name.ng"), "akoro.name.ng");
  assert.equal(hostOf("https://www.akoro.name.ng/x"), "akoro.name.ng");
  assert.equal(hostOf("https://api.akoro.name.ng"), "akoro.name.ng");
  assert.equal(hostOf("https://app.akoro.name.ng/app?x=1"), "akoro.name.ng");   // the split: FRONTEND_URL moves here
  assert.equal(hostOf("APP.Akoro.Name.NG:443"), "akoro.name.ng");
  assert.equal(hostOf("https://admin.akoro.name.ng"), "admin.akoro.name.ng");   // only www/api/app are stripped
  assert.equal(hostOf(""), "");
  assert.equal(hostOf(undefined), "");
});

test("subdomainOf: the label in front of the base, '' for the apex, null outside it", () => {
  assert.equal(subdomainOf("greenfield.akoro.name.ng", "akoro.name.ng"), "greenfield");
  assert.equal(subdomainOf("app.akoro.name.ng", "akoro.name.ng"), "app");
  assert.equal(subdomainOf("akoro.name.ng", "akoro.name.ng"), "");
  assert.equal(subdomainOf("www.akoro.name.ng", "akoro.name.ng"), "");
  assert.equal(subdomainOf("a.b.akoro.name.ng", "akoro.name.ng"), "a.b");
  assert.equal(subdomainOf("example.com", "akoro.name.ng"), null);
  assert.equal(subdomainOf("notakoro.name.ng", "akoro.name.ng"), null);
});

test("reserved subdomains are ours: app, api, admin, instructors, school…", () => {
  for (const s of ["app", "api", "admin", "instructors", "instructor", "school", "akoro-school", "www"]) assert.ok(isReservedSubdomain(s), s);
  assert.ok(isReservedSubdomain("APP"));
  assert.ok(!isReservedSubdomain("greenfield"));
  assert.ok(!isReservedSubdomain(""));
  assert.ok(RESERVED_SUBDOMAINS.has("app"));
});

test("tenant.js uses them: a reserved subdomain is never a school host and never resolves to a school", async () => {
  const src = await readFile(new URL("./tenant.js", import.meta.url), "utf8");
  assert.match(src, /import \{ hostOf, isReservedSubdomain \} from "\.\/hostNames\.js"/);
  assert.match(src, /if \(isReservedSubdomain\(sub\)\) return false;/);
  assert.match(src, /!sub\.includes\("\."\) && !isReservedSubdomain\(sub\)/);
  assert.doesNotMatch(src, /export function hostOf/);   // one definition
});
