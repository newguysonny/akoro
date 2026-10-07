-- =============================================================
-- database-seed-marketplace.sql  —  Discovery / Agent Marketplace seed
-- Run AFTER migration.sql (and ideally after database-seed.sql).
-- Safe to re-run: fixed UUIDs + ON CONFLICT DO NOTHING.
--
-- Seeds 6 instructors → 6 trained teacher agents → 6 marketplace
-- listings (mix of free/paid across maths/english/science), each with
-- a teacher_profile (powers the "Trained on / Sessions" stats), an
-- orchestration config (so the trained agent can actually run), plus
-- reviews. Also pre-grants two agents to the demo student so the
-- "owned", purchase-history, review and teacher-switch flows have data.
--
-- IMPORTANT — subjects use the learner app's filter keys
--   ('maths' | 'english' | 'science') so the Discovery subject pills work.
--
-- NOTE on the demo student: the learner app currently uses the mock
--   STUDENT_ID = "user-alex-01" (constants.js). The owned/purchase/review
--   flows query by that id. To exercise them against this seed, point the
--   app at the real Alex UUID below (22222222-0002-0001-0001-000000000001)
--   — e.g. set STUDENT_ID to it, or wire it from the authenticated user.
--   Browsing listings in Discovery needs no user and works as-is.
-- =============================================================

