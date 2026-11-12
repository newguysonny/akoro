-- =============================================================
-- 2026-email-verification-codes.sql — emailed codes for signup, login and
-- password reset.
--
-- Codes are stored HASHED, single-use, with an expiry, attempt cap and send
-- rate limit. Existing accounts are grandfathered as verified so enabling the
-- flow never locks anyone out; only new/verification-pending accounts need it.
-- Idempotent.
-- =============================================================

create table if not exists public.email_verification_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.users(id) on delete cascade,
  email       text not null,
  purpose     text not null check (purpose in ('signup', 'login', 'reset')),
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    integer not null default 0,
  max_attempts integer not null default 5,
  consumed_at timestamptz,
  created_at  timestamptz not null default now(),
  ip          text,
  user_agent  text
);

create index if not exists email_verification_codes_lookup
  on public.email_verification_codes (email, purpose, created_at desc);
create index if not exists email_verification_codes_user
  on public.email_verification_codes (user_id, purpose, created_at desc);

-- Grandfather every account that exists when this ships.
update public.users
   set email_verified = true
 where email_verified is distinct from true;
