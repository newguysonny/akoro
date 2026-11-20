-- Discipline for higher-education learners (programme / department).
--
-- School learners have subjects; university learners have ONE discipline
-- ("Pharmacy and Pharmaceutical Sciences", "Law", …). Keeping it in its own
-- column means reporting and matching can tell the two apart instead of
-- reading a discipline out of the subjects array.
--
-- Nullable: existing rows and school learners have none. Safe to re-run.

ALTER TABLE users       ADD COLUMN IF NOT EXISTS discipline TEXT;
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS discipline TEXT;
