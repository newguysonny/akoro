#!/usr/bin/env node
/**
 * boot-smoke.mjs — boots the API with dummy env and probes it, WITHOUT any
 * real credentials. Answers one question in ~10s: does this build import,
 * mount every route, and answer /health? Run from akoro-api/:
 *
 *   node scripts/boot-smoke.mjs
 *
 * Why it exists: several modules construct clients at import time, so a
 * missing env var doesn't degrade one feature — it CRASHES the whole process
 * at boot and every surface (agent chat, teaching, decay, continuation…)
 * dies together. This smoke catches that class locally, before a deploy.
 *
 * Env vars that crash at boot when missing (keep this list in sync):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY        (db.js exits with a message)
 *   SUPABASE_SERVICE_ROLE_KEY                 (alias — falls back to
 *                                              SUPABASE_SERVICE_KEY in the
 *                                              student-agent modules)
 *   OPENAI_API_KEY                            (the OpenAI SDK throws at
 *                                              construction — aiModel.js,
 *                                              voice routes)
 *   OAuth strategy keys (Google/Zoom/Teams)   (passport throws at setup)
 *
 * Dummy endpoints are used for Supabase/Redis, so health reports
 * degraded — that's expected here; the check is "boots and answers",
 * not "connects".
 */
process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "dummy";
process.env.JWT_SECRET ||= "dummy";
process.env.REDIS_URL ||= "redis://localhost:63999";
process.env.PORT = process.env.PORT || "4555";
process.env.HOST = "127.0.0.1";
process.env.ENABLE_TASK_WORKER = "false";
process.env.OPENAI_API_KEY ||= "dummy-key-for-boot-smoke";
for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "REDIRECT_URI_GOOGLE",
  "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET", "REDIRECT_URI_ZOOM",
  "TEAMS_CLIENT_ID", "TEAMS_CLIENT_SECRET", "REDIRECT_URI_TEAMS"]) {
  process.env[k] ||= `dummy-${k}`;
}

const { default: app } = await import("../app.js");

const base = `http://127.0.0.1:${process.env.PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 40; i++) {
  try { await fetch(`${base}/health`); break; } catch { await wait(250); }
}
try {
  const health = await fetch(`${base}/health`).then((r) => r.json());
  console.log("HEALTH:", JSON.stringify(health));
  const chat = await fetch(`${base}/api/adaptive/chat/agent`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  console.log("AGENT CHAT (unauthed):", chat.status, JSON.stringify(await chat.json().catch(() => null)));

  // Egress guards (Render Hobby caps outbound bandwidth at 5 GB/month):
  // compression middleware mounted, robots.txt refuses crawlers, uploads
  // responses carry X-Robots-Tag. The 404 here is expected — the check is the
  // header, which the wrapper sets before static() falls through.
  const hasCompression = app._router?.stack?.some((l) => l.handle?.name === "compression");
  console.log("COMPRESSION MOUNTED:", hasCompression);
  const robots = await fetch(`${base}/robots.txt`).then((r) => r.text());
  console.log("ROBOTS.TXT:", JSON.stringify(robots.trim()));
  const uploadProbe = await fetch(`${base}/uploads/boot-smoke-missing.png`);
  console.log("UPLOADS X-ROBOTS-TAG:", uploadProbe.headers.get("x-robots-tag"), `(status ${uploadProbe.status})`);
  if (!hasCompression || !robots.includes("Disallow: /") || uploadProbe.headers.get("x-robots-tag")?.includes("noindex") === false) {
    throw new Error("egress guard missing (compression / robots.txt / uploads noindex)");
  }
  console.log("BOOT_SMOKE_OK — app boots, routes respond, no crash");
  process.exit(0);
} catch (e) {
  console.error("BOOT_SMOKE_FAIL:", e.message);
  process.exit(1);
}
