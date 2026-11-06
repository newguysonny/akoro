-- =============================================================
-- 2026-tier-allowed-models.sql — Grand Plan §7.11.5a (D26), Phase 11.
-- Which models a plan tier may switch TO in the chat's model picker. Every
-- tier defaults to gpt-4o-mini (not listed here); a model must be enabled in
-- the catalogue AND in the payer's tier list to be offered.
--
-- NULL = never set: the API uses the plan's starting list for that tier
-- name (lib/modelTiers.js). An admin's edit (even to an empty list = the
-- default only) is kept: the seed below only fills NULLs.
-- Idempotent.
-- =============================================================
ALTER TABLE public.tiers ADD COLUMN IF NOT EXISTS allowed_models text[];

COMMENT ON COLUMN public.tiers.allowed_models IS
  'Grand Plan §7.11.5a: catalogue ids this tier may switch to (the default gpt-4o-mini is always allowed). NULL = the plan''s starting list.';

-- Starting lists (confirmed 2026-10-09). DeepSeek is on every tier; Fable on none.
UPDATE public.tiers SET allowed_models = ARRAY['deepseek']
  WHERE allowed_models IS NULL AND lower(name) = 'pilot';
UPDATE public.tiers SET allowed_models = ARRAY['claude-haiku', 'deepseek']
  WHERE allowed_models IS NULL AND lower(name) = 'trial';
UPDATE public.tiers SET allowed_models = ARRAY['claude-haiku', 'claude-sonnet', 'gpt-4.1', 'deepseek']
  WHERE allowed_models IS NULL AND lower(name) = 'freemium';
UPDATE public.tiers SET allowed_models = ARRAY['claude-haiku', 'claude-sonnet', 'gpt-4.1', 'claude-opus', 'grok', 'deepseek']
  WHERE allowed_models IS NULL AND lower(name) = 'premium';
