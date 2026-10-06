-- =============================================================
-- 2026-hot-path-indexes.sql
-- Index audit follow-up: close every gap on tables the API
-- actively queries, and drop one index the Pharm.D migration
-- created redundantly.
--
-- Method (not guesswork): every migration was parsed for tables,
-- PKs/unique keys/indexes and FK columns (Postgres does NOT
-- auto-index FKs); the codebase was grepped for the predicates
-- actually used against each table (.eq/.in/.order near each
-- from("<table>")); a column got an index only when it is really
-- filtered or ordered on, or when it carries an ON DELETE
-- CASCADE that would otherwise seq-scan per deleted row.
--
-- Deliberately NOT done: ~250 further unindexed FK columns on
-- the cold school-management suite (fees, hostels, assets,
-- timetables…). Those tables barely receive reads, and an index
-- costs every INSERT/UPDATE — speculative indexes are write tax
-- with no read benefit. They get indexed when their features
-- ship hot paths.
--
-- Every statement is idempotent (IF NOT EXISTS / IF EXISTS).
-- =============================================================

-- Agent chat history — chat_messages by user and by agent session
-- (public schema, like the table).
CREATE INDEX IF NOT EXISTS idx_chat_messages_user
  ON public.chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_agent_session
  ON public.chat_messages(agent_session_id);

-- A learner's sessions, newest first (Sessions list, continuation).
CREATE INDEX IF NOT EXISTS idx_adaptive_sessions_student_updated
  ON edu.adaptive_sessions(student_id, updated_at DESC);

-- Class chat threads by agent.
CREATE INDEX IF NOT EXISTS idx_class_messages_agent
  ON class_messages(agent_id);

-- Battle spectator feed by user.
CREATE INDEX IF NOT EXISTS idx_battle_viewers_user
  ON battle_viewers(user_id);

-- Teacher training: a teacher's sessions newest-first, and a
-- session's chunks in order.
CREATE INDEX IF NOT EXISTS idx_training_sessions_teacher
  ON edu.training_sessions(teacher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_chunks_session
  ON edu.training_chunks(session_id);

-- Device-training stream tokens: per session, and the expiry the
-- cleanup job scans.
CREATE INDEX IF NOT EXISTS idx_stream_tokens_session
  ON edu.stream_tokens(session_id);
CREATE INDEX IF NOT EXISTS idx_stream_tokens_expires
  ON edu.stream_tokens(expires_at);

-- Notification queue fan-out: per user, per live session.
CREATE INDEX IF NOT EXISTS idx_notification_queue_user
  ON notification_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_queue_session
  ON notification_queue(session_id);

-- XP per agent (leaderboards).
CREATE INDEX IF NOT EXISTS idx_xp_ledger_agent
  ON xp_ledger(agent_id);

-- Knowledge decay: a student's whole knowledge set.
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_student
  ON edu.agent_knowledge(student_id);

-- Learner-agent turns by agent session (history stitching).
CREATE INDEX IF NOT EXISTS idx_conv_turns_agent_session
  ON edu.learner_agent_conversation_turns(agent_session_id);

-- Self-study: a classroom's assignments.
CREATE INDEX IF NOT EXISTS idx_self_study_assignments_classroom
  ON edu.self_study_assignments(classroom_id);

-- Study-prep workflow runs by their exam-prep run.
CREATE INDEX IF NOT EXISTS idx_adaptive_workflow_runs_exam_prep
  ON edu.adaptive_workflow_runs(exam_prep_run_id);

-- PHARM.D: the programme-tree query filters courses by programme
-- (GET /api/pharmd/programme), and topic deletions cascade through
-- progress rows — index the referencing side.
CREATE INDEX IF NOT EXISTS idx_pharmd_courses_programme
  ON edu.pharmd_courses(programme_id);
CREATE INDEX IF NOT EXISTS idx_pharmd_progress_topic
  ON edu.pharmd_topic_progress(topic_id);

-- Drop: idx_pharmd_progress_user is fully covered by the table's
-- PRIMARY KEY (user_id, topic_id) — a pure write tax.
DROP INDEX IF EXISTS edu.idx_pharmd_progress_user;
