-- =============================================================
-- 2026-ownership-links.sql
-- Ownership links with approval workflow:
--   • Teachers request to join a school  → school_teachers.status
--   • Learners request to join a teacher → classroom_students 'pending'
--   • Teacher-added students get a school SIS record (provenance).
-- Idempotent.
-- =============================================================

-- ── school_teachers: pending / approved / rejected ─────────────────────
ALTER TABLE public.school_teachers
  ADD COLUMN IF NOT EXISTS status       text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS requested_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS decided_at   timestamptz,
  ADD COLUMN IF NOT EXISTS decided_by   uuid;
ALTER TABLE public.school_teachers DROP CONSTRAINT IF EXISTS school_teachers_status_check;
ALTER TABLE public.school_teachers ADD CONSTRAINT school_teachers_status_check
  CHECK (status IN ('pending','approved','rejected'));
-- Existing links (created by school admins) are approved.
UPDATE public.school_teachers SET status = 'approved' WHERE status IS NULL;
CREATE INDEX IF NOT EXISTS idx_school_teachers_status ON public.school_teachers (status);

-- ── classroom_students: allow a 'pending' join request ─────────────────
ALTER TABLE public.classroom_students DROP CONSTRAINT IF EXISTS classroom_students_status_check;
ALTER TABLE public.classroom_students ADD CONSTRAINT classroom_students_status_check
  CHECK (status IN ('pending','active','removed','suspended'));
ALTER TABLE public.classroom_students
  ADD COLUMN IF NOT EXISTS requested_at timestamptz DEFAULT now();

-- ── mgmt.students: who added them (teacher provenance) ─────────────────
ALTER TABLE mgmt.students
  ADD COLUMN IF NOT EXISTS created_by uuid;     -- teacher/user who added the student
CREATE INDEX IF NOT EXISTS idx_students_created_by ON mgmt.students (created_by);

NOTIFY pgrst, 'reload schema';
