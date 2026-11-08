import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL_DEFAULTS, urlFor, displayHost, missingUrlEnv, EXPECTED_URL_ENV, appHomePath, appLink } from "./urls.js";

test("defaults are the CURRENT hosts: apex marketing site, app., portals, api.", () => {
  assert.equal(URL_DEFAULTS.MAIN_SITE_URL, "https://akoro.name.ng");
  assert.equal(URL_DEFAULTS.FRONTEND_URL, "https://app.akoro.name.ng");
  assert.equal(URL_DEFAULTS.API_URL, "https://api.akoro.name.ng");
  assert.equal(URL_DEFAULTS.SCHOOL_FRONTEND_URL, "https://akoro-school.akoro.name.ng");
  for (const v of Object.values(URL_DEFAULTS)) assert.doesNotMatch(v, /akoro\.app|onrender\.com|\/$/);
});

test("urlFor: env wins, trailing slashes are dropped, aliases are tried in order, then the default", () => {
  assert.equal(urlFor("FRONTEND_URL", { env: {} }), "https://app.akoro.name.ng");
  assert.equal(urlFor("FRONTEND_URL", { env: { FRONTEND_URL: "https://x.example.com//" } }), "https://x.example.com");
  assert.equal(urlFor("FRONTEND_URL", { env: { FRONTEND_URL: "   " } }), "https://app.akoro.name.ng");
  assert.equal(urlFor("INSTRUCTOR_FRONTEND_URL", { env: { INSTRUCTOR_APP_URL: "https://i.example.com" }, alias: ["INSTRUCTOR_APP_URL"] }), "https://i.example.com");
  assert.equal(urlFor("INSTRUCTOR_FRONTEND_URL", { env: { INSTRUCTOR_FRONTEND_URL: "https://a", INSTRUCTOR_APP_URL: "https://b" }, alias: ["INSTRUCTOR_APP_URL"] }), "https://a");
  assert.equal(urlFor("EMAIL_ASSET_BASE", { env: { FRONTEND_URL: "https://app.example.ng/" }, alias: ["FRONTEND_URL"] }), "https://app.example.ng");
  assert.equal(urlFor("EMAIL_ASSET_BASE", { env: {}, alias: ["FRONTEND_URL"] }), "https://app.akoro.name.ng");   // an alias's default counts
  assert.equal(urlFor("NOT_A_NAME", { env: {} }), "");
});

test("displayHost", () => {
  assert.equal(displayHost("https://akoro.name.ng/path"), "akoro.name.ng");
  assert.equal(displayHost("akoro.name.ng/x"), "akoro.name.ng");
  assert.equal(displayHost(""), "");
});

test("missingUrlEnv names what production hasn't set", () => {
  assert.deepEqual(missingUrlEnv({}), [...EXPECTED_URL_ENV]);
  const all = Object.fromEntries(EXPECTED_URL_ENV.map((k) => [k, "https://x"]));
  assert.deepEqual(missingUrlEnv(all), []);
  assert.deepEqual(missingUrlEnv({ ...all, FRONTEND_URL: " " }), ["FRONTEND_URL"]);
});

test("wiring: no module spells a platform domain any more; the JWT claims are deliberately untouched; boot warns in production", async () => {
  const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
  for (const p of ["../modules/auth/routes.js", "../modules/admin/extended.js", "../modules/admin/pilotSchools.js", "../modules/school/socialOAuth.js", "../modules/school/routes.js",
    "../modules/profiles/routes.js", "../modules/instructor/tools.js", "../modules/billing/gateway.js", "../modules/courses/payments.js", "../modules/courses/cart.js",
    "../modules/courses/meeting-integration.js", "../modules/auth/emails.js"]) {
    const src = (await read(p)).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !/JWT_(ISSUER|AUDIENCE)/.test(l)).join("\n");
    assert.doesNotMatch(src, /process\.env\.(FRONTEND_URL|MAIN_SITE_URL|SCHOOL_FRONTEND_URL|INSTRUCTOR_FRONTEND_URL|ADMIN_FRONTEND_URL)\s*\|\|\s*"https?:/, p);
    assert.doesNotMatch(src, /"https:\/\/[a-z.-]*akoro\.app/, p);
    assert.match(src, /lib\/urls\.js/, p);
  }
  const auth = await read("../modules/auth/routes.js");
  assert.match(auth, /JWT_ISSUER\s*=\s*process\.env\.JWT_ISSUER\s*\|\|\s*"https:\/\/api\.akoro\.app"/);   // opaque claims: unchanged on purpose
  const cfg = await read("../config/index.js");
  assert.match(cfg, /missingUrlEnv\(env\)/);
  assert.match(cfg, /URL env vars not set/);
  const emails = await read("../modules/auth/emails.js");
  assert.match(emails, /\$\{SITE_BASE\}\/privacy/);   // legal links go to the marketing site
});

test("appLink: links into the learner app use its home — '/' on the app site, '/app' when APP_HOME_PATH says so (an unsplit deployment)", () => {
  assert.equal(appHomePath({}), "/");
  assert.equal(appLink("tab=agent", {}), "/?tab=agent");
  assert.equal(appLink("?tab=battles&battle=b1", {}), "/?tab=battles&battle=b1");
  assert.equal(appLink("", {}), "/");
  assert.equal(appLink(undefined, {}), "/");
  assert.equal(appLink("tab=agent", { APP_HOME_PATH: "/app" }), "/app?tab=agent");
  assert.equal(appLink("tab=agent", { APP_HOME_PATH: "app" }), "/app?tab=agent");   // a missing leading slash is added
  assert.equal(appHomePath({ APP_HOME_PATH: "  " }), "/");
});

test("no module spells a learner-app link as /app? any more — they go through appLink()", async () => {
  const { readdir } = await import("node:fs/promises");
  const path = await import("node:path");
  const root = new URL("../modules/", import.meta.url).pathname;
  const bad = [];
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "verify") await walk(p); continue; }
      if (!e.name.endsWith(".js") || /\.test\./.test(e.name)) continue;
      const src = (await readFile(p, "utf8")).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      if (/\/app\?/.test(src)) bad.push(path.relative(root, p));
    }
  }
  await walk(root);
  assert.deepEqual(bad, []);
});
