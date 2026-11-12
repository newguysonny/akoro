-- =============================================================
-- 2026-ai-runtime-roles.sql — runtime model overrides per role/feature.
--
-- The global default could already be switched at runtime. This adds maps so
-- an admin can pin a model to one role (chat, persona, suggestions, vision,
-- builder, the locked graders…) or one feature without an env change.
-- Idempotent.
-- =============================================================

alter table edu.ai_runtime_settings
  add column if not exists role_models jsonb not null default '{}'::jsonb,
  add column if not exists feature_models jsonb not null default '{}'::jsonb;

comment on column edu.ai_runtime_settings.role_models is
  'Per-role model id overrides: {"assessor":"claude-haiku",...}. Empty = env/default.';
comment on column edu.ai_runtime_settings.feature_models is
  'Per-feature model id overrides: {"think_mode":"o4-mini",...}. Empty = env/default.';