-- ─── § 0. INSTRUCTORS (reuse database-seed.sql users; insert if absent) ──────
INSERT INTO users (id, email, username, password_hash, full_name, avatar_url, role, is_active, email_verified, school_name, subjects, created_at, updated_at) VALUES
  ('22222222-0001-0001-0001-000000000002', 'dr.amara@westwood.edu',  'dr_amara',   '$2b$12$placeholder', 'Dr. Amara Osei', 'https://i.pravatar.cc/150?img=47', 'instructor', true, true, 'Westwood Academy','{"Mathematics","Further Mathematics"}', now(), now()),
  ('22222222-0001-0001-0001-000000000003', 'ms.rivera@riverside.edu','ms_rivera',  '$2b$12$placeholder', 'Ms. Rivera',     'https://i.pravatar.cc/150?img=45', 'instructor', true, true, 'Riverside High',  '{"Mathematics","Geometry"}',            now(), now()),
  ('22222222-0001-0001-0001-000000000004', 'mr.chen@summit.edu',     'mr_chen',    '$2b$12$placeholder', 'Mr. Chen',       'https://i.pravatar.cc/150?img=33', 'instructor', true, true, 'Summit Prep',     '{"English Language","English Literature"}', now(), now()),
  ('22222222-0001-0001-0001-000000000005', 'dr.adeyemi@lakeside.edu','dr_adeyemi', '$2b$12$placeholder', 'Dr. Adeyemi',    'https://i.pravatar.cc/150?img=56', 'instructor', true, true, 'Lakeside STEM',   '{"Biology","Chemistry"}',               now(), now()),
  ('22222222-0001-0001-0001-000000000006', 'mr.okafor@westwood.edu', 'mr_okafor',  '$2b$12$placeholder', 'Mr. Okafor',     'https://i.pravatar.cc/150?img=61', 'instructor', true, true, 'Westwood Academy','{"Mathematics","Further Mathematics"}', now(), now()),
  ('22222222-0001-0001-0001-000000000007', 'mrs.bello@oakwood.edu',  'mrs_bello',  '$2b$12$placeholder', 'Mrs. Bello',     'https://i.pravatar.cc/150?img=38', 'instructor', true, true, 'Oakwood Charter', '{"English Language","English Literature"}', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Demo student (reuse if present)
INSERT INTO users (id, email, username, password_hash, full_name, avatar_url, role, is_active, email_verified, year_group, study_level, school_name, subjects, created_at, updated_at) VALUES
  ('22222222-0002-0001-0001-000000000001', 'alex@student.akoro.app', 'alex_johnson', '$2b$12$placeholder', 'Alex Johnson', 'https://i.pravatar.cc/150?img=15', 'student', true, true, 'Year 11', 'Senior Secondary', 'Westwood Academy', '{"Mathematics","Physics","Computer Science"}', now(), now()),
  ('22222222-0002-0001-0001-000000000002', 'jordan@student.akoro.app','jordan_m',     '$2b$12$placeholder', 'Jordan M.',    'https://i.pravatar.cc/150?img=12', 'student', true, true, 'Year 11', 'Senior Secondary', 'Westwood Academy', '{"Mathematics","Further Mathematics"}', now(), now()),
  ('22222222-0002-0001-0001-000000000003', 'priya@student.akoro.app', 'priya_k',      '$2b$12$placeholder', 'Priya K.',     'https://i.pravatar.cc/150?img=44', 'student', true, true, 'Year 10', 'Senior Secondary', 'Westwood Academy', '{"English Language","English Literature"}', now(), now()),
  ('22222222-0002-0001-0001-000000000004', 'marcus@student.akoro.app','marcus_b',     '$2b$12$placeholder', 'Marcus B.',    'https://i.pravatar.cc/150?img=57', 'student', true, true, 'Year 11', 'Senior Secondary', 'Westwood Academy', '{"Chemistry","Biology","Mathematics"}', now(), now())
ON CONFLICT (id) DO NOTHING;

-- ─── § 1. TEACHER PROFILES (one per teacher — powers Discovery stats) ────────
-- teacher_profiles.teacher_id is UNIQUE; agent_id must match the listing's
-- agent_id so edu.marketplace_summary's LEFT JOIN fills training stats.
INSERT INTO edu.teacher_profiles (teacher_id, agent_id, teacher_name, agent_name, subject, style_profile, concepts_taught, total_hours_trained, session_count, last_trained_at, updated_at) VALUES
  ('22222222-0001-0001-0001-000000000002', 'aaaaaaaa-0001-0001-0001-000000000001', 'Dr. Amara Osei', 'Pythia',   'maths',   '{"tone":"warm","approach":"example-first","pace":"measured"}', '{"Differentiation","Integration","Limits","Chain rule","Optimisation"}', 42.5, 38, now(), now()),
  ('22222222-0001-0001-0001-000000000006', 'aaaaaaaa-0001-0001-0001-000000000002', 'Mr. Okafor',     'Sigma',    'maths',   '{"tone":"energetic","approach":"drill-heavy","pace":"fast"}',  '{"Algebra","Quadratics","Indices","Surds","Logarithms"}',                28.0, 25, now(), now()),
  ('22222222-0001-0001-0001-000000000003', 'aaaaaaaa-0001-0001-0001-000000000003', 'Ms. Rivera',     'Euclid',   'maths',   '{"tone":"patient","approach":"visual","pace":"measured"}',     '{"Triangles","Circle theorems","Proofs","Congruence","Vectors"}',        19.5, 17, now(), now()),
  ('22222222-0001-0001-0001-000000000004', 'aaaaaaaa-0001-0001-0001-000000000004', 'Mr. Chen',       'Quill',    'english', '{"tone":"encouraging","approach":"socratic","pace":"reflective"}', '{"Thesis statements","PEEL paragraphs","Comprehension","Tone","Persuasion"}', 33.0, 30, now(), now()),
  ('22222222-0001-0001-0001-000000000007', 'aaaaaaaa-0001-0001-0001-000000000005', 'Mrs. Bello',     'Lexis',    'english', '{"tone":"firm","approach":"exam-focused","pace":"brisk"}',     '{"Summary writing","Lexis & structure","Oral comprehension","Registers"}', 24.5, 22, now(), now()),
  ('22222222-0001-0001-0001-000000000005', 'aaaaaaaa-0001-0001-0001-000000000006', 'Dr. Adeyemi',    'Helix',    'science', '{"tone":"curious","approach":"story-driven","pace":"measured"}', '{"Cell biology","Genetics","Photosynthesis","Homeostasis","Ecology"}',    37.0, 34, now(), now())
ON CONFLICT (teacher_id) DO NOTHING;

-- ─── § 2. ORCHESTRATION CONFIG (one per agent — lets the trained agent run) ──
INSERT INTO edu.agent_orchestration_config (agent_id, teacher_id, flow_type, phase_definitions, guide_config, control_config, student_config, prompt_injections, training_version, is_active, created_at, updated_at) VALUES
  ('aaaaaaaa-0001-0001-0001-000000000001', '22222222-0001-0001-0001-000000000002', 'phase-based',
    '[{"id":"HOOK","label":"Hook","description":"Open with a real-world calculus problem"},{"id":"BUILD","label":"Build","description":"Work an example step by step"},{"id":"CHECK","label":"Check","description":"Student explains it back"}]',
    '{"guideName":"Dr. Amara''s Guide","guideEmoji":"📐","personality":"Warm, example-first lecturer who builds intuition before formality.","tone":"warm","voice":"nova","renderStyle":{"bubbleBg":"rgba(108,59,255,0.10)","bubbleBorder":"#6C3BFF","labelColor":"#6C3BFF","ttsVoice":"nova","assessStyle":"supportive"}}',
    '{"boundaryStyle":"gentle","redirectTone":"encouraging"}', '{"scaffolding":"high"}', '{}', 1, true, now(), now()),
  ('aaaaaaaa-0001-0001-0001-000000000002', '22222222-0001-0001-0001-000000000006', 'lecture-drill',
    '[{"id":"WARM","label":"Warm-up","description":"Quick recall drill"},{"id":"DRILL","label":"Drill","description":"Rapid practice set"},{"id":"PUSH","label":"Push","description":"Exam-style stretch question"}]',
    '{"guideName":"Mr. Okafor''s Guide","guideEmoji":"⚡","personality":"High-energy coach who drills until it sticks.","tone":"energetic","voice":"onyx","renderStyle":{"bubbleBg":"rgba(245,158,11,0.10)","bubbleBorder":"#F59E0B","labelColor":"#B45309","ttsVoice":"onyx","assessStyle":"challenging"}}',
    '{"boundaryStyle":"firm","redirectTone":"direct"}', '{"scaffolding":"medium"}', '{}', 1, true, now(), now()),
  ('aaaaaaaa-0001-0001-0001-000000000003', '22222222-0001-0001-0001-000000000003', 'phase-based',
    '[{"id":"SEE","label":"See","description":"Draw the figure"},{"id":"REASON","label":"Reason","description":"Justify each step"},{"id":"PROVE","label":"Prove","description":"Write the proof"}]',
    '{"guideName":"Ms. Rivera''s Guide","guideEmoji":"📊","personality":"Patient, visual teacher who makes proofs feel inevitable.","tone":"patient","voice":"shimmer","renderStyle":{"bubbleBg":"rgba(14,165,233,0.10)","bubbleBorder":"#0EA5E9","labelColor":"#0369A1","ttsVoice":"shimmer","assessStyle":"supportive"}}',
    '{"boundaryStyle":"gentle","redirectTone":"calm"}', '{"scaffolding":"high"}', '{}', 1, true, now(), now()),
  ('aaaaaaaa-0001-0001-0001-000000000004', '22222222-0001-0001-0001-000000000004', 'phase-based',
    '[{"id":"PLAN","label":"Plan","description":"Outline the argument"},{"id":"DRAFT","label":"Draft","description":"Write a PEEL paragraph"},{"id":"POLISH","label":"Polish","description":"Refine tone and clarity"}]',
    '{"guideName":"Mr. Chen''s Guide","guideEmoji":"✍️","personality":"Socratic writing mentor who asks more than he tells.","tone":"encouraging","voice":"fable","renderStyle":{"bubbleBg":"rgba(16,185,129,0.10)","bubbleBorder":"#10B981","labelColor":"#047857","ttsVoice":"fable","assessStyle":"reflective"}}',
    '{"boundaryStyle":"gentle","redirectTone":"curious"}', '{"scaffolding":"medium"}', '{}', 1, true, now(), now()),
  ('aaaaaaaa-0001-0001-0001-000000000005', '22222222-0001-0001-0001-000000000007', 'lecture-drill',
    '[{"id":"READ","label":"Read","description":"Unpack the passage"},{"id":"ANSWER","label":"Answer","description":"Model exam responses"},{"id":"REVIEW","label":"Review","description":"Mark against the rubric"}]',
    '{"guideName":"Mrs. Bello''s Guide","guideEmoji":"📖","personality":"Exam-focused, no-nonsense — every minute earns marks.","tone":"firm","voice":"alloy","renderStyle":{"bubbleBg":"rgba(14,165,233,0.10)","bubbleBorder":"#0EA5E9","labelColor":"#0369A1","ttsVoice":"alloy","assessStyle":"exam"}}',
    '{"boundaryStyle":"firm","redirectTone":"direct"}', '{"scaffolding":"low"}', '{}', 1, true, now(), now()),
  ('aaaaaaaa-0001-0001-0001-000000000006', '22222222-0001-0001-0001-000000000005', 'phase-based',
    '[{"id":"STORY","label":"Story","description":"Frame the concept as a story"},{"id":"MODEL","label":"Model","description":"Diagram the process"},{"id":"APPLY","label":"Apply","description":"Predict an outcome"}]',
    '{"guideName":"Dr. Adeyemi''s Guide","guideEmoji":"🧬","personality":"Curious storyteller who turns biology into narrative.","tone":"curious","voice":"nova","renderStyle":{"bubbleBg":"rgba(16,185,129,0.10)","bubbleBorder":"#10B981","labelColor":"#047857","ttsVoice":"nova","assessStyle":"supportive"}}',
    '{"boundaryStyle":"gentle","redirectTone":"warm"}', '{"scaffolding":"high"}', '{}', 1, true, now(), now())
ON CONFLICT (agent_id) DO NOTHING;

-- ─── § 3. MARKETPLACE LISTINGS (6 — mixed free/paid across subjects) ─────────
INSERT INTO edu.marketplace_listings
  (id, agent_id, teacher_id, title, description, subject, topics_covered, price_kobo, currency, is_active, preview_topics, sample_tip, total_students, total_sessions, avg_rating, rating_count, teacher_name, teacher_avatar, agent_avatar, style_summary, created_at, updated_at) VALUES
  ('bbbbbbbb-0001-0001-0001-000000000001', 'aaaaaaaa-0001-0001-0001-000000000001', '22222222-0001-0001-0001-000000000002',
    'A-Level Calculus Mastery', 'Build real intuition for differentiation and integration. Dr. Amara works every idea from a concrete example before the formal rule, so the maths finally clicks.',
    'maths', '{"Differentiation","Integration","Limits","Chain rule","Optimisation","Related rates"}', 250000, 'NGN', true,
    '{"Differentiation","Limits"}', 'Don''t memorise the rule — derive it once from a slope and you''ll never forget it.',
    1240, 980, 4.80, 0, 'Dr. Amara Osei', 'https://i.pravatar.cc/150?img=47', '📐', 'Warm, example-first — intuition before formality', now(), now()),
  ('bbbbbbbb-0001-0001-0001-000000000002', 'aaaaaaaa-0001-0001-0001-000000000002', '22222222-0001-0001-0001-000000000006',
    'JAMB Maths Crash Course', 'Fast-paced drilling for UTME maths. Mr. Okafor''s agent throws rapid practice sets and exam-timed stretches until speed and accuracy become automatic.',
    'maths', '{"Algebra","Quadratics","Indices","Surds","Logarithms","Sequences"}', 150000, 'NGN', true,
    '{"Algebra","Indices"}', 'Speed comes from patterns. Spot the form, skip the long way.',
    860, 1510, 4.60, 0, 'Mr. Okafor', 'https://i.pravatar.cc/150?img=61', '⚡', 'High-energy, drill-heavy exam prep', now(), now()),
  ('bbbbbbbb-0001-0001-0001-000000000003', 'aaaaaaaa-0001-0001-0001-000000000003', '22222222-0001-0001-0001-000000000003',
    'GCSE Geometry & Proofs', 'Make proofs feel inevitable. Ms. Rivera''s agent draws the figure with you and justifies every step, turning circle theorems from scary to satisfying.',
    'maths', '{"Triangles","Circle theorems","Proofs","Congruence","Vectors"}', 0, 'NGN', true,
    '{"Triangles","Circle theorems"}', 'A good diagram has already done half the proof. Draw before you write.',
    2100, 1720, 4.90, 0, 'Ms. Rivera', 'https://i.pravatar.cc/150?img=45', '📊', 'Patient & visual — proofs made obvious', now(), now()),
  ('bbbbbbbb-0001-0001-0001-000000000004', 'aaaaaaaa-0001-0001-0001-000000000004', '22222222-0001-0001-0001-000000000004',
    'Essay Writing & Comprehension', 'Write with structure and read with insight. Mr. Chen''s Socratic agent asks the questions that make your argument sharper, paragraph by paragraph.',
    'english', '{"Thesis statements","PEEL paragraphs","Comprehension","Tone","Persuasion"}', 0, 'NGN', true,
    '{"PEEL paragraphs","Thesis statements"}', 'Every paragraph should survive the question: so what? Answer it explicitly.',
    1680, 1340, 4.70, 0, 'Mr. Chen', 'https://i.pravatar.cc/150?img=33', '✍️', 'Socratic — sharpens your argument by asking', now(), now()),
  ('bbbbbbbb-0001-0001-0001-000000000005', 'aaaaaaaa-0001-0001-0001-000000000005', '22222222-0001-0001-0001-000000000007',
    'WAEC English Mastery', 'Exam-focused English for WAEC/NECO. Mrs. Bello''s agent models high-mark answers and marks yours against the rubric so you know exactly where the marks are.',
    'english', '{"Summary writing","Lexis & structure","Oral comprehension","Registers","Letter writing"}', 100000, 'NGN', true,
    '{"Summary writing","Registers"}', 'Read the mark scheme like a map — it tells you exactly where the marks are buried.',
    640, 720, 4.50, 0, 'Mrs. Bello', 'https://i.pravatar.cc/150?img=38', '📖', 'Firm & exam-focused — every minute earns marks', now(), now()),
  ('bbbbbbbb-0001-0001-0001-000000000006', 'aaaaaaaa-0001-0001-0001-000000000006', '22222222-0001-0001-0001-000000000005',
    'Biology Made Simple', 'Biology as a story you can''t forget. Dr. Adeyemi''s agent frames each process as a narrative, then has you predict outcomes to lock it in.',
    'science', '{"Cell biology","Genetics","Photosynthesis","Homeostasis","Ecology"}', 200000, 'NGN', true,
    '{"Cell biology","Photosynthesis"}', 'If you can tell the story of the process, you understand it. Names come after the plot.',
    1490, 1180, 4.85, 0, 'Dr. Adeyemi', 'https://i.pravatar.cc/150?img=56', '🧬', 'Curious storyteller — narrative-driven science', now(), now())
ON CONFLICT (id) DO NOTHING;

-- ─── § 4. REVIEWS (real students; trigger recomputes avg_rating + count) ─────
-- purchase_id left NULL (seed bypasses the purchase gate the API enforces).
INSERT INTO edu.marketplace_reviews (listing_id, student_id, purchase_id, rating, review_text, created_at) VALUES
  ('bbbbbbbb-0001-0001-0001-000000000001', '22222222-0002-0001-0001-000000000001', NULL, 5, 'Calculus finally makes sense. The example-first approach is a game changer.', now()),
  ('bbbbbbbb-0001-0001-0001-000000000001', '22222222-0002-0001-0001-000000000002', NULL, 5, 'Dr. Amara''s agent never just gives the rule — it builds it with you. Brilliant.', now()),
  ('bbbbbbbb-0001-0001-0001-000000000001', '22222222-0002-0001-0001-000000000004', NULL, 4, 'Really solid for A-Level. Wanted a couple more worked exam papers.', now()),
  ('bbbbbbbb-0001-0001-0001-000000000002', '22222222-0002-0001-0001-000000000002', NULL, 5, 'My JAMB speed shot up. The drills are relentless in the best way.', now()),
  ('bbbbbbbb-0001-0001-0001-000000000002', '22222222-0002-0001-0001-000000000001', NULL, 4, 'Fast and effective. Bring water — it''s a workout.', now()),
  ('bbbbbbbb-0001-0001-0001-000000000003', '22222222-0002-0001-0001-000000000003', NULL, 5, 'Circle theorems used to terrify me. Now I actually enjoy proofs.', now()),
  ('bbbbbbbb-0001-0001-0001-000000000003', '22222222-0002-0001-0001-000000000001', NULL, 5, 'The "draw first" habit alone was worth it. Free and excellent.', now()),
  ('bbbbbbbb-0001-0001-0001-000000000004', '22222222-0002-0001-0001-000000000003', NULL, 5, 'My essays have structure now. The questions it asks are exactly the right ones.', now()),
  ('bbbbbbbb-0001-0001-0001-000000000004', '22222222-0002-0001-0001-000000000002', NULL, 4, 'Great for comprehension. Made me a sharper reader.', now()),
  ('bbbbbbbb-0001-0001-0001-000000000005', '22222222-0002-0001-0001-000000000003', NULL, 5, 'Marked my answers against the rubric — I finally see where marks come from.', now()),
  ('bbbbbbbb-0001-0001-0001-000000000006', '22222222-0002-0001-0001-000000000004', NULL, 5, 'Biology as a story actually works. I remember everything now.', now()),
  ('bbbbbbbb-0001-0001-0001-000000000006', '22222222-0002-0001-0001-000000000001', NULL, 5, 'Dr. Adeyemi''s narratives make genetics stick. Loved it.', now())
ON CONFLICT (listing_id, student_id) DO NOTHING;

-- ─── § 5. DEMO STUDENT OWNERSHIP (Alex owns 2 agents) ───────────────────────
-- Lets the owned-badge, purchase-history, review and teacher-switch flows
-- show real data when the app runs as Alex's real UUID.
INSERT INTO edu.agent_purchases
  (id, student_id, agent_id, listing_id, amount_kobo, currency, paystack_ref, paystack_status, access_granted, metadata, purchased_at, verified_at) VALUES
  ('cccccccc-0001-0001-0001-000000000001', '22222222-0002-0001-0001-000000000001', 'aaaaaaaa-0001-0001-0001-000000000003', 'bbbbbbbb-0001-0001-0001-000000000003',
    0, 'NGN', 'FREE-seed-geometry', 'success', true, '{"listing_title":"GCSE Geometry & Proofs","subject":"maths","teacher_name":"Ms. Rivera"}', now(), now()),
  ('cccccccc-0001-0001-0001-000000000002', '22222222-0002-0001-0001-000000000001', 'aaaaaaaa-0001-0001-0001-000000000001', 'bbbbbbbb-0001-0001-0001-000000000001',
    250000, 'NGN', 'AGNT-seed-calculus', 'success', true, '{"listing_title":"A-Level Calculus Mastery","subject":"maths","teacher_name":"Dr. Amara Osei"}', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO edu.user_agent_preferences (user_id, default_pair_id, purchased_agents, active_agent_id, updated_at) VALUES
  ('22222222-0002-0001-0001-000000000001', 'nana-sargeant',
    '{aaaaaaaa-0001-0001-0001-000000000003,aaaaaaaa-0001-0001-0001-000000000001}', NULL, now())
ON CONFLICT (user_id) DO UPDATE
  SET purchased_agents = EXCLUDED.purchased_agents,
      updated_at       = now();

-- ─── § 6. COVER IMAGES ──────────────────────────────────────────────────────
-- Stable placeholder banner per listing (only fills blanks; idempotent).
UPDATE edu.marketplace_listings
SET cover_image_url = 'https://picsum.photos/seed/agent-' || id::text || '/600/360'
WHERE cover_image_url IS NULL OR cover_image_url = '';

-- ─── § 7. SANITY CHECK ──────────────────────────────────────────────────────
-- SELECT title, subject, price_kobo, total_students, avg_rating, rating_count
-- FROM edu.marketplace_summary ORDER BY avg_rating DESC;
