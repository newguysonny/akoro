-- =============================================================
-- 2026-school-portal-settings.sql
-- Backend for the akoro-school Settings & Billing area: School Profile
-- extras, System & Formats / Attendance / Security / Integrations /
-- Personalisation / Notification preferences (one jsonb-per-category row),
-- Social Media connections, Telegram bot config, custom Domains, and the
-- School Website (config + saved HTML templates).
--
-- Also extends edu.platform_tools with a 'management' kind so the Apps
-- Center's built-in School Management Tools reuse the exact same
-- catalog/checkout/verify pipeline as Agent Tools & Assets.
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- =============================================================

-- ── School Profile extras (columns not already on school_profiles) ──────────
ALTER TABLE public.school_profiles ADD COLUMN IF NOT EXISTS slug                     text;
ALTER TABLE public.school_profiles ADD COLUMN IF NOT EXISTS acronym                  text;
ALTER TABLE public.school_profiles ADD COLUMN IF NOT EXISTS principal_name           text;
ALTER TABLE public.school_profiles ADD COLUMN IF NOT EXISTS country                  text DEFAULT 'Nigeria (+234)';
ALTER TABLE public.school_profiles ADD COLUMN IF NOT EXISTS favicon_url              text;
ALTER TABLE public.school_profiles ADD COLUMN IF NOT EXISTS principal_signature_url  text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_school_profiles_slug ON public.school_profiles (slug) WHERE slug IS NOT NULL;

