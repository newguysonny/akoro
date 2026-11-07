-- =============================================================
-- 2026-confusion-pair-reviews.sql — §7.15.1: an admin reviews the commonly
-- confused pairs (edu.learning_confusion_pairs: a wrong option picked by 5+
-- learners): fix the content, note it, or set it aside. One review row per
-- subject + concept + confused option; who and when are kept. Idempotent.
-- =============================================================
CREATE TABLE IF NOT EXISTS edu.confusion_pair_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject       text NOT NULL DEFAULT '',
  concept       text NOT NULL DEFAULT '',
  confused_with text NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'content_fixed', 'noted', 'ignored')),
  note          text CHECK (note IS NULL OR char_length(note) <= 500),
  reviewed_by   uuid,
  reviewed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject, concept, confused_with)
);
GRANT SELECT, INSERT, UPDATE ON edu.confusion_pair_reviews TO service_role;

NOTIFY pgrst, 'reload schema';
