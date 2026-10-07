-- =============================================================
-- 2026-adaptive-schema.sql
-- Canonical, idempotent DDL for the adaptive-learning edu.* schema
-- (teacher training, student agents, knowledge/decay, marketplace,
-- adaptive sessions). Extracted from the manual migration.sql bootstrap +
-- the module's migration-patch5/6 so a deploy creates these tables through
-- the normal pipeline instead of relying on a hand-applied bundle.
--
-- Every statement is CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, so
-- it is a no-op on existing databases and safe to re-run on every deploy.
-- Must run BEFORE the 2026-* patches that ALTER these tables.
--
-- NOTE: assessment_sessions is intentionally NOT here — it is created by the
-- registered 2026-assessment-gateway.sql.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA    IF NOT EXISTS edu;

-- ── Core adaptive tables + idempotent column additions ───────
CREATE TABLE IF NOT EXISTS edu.training_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_id      UUID NOT NULL,
  run_id        UUID,
  title         TEXT,
  subject       TEXT,
  file_type     TEXT CHECK (file_type IN ('audio','video','live')),
  file_path     TEXT,
  file_size     BIGINT,
  status        TEXT DEFAULT 'processing',
  chunks_stored INT  DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS edu.teacher_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id          UUID UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_id            UUID,
  teacher_name        TEXT,
  agent_name          TEXT DEFAULT 'Pythia',
  subject             TEXT,
  style_profile       JSONB,
  concepts_taught     TEXT[],
  total_hours_trained NUMERIC DEFAULT 0,
  session_count       INT     DEFAULT 0,
  last_trained_at     TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edu.training_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_id    UUID,
  session_id  UUID REFERENCES edu.training_sessions(id) ON DELETE CASCADE,
  chunk_text  TEXT NOT NULL,
  chunk_type  TEXT,
  metadata    JSONB DEFAULT '{}',
  embedding   vector(1536),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_chunks_embedding
  ON edu.training_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE TABLE IF NOT EXISTS edu.stream_tokens (
  token       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID REFERENCES edu.training_sessions(id) ON DELETE CASCADE,
  teacher_id  UUID,
  agent_id    UUID,
  subject     TEXT,
  run_id      UUID,
  expires_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS edu.agent_orchestration_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          UUID UNIQUE NOT NULL,
  teacher_id        UUID REFERENCES public.users(id) ON DELETE CASCADE,

  -- Flow type derived from pedagogical_pattern
  flow_type         TEXT DEFAULT 'phase-based'
                    CHECK (flow_type IN ('phase-based','lecture-drill','challenge-first','custom')),

  -- Phase definitions unique to this teacher
  -- e.g. [{ id: "HOOK", label: "Hook", description: "..." }, ...]
  phase_definitions JSONB DEFAULT '[]',

  -- Guide agent config (teacher's voice + style)
  guide_config      JSONB DEFAULT '{}',

  -- Control agent config (teacher's boundary + redirect style)
  control_config    JSONB DEFAULT '{}',

  -- Student agent tuning for this teacher's class
  student_config    JSONB DEFAULT '{}',

  -- System prompt fragments injected at runtime
  prompt_injections JSONB DEFAULT '{}',

  -- Metadata
  derived_from_run  UUID,
  training_version  INT DEFAULT 1,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orchestration_agent
  ON edu.agent_orchestration_config(agent_id);

CREATE INDEX IF NOT EXISTS idx_orchestration_teacher
  ON edu.agent_orchestration_config(teacher_id);

CREATE TABLE IF NOT EXISTS edu.student_agents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name             TEXT DEFAULT 'My Learning Agent',
  level            INT  DEFAULT 1,
  total_sessions   INT  DEFAULT 0,
  total_turns      INT  DEFAULT 0,
  knowledge_score  NUMERIC DEFAULT 0,  -- grows with every session
  subjects_learned TEXT[] DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id)  -- one agent per student
);

CREATE INDEX IF NOT EXISTS idx_student_agents_student
  ON edu.student_agents(student_id);

CREATE TABLE IF NOT EXISTS edu.student_knowledge (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_id    UUID REFERENCES edu.student_agents(id) ON DELETE CASCADE,
  topic       TEXT NOT NULL,
  subject     TEXT,
  content     TEXT NOT NULL,
  source      TEXT DEFAULT 'manual'
              CHECK (source IN ('manual','session','teacher','upload')),
  confidence  NUMERIC DEFAULT 0.5,
  tags        TEXT[] DEFAULT '{}',
  embedding   vector(1536),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_knowledge_student
  ON edu.student_knowledge(student_id);

CREATE INDEX IF NOT EXISTS idx_student_knowledge_embedding
  ON edu.student_knowledge USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

CREATE TABLE IF NOT EXISTS edu.agent_knowledge (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES edu.student_agents(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  topic         TEXT NOT NULL,
  subject       TEXT,
  content       TEXT NOT NULL,
  chunk_type    TEXT DEFAULT 'taught'
                CHECK (chunk_type IN ('taught','corrected','recalled','reinforced')),
  confidence    NUMERIC DEFAULT 0.5,
  times_seen    INT DEFAULT 1,
  last_seen_at  TIMESTAMPTZ DEFAULT now(),
  session_id    TEXT,  -- which session this came from
  embedding     vector(1536),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_knowledge_agent
  ON edu.agent_knowledge(agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_knowledge_embedding
  ON edu.agent_knowledge USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

CREATE TABLE IF NOT EXISTS edu.session_knowledge_delta (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id               TEXT NOT NULL,
  agent_id                 UUID REFERENCES edu.student_agents(id) ON DELETE CASCADE,
  student_id               UUID REFERENCES public.users(id) ON DELETE CASCADE,
  teacher_agent_id         UUID,  -- NULL if using built-in pair

  -- What was covered
  topic                    TEXT,
  subject                  TEXT,
  concepts_learned         TEXT[] DEFAULT '{}',
  misconceptions_cleared   TEXT[] DEFAULT '{}',

  -- State deltas
  understanding_start      NUMERIC DEFAULT 0,
  understanding_end        NUMERIC DEFAULT 0,
  understanding_delta      NUMERIC DEFAULT 0,

  -- Knowledge additions
  agent_knowledge_added    INT DEFAULT 0,    -- new chunks added to agent KB
  student_knowledge_refs   INT DEFAULT 0,   -- times student KB was referenced
  teacher_chunks_used      INT DEFAULT 0,   -- times teacher material was used

  -- Session stats
  total_turns              INT DEFAULT 0,
  session_duration_sec     INT DEFAULT 0,
  xp_earned                INT DEFAULT 0,

  started_at   TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_session_delta_agent
  ON edu.session_knowledge_delta(agent_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_delta_student
  ON edu.session_knowledge_delta(student_id, started_at DESC);

ALTER TABLE edu.agent_knowledge
  ADD COLUMN IF NOT EXISTS subject          TEXT,
  ADD COLUMN IF NOT EXISTS confidence       NUMERIC DEFAULT 0.50,
  ADD COLUMN IF NOT EXISTS decay_rate       NUMERIC DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS next_review_due  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS priority         TEXT DEFAULT 'low'
    CHECK (priority IN ('critical','high','medium','low'));

ALTER TABLE edu.student_knowledge
  ADD COLUMN IF NOT EXISTS confidence       NUMERIC DEFAULT 0.60,
  ADD COLUMN IF NOT EXISTS decay_rate       NUMERIC DEFAULT 0.08,
  ADD COLUMN IF NOT EXISTS next_review_due  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS priority         TEXT DEFAULT 'low'
    CHECK (priority IN ('critical','high','medium','low'));

CREATE TABLE IF NOT EXISTS edu.decay_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         UUID NOT NULL REFERENCES edu.student_agents(id) ON DELETE CASCADE,
  student_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject          TEXT NOT NULL,
  topic            TEXT NOT NULL,
  event_type       TEXT NOT NULL
    CHECK (event_type IN ('decay_calculated','review_triggered',
                          'review_completed','reinforced','alert_sent')),
  confidence_before NUMERIC,
  confidence_after  NUMERIC,
  days_since_review INT,
  decay_amount      NUMERIC,
  session_id        TEXT,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decay_events_agent
  ON edu.decay_events(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decay_events_student
  ON edu.decay_events(student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS edu.decay_notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES edu.student_agents(id) ON DELETE CASCADE,
  subject      TEXT NOT NULL,
  topic        TEXT NOT NULL,
  confidence   NUMERIC NOT NULL,
  priority     TEXT NOT NULL,
  message      TEXT NOT NULL,
  is_read      BOOLEAN DEFAULT false,
  is_actioned  BOOLEAN DEFAULT false,  -- true when student starts review session
  session_id   TEXT,                   -- populated when review session is started
  created_at   TIMESTAMPTZ DEFAULT now(),
  read_at      TIMESTAMPTZ,
  actioned_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_decay_notifs_student
  ON edu.decay_notifications(student_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decay_notifs_agent
  ON edu.decay_notifications(agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_knowledge_review_due
  ON edu.agent_knowledge(agent_id, next_review_due ASC)
  WHERE next_review_due IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_knowledge_subject_topic
  ON edu.agent_knowledge(agent_id, subject, topic);

CREATE INDEX IF NOT EXISTS idx_agent_knowledge_priority
  ON edu.agent_knowledge(agent_id, priority)
  WHERE priority IN ('critical', 'high');

CREATE TABLE IF NOT EXISTS edu.user_agent_preferences (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  default_pair_id  TEXT NOT NULL DEFAULT 'nana-sargeant',
  -- Array of teacher agent UUIDs the user has purchased/unlocked
  purchased_agents UUID[] DEFAULT '{}',
  -- The agent currently selected for active chat sessions
  active_agent_id  UUID,
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_agent_prefs_user
  ON edu.user_agent_preferences(user_id);

CREATE TABLE IF NOT EXISTS edu.marketplace_listings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         UUID NOT NULL,   -- references edu.agent_orchestration_config.agent_id
  teacher_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  description      TEXT,
  subject          TEXT NOT NULL,
  topics_covered   TEXT[] DEFAULT '{}',
  price_kobo       INT  NOT NULL DEFAULT 0,  -- 0 = free
  currency         TEXT NOT NULL DEFAULT 'NGN',
  is_active        BOOLEAN DEFAULT true,
  is_free          BOOLEAN GENERATED ALWAYS AS (price_kobo = 0) STORED,
  preview_topics   TEXT[] DEFAULT '{}',      -- shown before purchase
  sample_tip       TEXT,                     -- sample NaNa-style tip
  total_students   INT  DEFAULT 0,
  total_sessions   INT  DEFAULT 0,
  avg_rating       NUMERIC(3,2) DEFAULT 0.00,
  rating_count     INT  DEFAULT 0,
  teacher_name     TEXT,
  teacher_avatar   TEXT,
  agent_avatar     TEXT,
  style_summary    TEXT,  -- e.g. "Warm, example-first, conversational"
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_active
  ON edu.marketplace_listings(is_active, subject, price_kobo);

CREATE INDEX IF NOT EXISTS idx_marketplace_teacher
  ON edu.marketplace_listings(teacher_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_agent
  ON edu.marketplace_listings(agent_id);

CREATE TABLE IF NOT EXISTS edu.agent_purchases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_id         UUID NOT NULL,
  listing_id       UUID NOT NULL REFERENCES edu.marketplace_listings(id),
  amount_kobo      INT  NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'NGN',
  paystack_ref     TEXT UNIQUE,        -- Paystack transaction reference
  paystack_status  TEXT DEFAULT 'pending'
                   CHECK (paystack_status IN ('pending','success','failed','refunded')),
  access_granted   BOOLEAN DEFAULT false,
  receipt_url      TEXT,
  metadata         JSONB DEFAULT '{}',
  purchased_at     TIMESTAMPTZ DEFAULT now(),
  verified_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_purchases_student
  ON edu.agent_purchases(student_id, paystack_status);

CREATE INDEX IF NOT EXISTS idx_purchases_ref
  ON edu.agent_purchases(paystack_ref);

CREATE INDEX IF NOT EXISTS idx_purchases_agent
  ON edu.agent_purchases(agent_id, access_granted);

CREATE TABLE IF NOT EXISTS edu.marketplace_reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID NOT NULL REFERENCES edu.marketplace_listings(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  purchase_id UUID REFERENCES edu.agent_purchases(id),
  rating      INT  NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(listing_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_listing
  ON edu.marketplace_reviews(listing_id, rating DESC);

CREATE TABLE IF NOT EXISTS edu.student_states (
  agent_id   UUID PRIMARY KEY,
  state      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edu_student_states_updated
  ON edu.student_states(updated_at DESC);

CREATE TABLE IF NOT EXISTS edu.adaptive_sessions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id               UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  student_agent_id         UUID REFERENCES public.user_agents(id),
  topic                    TEXT NOT NULL,
  subject                  TEXT NOT NULL,
  subtopics                JSONB NOT NULL DEFAULT '[]',
  objectives               JSONB NOT NULL DEFAULT '{}',
  current_subtopic_idx     INTEGER NOT NULL DEFAULT 0,
  current_phase            TEXT    NOT NULL DEFAULT '1',  -- '1'|'2'|'3'|'4'|'assessment'|'complete'
  status                   TEXT    NOT NULL DEFAULT 'configured'
                             CHECK (status IN ('configured','active','complete','blocked','abandoned')),
  session_history          JSONB   NOT NULL DEFAULT '[]',
  objectives_covered       JSONB   NOT NULL DEFAULT '{}',
  confidence_by_subtopic   JSONB   NOT NULL DEFAULT '{}',
  assessment_state         JSONB,                          -- current Sargeant gate state
  teacher_agent_id         UUID,                           -- optional trained guide agent
  started_at               TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ DEFAULT now(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adaptive_sessions_student
  ON edu.adaptive_sessions(student_id);

CREATE INDEX IF NOT EXISTS idx_adaptive_sessions_status
  ON edu.adaptive_sessions(status);

CREATE TABLE IF NOT EXISTS edu.session_phase_progress (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES edu.adaptive_sessions(id) ON DELETE CASCADE,
  subtopic_idx      INTEGER  NOT NULL,
  subtopic          TEXT     NOT NULL,
  phase             TEXT     NOT NULL,   -- '1'|'2'|'3'|'4'|'assessment'
  confidence_start  FLOAT    DEFAULT 0,
  confidence_end    FLOAT,
  gaps_covered      JSONB    DEFAULT '[]',
  objectives_met    JSONB    DEFAULT '[]',
  assessment_score  FLOAT,
  passed            BOOLEAN,
  completed_at      TIMESTAMPTZ,
  UNIQUE (session_id, subtopic_idx, phase)
);

CREATE INDEX IF NOT EXISTS idx_session_phase_session
  ON edu.session_phase_progress(session_id);

ALTER TABLE edu.user_agent_preferences
  ALTER COLUMN default_pair_id SET DEFAULT 'nana-esumai';

-- ── Per-subtopic confidence + decay (was migration-patch5) ──
-- Extends the adaptive learning module with granular knowledge
-- tracking at the subtopic and objective level.
-- ================================================================

-- ── Table: edu.knowledge_confidence ─────────────────────────────
-- One row per (student × topic × subtopic).
-- Updated by Sargeant after every assessment gate.
-- Read by decay engine to apply Ebbinghaus forgetting curve.
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.knowledge_confidence (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      text          NOT NULL,
  agent_id        uuid,                          -- student's AI agent
  session_id      uuid,                          -- last session that assessed this
  topic           text          NOT NULL,
  subject         text          NOT NULL,
  subtopic        text          NOT NULL,
  objectives      jsonb         NOT NULL DEFAULT '[]',
  -- Confidence 0-100 (maps to Sargeant score × 100)
  confidence      numeric(5,2)  NOT NULL DEFAULT 20.0,
  prev_confidence numeric(5,2)  NOT NULL DEFAULT 20.0,
  -- Sargeant assessment tracking
  assess_count    int           NOT NULL DEFAULT 0,
  passed_count    int           NOT NULL DEFAULT 0,
  misconceptions  text[]        NOT NULL DEFAULT '{}',
  -- Ebbinghaus decay parameters
  -- decay_rate: daily decay as fraction (lower = slower)
  -- stability: increases with each pass, making decay slower
  decay_rate      numeric(5,4)  NOT NULL DEFAULT 0.0800,
  stability       numeric(5,3)  NOT NULL DEFAULT 1.000,
  -- Scheduling
  last_assessed   timestamptz   NOT NULL DEFAULT now(),
  next_review_due timestamptz,
  -- Meta
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  -- One row per student × topic × subtopic
  UNIQUE(student_id, topic, subtopic)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_kc_student_id    ON edu.knowledge_confidence(student_id);
CREATE INDEX IF NOT EXISTS idx_kc_next_review   ON edu.knowledge_confidence(next_review_due);
CREATE INDEX IF NOT EXISTS idx_kc_topic_subject ON edu.knowledge_confidence(topic, subject);
CREATE INDEX IF NOT EXISTS idx_kc_confidence    ON edu.knowledge_confidence(confidence);

-- ── Update adaptive_sessions: store block_history ────────────────
-- Stores the full typed block array so decay sessions can
-- reconstruct exact history (fallback: session_phase_progress).
ALTER TABLE edu.adaptive_sessions
  ADD COLUMN IF NOT EXISTS block_history jsonb DEFAULT '[]';

-- ── Update session_phase_progress: add confidence columns ────────
ALTER TABLE edu.session_phase_progress
  ADD COLUMN IF NOT EXISTS misconceptions text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS reteach_focus  text;

-- ── Update edu.decay_notifications: add subtopic fields ──────────
ALTER TABLE edu.decay_notifications
  ADD COLUMN IF NOT EXISTS subtopic        text,
  ADD COLUMN IF NOT EXISTS prev_confidence numeric(5,2),
  ADD COLUMN IF NOT EXISTS misconceptions  text[] DEFAULT '{}';

-- ── Helper view: knowledge health per topic ───────────────────────
CREATE OR REPLACE VIEW edu.topic_knowledge_health AS
SELECT
  student_id,
  topic,
  subject,
  COUNT(*)                                        AS subtopic_count,
  ROUND(AVG(confidence), 1)                       AS avg_confidence,
  MIN(confidence)                                 AS min_confidence,
  MAX(confidence)                                 AS max_confidence,
  COUNT(*) FILTER (WHERE confidence < 35)         AS critical_count,
  COUNT(*) FILTER (WHERE confidence < 55)         AS high_count,
  MIN(next_review_due)                            AS next_review_due,
  MAX(last_assessed)                              AS last_assessed
FROM edu.knowledge_confidence
GROUP BY student_id, topic, subject;

-- ── Helper view: subtopics needing review ────────────────────────
CREATE OR REPLACE VIEW edu.subtopics_due_for_review AS
SELECT *
FROM edu.knowledge_confidence
WHERE
  next_review_due <= now() + interval '1 day'
  OR confidence < 55
ORDER BY confidence ASC, next_review_due ASC;

-- ── Renderer styles + per-agent TTS voice (was migration-patch6) ──
-- FIX: patch6 targeted edu.agent_orchestration_configs (plural, nonexistent);
-- corrected to the real table edu.agent_orchestration_config so tts_voice lands.
-- Add render_style to teacher_profiles
-- Stores visual config extracted during agent training
ALTER TABLE edu.teacher_profiles
  ADD COLUMN IF NOT EXISTS render_style jsonb DEFAULT '{}';

-- Add tts_voice to orchestration_configs for per-agent TTS
ALTER TABLE edu.agent_orchestration_config
  ADD COLUMN IF NOT EXISTS tts_voice text DEFAULT 'alloy'
    CHECK (tts_voice IN ('alloy','echo','fable','onyx','nova','shimmer'));

-- Add teacher_agent_id + guide_name to user_agents
-- Links student's profile to their active guide agent
ALTER TABLE public.user_agents
  ADD COLUMN IF NOT EXISTS teacher_agent_id  text    DEFAULT 'nana-sargeant',
  ADD COLUMN IF NOT EXISTS guide_name        text    DEFAULT 'NaNa Esumai',
  ADD COLUMN IF NOT EXISTS guide_emoji       text    DEFAULT '🧠',
  ADD COLUMN IF NOT EXISTS guide_render_style jsonb  DEFAULT '{}';

-- Default NaNa render style for all existing agents
UPDATE public.user_agents
SET guide_render_style = '{
  "bubbleBg":    "rgba(124,58,237,0.10)",
  "bubbleBorder":"#7C3AED",
  "labelColor":  "#7C3AED",
  "ttsVoice":    "alloy",
  "assessStyle": "gentle"
}'::jsonb
WHERE guide_render_style = '{}'::jsonb OR guide_render_style IS NULL;

NOTIFY pgrst, 'reload schema';
