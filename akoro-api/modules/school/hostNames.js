/**
 * hostNames.js — pure host-name helpers shared by the tenant resolver (tenant.js). No database, so they are unit-tested.
 *
 * Our own apps live on subdomains of the base domain (app., admin., instructors., api. …); a school's site is
 * <slug>.<base domain> or a verified custom domain. The names below are ours: a school can never own them, and they
 * must never be mistaken for the base domain itself.
 */
export const RESERVED_SUBDOMAINS = Object.freeze(new Set([
  "www", "app", "api", "admin", "instructor", "instructors", "school", "akoro-school", "akoro-instructor", "akoro-admin", "learn", "learner",
]));

/** Bare registrable host from a URL or host string: drops scheme, path, port and ONE leading www./api./app. label.
 *  "https://app.akoro.name.ng/x" → "akoro.name.ng", so the learner app moving to app.<base> never changes the base domain. */
export function hostOf(url) {
  if (!url) return "";
  const h = String(url).trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split("/")[0].split(":")[0];
  return h.replace(/^(www|api|app)\./, "");
}

/** The single label in front of `base` ("greenfield" for greenfield.akoro.name.ng), "" for the apex, null when `host` isn't under `base`. */
export function subdomainOf(host, base) {
  const bare = String(host || "").toLowerCase().replace(/^www\./, "");
  if (!bare || bare === base) return "";
  if (!bare.endsWith(`.${base}`)) return null;
  return bare.slice(0, -(base.length + 1));
}

export const isReservedSubdomain = (sub) => RESERVED_SUBDOMAINS.has(String(sub || "").toLowerCase());
