/**
 * Embedding worker contract: boot is inert (the model loads on the first job,
 * like the parse worker), the harness is wired, the image carries both files,
 * and the pure core passes its checks (input limits, MRL dimensions ≤ 1024).
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [handler, dockerfile, requirements] = await Promise.all([read("../handler.py"), read("../Dockerfile"), read("../requirements.txt")]);

test("boot is inert — the model loads lazily, once, under a lock", () => {
  const beforeLoader = handler.split("def _ensure_model")[0];
  assert.doesNotMatch(beforeLoader, /from_pretrained\(/);
  assert.match(handler, /_model_lock = threading\.Lock\(\)/);
  assert.match(handler, /raise ModelUnavailable\(str\(e\)\) from e/, "a load failure fails the job, not the worker");
});

test("pooling and normalisation follow each model card: Qwen3 last token (left padding), bge-m3 CLS; L2", () => {
  assert.match(handler, /PROFILE = model_profile\(MODEL_ID\)/);
  assert.match(handler, /padding_side=PROFILE\["padding_side"\]/);
  assert.match(handler, /pooled = hidden\[:, 0\] if PROFILE\["pooling"\] == "cls" else hidden\[:, -1\]/);
  assert.match(handler, /parse_input\(job\.get\("input"\) or \{\}, PROFILE\)/, "the dims and instruction rules are the model's");
  assert.match(handler, /F\.normalize\(pooled\[:, :dims\]\.float\(\), p=2, dim=1\)/, "cut to the MRL dims, then normalised");
});

test("the harness is wired and the image carries both modules", () => {
  assert.match(handler, /runpod\.serverless\.start\(\{"handler": handler\}\)/);
  assert.match(dockerfile, /COPY embed-worker\/embedcore\.py embed-worker\/handler\.py \//);
  assert.match(dockerfile, /CMD \["python3", "-u", "handler\.py"\]/);
  assert.match(requirements, /transformers>=4\.51/, "Qwen3 needs transformers 4.51+");
});

test("the pure core passes its checks", async () => {
  const { code, out } = await new Promise((resolve) => {
    execFile("python3", [new URL("./core_check.py", import.meta.url).pathname], { timeout: 30_000 },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout}\n${stderr}` }));
  });
  assert.equal(code, 0, out.slice(-800));
  assert.match(out, /CORE-CHECK: all passed/);
});

test("the image carries a C toolchain for triton's first-run JIT (Qwen3 died without it, 2026-10-23)", () => {
  assert.match(dockerfile, /apt-get install[^\n]*build-essential/);
  assert.match(dockerfile, /rm -rf \/var\/lib\/apt\/lists\/\*/);
  assert.ok(dockerfile.indexOf("build-essential") < dockerfile.indexOf("pip install"), "toolchain before the Python packages");
});
