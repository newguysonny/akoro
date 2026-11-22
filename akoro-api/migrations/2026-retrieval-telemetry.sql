-- Retrieval and generation telemetry (2026-11-22).
--
-- One row per search or generated answer, so retrieval failures and generation
-- failures can be told apart. Deliberately small and append-only:
--   • retrieval: did the query return anything, how many candidates, how long,
--     did the vector arm contribute;
--   • generation: passages supplied, citations emitted, citation coverage,
--     unknown markers, model, answer size.
-- A zero-result query is the "nothing useful" log — the query text is stored
-- normalised and bounded (and hashed), so gaps can be grouped without keeping
-- whole learner documents.
create table if not exists edu.retrieval_events (
  id              bigserial primary key,
  user_id         uuid,
  surface         text not null,
  phase           text not null check (phase in ('retrieval', 'generation')),
  query           text,
  query_hash      text,
  zero_result     boolean,
  candidates      integer,
  passages        integer,
  citations       integer,
  coverage        real,
  unknown_markers integer,
  latency_ms      integer,
  vector          boolean,
  top_score       real,
  model           text,
  answer_chars    integer,
  meta            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_retrieval_events_time
  on edu.retrieval_events (created_at desc);
create index if not exists idx_retrieval_events_surface
  on edu.retrieval_events (surface, phase, created_at desc);
create index if not exists idx_retrieval_events_zero
  on edu.retrieval_events (created_at desc) where zero_result is true;
create index if not exists idx_retrieval_events_user
  on edu.retrieval_events (user_id, created_at desc);

comment on table edu.retrieval_events is
  'Search/answer telemetry: retrieval health (zero-result, candidates, latency) and generation health (citation coverage, unknown markers). Append-only; query text is normalised and bounded.';
