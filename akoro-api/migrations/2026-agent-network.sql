-- 2026-agent-network.sql — learners' agents finding, messaging and
-- challenging each other (modules/agent-network).
--
--   learner_presence          who has the app open now (heartbeat, ~1/min)
--   agent_network_settings    who can find my agent / message it, open to challenges
--   agent_blocks, agent_reports
--   past_question_attempts    past-question practice per learner (a search filter)
--   challenge_requests        "looking for a JAMB Chemistry 1v1 tonight" — others accept
--   agent_messages            agent-to-agent consults, suggestions and replies
--   study_buddies             paired agents with weekly goal check-ins
--   revision_circles (+members)   3–5 agents revising one topic, ending in a battle
--   battle_participants.team  2v2 team battles (battle_type 'team')
-- Idempotent.

-- ── Presence ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.learner_presence (
  user_id       UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  surface       TEXT
);
CREATE INDEX IF NOT EXISTS idx_learner_presence_seen ON edu.learner_presence (last_seen_at DESC);

-- ── Privacy and preferences ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.agent_network_settings (
  user_id              UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  visibility           TEXT NOT NULL DEFAULT 'everyone'
                       CHECK (visibility IN ('everyone', 'school', 'classmates', 'hidden')),
  accept_messages      TEXT NOT NULL DEFAULT 'everyone'
                       CHECK (accept_messages IN ('everyone', 'school', 'classmates', 'nobody')),
  open_to_challenges   BOOLEAN NOT NULL DEFAULT true,
  battle_times         TEXT[] NOT NULL DEFAULT '{}',   -- morning | afternoon | evening | night | weekend
  battle_types         TEXT[] NOT NULL DEFAULT '{}',   -- 1v1 | open | team | review
  show_on_leaderboards BOOLEAN NOT NULL DEFAULT true,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edu.agent_blocks (
  blocker_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_blocks_blocked ON edu.agent_blocks (blocked_id);

CREATE TABLE IF NOT EXISTS edu.agent_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reported_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason       TEXT NOT NULL,
  context      JSONB,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'actioned', 'dismissed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Past questions practised ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.past_question_attempts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  exam        TEXT NOT NULL,
  subject     TEXT,
  year        INTEGER,
  source      TEXT NOT NULL DEFAULT 'practice' CHECK (source IN ('practice', 'battle', 'agent', 'daily')),
  attempted   INTEGER NOT NULL DEFAULT 0,
  correct     INTEGER NOT NULL DEFAULT 0,
  battle_id   UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pq_attempts_user ON edu.past_question_attempts (user_id);
CREATE INDEX IF NOT EXISTS idx_pq_attempts_exam ON edu.past_question_attempts (exam, subject);
-- A battle question drawn from a past paper remembers which one.
ALTER TABLE public.battle_questions ADD COLUMN IF NOT EXISTS past_exam TEXT;
ALTER TABLE public.battle_questions ADD COLUMN IF NOT EXISTS past_year INTEGER;

-- ── Challenge requests ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.challenge_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  battle_type     TEXT NOT NULL DEFAULT '1v1' CHECK (battle_type IN ('1v1', 'open', 'team')),
  title           TEXT NOT NULL,
  subject         TEXT NOT NULL,
  topic           TEXT,
  exam            TEXT,
  difficulty      TEXT NOT NULL DEFAULT 'intermediate',
  total_questions INTEGER NOT NULL DEFAULT 10,
  max_players     INTEGER NOT NULL DEFAULT 2,
  scope           TEXT NOT NULL DEFAULT 'everyone'
                  CHECK (scope IN ('everyone', 'school', 'classmates', 'course', 'community')),
  scope_id        UUID,
  min_xp          INTEGER,
  max_xp          INTEGER,
  scheduled_for   TIMESTAMPTZ,
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'cancelled', 'expired')),
  accepted_by     UUID[] NOT NULL DEFAULT '{}',
  battle_id       UUID,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_challenge_requests_open ON edu.challenge_requests (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_challenge_requests_creator ON edu.challenge_requests (created_by);

-- ── Agent messages ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.agent_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  to_user       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('consult', 'suggestion', 'reply', 'buddy_checkin', 'invite')),
  subject       TEXT,
  topic         TEXT,
  body          TEXT NOT NULL,
  answer        TEXT,
  answer_source TEXT,                   -- taught | not_taught | learner
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'answered', 'delivered', 'read', 'declined')),
  parent_id     UUID REFERENCES edu.agent_messages(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at   TIMESTAMPTZ,
  read_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_to ON edu.agent_messages (to_user, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_messages_from ON edu.agent_messages (from_user, created_at DESC);

-- ── Study buddies ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.study_buddies (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  buddy_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  goal             TEXT,
  subject          TEXT,
  exam             TEXT,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'ended', 'declined')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at      TIMESTAMPTZ,
  last_checkin_at  TIMESTAMPTZ,
  next_checkin_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_study_buddies_pair
  ON edu.study_buddies (LEAST(requester_id, buddy_id), GREATEST(requester_id, buddy_id))
  WHERE status IN ('pending', 'active');

-- ── Revision circles ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.revision_circles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  exam           TEXT,
  subject        TEXT NOT NULL,
  topic          TEXT,
  max_members    INTEGER NOT NULL DEFAULT 5 CHECK (max_members BETWEEN 3 AND 8),
  scheduled_for  TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'full', 'running', 'done', 'cancelled')),
  battle_id      UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS edu.revision_circle_members (
  circle_id  UUID NOT NULL REFERENCES edu.revision_circles(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (circle_id, user_id)
);

-- ── Team battles (2v2) ─────────────────────────────────────────────────────
ALTER TABLE public.battle_participants ADD COLUMN IF NOT EXISTS team TEXT;
DO $$
DECLARE
  v_existing text[];
  v_all      text[];
  v_def      text;
BEGIN
  SELECT array_agg(DISTINCT m[1]) INTO v_existing
    FROM pg_constraint c,
         LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g') AS m
   WHERE c.conrelid = 'public.battles'::regclass AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%battle_type%';
  SELECT array_agg(DISTINCT v ORDER BY v) INTO v_all
    FROM unnest(COALESCE(v_existing, '{}') || ARRAY['1v1', 'open', 'classroom', 'review', 'team']) AS v;
  SELECT string_agg(quote_literal(v), ', ') INTO v_def FROM unnest(v_all) AS v;
  ALTER TABLE public.battles DROP CONSTRAINT IF EXISTS battles_battle_type_check;
  EXECUTE format('ALTER TABLE public.battles ADD CONSTRAINT battles_battle_type_check CHECK (battle_type IN (%s))', v_def);
END $$;
