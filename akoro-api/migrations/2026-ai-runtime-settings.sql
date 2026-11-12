-- =============================================================
-- 2026-ai-runtime-settings.sql — persisted admin override for the
-- global default model and fallback (no restart, no deploy).
-- One singleton row. Missing row or NULL columns = use env defaults.
-- Idempotent.
-- =============================================================
create table if not exists edu.ai_runtime_settings (
  id             smallint primary key default 1 check (id = 1),
  default_model  text,
  fallback_model text,
  updated_by     text,
  updated_at     timestamptz not null default now()
);

comment on table edu.ai_runtime_settings is
  'Singleton AI model override written by the admin AI model endpoint; NULL/text values fall back to env defaults.';
