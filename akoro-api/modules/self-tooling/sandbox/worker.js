/**
 * The sandbox worker (plan §7.7): one fresh QuickJS (WebAssembly) runtime per
 * run, inside its own worker thread. The code gets JSON in and gives JSON
 * out — there is no bridge back to Akoro, no require, no network, no
 * filesystem, no timers. The host kills this thread at the wall deadline.
 *
 * workerData: { source, payload: { input, data, akoro }, limits }
 * posts:      { ok: true, json } | { ok: false, error }
 */
import { parentPort, workerData } from "node:worker_threads";
import { getQuickJS, shouldInterruptAfterDeadline } from "quickjs-emscripten";

const { source, payload, limits } = workerData;

function done(msg) { parentPort.postMessage(msg); }

try {
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + limits.cpuMs));
  const vm = runtime.newContext();
  try {
    const inHandle = vm.newString(JSON.stringify(payload));
    vm.setProp(vm.global, "__in", inHandle);
    inHandle.dispose();
    // The learner code defines run(input, data, akoro); we call it and
    // serialise its answer inside the sandbox, so only a string crosses out.
    const program = `${source}
;(function(){
  if (typeof run !== "function") throw new Error("the code must define function run(input, data, akoro)");
  var p = JSON.parse(__in);
  var out = run(p.input, p.data, Object.freeze(p.akoro));
  if (out && typeof out.then === "function") throw new Error("run must return its answer directly, not a promise");
  return JSON.stringify(out === undefined ? null : out);
})()`;
    const result = vm.evalCode(program, "tool.js");
    if (result.error) {
      const err = vm.dump(result.error);
      result.error.dispose();
      const msg = typeof err === "object" && err ? `${err.name || "Error"}: ${err.message || ""}` : String(err);
      done({ ok: false, error: /interrupted/i.test(msg) ? "the code ran too long" : /out of memory|memory/i.test(msg) ? "the code used too much memory" : /stack/i.test(msg) ? "the code recursed too deeply" : msg.slice(0, 300) });
    } else {
      const json = vm.getString(result.value);
      result.value.dispose();
      if (json.length > limits.outputBytes) done({ ok: false, error: `the answer is too large (${json.length} bytes)` });
      else done({ ok: true, json });
    }
  } finally {
    vm.dispose();
    runtime.dispose();
  }
} catch (e) {
  const msg = String(e?.message || e);
  done({ ok: false, error: /memory/i.test(msg) ? "the code used too much memory" : `sandbox error: ${msg.slice(0, 200)}` });
}
