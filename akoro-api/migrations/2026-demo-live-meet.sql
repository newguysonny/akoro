-- =============================================================
-- 2026-demo-live-meet.sql
-- Point the demo LIVE courses at a real teacher who has Google Meet connected
-- (okposomatt@gmail.com) and switch them to the 'meet' platform. The live-
-- session scheduler then uses that teacher's saved Google token to create a
-- real Meet link ~15 min before each session (createLiveLink → createMeeting).
--
-- Runs after 2026-seed-demo-live-classes.sql. Idempotent: re-runs re-assert
-- the same owner/platform and only clear NON-Meet (e.g. stale zoom) links, so
-- already-provisioned Meet links are preserved.
-- =============================================================

DO $$
DECLARE host uuid;
BEGIN
  SELECT id INTO host FROM public.users WHERE lower(email) = 'okposomatt@gmail.com' LIMIT 1;
  IF host IS NULL THEN
    RAISE NOTICE 'okposomatt@gmail.com not found — demo live courses keep their default host';
    RETURN;
  END IF;

  -- Own the demo LIVE courses; mark them Google Meet.
  UPDATE public.courses
  SET instructor_id = host, platform = 'meet', updated_at = now()
  WHERE course_type = 'live'
    AND (slug LIKE 'demo-%live%' OR slug = 'demo-live-rapid');

  -- Repoint FUTURE (scheduled) demo sessions to this host + Meet. Clear any
  -- non-Meet link so the scheduler re-provisions a real Meet link; keep links
  -- that are already Google Meet so re-runs don't churn them.
  UPDATE public.live_sessions ls
  SET instructor_id    = host,
      platform         = 'meet',
      meeting_url      = CASE WHEN ls.meeting_url ILIKE '%meet.google.com%' THEN ls.meeting_url ELSE NULL END,
      join_url         = CASE WHEN ls.join_url    ILIKE '%meet.google.com%' THEN ls.join_url    ELSE NULL END,
      meeting_id       = CASE WHEN ls.join_url    ILIKE '%meet.google.com%' THEN ls.meeting_id  ELSE NULL END,
      meeting_password = CASE WHEN ls.join_url    ILIKE '%meet.google.com%' THEN ls.meeting_password ELSE NULL END,
      updated_at       = now()
  FROM public.courses c
  WHERE ls.course_id = c.id
    AND c.course_type = 'live'
    AND (c.slug LIKE 'demo-%live%' OR c.slug = 'demo-live-rapid')
    AND ls.status = 'scheduled';
END $$;

-- Verify:
-- SELECT c.slug, u.email AS host, c.platform, count(ls.*) sessions
--   FROM public.courses c JOIN public.users u ON u.id = c.instructor_id
--   LEFT JOIN public.live_sessions ls ON ls.course_id = c.id AND ls.status='scheduled'
--   WHERE c.course_type='live' AND (c.slug LIKE 'demo-%live%' OR c.slug='demo-live-rapid')
--   GROUP BY c.slug, u.email, c.platform;
