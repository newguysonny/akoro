/**
 * tenant.js — hostname → school resolution, shared by the site renderer
 * (routes.js) and the public portal (publicPortal.js).
 *
 * A tenant host is either a wildcard subdomain (<slug>.SITE_BASE_DOMAIN) or a
 * verified custom domain in edu.school_domains.
 */
import db from "../../db.js";

// One or more wildcard base domains (comma-separated env). Both the
// .name.ng and .app zones resolve out of the box; SITE_BASE_DOMAIN stays
// the primary one (used for the school's advertised default subdomain).
export const SITE_BASE_DOMAINS = (process.env.SITE_BASE_DOMAIN || "akoro.name.ng,akoro.app")
  .toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
export const SITE_BASE_DOMAIN = SITE_BASE_DOMAINS[0];
export const SCHOOL_SELECT = "id, name, slug, logo_url, address, phone, acronym, principal_name";

// host → school row (or null). Handles ports, www., wildcard subdomains and
// verified custom domains in edu.school_domains.
export async function resolveSchoolByHost(rawHost) {
  let host = String(rawHost || "").toLowerCase().split(":")[0].trim();
  if (!host) return null;
  const bare = host.startsWith("www.") ? host.slice(4) : host;

  // <slug>.<base-domain> wildcard subdomain
  for (const base of SITE_BASE_DOMAINS) {
    if (!bare.endsWith(`.${base}`)) continue;
    const sub = bare.slice(0, -(base.length + 1));
    if (sub && !sub.includes(".")) {
      const { data } = await db.from("school_profiles").select(SCHOOL_SELECT).eq("slug", sub).maybeSingle();
      if (data) return data;
    }
  }

  // Verified custom domain (exact, then www-stripped)
  for (const candidate of [host, bare]) {
    const { data: dom } = await db.schema("edu").from("school_domains")
      .select("school_id").eq("domain", candidate).eq("verified", true).maybeSingle();
    if (dom) {
      const { data } = await db.from("school_profiles").select(SCHOOL_SELECT).eq("id", dom.school_id).maybeSingle();
      if (data) return data;
    }
  }
  return null;
}

// The school's own payment gateway credentials (edu.school_payment_gateway).
// Returns { ok, secret, mode } — ok only when enabled + a usable secret key
// exists for the configured mode.
export async function getSchoolGateway(schoolId) {
  const { data: g } = await db.schema("edu").from("school_payment_gateway")
    .select("enabled, provider, mode, live_key_secret, sandbox_key_secret")
    .eq("school_id", schoolId).maybeSingle();
  if (!g || !g.enabled) return { ok: false };
  const mode = (g.mode || "sandbox").toLowerCase();
  const secret = mode === "live" ? g.live_key_secret : g.sandbox_key_secret;
  if (!secret) return { ok: false };
  return { ok: true, secret, mode, provider: g.provider || "paystack" };
}
