import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

/*
 * The server reads the cookie of the portal a request names (X-Akoro-Portal),
 * and a request that names none is a learner's. So every authed call from the
 * instructor app must name its portal: without it a teacher signed in to both
 * apps in one browser acts as the learner — the chat ran learner tools (a
 * study plan for "prepare an assignment"), onboarding saved the wrong profile.
 */
const ROOT = new URL("../../../akoro-instructor/src/", import.meta.url);
const PUBLIC = ["/api/auth/forgot-password", "/api/auth/reset-password", "/api/auth/refresh"];

async function files(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const u = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
    if (e.isDirectory()) out.push(...await files(u));
    else if (/\.(jsx?|mjs)$/.test(e.name)) out.push(u);
  }
  return out;
}

test("every raw fetch to the API from the instructor app names the instructor portal", async () => {
  const missing = [];
  for (const u of await files(ROOT)) {
    const src = await readFile(u, "utf8");
    for (const m of src.matchAll(/\bfetch\(\s*`\$\{(?:API|import\.meta\.env\.VITE_API_URL[^}]*)\}([^`]*)`/g)) {
      const call = src.slice(m.index, m.index + 600);
      const body = call.slice(0, call.indexOf("})") + 2 || 600);
      if (PUBLIC.some((p) => m[1].startsWith(p))) continue;
      if (!/X-Akoro-Portal/.test(body)) missing.push(`${u.pathname.split("/src/")[1]}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("the instructor chat's streaming turn names the instructor portal", async () => {
  const chat = await readFile(new URL("pages/ChatPage.jsx", ROOT), "utf8");
  const stream = chat.slice(chat.indexOf("const sendStreaming"), chat.indexOf("const sendStreaming") + 600);
  assert.match(stream, /'X-Akoro-Portal': 'instructor'/);
});
