-- =============================================================
-- 2026-classrooms-created-by.sql
--
-- classrooms historically identify their owner with teacher_id (the bench,
-- the seeds, join requests). Several newer code paths (agent tooling,
-- drafts) filtered by created_by — a column that never existed — so those
-- queries failed and the agent honestly reported "you have no classes".
--
-- Add created_by, backfill it from teacher_id, and keep both in sync for
-- rows inserted by either convention. Idempotent.
-- =============================================================

ALTER TABLE public.classrooms
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- Existing and future rows: teacher_id is the source of truth unless an
-- explicit creator was recorded.
UPDATE public.classrooms SET created_by = teacher_id WHERE created_by IS NULL;

-- Rows created by tools that only set created_by still get an owner the
-- teacher-facing filters can see.
CREATE OR REPLACE FUNCTION public.classrooms_sync_created_by()
RETURNS trigger AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := NEW.teacher_id;
  ELSIF NEW.teacher_id IS NULL THEN
    NEW.teacher_id := NEW.created_by;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_classrooms_sync_created_by ON public.classrooms;
CREATE TRIGGER trg_classrooms_sync_created_by
  BEFORE INSERT OR UPDATE OF teacher_id, created_by ON public.classrooms
  FOR EACH ROW EXECUTE FUNCTION public.classrooms_sync_created_by();

CREATE INDEX IF NOT EXISTS idx_classrooms_created_by ON public.classrooms(created_by);

-- Verify:
-- SELECT name, teacher_id, created_by FROM public.classrooms ORDER BY created_at DESC LIMIT 10;
