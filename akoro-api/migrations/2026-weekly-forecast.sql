-- =============================================================
-- 2026-weekly-forecast.sql
-- Weekly Forecast & Daily Schedule: what will be taught in each
-- day/period. The subject for each cell comes LIVE from the class
-- timetable; these tables only store the planned activity + a week
-- header (date range + theme). Idempotent.
-- =============================================================

-- One header per class (optionally section) per week.
CREATE TABLE IF NOT EXISTS mgmt.forecast_weeks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  class_id    uuid NOT NULL REFERENCES mgmt.classes(id) ON DELETE CASCADE,
  section_id  uuid REFERENCES mgmt.sections(id) ON DELETE CASCADE,
  week_start  date NOT NULL,                 -- Monday of the week
  week_end    date,
  theme       text,
  notes       text,
  prepared_by text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, section_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_forecast_weeks_school ON mgmt.forecast_weeks (school_id, class_id, week_start);

-- One planned activity per (week, day, period). Subject is NOT stored — it is
-- resolved from mgmt.timetable_slots at render time so the forecast always
-- follows the current timetable (incl. breaks/lunch).
CREATE TABLE IF NOT EXISTS mgmt.forecast_cells (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  week_id     uuid NOT NULL REFERENCES mgmt.forecast_weeks(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  period_id   uuid NOT NULL REFERENCES mgmt.periods(id) ON DELETE CASCADE,
  activity    text,
  notes       text,
  UNIQUE (week_id, day_of_week, period_id)
);
CREATE INDEX IF NOT EXISTS idx_forecast_cells_week ON mgmt.forecast_cells (week_id);

NOTIFY pgrst, 'reload schema';
