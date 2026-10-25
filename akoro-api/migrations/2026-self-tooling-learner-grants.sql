-- =============================================================
-- 2026-self-tooling-learner-grants.sql
-- A learner can turn on an own-data change capability (delete or complete
-- their tasks, end a study buddy) for THEMSELVES by approving it on a card in
-- their chat: a grant with learner_id set. learner_id NULL is an admin grant
-- for everyone, as before. Anything touching other learners' data stays
-- admin-only (enforced in code: capabilities.js learnerGrantable).
-- Idempotent.
-- =============================================================
ALTER TABLE edu.capability_grants ADD COLUMN IF NOT EXISTS learner_id uuid REFERENCES public.users(id) ON DELETE CASCADE;
-- A platform tool an admin promoted, when the grant came with that promotion (revoking the tool revokes it).
ALTER TABLE edu.capability_grants ADD COLUMN IF NOT EXISTS tool_id uuid;
CREATE INDEX IF NOT EXISTS idx_capability_grants_learner ON edu.capability_grants (learner_id, capability) WHERE revoked_at IS NULL AND learner_id IS NOT NULL;
NOTIFY pgrst, 'reload schema';
