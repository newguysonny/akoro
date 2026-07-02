-- =============================================================
-- 2026-school-domains-vercel.sql
-- Multi-tenant custom domains, managed programmatically via Vercel.
--
-- edu.school_domains gains:
--   vercel_added  whether the domain has been attached to the Vercel project
--   dns_records   the exact records the school must add (TXT ownership
--                 challenges from Vercel + CNAME/A routing guidance)
--
-- Requires API env: VERCEL_TOKEN, VERCEL_PROJECT_ID (+ VERCEL_TEAM_ID if the
-- project is under a team). Without them the API falls back to plain CNAME
-- verification (no automatic SSL).
--
-- Also remember (one-time, manual):
--   1. Vercel project → Settings → Domains → add the wildcard *.akoro.app
--      (requires akoro.app nameservers or a wildcard CNAME at your DNS host)
--      so every school's <slug>.akoro.app subdomain resolves automatically.
--   2. Set VITE_PORTAL_HOSTS on the school frontend (comma-separated hosts
--      that should load the ADMIN portal, e.g. 'school.akoro.app'); any other
--      hostname is treated as a tenant public site.
--
-- Run once in Supabase SQL Editor. Idempotent.
-- =============================================================

ALTER TABLE edu.school_domains ADD COLUMN IF NOT EXISTS vercel_added boolean NOT NULL DEFAULT false;
ALTER TABLE edu.school_domains ADD COLUMN IF NOT EXISTS dns_records  jsonb   NOT NULL DEFAULT '[]'::jsonb;

-- Routing now points at Vercel rather than a bespoke CNAME target.
ALTER TABLE edu.school_domains ALTER COLUMN cname_target SET DEFAULT 'cname.vercel-dns.com';

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
