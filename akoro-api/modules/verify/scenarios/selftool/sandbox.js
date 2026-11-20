// Self-tooling sandbox: the deployed code sandbox runs plain code and contains escapes.

export async function runSandboxContained(ctx, p) {
    const { runCode, staticCheck, CODE_LIMITS } = await import("../../../self-tooling/index.js");
    const ok = await runCode("function run(input, data){ return data.a.map(function (r) { return { x: r.x * 2 }; }); }", { input: {}, data: { a: [{ x: 1 }, { x: 2 }] }, akoro: {} });
    ctx.expect.ok("plain code runs", ok.ok && ok.value?.[1]?.x === 4, ok);
    // Network names are refused before running; host objects simply aren't there.
    ctx.expect.ok("network refused before running", staticCheck("function run(){ return fetch('https://example.com') }").some((e) => /network/.test(e)));
    const hostless = await runCode("function run(){ return [typeof std, typeof os, typeof module, typeof exports, typeof __dirname, typeof Buffer, typeof console].join(','); }", {});
    ctx.expect.eq("no host objects", hostless.value, "undefined,undefined,undefined,undefined,undefined,undefined,undefined");
    const t0 = Date.now();
    const loop = await runCode("function run(){ for (;;) {} }", {});
    ctx.expect.ok("infinite loop stopped", !loop.ok && /too long/.test(loop.error), loop);
    ctx.expect.lte("stopped within the wall limit (ms)", Date.now() - t0, CODE_LIMITS.wallMs + 1500);
    const bomb = await runCode("function run(){ var s = 'x'; for (var i = 0; i < 60; i++) s = s + s; return s.length; }", {});
    ctx.expect.ok("memory bomb stopped", !bomb.ok, bomb);
    const tamper = await runCode("function run(){ Array.isArray = null; return 1; }", {});
    const after = await runCode("function run(){ return typeof Array.isArray; }", {});
    ctx.expect.ok("tampering stays in one run", tamper.ok && after.value === "function", { tamper, after });
    ctx.expect.ok("escape routes refused before running", staticCheck("function run(){ return [].constructor.constructor('return process')() }").length > 0);
}
