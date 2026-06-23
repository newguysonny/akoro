-- 2026-expose-edu-schema.sql
-- FIX: "Invalid schema: edu" (PostgREST PGRST106) when starting teaching
-- sessions or proctored assessments.
--
-- Cause: the API (supabase-js) calls db.schema("edu").  For PostgREST to
-- route to a non-public schema it must be in the project's exposed-schemas
-- list. `edu` was never added, so every edu read/write returns PGRST106 and
-- the session dies before session_ready ("connects then disappears").
--
-- TWO WAYS TO APPLY — pick the one that matches your hosting:
--
-- A) Hosted Supabase (recommended):
--      Dashboard → Settings → API → Exposed schemas → add `edu`
--      (the same place `content` was added). No SQL needed; takes effect
--      immediately. This file then serves only as documentation.
--
-- B) Self-hosted / direct SQL (Postgres role config):
--      Run the statements below. Adjust the schema list to match your
--      project's CURRENT exposed schemas — DO NOT drop ones you already
--      expose (public, content, storage, graphql_public, …). Inspect first:
--
--        SHOW pgrst.db_schemas;            -- if set at the database level
--        -- or check: SELECT rolname, rolconfig FROM pg_roles
--        --           WHERE rolname = 'authenticator';

ALTER ROLE authenticator
  SET pgrst.db_schemas = 'public, content, edu, storage, graphql_public';

-- Make sure the service/auth roles can actually use the schema + its tables.
GRANT USAGE ON SCHEMA edu TO authenticator, service_role, anon, authenticated;
GRANT ALL ON ALL TABLES    IN SCHEMA edu TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA edu TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA edu GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA edu GRANT ALL ON SEQUENCES TO service_role;

-- Tell PostgREST to reload its config so the new schema list takes effect
-- without a restart.
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
