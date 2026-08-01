-- =============================================================
-- 2026-vouchers-preserve-history.sql
-- Stop a single user deletion from erasing financial history.
--
-- Before this: startups.owner_user_id and agent_wallets.user_id were
-- ON DELETE CASCADE to public.users. Deleting one user (admin/routes.js does
-- a hard `users.delete()`) cascaded through startups -> api_keys, batches,
-- codes, redemptions, settlements, startup_wallets(+transactions),
-- withdrawals, webhook_deliveries — i.e. one click erased records of money
-- already collected and paid out.
--
-- Now those two FKs are RESTRICT. Deleting a user who has voucher activity
-- fails loudly instead of silently destroying the ledger; suspend the
-- startup (status='suspended') or deactivate the user instead.
--
-- BEHAVIOUR CHANGE: admin "delete user" will now error for any user who owns
-- a startup or has an agent wallet. That is deliberate — those records are
-- financial history, not user content.
--
-- Idempotent: constraints are dropped by name and recreated.
-- =============================================================

ALTER TABLE vouchers.startups      DROP CONSTRAINT IF EXISTS startups_owner_user_id_fkey;
ALTER TABLE vouchers.startups      ADD  CONSTRAINT startups_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE vouchers.agent_wallets DROP CONSTRAINT IF EXISTS agent_wallets_user_id_fkey;
ALTER TABLE vouchers.agent_wallets ADD  CONSTRAINT agent_wallets_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

-- Codes/batches reference the buying agent. Keep the row (and its money
-- trail) even if the user record goes; the agent_wallets RESTRICT above
-- already blocks deleting anyone who actually traded.
ALTER TABLE vouchers.batches       DROP CONSTRAINT IF EXISTS batches_agent_id_fkey;
ALTER TABLE vouchers.batches       ADD  CONSTRAINT batches_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE vouchers.codes         DROP CONSTRAINT IF EXISTS codes_agent_id_fkey;
ALTER TABLE vouchers.codes         ADD  CONSTRAINT codes_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES public.users(id) ON DELETE RESTRICT;

-- api_keys.created_by_user_id had NO ON DELETE clause (NO ACTION), which
-- blocks user deletion for an audit field that doesn't need to. Null it out
-- instead — who minted the key is nice-to-have, not a financial record.
ALTER TABLE vouchers.api_keys      DROP CONSTRAINT IF EXISTS api_keys_created_by_user_id_fkey;
ALTER TABLE vouchers.api_keys      ADD  CONSTRAINT api_keys_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- Deleting a BATCH would still cascade away its codes and their redemptions.
-- Nothing in the app deletes batches, but make it impossible by accident:
-- a batch with codes can no longer be removed.
ALTER TABLE vouchers.codes         DROP CONSTRAINT IF EXISTS codes_batch_id_fkey;
ALTER TABLE vouchers.codes         ADD  CONSTRAINT codes_batch_id_fkey
  FOREIGN KEY (batch_id) REFERENCES vouchers.batches(id) ON DELETE RESTRICT;

-- Redemptions are the record that a customer actually received value.
-- Never let deleting a code erase it.
ALTER TABLE vouchers.redemptions   DROP CONSTRAINT IF EXISTS redemptions_code_id_fkey;
ALTER TABLE vouchers.redemptions   ADD  CONSTRAINT redemptions_code_id_fkey
  FOREIGN KEY (code_id) REFERENCES vouchers.codes(id) ON DELETE RESTRICT;

GRANT ALL ON ALL TABLES    IN SCHEMA vouchers TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA vouchers TO service_role;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
