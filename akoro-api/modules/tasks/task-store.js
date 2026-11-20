import db from "../../db.js";

export async function activeAgentForUser(userId) {
  const { data } = await db.from("user_agents").select("id").eq("user_id", userId).eq("is_active", true).maybeSingle();
  return data;
}

export async function partners() {
  const [{ data: schools }, { data: teachers }] = await Promise.all([
    db.from("schools").select("id, name, logo_url").order("name"),
    db.from("users").select("id, full_name, username, email, role").in("role", ["instructor", "admin"]).order("full_name"),
  ]);
  return { schools, teachers };
}

export async function dynamicToolById(id) {
  const { data, error } = await db.from("dynamic_tools").select("*").eq("id", id).single();
  return { data, error };
}

export async function openSuggestions(userId) {
  const { data, error } = await db.from("agent_suggestions")
    .select("*").eq("user_id", userId).eq("status", "open")
    .order("created_at", { ascending: false }).limit(50);
  return { data, error };
}

export async function updateTaskFileOcr(fileId, text) {
  await db.from("task_files").update({ ocr_text: text }).eq("id", fileId);
}

export async function insertRecurrenceTask(row) {
  const { data, error } = await db.from("tasks").insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}
