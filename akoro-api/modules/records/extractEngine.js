// Which engine parses scanned pages: the fine-tuned RunPod worker (default)
// or a vision model returning markdown directly.
//
// The switch lives in edu.platform_settings so an admin can flip it from the
// console without a redeploy; RECORDS_EXTRACT_ENGINE is the fallback (and the
// boot default when the row is missing). The RunPod path is never removed —
// rolling back is one toggle.

const KEY = "records_extract_engine";
export const EXTRACT_ENGINES = ["runpod", "model", "ocr"];

const dbLazy = async () => (await import("../../db.js")).default;

export async function getExtractEngine() {
  const fallback = String(process.env.RECORDS_EXTRACT_ENGINE || "runpod").toLowerCase();
  const envValue = EXTRACT_ENGINES.includes(fallback) ? fallback : "runpod";
  try {
    const db = await dbLazy();
    const { data, error } = await db.schema("edu").from("platform_settings")
      .select("value").eq("key", KEY).maybeSingle();
    if (error || !data) return envValue;
    const value = String(data.value || "").replace(/"/g, "").toLowerCase();
    return EXTRACT_ENGINES.includes(value) ? value : envValue;
  } catch {
    return envValue;
  }
}

export async function setExtractEngine(engine, userId = null) {
  const next = String(engine || "").toLowerCase();
  if (!EXTRACT_ENGINES.includes(next)) throw new Error(`engine must be one of ${EXTRACT_ENGINES.join(", ")}`);
  const db = await dbLazy();
  const { error } = await db.schema("edu").from("platform_settings")
    .upsert({ key: KEY, value: next, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return next;
}

/** The vision model the model lane uses (id from lib/modelRegistry). */
export const extractModelId = () => process.env.RECORDS_EXTRACT_MODEL || "claude-haiku";
