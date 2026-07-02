/**
 * vercelDomains.js — programmatic custom-domain management via Vercel's REST API.
 *
 * Attaches school custom domains to the school-frontend Vercel project so
 * Vercel handles DNS verification and automatic SSL issuance. Uses plain
 * fetch (no SDK dependency).
 *
 * Env (all optional — without them the API falls back to local CNAME checks):
 *   VERCEL_TOKEN       personal/team access token with project scope
 *   VERCEL_PROJECT_ID  the school-frontend project id (or name)
 *   VERCEL_TEAM_ID     required only if the project lives under a team
 */

const TOKEN   = process.env.VERCEL_TOKEN;
const PROJECT = process.env.VERCEL_PROJECT_ID;
const TEAM    = process.env.VERCEL_TEAM_ID;

export const vercelConfigured = () => Boolean(TOKEN && PROJECT);

async function vc(method, path, body) {
  const url = new URL(`https://api.vercel.com${path}`);
  if (TEAM) url.searchParams.set("teamId", TEAM);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `Vercel API ${res.status}`;
    const err = new Error(msg);
    err.code = json?.error?.code;
    err.status = res.status;
    throw err;
  }
  return json;
}

// Attach a domain to the project. Idempotent-ish: 'domain_already_in_use'
// by THIS project is treated as success.
export async function addDomainToProject(domain) {
  try {
    return await vc("POST", `/v10/projects/${PROJECT}/domains`, { name: domain });
  } catch (e) {
    if (e.code === "domain_already_in_use" || e.status === 409) {
      return getProjectDomain(domain);
    }
    throw e;
  }
}

// Project-domain state: { verified, verification: [{type, domain, value}] }
export function getProjectDomain(domain) {
  return vc("GET", `/v9/projects/${PROJECT}/domains/${domain}`);
}

// Ask Vercel to (re)verify TXT ownership challenges.
export function verifyProjectDomain(domain) {
  return vc("POST", `/v9/projects/${PROJECT}/domains/${domain}/verify`);
}

// DNS routing state: { misconfigured } — false once CNAME/A points at Vercel.
export function getDomainConfig(domain) {
  return vc("GET", `/v6/domains/${domain}/config`);
}

export async function removeDomainFromProject(domain) {
  try { return await vc("DELETE", `/v9/projects/${PROJECT}/domains/${domain}`); }
  catch (e) { if (e.status === 404) return { removed: false }; throw e; }
}

/**
 * The DNS records a school must add, combining Vercel's TXT ownership
 * challenges with routing guidance (CNAME for subdomains, A for apex).
 */
export function buildDnsRecords(domain, projectDomain) {
  const records = [];
  for (const v of projectDomain?.verification || []) {
    records.push({ type: v.type, name: v.domain, value: v.value, purpose: "ownership" });
  }
  const isApex = domain.split(".").length === 2;
  if (isApex) {
    records.push({ type: "A", name: "@", value: "76.76.21.21", purpose: "routing" });
  } else {
    records.push({ type: "CNAME", name: domain.split(".")[0], value: "cname.vercel-dns.com", purpose: "routing" });
  }
  return records;
}
