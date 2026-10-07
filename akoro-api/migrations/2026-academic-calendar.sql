-- =============================================================
-- 2026-academic-calendar.sql
-- Academic Calendar: dated events per term (resumption, mid-term break,
-- exams, holidays, PTMs, etc.), optionally tied to an academic session.
-- School-scoped and idempotent — safe to re-run every deploy.
-- =============================================================
CREATE TABLE IF NOT EXISTS mgmt.academic_calendar (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  session_id  uuid REFERENCES mgmt.academic_sessions(id) ON DELETE SET NULL,
  term        text,                                  -- First / Second / Third / Whole Session
  title       text NOT NULL,                         -- e.g. "First Term Begins"
  event_type  text NOT NULL DEFAULT 'event'
                CHECK (event_type IN ('resumption','vacation','holiday','exam','midterm','ptm','event')),
  starts_on   date NOT NULL,
  ends_on     date,                                  -- null = single-day event
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academic_calendar_school ON mgmt.academic_calendar (school_id, starts_on);
CREATE INDEX IF NOT EXISTS idx_academic_calendar_term   ON mgmt.academic_calendar (school_id, term);

NOTIFY pgrst, 'reload schema';
