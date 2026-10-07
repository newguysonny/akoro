import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Render's Hobby workspace caps outbound bandwidth at 5 GB/month (April 2026
 * plan change; it used to be 100 GB) — the operator hit 70% of it. The two
 * structural defenses, pinned:
 *
 *  1. Compression AT the API (Render meters the bytes it sends; Cloudflare
 *     only compresses after that). Gzip shrinks API JSON 5-10x. SSE is
 *     excluded — buffering it would stall token-by-token streaming.
 *  2. /uploads serves lecture videos (up to 2 GB each) off Render's disk.
 *     Unique generated filenames make every URL immutable, so it is cached
 *     hard (Cloudflare + browser) — a video is metered once per cache
 *     lifetime, not once per view. Crawler defense (robots.txt +
 *     X-Robots-Tag) keeps bulk scrapers from pulling it all.
 */

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [appJs, pkg] = await Promise.all([read("app.js"), read("package.json")]);

test("responses are compressed at the API, where the meter runs", () => {
  assert.match(pkg, /"compression": /);
  assert.match(appJs, /import compression                from "compression";/);
  assert.match(appJs, /app\.use\(compression\(\{/);
  // SSE must never be compressed: buffering stalls streaming.
  assert.match(appJs, /if \(type\.includes\("text\/event-stream"\)\) return false;   \/\/ never buffer SSE/);
  assert.match(appJs, /return compression\.filter\(req, res\);/);
});

test("/uploads is immutable and cached hard — a view is metered once, not every time", () => {
  assert.match(appJs, /app\.use\("\/uploads",/);
  // Crawler defense stays on the wrapper.
  assert.match(appJs, /res\.setHeader\("X-Robots-Tag", "noindex, nofollow"\); next\(\);/);
  assert.match(appJs, /express\.static\(path\.join\(__dirname, "uploads"\), \{/);
  assert.match(appJs, /maxAge: "30d",/);
  assert.match(appJs, /immutable: true,/);
  assert.match(appJs, /User-agent: \*\\nDisallow: \/\\n/);
});
