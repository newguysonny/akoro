import db from "../../db.js";

export async function activeDocumentTools(ownerId) {
  const { data } = await db.schema("edu").from("agent_tools")
    .select("id, name, label, goal, views").eq("owner_id", ownerId).eq("status", "active");
  return data;
}

export async function archiveTool(id, ownerId) {
  await db.schema("edu").from("agent_tools")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", id).eq("owner_id", ownerId);
}

export async function activeToolsForCleanup(ownerId) {
  const { data } = await db.schema("edu").from("agent_tools")
    .select("id, name, label, mode, views, domain, params_schema, capabilities, created_at").eq("owner_id", ownerId).eq("status", "active");
  return data;
}

export async function allActiveLearnerTools() {
  const { data } = await db.schema("edu").from("agent_tools")
    .select("id, owner_id, name, label, mode, views, domain, params_schema, capabilities, created_at")
    .eq("scope", "learner").eq("status", "active").limit(10000);
  return data;
}

export async function learnerTools(ownerId, status) {
  const q = db.schema("edu").from("agent_tools")
    .select("name, label, goal, mode, status, views, domain, actions, capabilities, params_schema, verification, created_at, last_used_at, usage_count")
    .eq("owner_id", ownerId).order("created_at", { ascending: true });
  if (["active", "disabled", "archived"].includes(status)) q.eq("status", status);
  return q;
}

export async function contentParses(key) {
  const { data, error } = await db.schema("edu").from("content_parses")
    .select("page_number, model, markdown, updated_at")
    .eq("content_key", key).order("page_number", { ascending: true });
  return { data, error };
}
