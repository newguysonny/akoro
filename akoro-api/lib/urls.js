/**
 * urls.js — the ONE place the API gets the addresses of the platform's own sites.
 *
 * Every address is an env var; when it isn't set the default is the CURRENT host (the split: marketing site on the apex,
 * the learner app on app., portals on their own subdomains, the API on api.). No other file should spell a domain.
 * JWT_ISSUER / JWT_AUDIENCE are NOT here on purpose: they are opaque claims inside already-issued tokens, not addresses
 * we call — changing their defaults would invalidate every session (they live in auth/routes.js and lib/tokenPeek.js).
 */
export const URL_DEFAULTS = Object.freeze({
  FRONTEND_URL:            "https://app.akoro.name.ng",            // the learner app (emails, payment returns, sign-in links)
  MAIN_SITE_URL:           "https://akoro.name.ng",                // the marketing site (landing, blog, legal)
  INSTRUCTOR_FRONTEND_URL: "https://instructors.akoro.name.ng",
  ADMIN_FRONTEND_URL:      "https://admin.akoro.name.ng",
  SCHOOL_FRONTEND_URL:     "https://akoro-school.akoro.name.ng",   // the school portal
  AGENT_FRONTEND_URL:      "https://agent.akoro.name.ng",
  BUSINESS_FRONTEND_URL:   "https://business.akoro.name.ng",
  API_URL:                 "https://api.akoro.name.ng",            // this API, as the outside world reaches it
});

const trim = (u) => String(u ?? "").trim().replace(/\/+$/, "");

/** The configured address for `name` (no trailing slash), else the current-host default. Extra env names are tried in order. */
export function urlFor(name, { env = process.env, alias = [] } = {}) {
  for (const key of [name, ...alias]) {
    const v = trim(env[key]);
    if (v) return v;
  }
  return URL_DEFAULTS[name] ?? alias.map((k) => URL_DEFAULTS[k]).find(Boolean) ?? "";
}

/** The host of an address, for display ("akoro.name.ng"). */
export function displayHost(url) {
  try { return new URL(url).host; } catch { return String(url || "").replace(/^[a-z]+:\/\//i, "").split("/")[0]; }
}

/** The URL env vars production should set (falling back to a default works, but silently — this names what's unset). */
export const EXPECTED_URL_ENV = Object.freeze([
  "FRONTEND_URL", "MAIN_SITE_URL", "INSTRUCTOR_FRONTEND_URL", "ADMIN_FRONTEND_URL", "SCHOOL_FRONTEND_URL", "API_URL", "GOOGLE_CALLBACK_URL", "SITE_BASE_DOMAIN",
]);
export const missingUrlEnv = (env = process.env) => EXPECTED_URL_ENV.filter((k) => !trim(env[k]));
