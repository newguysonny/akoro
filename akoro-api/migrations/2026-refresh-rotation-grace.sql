-- =============================================================
-- 2026-refresh-rotation-grace.sql
-- Stop a concurrent refresh from being mistaken for a stolen token.
--
-- Refresh tokens rotate, and reuse of a spent token revokes the whole FAMILY —
-- every session for that user, on every device. That is the correct response to
-- a stolen token. It is the wrong response to the app refreshing twice at once,
-- which it does routinely:
--
--   · AuthContext's 13-minute proactive refresh and api.js's 401-retry refresh
--     dedupe SEPARATELY, so they can both be in flight with the same cookie
--   · two open tabs each run their own 13-minute timer
--   · a retried request after a dropped connection resends the same token
--
-- Any of those produced "Refresh token reuse detected — all sessions revoked"
-- and bounced the user to sign-in, which is what the instructor and learner
-- apps were doing.
--
-- The fix needs to tell "used a moment ago, by us" from "used last Tuesday, by
-- someone else". used_at gives the first half; replaced_by records which token
-- superseded it, so a reuse inside the grace window can be answered from the
-- same family instead of destroying it.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Existing spent tokens get used_at NULL,
-- which is treated as "long ago" — outside any grace window, so the strict
-- replay behaviour still applies to them.
-- =============================================================

ALTER TABLE public.refresh_tokens
  ADD COLUMN IF NOT EXISTS used_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replaced_by UUID;

COMMENT ON COLUMN public.refresh_tokens.used_at IS
  'When this token was spent. NULL on an unused token, and on tokens spent before this column existed.';
COMMENT ON COLUMN public.refresh_tokens.replaced_by IS
  'jti of the token issued in its place. Lets a concurrent refresh be answered rather than treated as replay.';

-- Finding "was this spent just now?" is the hot path on every refresh.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_used_at
  ON public.refresh_tokens (used_at)
  WHERE used = true;

-- Verify:
--   SELECT used, count(*),
--          count(*) FILTER (WHERE used_at IS NOT NULL) AS with_timestamp
--   FROM public.refresh_tokens GROUP BY used;
