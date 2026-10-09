import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Parse-worker boot contract. RunPod's GitHub build runs the container
 * BEFORE the model cache volume exists; a module-level model load there
 * crashed the process before runpod.serverless.start() — the reported
 * build failure "Could not find runpod.serverless.start". The handler
 * must therefore boot INERT (lazy model load on first request) and fail
 * jobs readably instead of dying.
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");

const [handler, dockerfile, requirements] = await Promise.all([
  read("../handler.py"),
  read("../Dockerfile"),
  read("../requirements.txt"),
]);

test("boot is inert — nothing loads the model at import", () => {
  assert.match(handler, /def _ensure_model\(\)/, "the lazy loader exists");
  assert.match(handler, /_model_lock = threading\.Lock/, "guarded against concurrent first jobs");
  assert.match(handler, /import threading/);
  assert.ok(!/from_pretrained\(/.test(handler.split("def handler(job)")[0].split("def _ensure_model")[0] || ""),
    "no from_pretrained outside the lazy loader");
  assert.ok(!handler.includes("ONCE per worker boot"), "the old module-level load is gone");
  assert.doesNotMatch(
    handler.split("def _ensure_model")[0],
    /AutoProcessor\.from_pretrained|AutoModelForImageTextToText\.from_pretrained/,
    "no model load before the lazy section",
  );
});

test("runpod.serverless.start is reachable and wired", () => {
  assert.match(handler, /runpod\.serverless\.start\(\{"handler": handler\}\)/);
  assert.match(dockerfile, /CMD \["python3", "-u", "handler.py"\]/);
  assert.match(requirements, /runpod>=/, "the harness is a dependency");
});

test("a missing cache fails the JOB, not the worker", () => {
  assert.match(handler, /class ModelUnavailable\(RuntimeError\)/);
  assert.match(handler, /"error": f"Model unavailable: \{e\}"/,
    "per-job readable error — the fix (Model field) is in the message");
  assert.match(handler, /Cached model not found: \{model_id\}/,
    "resolve keeps naming the fix");
  assert.match(handler, /Set the endpoint's Model field /,
    "…with the exact remedy in the message");
});

test("the vision prompt uses Qwen3-VL's real placeholder — never the obsolete <image>", () => {
  assert.match(handler, /<\|vision_start\|><\|image_pad\|><\|vision_end\|>/,
    "the processor expands <|image_pad|> to the exact visual token count");
  assert.ok(!handler.includes("PRODUCTION_PROMPT = \"<image>"),
    "the old prefix is literal text to Qwen3-VL — it caused tokens: 0 vs features 1122");
  assert.match(handler, /"<\|image_pad\|>" not in prompt/, "operator-supplied placeholders survive");
  assert.match(handler, /dtype="auto"/, "the non-deprecated dtype kwarg");
});

test("the endpoint contract is unchanged", () => {
  assert.match(handler, /job_input\.get\("image_b64"\) or job_input\.get\("image"\)/);
  assert.match(handler, /PARSE_MODEL_ALLOW_PROMPT/, "prompt lock still configurable");
  assert.match(handler, /"blocks": extract_blocks\(raw\)/, "blocks ride the response");
});
