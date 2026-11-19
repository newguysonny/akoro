/**
 * modules/school/service-domains.js — custom domains (Vercel-managed with a
 * DNS fallback) and connected social accounts.
 *
 * Auth decisions and status codes live here; queries live in store.js; the
 * Vercel/DNS side effects stay in the existing helper modules.
 */

import {
  vercelConfigured, addDomainToProject, getProjectDomain,
  verifyProjectDomain, getDomainConfig, removeDomainFromProject, buildDnsRecords,
} from "./vercelDomains.js";
import { SITE_BASE_DOMAIN, SITE_BASE_DOMAINS } from "./tenant.js";
import * as store from "./store.js";
import { slugify } from "./rules.js";
import { getMySchool } from "./service.js";

// ── GET /api/school/domains ────────────────────────────────────────────────────
export async function listDomains(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data } = await store.domainsBySchool(school.id);
    res.json({
      success: true,
      data: {
        defaultDomain: `${school.slug || slugify(school.name)}.${SITE_BASE_DOMAIN}`,
        vercelManaged: vercelConfigured(),
        customDomains: (data || []).map((d) => ({
          id: d.id, domain: d.domain, verified: d.verified,
          cnameTarget: d.cname_target, vercelAdded: d.vercel_added, dnsRecords: d.dns_records || [],
        })),
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/domains ───────────────────────────────────────────────────
// Registers the domain and, when Vercel credentials are configured, attaches
// it to the Vercel project so verification + SSL are handled by Vercel.
export async function createDomain(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const domain = (req.body.domain || "").toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!domain || !domain.includes(".")) return res.status(400).json({ error: "Enter a valid domain, e.g. www.yourschool.com" });
    if (SITE_BASE_DOMAINS.some((b) => domain === b || domain.endsWith(`.${b}`))) {
      return res.status(400).json({ error: `${SITE_BASE_DOMAIN} subdomains are assigned automatically — add your own domain here.` });
    }
    const { data, error } = await store.domainInsert({ school_id: school.id, domain, cname_target: "cname.vercel-dns.com" });
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "That domain is already registered" });
      throw new Error(error.message);
    }

    // Programmatic Vercel attach → returns the exact DNS records to configure.
    let dnsRecords = data.dns_records || [];
    let vercelAdded = false;
    if (vercelConfigured()) {
      try {
        await addDomainToProject(domain);
        const pd = await getProjectDomain(domain);
        dnsRecords = buildDnsRecords(domain, pd);
        vercelAdded = true;
        await store.domainUpdate(data.id, { vercel_added: true, dns_records: dnsRecords });
      } catch (e) { console.error("[vercel add domain]", e.message); }
    }

    res.status(201).json({ success: true, data: {
      id: data.id, domain: data.domain, verified: data.verified,
      cnameTarget: data.cname_target, vercelAdded, dnsRecords,
    } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/domains/:id/verify ────────────────────────────────────────
// Vercel-managed: verifies TXT ownership + DNS routing through Vercel (SSL is
// issued automatically once both pass). Fallback: local CNAME resolution.
export async function verifyDomain(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: row } = await store.domainById(school.id, req.params.id);
    if (!row) return res.status(404).json({ error: "Domain not found" });

    let verified = false;
    let message;
    let dnsRecords = row.dns_records || [];

    if (vercelConfigured()) {
      // (Re)attach in case the earlier add failed, then run Vercel's checks.
      if (!row.vercel_added) {
        try { await addDomainToProject(row.domain); } catch (e) { console.error("[vercel re-add]", e.message); }
      }
      try { await verifyProjectDomain(row.domain); } catch { /* pending challenges just stay pending */ }
      const [pd, cfg] = await Promise.all([
        getProjectDomain(row.domain).catch(() => null),
        getDomainConfig(row.domain).catch(() => null),
      ]);
      const ownershipOk = !!pd?.verified;
      const routingOk = cfg ? !cfg.misconfigured : false;
      verified = ownershipOk && routingOk;
      dnsRecords = pd ? buildDnsRecords(row.domain, pd) : dnsRecords;
      message = verified
        ? "Domain verified — Vercel is issuing the SSL certificate."
        : !ownershipOk
          ? "Ownership not confirmed yet — add the TXT record shown, then verify again."
          : "Ownership confirmed, but DNS isn't pointing at Vercel yet — add the CNAME/A record shown.";
      await store.domainUpdate(row.id, {
        vercel_added: true, dns_records: dnsRecords,
        ...(verified ? { verified: true, verified_at: new Date() } : {}),
      });
    } else {
      // Fallback: plain CNAME resolution (no automatic SSL).
      try {
        const { resolveCname } = await import("node:dns/promises");
        const records = await resolveCname(row.domain);
        verified = records.some((r) => r.toLowerCase().includes(row.cname_target.toLowerCase()));
      } catch { verified = false; }
      message = verified ? "Domain verified!" : "CNAME record not found yet — DNS can take a few hours to propagate.";
      if (verified) {
        await store.domainUpdate(row.id, { verified: true, verified_at: new Date() });
      }
    }

    res.json({ success: true, verified, message, dnsRecords });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── DELETE /api/school/domains/:id ─────────────────────────────────────────────
export async function deleteDomain(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: row } = await store.domainSummaryById(school.id, req.params.id);
    if (row?.vercel_added && vercelConfigured()) {
      try { await removeDomainFromProject(row.domain); } catch (e) { console.error("[vercel remove domain]", e.message); }
    }
    const { error } = await store.domainDelete(school.id, req.params.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── GET /api/school/social-accounts ────────────────────────────────────────────
export async function listSocialAccounts(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data } = await store.socialAccountsBySchool(school.id);
    res.json({ success: true, data: (data || []).map((a) => ({ id: a.id, provider: a.provider, pageName: a.page_name, pageId: a.page_id, active: a.active, connectedAt: a.connected_at, expiresAt: a.expires_at })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── PATCH /api/school/social-accounts/:id ──────────────────────────────────────
// Body: { active } — used by the Disconnect / Switch Active Page actions.
export async function updateSocialAccount(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { error } = await store.socialAccountUpdate(school.id, req.params.id, { active: !!req.body.active });
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
