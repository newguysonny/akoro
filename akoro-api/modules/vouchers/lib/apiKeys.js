/**
 * lib/apiKeys.js — raw API key generation for startups.
 * The raw key is returned to the caller ONCE (at creation) and never stored —
 * only its sha256 hash lives in the database (see apiKeyAuth.js).
 */
import { randomBytes } from "crypto";
import { hashKey } from "../apiKeyAuth.js";
import { vdb } from "../db.js";

const PREFIX = "sk_live_";

export function generateRawKey() {
  const secret = randomBytes(24).toString("base64url");   // ~192 bits
  return `${PREFIX}${secret}`;
}

/** Create + store a new key for a startup. Returns the RAW key (show once). */
export async function issueApiKey(startupId, label = null, createdByUserId = null) {
  const raw = generateRawKey();
  const { data, error } = await vdb().from("api_keys").insert({
    startup_id: startupId,
    key_prefix: raw.slice(0, 14) + "…",
    key_hash:   hashKey(raw),
    label,
    created_by_user_id: createdByUserId,
  }).select("id, key_prefix, created_at").single();
  if (error) throw new Error(error.message);
  return { ...data, rawKey: raw };
}
