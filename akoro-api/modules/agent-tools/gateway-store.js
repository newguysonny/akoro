import db from "../../db.js";
import { GatewayError } from "./gateway-rules.js";

export async function priorInvocation(capabilityJti, idempotencyKey) {
  const { data, error } = await db.schema("edu").from("agent_tool_invocations")
    .select("status, response, tool_name")
    .eq("capability_jti", capabilityJti)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw new GatewayError(503, "Agent tools idempotency store is unavailable");
  return data;
}

export async function claimInvocation({ claims, principal, name, idempotencyKey }) {
  const existing = await priorInvocation(claims.jti, idempotencyKey);
  if (existing) return { existing, created: false };
  const { error } = await db.schema("edu").from("agent_tool_invocations").insert({
    capability_jti: claims.jti,
    idempotency_key: idempotencyKey,
    principal_id: principal.id,
    tool_name: name,
    status: "running",
  });
  if (!error) return { existing: null, created: true };
  // A simultaneous retry is normal under network failures. Read the winner
  // rather than performing a second write-capable invocation.
  if (error.code === "23505") return { existing: await priorInvocation(claims.jti, idempotencyKey), created: false };
  throw new GatewayError(503, "Agent tools idempotency store is unavailable");
}

export async function completeInvocation(claims, idempotencyKey, response) {
  const { error } = await db.schema("edu").from("agent_tool_invocations")
    .update({ status: "completed", response, completed_at: new Date().toISOString() })
    .eq("capability_jti", claims.jti)
    .eq("idempotency_key", idempotencyKey);
  if (error) throw new GatewayError(503, "Agent tools idempotency store is unavailable");
}
