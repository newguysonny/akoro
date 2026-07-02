-- =============================================================
-- 2026-public-portal.sql
-- Public-facing school portal: online admission applications, online fee
-- payments (school's own Paystack keys), and the public results checker.
-- Run AFTER 2026-mgmt-schema-3.sql. Idempotent.
--
-- Public URLs (served on each school's tenant domain):
--   /apply    — online admission form (custom fields from Admission Settings)
--   /pay      — school-fees payment (admission number → dues → Paystack)
--   /results  — results checker (admission number + result PIN)
-- =============================================================

-- Applications submitted from the public /apply form.
CREATE TABLE IF NOT EXISTS mgmt.admission_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  application_no text NOT NULL,
  first_name text NOT NULL,
  last_name text,
  email text,
  phone text,
  dob date,
  gender text,
  guardian_name text,
  guardian_phone text,
  address text,
  class_applied text,
  custom_answers jsonb NOT NULL DEFAULT '{}'::jsonb,   -- label → answer, from edu.school_admission_fields
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','admitted','rejected')),
  fee_amount numeric NOT NULL DEFAULT 0,
  fee_status text NOT NULL DEFAULT 'unpaid' CHECK (fee_status IN ('unpaid','paid','waived')),
  fee_reference text,
  student_id uuid REFERENCES mgmt.students(id) ON DELETE SET NULL, -- set on Admit
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (school_id, application_no)
);
CREATE INDEX IF NOT EXISTS idx_admission_applications_school ON mgmt.admission_applications (school_id, status);

-- Result PINs — admin generates per exam (per student); parents check with
-- admission number + PIN on /results.
CREATE TABLE IF NOT EXISTS mgmt.result_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES mgmt.exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES mgmt.students(id) ON DELETE CASCADE,
  pin text NOT NULL,
  max_uses int NOT NULL DEFAULT 10,
  used_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, pin)
);
CREATE INDEX IF NOT EXISTS idx_result_pins_lookup ON mgmt.result_pins (school_id, student_id, exam_id);

-- Online payment intents (Paystack init → verify). One row per checkout;
-- verified fee payments are ALSO recorded in mgmt.fee_payments (method
-- 'online') so they appear in normal fee reports automatically.
CREATE TABLE IF NOT EXISTS mgmt.online_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  purpose text NOT NULL DEFAULT 'fees' CHECK (purpose IN ('fees','admission')),
  student_id uuid REFERENCES mgmt.students(id) ON DELETE SET NULL,
  application_id uuid REFERENCES mgmt.admission_applications(id) ON DELETE SET NULL,
  amount numeric NOT NULL,
  email text NOT NULL,
  reference text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  gateway text NOT NULL DEFAULT 'paystack',
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_online_payments_school ON mgmt.online_payments (school_id, status);

GRANT ALL ON ALL TABLES    IN SCHEMA mgmt TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA mgmt TO service_role;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
