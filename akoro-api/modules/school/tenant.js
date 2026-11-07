/**
 * tenant.js — hostname → school resolution, shared by the site renderer
 * (routes.js) and the public portal (publicPortal.js).
 *
 * A tenant host is either a wildcard subdomain (<slug>.SITE_BASE_DOMAIN) or a
 * verified custom domain in edu.school_domains.
 */
import db from "../../db.js";
import { hostOf, isReservedSubdomain } from "./hostNames.js";
import { URL_DEFAULTS } from "../../lib/urls.js";

export { hostOf };

// Wildcard base domain(s). Not hardcoded — derived from the main learner/site
// URL that Railway already defines (FRONTEND_URL / MAIN_SITE_URL). Change the
// domain there and tenant subdomains follow. SITE_BASE_DOMAIN may still be set
// explicitly (comma list) to add extra zones (e.g. keep the old akoro.app).
const derivedBase = hostOf(process.env.FRONTEND_URL || process.env.MAIN_SITE_URL);
export const SITE_BASE_DOMAINS = (process.env.SITE_BASE_DOMAIN || derivedBase || hostOf(URL_DEFAULTS.MAIN_SITE_URL))
  .toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
export const SITE_BASE_DOMAIN = SITE_BASE_DOMAINS[0];
export const SCHOOL_SELECT = "id, name, slug, logo_url, address, phone, acronym, principal_name";

/* ── Which hosts belong to a SCHOOL rather than to us ────────────────────────
 *
 * CORS credentials hinge on this. Every school site and every one of our own
 * apps lives under the same base domain, so the hostname pattern alone can't
 * tell them apart — and guessing our app names ("akoro-school", "app", …) fails
 * the moment one is deployed under a name the guess didn't include.
 *
 * The real distinction is data: a tenant host matches a school slug or a
 * verified custom domain. Everything else on the base domain is ours. The set
 * is cached and refreshed in the background, because this is consulted on the
 * CORS path of every request.
 *
 * FAILS CLOSED: until the cache has loaded successfully, isTenantHost() reports
 * true for any base-domain subdomain, so an unknown host is treated as a school
 * site and denied credentials. Wrongly denying is a broken page; wrongly
 * granting is a school's script acting as any signed-in visitor.
 */
let tenantSlugs = new Set();
let tenantDomains = new Set();
let tenantCacheLoaded = false;

export async function refreshTenantHosts() {
  try {
    const [{ data: schools }, { data: domains }] = await Promise.all([
      db.from("school_profiles").select("slug").not("slug", "is", null),
      db.schema("edu").from("school_domains").select("domain").eq("verified", true),
    ]);
    tenantSlugs = new Set((schools || []).map((s) => String(s.slug).toLowerCase()));
    tenantDomains = new Set((domains || []).map((d) => String(d.domain).toLowerCase().replace(/^www\./, "")));
    tenantCacheLoaded = true;
  } catch (e) {
    console.warn("[tenant] host cache refresh failed:", e.message);
  }
  return { slugs: tenantSlugs.size, domains: tenantDomains.size, loaded: tenantCacheLoaded };
}

/** True when this host serves a SCHOOL's own site (not one of our apps). */
export function isTenantHost(host) {
  const bare = String(host || "").toLowerCase().replace(/^www\./, "");
  if (!bare) return false;
  if (tenantDomains.has(bare)) return true;
  for (const base of SITE_BASE_DOMAINS) {
    if (bare === base || !bare.endsWith(`.${base}`)) continue;
    const sub = bare.slice(0, -(base.length + 1));
    if (sub.includes(".")) return true;               // deeper nesting is never ours
    if (isReservedSubdomain(sub)) return false;       // app., admin., api. … are our own apps, never a school
    if (!tenantCacheLoaded) return true;              // unknown → treat as a school
    return tenantSlugs.has(sub);
  }
  return false;
}

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
    if (sub && !sub.includes(".") && !isReservedSubdomain(sub)) {
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
