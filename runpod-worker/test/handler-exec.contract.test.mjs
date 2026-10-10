/**
 * Parse-worker EXECUTION contract — beyond source pins.
 *
 * v1.0.3 shipped a NameError that py_compile and source pins both missed:
 * the prompt variable was renamed but the processor call still read
 * text=[text]. The only check that catches that class is RUNNING the
 * handler with stubbed torch/transformers/PIL — which is what this file
 * does via exec_check.py (the node test shells out to python3, asserts
 * exit 0, and would fail on ANY handler-level exception).
 */
import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

test("the handler EXECUTES end-to-end on stubbed libs — no NameError-class defects", async () => {
  const { code, out } = await new Promise((resolve) => {
    execFile("python3", [join(here, "exec_check.py")], { timeout: 60_000 },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout}\n${stderr}` }));
  });
  assert.equal(code, 0, `handler execution failed:\n${out.slice(-1200)}`);
  assert.match(out, /EXEC-CHECK: all passed/);
});

test("the processor gets the CHAT-formatted text, built right before the call", async () => {
  const handler = await readFile(join(here, "..", "handler.py"), "utf8");
  // A bare prompt made the chat model end its turn at once (empty output,
  // ~1 s). The text must come from build_chat_text, defined in this scope.
  assert.match(handler, /text = build_chat_text\(processor, prompt\)\n\s+inputs = processor\(text=\[text\]/);
});
