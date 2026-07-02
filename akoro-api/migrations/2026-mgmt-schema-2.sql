-- =============================================================
-- 2026-mgmt-schema-2.sql
-- Second mgmt batch: Accounts, Human Resource, QR Attendance, Offline &
-- Online Examinations, CBC Academics, PTM Meetings, Lesson Planner, OSM.
-- Run AFTER 2026-mgmt-schema.sql. Idempotent — safe to re-run.
-- =============================================================

-- ═════════════════════════ ACCOUNTS ════════════════════════════
CREATE TABLE IF NOT EXISTS mgmt.income_heads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.expense_heads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.incomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  head_id uuid REFERENCES mgmt.income_heads(id) ON DELETE SET NULL,
  amount numeric NOT NULL DEFAULT 0, source text, reference text, note text,
  received_on date NOT NULL DEFAULT CURRENT_DATE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mgmt.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  head_id uuid REFERENCES mgmt.expense_heads(id) ON DELETE SET NULL,
  amount numeric NOT NULL DEFAULT 0, paid_to text, reference text, note text,
  spent_on date NOT NULL DEFAULT CURRENT_DATE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mgmt.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, bank_name text, account_no text, balance numeric NOT NULL DEFAULT 0,
  UNIQUE (school_id, name)
);

-- ═════════════════════ HUMAN RESOURCE ══════════════════════════
CREATE TABLE IF NOT EXISTS mgmt.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.designations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  staff_no text NOT NULL, first_name text NOT NULL, last_name text NOT NULL,
  gender text CHECK (gender IN ('male','female','other')),
  phone text, email text, photo_url text,
  department_id uuid REFERENCES mgmt.departments(id) ON DELETE SET NULL,
  designation_id uuid REFERENCES mgmt.designations(id) ON DELETE SET NULL,
  employment_type text NOT NULL DEFAULT 'full_time' CHECK (employment_type IN ('full_time','part_time','contract')),
  monthly_salary numeric NOT NULL DEFAULT 0,
  joined_on date, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, staff_no)
);
CREATE TABLE IF NOT EXISTS mgmt.staff_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES mgmt.staff(id) ON DELETE CASCADE,
  date date NOT NULL, status text NOT NULL DEFAULT 'present' CHECK (status IN ('present','absent','late','leave')),
  note text, UNIQUE (staff_id, date)
);
CREATE TABLE IF NOT EXISTS mgmt.leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, days_allowed integer NOT NULL DEFAULT 0, UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES mgmt.staff(id) ON DELETE CASCADE,
  leave_type_id uuid REFERENCES mgmt.leave_types(id) ON DELETE SET NULL,
  from_date date NOT NULL, to_date date NOT NULL, reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by text, decided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mgmt.payroll_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES mgmt.staff(id) ON DELETE CASCADE,
  month text NOT NULL,                              -- 'YYYY-MM'
  gross numeric NOT NULL DEFAULT 0, deductions numeric NOT NULL DEFAULT 0, net numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  paid_on date, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, month)
);
CREATE TABLE IF NOT EXISTS mgmt.staff_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES mgmt.staff(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0, monthly_deduction numeric NOT NULL DEFAULT 0,
  balance numeric NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  issued_on date NOT NULL DEFAULT CURRENT_DATE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mgmt.salary_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, basic numeric NOT NULL DEFAULT 0, housing numeric NOT NULL DEFAULT 0,
  transport numeric NOT NULL DEFAULT 0, other numeric NOT NULL DEFAULT 0,
  UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.appraisal_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, starts_on date, ends_on date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.appraisal_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  title text NOT NULL, weight integer NOT NULL DEFAULT 10
);
CREATE TABLE IF NOT EXISTS mgmt.appraisals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES mgmt.staff(id) ON DELETE CASCADE,
  cycle_id uuid REFERENCES mgmt.appraisal_cycles(id) ON DELETE SET NULL,
  score numeric, strengths text, improvements text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Generic per-module settings (HR Settings, QR Settings, Lesson Planner Settings…)
CREATE TABLE IF NOT EXISTS mgmt.module_settings (
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  module text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, module)
);

-- ═════════════════════ QR ATTENDANCE ═══════════════════════════
CREATE TABLE IF NOT EXISTS mgmt.qr_attendance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  person_type text NOT NULL DEFAULT 'staff' CHECK (person_type IN ('staff','student')),
  staff_id uuid REFERENCES mgmt.staff(id) ON DELETE SET NULL,
  student_id uuid REFERENCES mgmt.students(id) ON DELETE SET NULL,
  person_name text,
  direction text NOT NULL DEFAULT 'in' CHECK (direction IN ('in','out')),
  method text NOT NULL DEFAULT 'qr' CHECK (method IN ('qr','manual')),
  happened_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mgmt_qr_events_school ON mgmt.qr_attendance_events (school_id, happened_at DESC);

