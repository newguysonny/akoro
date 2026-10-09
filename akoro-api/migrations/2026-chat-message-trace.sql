-- ============================================================================
-- 2026-chat-message-trace.sql
-- The Agent Chat tab renders a turn as thinking rows, tool rows and activity
-- text (Grand Plan §13.4). The bounded, learner-safe trace of an agent reply
-- is stored with that reply so a reloaded chat shows the same blocks.
-- Nullable: older rows and older API builds simply have no trace.
-- Never holds model reasoning, raw tool arguments or raw tool results.
-- ============================================================================
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS trace jsonb;
