-- =============================================================
-- 2026-mgmt-schema.sql
-- New `mgmt` schema: all school Management + Facilities & Services data
-- (Student Information, Academics, Finance & Fees, Front Office — with
-- room for the remaining module groups in later files).
--
-- IMPORTANT (hosted Supabase): after running this, also add `mgmt` to
-- Dashboard → Settings → API → Exposed schemas (same as `edu`/`content`),
-- or the API's db.schema("mgmt") calls will fail with PGRST106.
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- =============================================================

CREATE SCHEMA IF NOT EXISTS mgmt;

-- Expose + grants (self-hosted path; hosted Supabase uses the dashboard).
ALTER ROLE authenticator SET pgrst.db_schemas = 'public, content, edu, mgmt, storage, graphql_public';
GRANT USAGE ON SCHEMA mgmt TO authenticator, service_role, anon, authenticated;
GRANT ALL ON ALL TABLES    IN SCHEMA mgmt TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA mgmt TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA mgmt GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA mgmt GRANT ALL ON SEQUENCES TO service_role;

-- ═════════════════════════ ACADEMICS ═══════════════════════════

CREATE TABLE IF NOT EXISTS mgmt.academic_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name       text NOT NULL,                     -- e.g. '2026/2027'
  starts_on  date,
  ends_on    date,
  is_active  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS mgmt.classes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name       text NOT NULL,                     -- e.g. 'JSS1'
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS mgmt.sections (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  class_id   uuid NOT NULL REFERENCES mgmt.classes(id) ON DELETE CASCADE,
  name       text NOT NULL,                     -- e.g. 'A'
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, name)
);

CREATE TABLE IF NOT EXISTS mgmt.subjects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name       text NOT NULL,
  code       text,
  subject_type text NOT NULL DEFAULT 'core' CHECK (subject_type IN ('core','elective')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS mgmt.class_subjects (        -- Assign Subjects / Electives
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  class_id    uuid NOT NULL REFERENCES mgmt.classes(id) ON DELETE CASCADE,
  subject_id  uuid NOT NULL REFERENCES mgmt.subjects(id) ON DELETE CASCADE,
  teacher_id  uuid,                                     -- public.users id
  is_elective boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, subject_id)
);

CREATE TABLE IF NOT EXISTS mgmt.class_teachers (        -- Assign Class Teacher
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  class_id   uuid NOT NULL REFERENCES mgmt.classes(id) ON DELETE CASCADE,
  section_id uuid REFERENCES mgmt.sections(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL,                             -- public.users id
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, section_id)
);