-- ═══════════════════ OFFLINE EXAMINATIONS ══════════════════════
CREATE TABLE IF NOT EXISTS mgmt.exam_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  exam_type_id uuid REFERENCES mgmt.exam_types(id) ON DELETE SET NULL,
  session_id uuid REFERENCES mgmt.academic_sessions(id) ON DELETE SET NULL,
  starts_on date, ends_on date,
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','ongoing','completed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mgmt.exam_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES mgmt.exams(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES mgmt.classes(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES mgmt.subjects(id) ON DELETE CASCADE,
  exam_date date, max_marks integer NOT NULL DEFAULT 100, pass_marks integer NOT NULL DEFAULT 40,
  UNIQUE (exam_id, class_id, subject_id)
);
CREATE TABLE IF NOT EXISTS mgmt.exam_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  schedule_id uuid NOT NULL REFERENCES mgmt.exam_schedules(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES mgmt.students(id) ON DELETE CASCADE,
  marks numeric NOT NULL DEFAULT 0,
  UNIQUE (schedule_id, student_id)
);
CREATE TABLE IF NOT EXISTS mgmt.cocurricular_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.cocurricular_grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  grade text NOT NULL, min_score integer NOT NULL DEFAULT 0, max_score integer NOT NULL DEFAULT 100, remark text
);
CREATE TABLE IF NOT EXISTS mgmt.grade_scales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  grade text NOT NULL, min_percent integer NOT NULL DEFAULT 0, max_percent integer NOT NULL DEFAULT 100, remark text
);
CREATE TABLE IF NOT EXISTS mgmt.report_card_setups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, description text, options jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.marksheet_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  exam_id uuid REFERENCES mgmt.exams(id) ON DELETE SET NULL,
  class_id uuid REFERENCES mgmt.classes(id) ON DELETE SET NULL,
  file_url text, note text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mgmt.teacher_remarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES mgmt.students(id) ON DELETE CASCADE,
  exam_id uuid REFERENCES mgmt.exams(id) ON DELETE SET NULL,
  remark text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

-- ═════════════════════ CBC ACADEMICS ═══════════════════════════
CREATE TABLE IF NOT EXISTS mgmt.cbc_strands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES mgmt.subjects(id) ON DELETE SET NULL,
  strand text NOT NULL, sub_strand text, outcome text
);
CREATE TABLE IF NOT EXISTS mgmt.core_competencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, description text, UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.cbc_pathways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, track text, description text, UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS mgmt.cbc_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES mgmt.students(id) ON DELETE CASCADE,
  strand_id uuid REFERENCES mgmt.cbc_strands(id) ON DELETE SET NULL,
  level text NOT NULL DEFAULT 'meeting' CHECK (level IN ('exceeding','meeting','approaching','below')),
  note text, assessed_on date NOT NULL DEFAULT CURRENT_DATE
);

-- ═══════════════════ ONLINE EXAMINATIONS ═══════════════════════
CREATE TABLE IF NOT EXISTS mgmt.online_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  class_id uuid REFERENCES mgmt.classes(id) ON DELETE SET NULL,
  subject_id uuid REFERENCES mgmt.subjects(id) ON DELETE SET NULL,
  exam_date date, duration_minutes integer NOT NULL DEFAULT 60,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed'))
);
CREATE TABLE IF NOT EXISTS mgmt.question_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES mgmt.subjects(id) ON DELETE SET NULL,
  question text NOT NULL,
  option_a text, option_b text, option_c text, option_d text,
  correct_option text CHECK (correct_option IN ('a','b','c','d')),
  marks integer NOT NULL DEFAULT 1
);

-- ═════════════════════ PTM MEETINGS ════════════════════════════
CREATE TABLE IF NOT EXISTS mgmt.ptm_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  title text NOT NULL, meeting_date date, venue text, agenda text,
  class_id uuid REFERENCES mgmt.classes(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled'))
);
CREATE TABLE IF NOT EXISTS mgmt.ptm_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES mgmt.ptm_meetings(id) ON DELETE CASCADE,
  student_id uuid REFERENCES mgmt.students(id) ON DELETE SET NULL,
  guardian_name text, attended boolean NOT NULL DEFAULT true, remarks text
);
CREATE TABLE IF NOT EXISTS mgmt.ptm_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  meeting_id uuid REFERENCES mgmt.ptm_meetings(id) ON DELETE SET NULL,
  student_id uuid REFERENCES mgmt.students(id) ON DELETE SET NULL,
  note text NOT NULL, due_on date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done'))
);

-- ═════════════════════ LESSON PLANNER ══════════════════════════
CREATE TABLE IF NOT EXISTS mgmt.lesson_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  teacher_id uuid,                                  -- public.users id
  class_id uuid REFERENCES mgmt.classes(id) ON DELETE SET NULL,
  subject_id uuid REFERENCES mgmt.subjects(id) ON DELETE SET NULL,
  week_label text, topic text NOT NULL,
  objectives text, activities text, resources text, feedback text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ═══════════════════════════ OSM ═══════════════════════════════
CREATE TABLE IF NOT EXISTS mgmt.osm_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  teacher_id uuid,                                  -- public.users id
  observer_name text, session_date date, focus_area text,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed'))
);
CREATE TABLE IF NOT EXISTS mgmt.osm_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES mgmt.osm_sessions(id) ON DELETE CASCADE,
  score numeric, strengths text, improvements text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','moderated')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON ALL TABLES    IN SCHEMA mgmt TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA mgmt TO service_role;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
