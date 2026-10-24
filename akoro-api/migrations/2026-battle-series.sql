-- 2026-battle-series.sql — recurring battles (reference/Akoro Battles — Model.md).
--
-- A series repeats a class or course battle on days of the week at a time, in
-- the creator's time zone, until an end date and time. Each occurrence is its
-- own battle (battles.series_id), made an hour before it starts from
-- `template` (battle/series.js). Members are in every occurrence unless they
-- opt out (opted_out_at) or skip one (skips: the starts they sit out).
-- Idempotent (schema group).

CREATE TABLE IF NOT EXISTS public.battle_series (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  scope          TEXT NOT NULL CHECK (scope IN ('class', 'course')),
  classroom_id   UUID,
  course_id      UUID,
  template       JSONB NOT NULL DEFAULT '{}'::jsonb,
  days           SMALLINT[] NOT NULL,
  at_time        TEXT NOT NULL,
  tz             TEXT NOT NULL DEFAULT 'Africa/Lagos',
  until          TIMESTAMPTZ NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  ended_at       TIMESTAMPTZ,
  next_at        TIMESTAMPTZ,
  last_battle_id UUID,
  last_note      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_battle_series_creator ON public.battle_series(created_by, status);

CREATE TABLE IF NOT EXISTS public.battle_series_members (
  series_id    UUID NOT NULL REFERENCES public.battle_series(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  opted_out_at TIMESTAMPTZ,
  skips        TIMESTAMPTZ[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (series_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_battle_series_members_user ON public.battle_series_members(user_id);

ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES public.battle_series(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_battles_series ON public.battles(series_id, scheduled_start) WHERE series_id IS NOT NULL;
