-- =============================================================
-- 2026-chat-message-meta-merge.sql — merge reply metadata atomically.
--
-- A reply's materials (saved by the turn) and its follow-up ideas (saved by
-- the suggestions call, in parallel) were read-modify-write on chat_messages
-- .meta. Under a race one overwrote the other, so saved cards vanished on
-- refresh. This function merges a JSON patch in a single UPDATE. Idempotent.
-- =============================================================

create or replace function public.merge_chat_message_meta(p_id uuid, p_patch jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.chat_messages
     set meta = coalesce(meta, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb)
   where id = p_id;
$$;

comment on function public.merge_chat_message_meta(uuid, jsonb) is
  'Atomically merge a chat_message meta patch (materials + ideas must never overwrite each other).';
