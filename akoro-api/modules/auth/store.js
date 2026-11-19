/**
 * auth/store.js — every Supabase query the auth module makes. No Express, no
 * response shaping; callers await the builders and keep their own error
 * handling exactly as before.
 */

import db from "../../db.js";

// ─── § USERS ──────────────────────────────────────────────────────────────────

export const findUserByEmail = (email) =>
  db.from("users").select("*").eq("email", email).maybeSingle();

export const findSignupCandidate = (email) =>
  db.from("users").select("id, email, email_verified, full_name, username").eq("email", email).maybeSingle();

export const findUserByUsername = (username) =>
  db.from("users").select("id").eq("username", username).maybeSingle();

export const findUserById = (id) =>
  db.from("users").select("*").eq("id", id).maybeSingle();

export const findUserEmailProfile = (id) =>
  db.from("users").select("email, full_name, username, role").eq("id", id).maybeSingle();

export const insertUser = (row) =>
  db.from("users").insert(row).select("*").single();

export const updateUser = (id, patch) =>
  db.from("users").update(patch).eq("id", id);

export const findAllSessionUser = (id) =>
  db.from("users")
    .select("id,email,username,full_name,avatar_url,role,is_active,onboarding_completed,force_logout_at")
    .eq("id", id).maybeSingle();

export const findSessionUserFallback = (id) =>
  db.from("users")
    .select("id,email,username,full_name,avatar_url,role,is_active")
    .eq("id", id).maybeSingle();

export const findSocketUser = (id) =>
  db.from("users")
    .select("id,email,username,full_name,avatar_url,role,is_active,force_logout_at")
    .eq("id", id).maybeSingle();

export const findLatestAgent = (userId) =>
  db.from("user_agents")
    .select("id").eq("user_id", userId)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();

export const reactivateAgent = (id) =>
  db.from("user_agents").update({ is_active: true }).eq("id", id);

export const findResetTarget = (email) =>
  db.from("users")
    .select("id, full_name, username, email, is_active")
    .eq("email", email)
    .maybeSingle();

export const findTwoFactorProfile = (id) =>
  db.from("users").select("id,email,two_factor_enabled").eq("id", id).maybeSingle();

export const findTwoFactorState = (id) =>
  db.from("users").select("id,two_factor_secret,two_factor_enabled").eq("id", id).maybeSingle();

export const findPasswordState = (id) =>
  db.from("users").select("id,password_hash").eq("id", id).maybeSingle();

// ─── § REVOKED TOKENS (deny-list persistence) ─────────────────────────────────

export const insertRevokedToken = (jti, expiresAtISO) =>
  db.from("revoked_tokens").insert({ jti, expires_at: expiresAtISO });

export const findRevokedToken = (jti) =>
  db.from("revoked_tokens").select("jti").eq("jti", jti).maybeSingle();

// ─── § PASSWORD RESET TOKENS ──────────────────────────────────────────────────

export const invalidateResetTokens = (userId, usedAt) =>
  db.from("password_reset_tokens")
    .update({ used_at: usedAt })
    .eq("user_id", userId)
    .is("used_at", null);

export const insertResetToken = (row) =>
  db.from("password_reset_tokens").insert(row);

export const findResetToken = (tokenHash) =>
  db.from("password_reset_tokens")
    .select("id, user_id, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

export const markResetTokenUsed = (id, usedAt) =>
  db.from("password_reset_tokens")
    .update({ used_at: usedAt })
    .eq("id", id);

export const revokeUnusedRefreshTokensForUser = (userId) =>
  db.from("refresh_tokens")
    .update({ used: true })
    .eq("user_id", userId)
    .eq("used", false);

// ─── § REFRESH TOKEN STORE ────────────────────────────────────────────────────
// Stores valid refresh token metadata.  Supports rotation + family revocation.

export const RefreshStore = {
  // Save a newly issued refresh token
  save: async (jti, userId, family, expiresAt) => {
    try {
      await db.from("refresh_tokens").insert({
        jti,
        user_id:    userId,
        family,
        expires_at: new Date(expiresAt * 1000).toISOString(),
        used:       false,
      });
    } catch (e) {
      console.error("RefreshStore.save error:", e.message);
    }
  },
  // Find by jti — returns row or null
  find: async (jti) => {
    try {
      const { data } = await db.from("refresh_tokens").select("*").eq("jti", jti).maybeSingle();
      return data;
    } catch { return null; }
  },
  // Mark a token as used, and record WHEN and by what it was replaced.
  // The timestamp is what separates a concurrent refresh from a replayed
  // token; without it every double-refresh looked like an attack.
  markUsed: async (jti, replacedBy = null) => {
    try {
      await db.from("refresh_tokens")
        .update({ used: true, used_at: new Date().toISOString(), replaced_by: replacedBy })
        .eq("jti", jti);
    } catch { /* ignore */ }
  },
  // Revoke entire family (replay attack detected)
  revokeFamily: async (family) => {
    try { await db.from("refresh_tokens").delete().eq("family", family); }
    catch { /* ignore */ }
  },
  // Delete a single token (clean logout)
  delete: async (jti) => {
    try { await db.from("refresh_tokens").delete().eq("jti", jti); }
    catch { /* ignore */ }
  },
};

// ─── § GOOGLE OAUTH ───────────────────────────────────────────────────────────

export const updateGoogleUser = (id, patch) =>
  db.from("users").update(patch).eq("id", id).select("*").single();

export const insertGoogleUser = (row) =>
  db.from("users").insert(row).select("*").single();