CREATE TABLE IF NOT EXISTS mgmt.periods (               -- Manage Periods
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name       text NOT NULL,                             -- '1st Period'
  starts_at  time,
  ends_at    time,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS mgmt.timetable_slots (       -- Class Timetable
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  class_id    uuid NOT NULL REFERENCES mgmt.classes(id) ON DELETE CASCADE,
  section_id  uuid REFERENCES mgmt.sections(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),  -- 1 = Monday
  period_id   uuid NOT NULL REFERENCES mgmt.periods(id) ON DELETE CASCADE,
  subject_id  uuid REFERENCES mgmt.subjects(id) ON DELETE SET NULL,
  teacher_id  uuid,
  UNIQUE (class_id, section_id, day_of_week, period_id)
);

CREATE TABLE IF NOT EXISTS mgmt.promotion_logs (        -- Promote Students
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  from_class_id  uuid REFERENCES mgmt.classes(id) ON DELETE SET NULL,
  to_class_id    uuid REFERENCES mgmt.classes(id) ON DELETE SET NULL,
  session_id     uuid REFERENCES mgmt.academic_sessions(id) ON DELETE SET NULL,
  student_count  integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ═══════════════════ STUDENT INFORMATION ═══════════════════════

CREATE TABLE IF NOT EXISTS mgmt.student_categories (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name      text NOT NULL,
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS mgmt.student_houses (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name      text NOT NULL,
  color     text,
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS mgmt.students (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  admission_no    text NOT NULL,
  roll_no         text,
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  gender          text CHECK (gender IN ('male','female','other')),
  dob             date,
  class_id        uuid REFERENCES mgmt.classes(id) ON DELETE SET NULL,
  section_id      uuid REFERENCES mgmt.sections(id) ON DELETE SET NULL,
  category_id     uuid REFERENCES mgmt.student_categories(id) ON DELETE SET NULL,
  house_id        uuid REFERENCES mgmt.student_houses(id) ON DELETE SET NULL,
  guardian_name   text,
  guardian_phone  text,
  guardian_email  text,
  address         text,
  photo_url       text,
  blood_group     text,
  is_disabled     boolean NOT NULL DEFAULT false,
  disability_note text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','alumni')),
  user_id         uuid,                        -- optional link to public.users (learner account)
  admitted_on     date NOT NULL DEFAULT CURRENT_DATE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, admission_no)
);
CREATE INDEX IF NOT EXISTS idx_mgmt_students_school ON mgmt.students (school_id, class_id, section_id);

CREATE TABLE IF NOT EXISTS mgmt.student_attendance (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES mgmt.students(id) ON DELETE CASCADE,
  date       date NOT NULL,
  status     text NOT NULL DEFAULT 'present' CHECK (status IN ('present','absent','late','excused')),
  note       text,
  UNIQUE (student_id, date)
);
CREATE INDEX IF NOT EXISTS idx_mgmt_attendance_school_date ON mgmt.student_attendance (school_id, date);

CREATE TABLE IF NOT EXISTS mgmt.behavior_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES mgmt.students(id) ON DELETE CASCADE,
  incident_type text NOT NULL,
  severity      text NOT NULL DEFAULT 'low' CHECK (severity IN ('low','medium','high')),
  description   text,
  action_taken  text,
  recorded_on   date NOT NULL DEFAULT CURRENT_DATE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mgmt.health_records (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES mgmt.students(id) ON DELETE CASCADE,
  record_type text NOT NULL DEFAULT 'condition' CHECK (record_type IN ('allergy','condition','vaccination','checkup')),
  title       text NOT NULL,
  details     text,
  recorded_on date NOT NULL DEFAULT CURRENT_DATE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ═════════════════════ FINANCE & FEES ══════════════════════════

CREATE TABLE IF NOT EXISTS mgmt.fee_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS mgmt.fee_types (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  group_id       uuid REFERENCES mgmt.fee_groups(id) ON DELETE SET NULL,
  name           text NOT NULL,
  code           text,
  default_amount numeric NOT NULL DEFAULT 0,
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS mgmt.fee_discounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name          text NOT NULL,
  discount_type text NOT NULL DEFAULT 'percentage' CHECK (discount_type IN ('percentage','flat')),
  amount        numeric NOT NULL DEFAULT 0,
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS mgmt.fee_assignments (        -- Assign Fees (to a class OR a student)
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  session_id  uuid REFERENCES mgmt.academic_sessions(id) ON DELETE SET NULL,
  fee_type_id uuid NOT NULL REFERENCES mgmt.fee_types(id) ON DELETE CASCADE,
  class_id    uuid REFERENCES mgmt.classes(id) ON DELETE CASCADE,
  student_id  uuid REFERENCES mgmt.students(id) ON DELETE CASCADE,
  amount      numeric NOT NULL DEFAULT 0,
  due_date    date,
  discount_id uuid REFERENCES mgmt.fee_discounts(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mgmt_fee_assignments_school ON mgmt.fee_assignments (school_id, class_id, student_id);

CREATE TABLE IF NOT EXISTS mgmt.fee_payments (           -- All / Online Transactions + Collect Fees
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES mgmt.students(id) ON DELETE CASCADE,
  assignment_id uuid REFERENCES mgmt.fee_assignments(id) ON DELETE SET NULL,
  amount        numeric NOT NULL DEFAULT 0,
  method        text NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','bank','online','pos','cheque')),
  reference     text,
  note          text,
  paid_on       date NOT NULL DEFAULT CURRENT_DATE,
  received_by   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mgmt_fee_payments_school ON mgmt.fee_payments (school_id, paid_on DESC);

CREATE TABLE IF NOT EXISTS mgmt.fee_challans (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES mgmt.students(id) ON DELETE CASCADE,
  challan_no text NOT NULL,
  amount     numeric NOT NULL DEFAULT 0,
  status     text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','cancelled')),
  due_date   date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, challan_no)
);

CREATE TABLE IF NOT EXISTS mgmt.due_slips (              -- Generate Due Slip / Due Slip History
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  student_id   uuid NOT NULL REFERENCES mgmt.students(id) ON DELETE CASCADE,
  slip_no      text NOT NULL,
  period_label text,                                     -- e.g. 'JUL 2026'
  amount_due   numeric NOT NULL DEFAULT 0,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, slip_no)
);

CREATE TABLE IF NOT EXISTS mgmt.fee_carry_forwards (     -- Fees Carry Forward
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES mgmt.students(id) ON DELETE CASCADE,
  from_session_id uuid REFERENCES mgmt.academic_sessions(id) ON DELETE SET NULL,
  to_session_id   uuid REFERENCES mgmt.academic_sessions(id) ON DELETE SET NULL,
  amount          numeric NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ═════════════════════ FRONT OFFICE ════════════════════════════

CREATE TABLE IF NOT EXISTS mgmt.enquiries (              -- Admission Enquiries
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name           text NOT NULL,
  phone          text,
  email          text,
  class_interest text,
  source         text,
  status         text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','admitted','closed')),
  note           text,
  follow_up_on   date,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mgmt.visitors (               -- Visitor Book
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name      text NOT NULL,
  phone     text,
  purpose   text,
  to_meet   text,
  id_proof  text,
  check_in  timestamptz NOT NULL DEFAULT now(),
  check_out timestamptz
);

CREATE TABLE IF NOT EXISTS mgmt.complaints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  complainant text NOT NULL,
  phone       text,
  category    text,
  description text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  action_note text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mgmt.postal_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  direction    text NOT NULL DEFAULT 'receive' CHECK (direction IN ('dispatch','receive')),
  reference_no text,
  from_name    text,
  to_name      text,
  item         text,
  note         text,
  record_date  date NOT NULL DEFAULT CURRENT_DATE
);

-- Re-grant now that the tables exist (default privileges cover future ones).
GRANT ALL ON ALL TABLES    IN SCHEMA mgmt TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA mgmt TO service_role;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
