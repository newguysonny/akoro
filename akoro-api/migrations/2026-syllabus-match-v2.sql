-- =============================================================
-- 2026-syllabus-match-v2.sql  —  SUPERSEDED / NO-OP
-- The match_syllabus() upgrade (adds exam + subject name) now lives directly in
-- 2026-syllabus.sql (with a DROP-then-create so it's re-runnable every deploy).
-- Keeping two migrations define the same function with different return types
-- made them fight on each redeploy ("cannot change return type"). This file is
-- intentionally a no-op now; left in place to preserve migration ordering.
-- =============================================================
NOTIFY pgrst, 'reload schema';
