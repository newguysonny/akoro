-- =============================================================
-- 2026-student-profile-extended.sql
-- Extended Student Profile: full personal/academic details, parent details,
-- health, bank, address, previous school, portal credentials, and a simple
-- transport assignment. Additive + idempotent.
-- =============================================================

-- Academic / identity
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS biometric_id text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS place_of_birth text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS nationality text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS religion text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS caste text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS sub_caste text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS mother_tongue text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS quota text;

-- Contact & identity
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS student_email text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS student_phone text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS aadhaar_no text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS pen_no text;

-- Father / Mother / Emergency
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS father_name text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS father_phone text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS father_occupation text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS father_qualification text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS father_income text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS father_aadhaar text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS mother_name text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS mother_phone text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS mother_occupation text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS mother_qualification text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS mother_aadhaar text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS emergency_name text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS emergency_phone text;

-- Health
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS height_cm numeric;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS weight_kg numeric;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS medical_history text;

-- Bank
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS bank_account_no text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS bank_ifsc text;

-- Address / previous school / free-form extra fields
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS permanent_address text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS previous_school text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS extra_fields jsonb NOT NULL DEFAULT '[]'::jsonb; -- [{label,value}]

-- Portal credentials (student/parent) — regenerable, hash-only storage.
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS student_username text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS student_password_hash text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS parent_username text;
ALTER TABLE mgmt.students ADD COLUMN IF NOT EXISTS parent_password_hash text;

-- Simple one-active-assignment transport link.
CREATE TABLE IF NOT EXISTS mgmt.student_transport (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES mgmt.students(id) ON DELETE CASCADE,
  route_id uuid REFERENCES mgmt.transport_routes(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES mgmt.vehicles(id) ON DELETE SET NULL,
  pickup_point text,
  fee numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id)
);

GRANT ALL ON ALL TABLES    IN SCHEMA mgmt TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA mgmt TO service_role;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
