-- =============================================================
-- 2026-seed-ranking-xp.sql
-- Gives the demo cohort some XP so the Rankings tab (Classroom / Courses /
-- Inter-Schools) shows real data immediately, then rebuilds xp_leaderboard.
--
-- Idempotent: XP awards guarded by a 'seed_%' reason marker; the leaderboard
-- rebuild is a delete+insert of the app-managed scopes (exactly what the
-- 15-min cron does), so re-runs converge.
-- =============================================================

-- ── 1. Award course XP to every active enrolment in a demo course ──────────
INSERT INTO public.xp_transactions (user_id, course_id, reason, amount)
SELECT e.user_id, e.course_id, 'seed_demo_course',
       (200 + (abs(hashtext(e.user_id::text || e.course_id::text)) % 1200))
FROM public.enrollments e
JOIN public.courses c ON c.id = e.course_id
WHERE c.slug LIKE 'demo-%' AND e.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM public.xp_transactions x
    WHERE x.user_id = e.user_id AND x.course_id = e.course_id AND x.reason = 'seed_demo_course'
  );

-- ── 2. Give classroom members some XP (so classroom + school boards fill) ──
INSERT INTO public.xp_transactions (user_id, reason, amount)
SELECT cs.user_id, 'seed_demo_classroom',
       (150 + (abs(hashtext(cs.user_id::text)) % 900))
FROM public.classroom_students cs
WHERE cs.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM public.xp_transactions x
    WHERE x.user_id = cs.user_id AND x.reason = 'seed_demo_classroom'
  );

-- ── 3. Rebuild the app-managed leaderboard scopes (with ranks) ─────────────
DELETE FROM public.xp_leaderboard WHERE scope IN ('global', 'course', 'classroom');

-- global: total XP per user
INSERT INTO public.xp_leaderboard (user_id, scope, total_xp, rank, updated_at)
SELECT user_id, 'global', SUM(amount),
       rank() OVER (ORDER BY SUM(amount) DESC), now()
FROM public.xp_transactions
GROUP BY user_id;

-- course: XP per (user, course)
INSERT INTO public.xp_leaderboard (user_id, scope, course_id, scope_ref_id, total_xp, rank, updated_at)
SELECT user_id, 'course', course_id, course_id, SUM(amount),
       rank() OVER (PARTITION BY course_id ORDER BY SUM(amount) DESC), now()
FROM public.xp_transactions
WHERE course_id IS NOT NULL
GROUP BY user_id, course_id;

-- classroom: each active member credited with their total XP
INSERT INTO public.xp_leaderboard (user_id, scope, classroom_id, scope_ref_id, total_xp, rank, updated_at)
SELECT cs.user_id, 'classroom', cs.classroom_id, cs.classroom_id, g.total_xp,
       rank() OVER (PARTITION BY cs.classroom_id ORDER BY g.total_xp DESC), now()
FROM public.classroom_students cs
JOIN (SELECT user_id, SUM(amount) AS total_xp FROM public.xp_transactions GROUP BY user_id) g
  ON g.user_id = cs.user_id
WHERE cs.status = 'active';

-- Verify:
-- SELECT scope, count(*) FROM public.xp_leaderboard GROUP BY scope;
