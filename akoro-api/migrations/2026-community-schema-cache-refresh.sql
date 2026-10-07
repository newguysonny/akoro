-- =============================================================
-- 2026-community-schema-cache-refresh.sql
--
-- Communities are served by the API through the service-role
-- Supabase/PostgREST client. Make the two base community relations
-- explicitly visible to that role and force PostgREST to rebuild its
-- schema/config caches after the community tables exist.
--
-- Idempotent; safe on every deployment.
-- =============================================================

GRANT USAGE ON SCHEMA edu TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  edu.communities,
  edu.community_members
TO service_role;

-- Required after additive relations and grants: PostgREST otherwise can retain
-- an older relation cache and respond with PGRST205 for these tables.
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
