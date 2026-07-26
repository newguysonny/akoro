-- Teaching Materials can be scoped to a section (optional). Idempotent.
ALTER TABLE mgmt.learning_resources
  ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES mgmt.sections(id) ON DELETE SET NULL;
