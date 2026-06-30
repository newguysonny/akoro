-- =============================================================
-- 2026-enroll-test-students.sql
-- Enrols priya@student.akoro.app and amaka@student.akoro.app into all
-- demo seed courses (so they land in the enrolled / video-player view).
-- Idempotent via the (user_id, course_id) unique constraint.
-- Run after 2026-seed-demo-course.sql.
-- =============================================================

INSERT INTO public.enrollments (user_id, course_id, status)
SELECT u.id, c.id, 'active'
FROM public.users u
CROSS JOIN public.courses c
WHERE u.email IN ('priya@student.akoro.app', 'amaka@student.akoro.app')
  AND c.slug LIKE 'demo-fmaths-%'
ON CONFLICT (user_id, course_id) DO UPDATE SET status = 'active';

-- Verify:
-- SELECT u.email, c.title, e.status
-- FROM public.enrollments e
-- JOIN public.users u   ON u.id = e.user_id
-- JOIN public.courses c ON c.id = e.course_id
-- WHERE u.email IN ('priya@student.akoro.app','amaka@student.akoro.app');
