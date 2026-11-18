-- =============================================================
-- 2026-self-tooling-views.sql — the data-driven Data View registry.
--
-- A Data View is a declarative spec (one existing table, an owner column,
-- an allowlist of fields) that modules/self-tooling/views.js interprets at
-- runtime. Built-in views live in code; rows here ADD views at runtime so a
-- new kind of learner data can become buildable without a code deploy.
-- A row only ever describes data that already exists — it creates no table
-- and changes no schema. Activation is gated by spec validation against the
-- live database (see modules/self-tooling/viewSpecs.js).
--
--   status 'proposed'  → stored, NOT loaded (waiting for an admin decision)
--   status 'active'    → merged into the live registry on the next refresh
--   status 'disabled'  → kept for the record, NOT loaded
-- Idempotent.
-- =============================================================
CREATE TABLE IF NOT EXISTS edu.self_tool_views (
  name         text PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9_]{2,47}$'),
  spec         jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','active','disabled')),
  origin       text NOT NULL DEFAULT 'admin' CHECK (origin IN ('admin','agent','learner')),
  note         text CHECK (length(note) <= 500),
  proposed_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_self_tool_views_status ON edu.self_tool_views (status);

-- Column introspection for spec validation: the API's PostgREST client
-- cannot read information_schema, so validation asks this function which
-- columns a table really has (name + data type) before a spec may activate.
CREATE OR REPLACE FUNCTION edu.self_tool_table_columns(p_schema text, p_table text)
RETURNS TABLE (column_name text, data_type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT c.column_name::text, c.data_type::text
  FROM information_schema.columns c
  WHERE c.table_schema = p_schema AND c.table_name = p_table
  ORDER BY c.ordinal_position;
$$;

NOTIFY pgrst, 'reload schema';
