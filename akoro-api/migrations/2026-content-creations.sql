-- Content hub: saved outputs of the Blog / Social / Activities generators, so
-- each generator can show a "past creations" row. Idempotent; every deploy.
CREATE TABLE IF NOT EXISTS edu.content_creations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  kind        text NOT NULL,          -- 'blog' | 'social' | 'activity'
  subtype     text,                   -- blog type / platform / etc
  topic       text,
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_creations_school_kind
  ON edu.content_creations(school_id, kind, created_at DESC);
