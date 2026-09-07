/**
 * Trusted Node → Python delivery for a learner-approved agent action.
 *
 * This is intentionally server-to-server: the browser receives a review card
 * but never the confirmation token or the Python-service credential.
 */
import { safeFetch } from "../../lib/safeFetch.js";

function pythonService() {
  const baseUrl = (process.env.PYTHON_AGENT_SERVICE_URL || "").trim().replace(/\/$/, "");
  const secret = (process.env.AKORO_AGENT_SERVICE_SECRET || "").trim();
  return baseUrl && secret ? { baseUrl, secret } : null;
}

export function pythonActionRelayConfigured() {
  return Boolean(pythonService());
}

export async function relayConfirmedPythonAction({ sessionId, confirmationToken }) {
  const service = pythonService();
  if (!service) return { delivered: false, state: "awaiting_python_bridge" };

  const response = await safeFetch(`${service.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/confirmed-actions`, {
    method: "POST",
    timeoutMs: 12_000,
    maxBytes: 32 * 1024,
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Akoro-Agent-Secret": service.secret,
    },
    body: { confirmationToken },
  });
  let payload = null;
  try { payload = JSON.parse(response.text); } catch { /* handled below */ }
  if (response.status < 200 || response.status >= 300 || !payload || typeof payload !== "object") {
    throw new Error("Python agent could not redeem the confirmed action");
  }
  return { delivered: true, execution: payload.execution ?? null };
}