-- Backfill slugs for existing schools that don't have one yet.
UPDATE public.school_profiles
SET slug = lower(regexp_replace(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')) || '-' || substr(id::text, 1, 6)
WHERE slug IS NULL;

-- ── One jsonb-per-category settings row per school ───────────────────────────
CREATE TABLE IF NOT EXISTS edu.school_portal_settings (
  school_id           uuid PRIMARY KEY REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  system_formats      jsonb NOT NULL DEFAULT '{}'::jsonb,
  attendance          jsonb NOT NULL DEFAULT '{}'::jsonb,
  security            jsonb NOT NULL DEFAULT '{}'::jsonb,
  integrations        jsonb NOT NULL DEFAULT '{}'::jsonb,
  personalisation     jsonb NOT NULL DEFAULT '{}'::jsonb,
  notification_prefs  jsonb NOT NULL DEFAULT '{}'::jsonb,
  notification_alerts jsonb NOT NULL DEFAULT '{}'::jsonb,  -- alert_key -> {active,email,sms,whatsapp,push}
  modules              jsonb NOT NULL DEFAULT '{}'::jsonb,  -- module_key -> boolean (enabled/disabled)
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Column may already exist from an earlier run of this file.
ALTER TABLE edu.school_portal_settings ADD COLUMN IF NOT EXISTS modules jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE edu.school_portal_settings ADD COLUMN IF NOT EXISTS backup_schedule jsonb NOT NULL DEFAULT '{"autoBackup": true, "frequency": "daily", "retentionDays": 30}'::jsonb;

-- ── Backup Management: metadata for each backup snapshot ────────────────────
CREATE TABLE IF NOT EXISTS edu.school_backups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  label        text NOT NULL DEFAULT 'Manual Backup',
  type         text NOT NULL DEFAULT 'manual' CHECK (type IN ('manual','auto')),
  status       text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','failed','in_progress')),
  size_bytes   bigint NOT NULL DEFAULT 0,
  record_count integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_school_backups_school ON edu.school_backups (school_id, created_at DESC);

-- ── Roles & Permissions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.school_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_system   boolean NOT NULL DEFAULT false,   -- system roles (e.g. Administrator) can't be deleted
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb, -- module_key -> {view,create,edit,delete}
  member_count integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);
CREATE INDEX IF NOT EXISTS idx_school_roles_school ON edu.school_roles (school_id);

-- ── Payment Gateway Settings (online fee collection) ─────────────────────────
-- Secrets are stored here and masked on read by the API — never returned raw.
CREATE TABLE IF NOT EXISTS edu.school_payment_gateway (
  school_id          uuid PRIMARY KEY REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  enabled            boolean NOT NULL DEFAULT false,
  provider           text,                                    -- e.g. 'paystack', 'flutterwave', 'stripe'
  mode               text NOT NULL DEFAULT 'sandbox' CHECK (mode IN ('sandbox','live')),
  live_key_id        text,
  live_key_secret    text,
  sandbox_key_id     text,
  sandbox_key_secret text,
  webhook_secret     text,
  surcharge_type     text NOT NULL DEFAULT 'percentage' CHECK (surcharge_type IN ('percentage','flat')),
  surcharge_amount   numeric NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ── Admission Form Configuration ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.school_admission_settings (
  school_id     uuid PRIMARY KEY REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  enabled       boolean NOT NULL DEFAULT false,   -- online admission fee collection
  slug          text,                              -- public admission-form URL slug
  fee_amount    numeric NOT NULL DEFAULT 0,
  qr_code_url   text,                              -- uploaded GPay/PhonePe/Paytm QR image
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_school_admission_settings_slug ON edu.school_admission_settings (slug) WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS edu.school_admission_fields (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  label       text NOT NULL,
  field_type  text NOT NULL DEFAULT 'text' CHECK (field_type IN ('text','number','date','dropdown','file','textarea','checkbox')),
  options     text[],                              -- for dropdown fields
  required    boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_school_admission_fields_school ON edu.school_admission_fields (school_id, sort_order);

-- ── Subscription plans (platform-owned catalog — prices set by us) ──────────
CREATE TABLE IF NOT EXISTS edu.subscription_plans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                text NOT NULL UNIQUE,
  name               text NOT NULL,
  description        text NOT NULL DEFAULT '',
  max_students       integer NOT NULL,
  price_monthly_kobo integer NOT NULL DEFAULT 0,
  price_yearly_kobo  integer NOT NULL DEFAULT 0,
  sort_order         integer NOT NULL DEFAULT 0,
  is_active          boolean NOT NULL DEFAULT true
);

INSERT INTO edu.subscription_plans (key, name, description, max_students, price_monthly_kobo, price_yearly_kobo, sort_order) VALUES
  ('trial',      'Trial Plan',      'Perfect for new and Testing Demo getting started.', 300,       0,       0, 1),
  ('growth',     'Growth Plan',     'Our most popular plan for established and growing schools.', 500,  100000, 1000000, 2),
  ('enterprise', 'Enterprise Plan', 'This solution is designed for higher strength usage by both students and teachers. It can be installed individually, and for further assistance, please contact our sales team.', 1000, 500000, 5000000, 3)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, max_students = EXCLUDED.max_students, sort_order = EXCLUDED.sort_order;

-- ── Each school's active subscription ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.school_subscriptions (
  school_id      uuid PRIMARY KEY REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  plan_key       text NOT NULL DEFAULT 'trial' REFERENCES edu.subscription_plans(key),
  status         text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','expired','cancelled')),
  billing_cycle  text NOT NULL DEFAULT 'yearly' CHECK (billing_cycle IN ('monthly','yearly')),
  starts_at      timestamptz NOT NULL DEFAULT now(),
  ends_at        timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ── Subscription payment history ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.school_subscription_payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  order_id       text NOT NULL UNIQUE,
  plan_key       text NOT NULL,
  billing_cycle  text NOT NULL DEFAULT 'yearly',
  amount_kobo    integer NOT NULL DEFAULT 0,
  method         text NOT NULL DEFAULT 'Paystack',
  transaction_id text,
  proof_url      text,
  paystack_ref   text UNIQUE,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  paid_at        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_school_subscription_payments_school ON edu.school_subscription_payments (school_id, created_at DESC);

-- ── Audit Trail — auto-logged by middleware for every write under /api/school ─
CREATE TABLE IF NOT EXISTS edu.school_audit_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  actor_user_id  uuid,
  actor_name     text,
  method         text NOT NULL,               -- POST | PUT | PATCH | DELETE
  entity_type    text NOT NULL,                -- e.g. 'roles', 'domains', 'settings'
  entity_label   text,                         -- best-effort human label (name/label/title from body)
  path           text NOT NULL,
  status_code    integer NOT NULL,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb, -- sanitized request body (secrets stripped)
  ip_address     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_school_audit_logs_school ON edu.school_audit_logs (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_school_audit_logs_entity ON edu.school_audit_logs (school_id, entity_type);

-- ── Social media connections (Facebook/Instagram autopost) ──────────────────
CREATE TABLE IF NOT EXISTS edu.school_social_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  provider      text NOT NULL CHECK (provider IN ('facebook','instagram')),
  page_name     text,
  page_id       text,
  access_token  text,
  active        boolean NOT NULL DEFAULT true,
  connected_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,
  UNIQUE (school_id, provider, page_id)
);
CREATE INDEX IF NOT EXISTS idx_school_social_accounts_school ON edu.school_social_accounts (school_id);

-- ── Telegram bot monitoring config ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.school_telegram_config (
  school_id   uuid PRIMARY KEY REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  bot_token   text,
  chat_id     text,
  bot_username text,
  active      boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Custom domains (the default *.akoro.app subdomain is computed, not stored) ─
CREATE TABLE IF NOT EXISTS edu.school_domains (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  domain      text NOT NULL UNIQUE,
  verified    boolean NOT NULL DEFAULT false,
  cname_target text NOT NULL DEFAULT 'cname.akoro.app',
  created_at  timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_school_domains_school ON edu.school_domains (school_id);

-- ── School Website (public landing page) config ──────────────────────────────
CREATE TABLE IF NOT EXISTS edu.school_website (
  school_id        uuid PRIMARY KEY REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  enabled          boolean NOT NULL DEFAULT false,
  mode             text NOT NULL DEFAULT 'theme' CHECK (mode IN ('theme','template')),
  theme_id         text NOT NULL DEFAULT 'indian-gov',
  hero_title       text,
  hero_subtitle    text,
  hero_image_url   text,
  about_text       text,
  meta_title       text,
  meta_keywords    text,
  meta_description text,
  og_image_url     text,
  header_scripts   text,
  footer_scripts   text,
  primary_color    text NOT NULL DEFAULT '#1a56db',
  secondary_color  text NOT NULL DEFAULT '#6b7280',
  accent_color     text NOT NULL DEFAULT '#f59e0b',
  bg_mode          text NOT NULL DEFAULT 'Light',
  social_links     jsonb NOT NULL DEFAULT '{}'::jsonb,
  sections         jsonb NOT NULL DEFAULT '[{"key":"hero","label":"Hero","on":true},{"key":"about","label":"About","on":true},{"key":"notices","label":"Notices","on":true},{"key":"events","label":"Events","on":true},{"key":"gallery","label":"Gallery","on":true},{"key":"contact","label":"Contact","on":true},{"key":"stats","label":"Stats","on":false}]'::jsonb,
  custom_css       text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Saved full-HTML website templates ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.school_website_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  html        text NOT NULL DEFAULT '',
  is_active   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_school_website_templates_school ON edu.school_website_templates (school_id);

-- Only one active template per school.
CREATE UNIQUE INDEX IF NOT EXISTS idx_school_website_templates_one_active
  ON edu.school_website_templates (school_id) WHERE is_active;

-- ── Extend platform_tools with a 'management' kind for School Management Tools ─
ALTER TABLE edu.platform_tools DROP CONSTRAINT IF EXISTS platform_tools_kind_check;
ALTER TABLE edu.platform_tools ADD CONSTRAINT platform_tools_kind_check CHECK (kind IN ('tool','asset','management'));

INSERT INTO edu.platform_tools (key, kind, name, description, emoji, tag, price_kobo, sort_order, is_active) VALUES
  ('mgmt-question-paper', 'management', 'Question Paper Generator',      'Generate offline exam papers with Excel import, multi-section support, and print-ready PDFs.', '📄', 'active', 1500000, 101, true),
  ('mgmt-student-360',    'management', 'Student 360 View',              'Unified student profile — attendance, fees, marks, and notes in one page.',                    '👤', 'active',       0, 102, true),
  ('mgmt-seating',        'management', 'Seating Arrangement Generator', 'Auto-generate exam hall seating with class interleaving and hall tickets.',                   '🪑', 'active', 1000000, 103, true),
  ('mgmt-financial',      'management', 'Financial Analytics & Reports', 'Advanced P&L, Cash Flow summaries, and Tally exports.',                                       '📊', 'active', 2500000, 104, true),
  ('mgmt-whiteboard',     'management', 'Digital Whiteboard',            'Create, save, and share digital whiteboards for teaching and planning using Excalidraw.',     '🖊️', 'active',  800000, 105, true),
  ('mgmt-at-risk',        'management', 'At-Risk Student Detector',      'Flag students at academic risk using attendance and marks trends.',                          '⚠️', 'soon',   2000000, 106, true),
  ('mgmt-import-export',  'management', 'Data Import/Export Utility',    'Bulk import students via Excel and export class data for any module.',                       '🔁', 'soon',    500000, 107, true),
  ('mgmt-result-analysis','management', 'Result Analysis Tool',          'Subject-wise averages, pass/fail counts, mark distribution, and rank lists.',                 '📈', 'soon',   1200000, 108, true)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      kind = EXCLUDED.kind,
      description = EXCLUDED.description,
      emoji = EXCLUDED.emoji,
      tag = EXCLUDED.tag,
      sort_order = EXCLUDED.sort_order,
      updated_at = now();

-- ── Seed: default portal-settings + website row for every existing school ───
INSERT INTO edu.school_portal_settings (school_id)
SELECT id FROM public.school_profiles
ON CONFLICT (school_id) DO NOTHING;

INSERT INTO edu.school_website (school_id, hero_subtitle, meta_title, meta_keywords)
SELECT id, 'Empowering students with knowledge, values, and skills for a brighter tomorrow.', name, 'school, education, learning'
FROM public.school_profiles
ON CONFLICT (school_id) DO NOTHING;

INSERT INTO edu.school_telegram_config (school_id)
SELECT id FROM public.school_profiles
ON CONFLICT (school_id) DO NOTHING;

-- ── Ensure the API's service_role can read/write the new tables ─────────────
-- (mirrors 2026-expose-edu-schema.sql; harmless if already granted).
GRANT ALL ON ALL TABLES    IN SCHEMA edu TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA edu TO service_role;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
