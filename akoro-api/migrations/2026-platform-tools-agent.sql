-- =============================================================
-- 2026-platform-tools-agent.sql
-- Adds the EXISTING agent/chat tools to the platform_tools catalog so they
-- are also purchase-gated. After this, a brand-new instructor agent has NO
-- tool commands — each becomes available only once the instructor unlocks it.
--
-- Run after 2026-platform-tools.sql. Safe to re-run (idempotent).
-- =============================================================

INSERT INTO edu.platform_tools (key, kind, name, description, emoji, tag, price_kobo, sort_order) VALUES
  ('quiz-generator',  'tool', 'Quiz Generator',        'Agent generates quizzes for any topic, difficulty and question count.',        '📝', NULL, 150000, 19),
  ('student-data',    'tool', 'Student Progress',      'Agent fetches student performance, attendance and progress data on request.',  '📊', NULL, 100000, 20),
  ('send-reminder',   'tool', 'Send Reminder',         'Agent sends reminders and nudges to students (notification + message).',        '🔔', NULL,  80000, 21),
  ('schedule-session','tool', 'Schedule Session',      'Agent schedules live classes / sessions and notifies enrolled students.',       '📅', NULL,  80000, 22),
  ('export-report',   'tool', 'Reports & Battle Report','Agent compiles progress reports and battle/ranking reports on demand.',         '📈', NULL, 150000, 23),
  ('create-battle',   'tool', 'Create Battle',         'Agent creates 1v1 / class battles and challenges between students.',            '⚔️', NULL, 100000, 24)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      kind = EXCLUDED.kind,
      description = EXCLUDED.description,
      emoji = EXCLUDED.emoji,
      tag = EXCLUDED.tag,
      sort_order = EXCLUDED.sort_order,
      updated_at = now();
-- price_kobo not overwritten on re-run (preserves manual price edits).
