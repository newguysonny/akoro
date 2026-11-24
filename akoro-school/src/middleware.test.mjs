// The tenant edge proxy is what removes the blank React boot: a candidate host
// gets the API-rendered HTML directly; portal hosts still fall through.
import assert from "node:assert/strict";
import test from "node:test";

process.env.VITE_SITE_BASE_DOMAIN = "akoro.ng";
process.env.VITE_PORTAL_HOSTS = "schools.akoro.ng";
process.env.VITE_API_URL = "https://api.akoro.ng";
const { default: middleware } = await import("../middleware.js");

test("a tenant host is served the rendered school HTML", async () => {
  let called = "";
  global.fetch = async (url) => {
    called = String(url);
    return new Response("<!doctype html><h1>School site</h1>", { status: 200, headers: { "content-type": "text/html", "cache-control": "public, max-age=20" } });
  };
  const res = await middleware(new Request("https://akoro-demo-academy-a29059.akoro.ng/about?x=1"));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /School site/);
  assert.match(called, /api\.akoro\.ng\/api\/school\/site\/by-host/);
  assert.match(called, /host=akoro-demo-academy-a29059\.akoro\.ng/);
  assert.match(called, /path=%2Fabout%3Fx%3D1/);
  assert.equal(res.headers.get("cache-control"), "public, max-age=20");
});

test("portal hosts, assets and apply pages fall through", async () => {
  global.fetch = async () => { throw new Error("must not proxy"); };
  for (const url of [
    "https://schools.akoro.ng/",
    "https://akoro-demo-academy-a29059.akoro.ng/assets/index.js",
    "https://akoro-demo-academy-a29059.akoro.ng/apply",
  ]) {
    const res = await middleware(new Request(url));
    assert.equal(res.headers.get("x-middleware-next"), "1", url);
  }
});

test("a 404 from the API falls back to the portal", async () => {
  global.fetch = async () => new Response("not found", { status: 404 });
  const res = await middleware(new Request("https://unknown-host.akoro.ng/"));
  assert.equal(res.headers.get("x-middleware-next"), "1");
});
