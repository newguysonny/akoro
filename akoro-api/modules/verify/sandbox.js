/**
 * modules/verify/sandbox.js — the gate's sandbox switch (phase V3).
 *
 *   VERIFY_SANDBOX_ENABLED=true   runs go to the sandbox gate (a second
 *                                 akoro-api with VERIFY_TARGET=sandbox and its
 *                                 own database) instead of running here
 *   VERIFY_SANDBOX_URL            e.g. https://akoro-api-sandbox.onrender.com
 *   VERIFY_SANDBOX_KEY            its gate key (default: this AGENT_CONSOLE_KEY)
 *
 * Off or unset (the default): nothing changes — the gate tests THIS API, as
 * before. While on, a run can still be pinned here with { "target": "production" }.
 */
export const sandboxConfig = () => {
  const enabled = String(process.env.VERIFY_SANDBOX_ENABLED || "").trim().toLowerCase() === "true";
  const url = String(process.env.VERIFY_SANDBOX_URL || "").trim().replace(/\/+$/, "");
  return { enabled: enabled && /^https?:\/\//.test(url), requested: enabled, url, key: process.env.VERIFY_SANDBOX_KEY || process.env.AGENT_CONSOLE_KEY || "" };
};

/** Should this request go to the sandbox? Never from the sandbox itself. */
export const goesToSandbox = (target) => {
  const c = sandboxConfig();
  return c.enabled && process.env.VERIFY_TARGET !== "sandbox" && target !== "production" && target !== "here";
};

/**
 * Forward one gate call. → { status, body }. A sandbox that doesn't answer is
 * BLOCKED (a missing precondition), never a silent fallback to production.
 */
export async function forward(method, path, body = null, { timeoutMs = 120_000 } = {}) {
  const { url, key } = sandboxConfig();
  try {
    const r = await fetch(`${url}/api/verify${path}`, {
      method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await r.json().catch(() => null);
    return { status: r.status, body: json && typeof json === "object" ? { ...json, via: "sandbox" } : { success: false, error: `sandbox answered ${r.status}`, via: "sandbox" } };
  } catch (e) {
    return { status: 503, body: { success: false, via: "sandbox", data: { verdict: "BLOCKED", reason: `sandbox unreachable (${url}): ${e.message}` }, error: `The sandbox gate didn't answer: ${e.message}. Pass "target":"production" to run here instead.` } };
  }
}
