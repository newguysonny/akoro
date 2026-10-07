-- =============================================================
-- 2026-pilot-schools-cohorts.sql
-- Tiers, Credits & Subscription Admin — plan §4.6 Phase 1 (part 2):
-- the Pilot Schools roster + per-school pilot cohorts.
--
--   public.pilot_schools   plan §4.1 `schools` — the pilot-program
--                          roster (name + admin contact), kept separate
--                          from platform school_profiles because a real
--                          school_profiles row requires an admin user
--                          account; pilot partners are often onboarded
--                          before that exists. school_profile_id links
--                          the two once the school is provisioned.
--   public.pilot_cohorts   plan §4.1 — per-school override of the Pilot
--                          tier defaults: start/end dates, caps, status.
--                          One cohort per pilot school.
--
-- Fed by approving applications (POST /api/admin/pilot-applications/:id/
-- approve) or the "Add pilot school" modal. The pilot-expiry-check cron
-- (modules/admin/pilotSchools.js, plan §4.3) ends active cohorts past
-- their end_date and writes an audit entry.
--
-- Idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.pilot_schools (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL UNIQUE,
  contact_name      text,
  contact_email     text,
  contact_phone     text,
  school_profile_id uuid REFERENCES public.school_profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.pilot_schools IS 'Plan §4.1 schools — pilot-program roster; school_profile_id links to the platform school once provisioned';
COMMENT ON COLUMN public.pilot_schools.school_profile_id IS 'Set when the pilot partner becomes a real school_profiles row; NULL until then';

CREATE TABLE IF NOT EXISTS public.pilot_cohorts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             uuid NOT NULL UNIQUE REFERENCES public.pilot_schools(id) ON DELETE CASCADE,
  start_date            date NOT NULL,
  end_date              date NOT NULL,
  student_cap           integer NOT NULL DEFAULT 200 CHECK (student_cap >= 0),
  instructor_cap        integer NOT NULL DEFAULT 400 CHECK (instructor_cap >= 0),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  archived              boolean NOT NULL DEFAULT false,
  source_application_id uuid REFERENCES public.pilot_applications(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

COMMENT ON TABLE public.pilot_cohorts IS 'Plan §4.1 — per-school pilot window + caps (override of the school Pilot tier defaults); pilot-expiry-check cron ends cohorts past end_date';

CREATE INDEX IF NOT EXISTS pilot_cohorts_status_idx ON public.pilot_cohorts (status, end_date);
CREATE INDEX IF NOT EXISTS pilot_cohorts_source_app_idx ON public.pilot_cohorts (source_application_id);

-- ── Grants (service_role only; the migration runner re-asserts these) ───────
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pilot_schools, public.pilot_cohorts TO service_role;
