-- =============================================================
-- database-seed.sql  —  Akoro Platform Seed Data
-- Run this AFTER migration.sql in the Supabase SQL editor.
-- Safe to re-run: uses INSERT ... ON CONFLICT DO NOTHING.
-- =============================================================

-- ─── § 1. SCHOOLS ─────────────────────────────────────────────────────────────

-- Schools are inserted AFTER users so admin_user_id FK can be satisfied.
-- See § 2a below for the school inserts.

-- ─── § 2. USERS ───────────────────────────────────────────────────────────────
-- Student passwords: FirstName2026  e.g. Alex2026, Jordan2026
-- Instructor/admin passwords: placeholder — use Google OAuth or reset in prod.

INSERT INTO users (id, email, username, password_hash, full_name, avatar_url, role, is_active, email_verified, year_group, study_level, school_name, subjects, created_at, updated_at) VALUES
  -- Admins / Teachers (placeholder hashes — login via Google OAuth)
  ('22222222-0001-0001-0001-000000000001', 'admin@akoro.app',        'akoro_admin',   '$2b$12$placeholder', 'Akoro Admin',       'https://i.pravatar.cc/150?img=1',  'admin',      true, true, null,     null,          null,              '{}',                                           now(), now()),
  ('22222222-0001-0001-0001-000000000002', 'dr.amara@westwood.edu',  'dr_amara',      '$2b$12$placeholder', 'Dr. Amara Osei',    'https://i.pravatar.cc/150?img=47', 'instructor', true, true, null,     null,          'Westwood Academy','{"Mathematics","Further Mathematics"}',        now(), now()),
  ('22222222-0001-0001-0001-000000000003', 'ms.rivera@riverside.edu','ms_rivera',     '$2b$12$placeholder', 'Ms. Rivera',        'https://i.pravatar.cc/150?img=47', 'instructor', true, true, null,     null,          'Riverside High',  '{"Mathematics","Geometry"}',                   now(), now()),
  ('22222222-0001-0001-0001-000000000004', 'mr.chen@summit.edu',     'mr_chen',       '$2b$12$placeholder', 'Mr. Chen',          'https://i.pravatar.cc/150?img=33', 'instructor', true, true, null,     null,          'Summit Prep',     '{"English Language","English Literature"}',    now(), now()),
  ('22222222-0001-0001-0001-000000000005', 'dr.adeyemi@lakeside.edu','dr_adeyemi',    '$2b$12$placeholder', 'Dr. Adeyemi',       'https://i.pravatar.cc/150?img=56', 'instructor', true, true, null,     null,          'Lakeside STEM',   '{"Biology","Chemistry"}',                      now(), now()),
  ('22222222-0001-0001-0001-000000000006', 'mr.okafor@westwood.edu', 'mr_okafor',     '$2b$12$placeholder', 'Mr. Okafor',        'https://i.pravatar.cc/150?img=61', 'instructor', true, true, null,     null,          'Westwood Academy','{"Mathematics","Further Mathematics"}',        now(), now()),
  ('22222222-0001-0001-0001-000000000007', 'mrs.bello@oakwood.edu',  'mrs_bello',     '$2b$12$placeholder', 'Mrs. Bello',        'https://i.pravatar.cc/150?img=38', 'instructor', true, true, null,     null,          'Oakwood Charter', '{"English Language","English Literature"}',    now(), now()),

  -- Students — Westwood Academy  (password = FirstName2026)
  ('22222222-0002-0001-0001-000000000001', 'alex@student.akoro.app',       'alex_johnson',   '$2b$12$nNIacYBdS2oTwCR15bE/WumjF44lt0GbsaNGoDAFaBJ/zWK.kJvlm', 'Alex Johnson',   'https://i.pravatar.cc/150?img=15', 'student', true, true, 'Year 11', 'Senior Secondary',   'Westwood Academy', '{"Mathematics","Physics","Computer Science"}',          now(), now()),
  ('22222222-0002-0001-0001-000000000002', 'jordan@student.akoro.app',     'jordan_m',       '$2b$12$1XH5PKulUqc1CcpmS755QOgBOlOubg8u6NgIoKVN2CnjydXMyf1LS', 'Jordan M.',      'https://i.pravatar.cc/150?img=12', 'student', true, true, 'Year 11', 'Senior Secondary',   'Westwood Academy', '{"Mathematics","Further Mathematics","Physics"}',       now(), now()),
  ('22222222-0002-0001-0001-000000000003', 'priya@student.akoro.app',      'priya_k',        '$2b$12$XUeuzli84438PVjhP0sG7us7ctm0Q9HGB.bRJzYi98XS4O.2iD0DO', 'Priya K.',       'https://i.pravatar.cc/150?img=44', 'student', true, true, 'Year 10', 'Senior Secondary',   'Westwood Academy', '{"English Language","English Literature","History"}',   now(), now()),
  ('22222222-0002-0001-0001-000000000004', 'marcus@student.akoro.app',     'marcus_b',       '$2b$12$JJ1F0WpU3tfKa3ztWjn2X.4jZ1c2IevY/Wpz7RFGPtcFaQGX/n/IS', 'Marcus B.',      'https://i.pravatar.cc/150?img=57', 'student', true, true, 'Year 11', 'Senior Secondary',   'Westwood Academy', '{"Chemistry","Biology","Mathematics"}',                now(), now()),
  ('22222222-0002-0001-0001-000000000005', 'aaliyah@student.akoro.app',    'aaliyah_t',      '$2b$12$bz0M8CVXNMa/tk1whCfWvO2isrxC2/VK.eZAUpMs0nbbd74UwDGhm', 'Aaliyah T.',     'https://i.pravatar.cc/150?img=32', 'student', true, true, 'Year 10', 'Senior Secondary',   'Westwood Academy', '{"Mathematics","Biology","Geography"}',                now(), now()),
  ('22222222-0002-0001-0001-000000000006', 'leon@student.akoro.app',       'leon_s',         '$2b$12$pLQ/mBwMj1pSgkpbLBFvXOY40E25LT3J2GQljAyvnj6puz0eMAt6i', 'Leon S.',        'https://i.pravatar.cc/150?img=68', 'student', true, true, 'Year 11', 'Senior Secondary',   'Westwood Academy', '{"Physics","Mathematics","Computer Science"}',          now(), now()),
  ('22222222-0002-0001-0001-000000000007', 'sasha@student.akoro.app',      'sasha_m',        '$2b$12$KY4ZfOZCo1ttbk6UXUIqKuYKRHkxkWIVnnVOLFLD5l8AneG7vvUxi', 'Sasha M.',       'https://i.pravatar.cc/150?img=47', 'student', true, true, 'Year 10', 'Senior Secondary',   'Westwood Academy', '{"English Literature","History","Geography"}',          now(), now()),
  ('22222222-0002-0001-0001-000000000008', 'devon@student.akoro.app',      'devon_r',        '$2b$12$TJjxzapE6iKaHCE93yvHbeQqlUv.inK60Fv3rK9XINl7xOcq2BHrC', 'Devon R.',       'https://i.pravatar.cc/150?img=33', 'student', true, true, 'Year 11', 'Senior Secondary',   'Westwood Academy', '{"English Language","Mathematics","Economics"}',        now(), now()),

  -- Students — Riverside High  (password = FirstName2026)
  ('22222222-0002-0002-0001-000000000001', 'ngozi@student.akoro.app',      'ngozi_a',        '$2b$12$KOwb2FsmPuudErnbzuUFU.MmJ2FqPUPXfH7l0vskjx0bPdxasHUHC', 'Ngozi A.',       'https://i.pravatar.cc/150?img=20', 'student', true, true, 'Year 12', 'Sixth Form / A-Level','Riverside High', '{"Mathematics","Further Mathematics","Chemistry"}',    now(), now()),
  ('22222222-0002-0002-0001-000000000002', 'chukwuemeka@student.akoro.app','chukwuemeka_o',  '$2b$12$2eznKX0GcfqfYYQzzW1.9umO3q6HLFmWocwZD54EyoABXL9MiiU8m', 'Chukwuemeka O.', 'https://i.pravatar.cc/150?img=21', 'student', true, true, 'Year 12', 'Sixth Form / A-Level','Riverside High', '{"Physics","Mathematics","Computer Science"}',          now(), now()),
  ('22222222-0002-0002-0001-000000000003', 'amaka@student.akoro.app',      'amaka_n',        '$2b$12$XssBbzpn8i4Nc6BoDKbapuoU5O7HEUw2nwVtePJG14t0u1VD7HfGW', 'Amaka N.',       'https://i.pravatar.cc/150?img=22', 'student', true, true, 'Year 11', 'Senior Secondary',   'Riverside High', '{"Biology","Chemistry","English Language"}',            now(), now()),
  ('22222222-0002-0002-0001-000000000004', 'emeka@student.akoro.app',      'emeka_c',        '$2b$12$8ihuzrbWCDaacVNIDzAK7u0jNea2B5jtmzTai2mUExBa3qltyBFli',  'Emeka C.',       'https://i.pravatar.cc/150?img=23', 'student', true, true, 'Year 11', 'Senior Secondary',   'Riverside High', '{"Mathematics","Physics","Economics"}',                  now(), now()),
  ('22222222-0002-0002-0001-000000000005', 'tunde@student.akoro.app',      'tunde_b',        '$2b$12$mq/cEyxde9Y77a5UbgGSA.YySMP0Im/BLfgvkdypkslwtJ.8KeNFC',  'Tunde B.',       'https://i.pravatar.cc/150?img=24', 'student', true, true, 'Year 10', 'Senior Secondary',   'Riverside High', '{"History","Government / Civics","English Language"}',  now(), now()),

  -- Students — Summit Prep  (password = FirstName2026)
  ('22222222-0002-0003-0001-000000000001', 'chioma@student.akoro.app',     'chioma_e',       '$2b$12$IQvNnFD9hSzwahgiNzI.kO8Y/y.MlV5skAarsEIgL0zWiv2lg2Zqu', 'Chioma E.',      'https://i.pravatar.cc/150?img=25', 'student', true, true, 'Year 13', 'Sixth Form / A-Level','Summit Prep',   '{"Biology","Chemistry","Mathematics"}',                  now(), now()),
  ('22222222-0002-0003-0001-000000000002', 'ola@student.akoro.app',        'ola_d',          '$2b$12$X9HpRs1.Z7uuqs9Pa15BL.9U/McESr2Kmc0L2ewEZ5pKV4UVogR1i',  'Ola D.',         'https://i.pravatar.cc/150?img=26', 'student', true, true, 'Year 12', 'Sixth Form / A-Level','Summit Prep',   '{"Economics","Mathematics","English Literature"}',       now(), now()),
  ('22222222-0002-0003-0001-000000000003', 'femi@student.akoro.app',       'femi_a',         '$2b$12$cfookozrjlN2V0U2StGOe.gUfbCe9QPzNtXLKJ0Kf5nvYBvOhT9zS',  'Femi A.',        'https://i.pravatar.cc/150?img=27', 'student', true, true, 'Year 13', 'Sixth Form / A-Level','Summit Prep',   '{"Computer Science","Mathematics","Physics"}',           now(), now())
ON CONFLICT (id) DO NOTHING;

-- ─── § 2a. SCHOOLS (inserted after users so admin_user_id FK resolves) ───────

INSERT INTO school_profiles (id, admin_user_id, name, description, website, is_active, created_at, updated_at) VALUES
  ('11111111-0001-0001-0001-000000000001', '22222222-0001-0001-0001-000000000002', 'Westwood Academy',   'Leading STEM-focused secondary school',       'https://westwood.edu',    true, now(), now()),
  ('11111111-0001-0001-0001-000000000002', '22222222-0001-0001-0001-000000000003', 'Riverside High',     'Award-winning arts and sciences school',       'https://riverside.edu',   true, now(), now()),
  ('11111111-0001-0001-0001-000000000003', '22222222-0001-0001-0001-000000000004', 'Summit Prep',        'University prep school with elite results',    'https://summitprep.edu',  true, now(), now()),
  ('11111111-0001-0001-0001-000000000004', '22222222-0001-0001-0001-000000000005', 'Lakeside STEM',      'Specialising in mathematics and computing',    'https://lakeside.edu',    true, now(), now()),
  ('11111111-0001-0001-0001-000000000005', '22222222-0001-0001-0001-000000000007', 'Oakwood Charter',    'Community-led charter school',                 'https://oakwood.edu',     true, now(), now()),
  ('11111111-0001-0001-0001-000000000006', '22222222-0001-0001-0001-000000000006', 'Greenfield IB',      'International Baccalaureate school',           'https://greenfield.edu',  true, now(), now()),
  ('11111111-0001-0001-0001-000000000007', '22222222-0001-0001-0001-000000000006', 'North Valley High',  'Large comprehensive secondary school',         'https://northvalley.edu', true, now(), now()),
  ('11111111-0001-0001-0001-000000000008', '22222222-0001-0001-0001-000000000007', 'Cedar Grove School', 'Friendly neighbourhood secondary',             'https://cedargrove.edu',  true, now(), now())
ON CONFLICT (id) DO NOTHING;

-- ─── § 3. SCHOOL ↔ TEACHER LINKS ─────────────────────────────────────────────

INSERT INTO school_teachers (school_id, teacher_id, created_at) VALUES
  ('11111111-0001-0001-0001-000000000001', '22222222-0001-0001-0001-000000000002', now()),
  ('11111111-0001-0001-0001-000000000001', '22222222-0001-0001-0001-000000000003', now()),
  ('11111111-0001-0001-0001-000000000001', '22222222-0001-0001-0001-000000000006', now()),
  ('11111111-0001-0001-0001-000000000002', '22222222-0001-0001-0001-000000000003', now()),
  ('11111111-0001-0001-0001-000000000002', '22222222-0001-0001-0001-000000000007', now()),
  ('11111111-0001-0001-0001-000000000003', '22222222-0001-0001-0001-000000000004', now()),
  ('11111111-0001-0001-0001-000000000004', '22222222-0001-0001-0001-000000000005', now()),
  ('11111111-0001-0001-0001-000000000005', '22222222-0001-0001-0001-000000000007', now())
ON CONFLICT DO NOTHING;

-- ─── § 4. CLASSROOMS ──────────────────────────────────────────────────────────

INSERT INTO classrooms (id, teacher_id, school_id, name, description, student_limit, is_upgraded, created_at, updated_at) VALUES
  ('33333333-0001-0001-0001-000000000001', '22222222-0001-0001-0001-000000000002', '11111111-0001-0001-0001-000000000001', 'Dr. Amara — A-Level Maths',      'Further Maths & Calculus for Year 12-13',  30, true,  now(), now()),
  ('33333333-0001-0001-0001-000000000002', '22222222-0001-0001-0001-000000000003', '11111111-0001-0001-0001-000000000001', 'Ms. Rivera — GCSE Maths 11',     'Year 11 GCSE Mathematics',                 30, false, now(), now()),
  ('33333333-0001-0001-0001-000000000003', '22222222-0001-0001-0001-000000000004', '11111111-0001-0001-0001-000000000003', 'Mr. Chen — English Language 10', 'Year 10 English Language & Literature',    28, false, now(), now()),
  ('33333333-0001-0001-0001-000000000004', '22222222-0001-0001-0001-000000000005', '11111111-0001-0001-0001-000000000004', 'Dr. Adeyemi — GCSE Science 9',   'Year 9 Combined Science',                  30, false, now(), now()),
  ('33333333-0001-0001-0001-000000000005', '22222222-0001-0001-0001-000000000006', '11111111-0001-0001-0001-000000000001', 'Mr. Okafor — Further Maths 11',  'Year 11 Further Mathematics',              25, true,  now(), now()),
  ('33333333-0001-0001-0001-000000000006', '22222222-0001-0001-0001-000000000007', '11111111-0001-0001-0001-000000000005', 'Mrs. Bello — English 10',        'Year 10 English Language Paper 1 & 2',     28, false, now(), now())
ON CONFLICT (id) DO NOTHING;

-- ─── § 5. CLASSROOM STUDENTS ──────────────────────────────────────────────────

INSERT INTO classroom_students (classroom_id, user_id, status, joined_at) VALUES
  -- Dr. Amara's A-Level Maths
  ('33333333-0001-0001-0001-000000000001', '22222222-0002-0001-0001-000000000001', 'active', now()),
  ('33333333-0001-0001-0001-000000000001', '22222222-0002-0001-0001-000000000002', 'active', now()),
  ('33333333-0001-0001-0001-000000000001', '22222222-0002-0002-0001-000000000001', 'active', now()),
  ('33333333-0001-0001-0001-000000000001', '22222222-0002-0002-0001-000000000002', 'active', now()),
  ('33333333-0001-0001-0001-000000000001', '22222222-0002-0003-0001-000000000001', 'active', now()),
  -- Ms. Rivera GCSE Maths
  ('33333333-0001-0001-0001-000000000002', '22222222-0002-0001-0001-000000000001', 'active', now()),
  ('33333333-0001-0001-0001-000000000002', '22222222-0002-0001-0001-000000000002', 'active', now()),
  ('33333333-0001-0001-0001-000000000002', '22222222-0002-0001-0001-000000000004', 'active', now()),
  ('33333333-0001-0001-0001-000000000002', '22222222-0002-0001-0001-000000000005', 'active', now()),
  ('33333333-0001-0001-0001-000000000002', '22222222-0002-0001-0001-000000000006', 'active', now()),
  ('33333333-0001-0001-0001-000000000002', '22222222-0002-0001-0001-000000000008', 'active', now()),
  -- Mr. Chen English
  ('33333333-0001-0001-0001-000000000003', '22222222-0002-0001-0001-000000000003', 'active', now()),
  ('33333333-0001-0001-0001-000000000003', '22222222-0002-0001-0001-000000000007', 'active', now()),
  ('33333333-0001-0001-0001-000000000003', '22222222-0002-0001-0001-000000000008', 'active', now()),
  ('33333333-0001-0001-0001-000000000003', '22222222-0002-0002-0001-000000000003', 'active', now()),
  -- Dr. Adeyemi Science
  ('33333333-0001-0001-0001-000000000004', '22222222-0002-0001-0001-000000000004', 'active', now()),
  ('33333333-0001-0001-0001-000000000004', '22222222-0002-0002-0001-000000000003', 'active', now()),
  ('33333333-0001-0001-0001-000000000004', '22222222-0002-0002-0001-000000000004', 'active', now()),
  ('33333333-0001-0001-0001-000000000004', '22222222-0002-0003-0001-000000000001', 'active', now()),
  -- Mr. Okafor Further Maths
  ('33333333-0001-0001-0001-000000000005', '22222222-0002-0001-0001-000000000001', 'active', now()),
  ('33333333-0001-0001-0001-000000000005', '22222222-0002-0001-0001-000000000002', 'active', now()),
  ('33333333-0001-0001-0001-000000000005', '22222222-0002-0001-0001-000000000006', 'active', now()),
  ('33333333-0001-0001-0001-000000000005', '22222222-0002-0002-0001-000000000002', 'active', now()),
  -- Mrs. Bello English
  ('33333333-0001-0001-0001-000000000006', '22222222-0002-0001-0001-000000000003', 'active', now()),
  ('33333333-0001-0001-0001-000000000006', '22222222-0002-0001-0001-000000000007', 'active', now()),
  ('33333333-0001-0001-0001-000000000006', '22222222-0002-0002-0001-000000000005', 'active', now())
ON CONFLICT DO NOTHING;

-- ─── § 6. COURSES ─────────────────────────────────────────────────────────────

INSERT INTO courses (id, instructor_id, title, slug, description, course_type, subject, level, is_free, total_students, rating, is_published, published_at, created_at, updated_at) VALUES
  ('44444444-0001-0001-0001-000000000001', '22222222-0001-0001-0001-000000000002', 'Algebra Fundamentals',           'algebra-fundamentals',           'Master single and multi-step equations, quadratics and inequalities.',                        'live',  'Mathematics',       'intermediate', true,  142, 4.8, true, now(), now(), now()),
  ('44444444-0001-0001-0001-000000000002', '22222222-0001-0001-0001-000000000006', 'Further Mathematics — Calculus', 'further-maths-calculus',         'Differentiation, integration and differential equations for A-Level and beyond.',           'live',  'Mathematics',       'advanced',     false, 89,  4.9, true, now(), now(), now()),
  ('44444444-0001-0001-0001-000000000003', '22222222-0001-0001-0001-000000000004', 'Creative Writing',               'creative-writing',               'Explore narrative voice, POV and structure through short story exercises.',                  'live',  'English Language',  'beginner',     true,  105, 4.6, true, now(), now(), now()),
  ('44444444-0001-0001-0001-000000000004', '22222222-0001-0001-0001-000000000004', 'Literature Analysis — GCSE',     'literature-analysis-gcse',       'Deep-dive analysis of key texts: Macbeth, To Kill a Mockingbird, An Inspector Calls.',       'live',  'English Literature','intermediate', false, 97,  4.7, true, now(), now(), now()),
  ('44444444-0001-0001-0001-000000000005', '22222222-0001-0001-0001-000000000005', 'Cell Biology',                   'cell-biology',                   'Compare and contrast cell division, organelles, and cellular processes with lab activities.', 'live',  'Biology',           'intermediate', true,  118, 4.5, true, now(), now(), now()),
  ('44444444-0001-0001-0001-000000000006', '22222222-0001-0001-0001-000000000005', 'Newton''s Laws & Forces',        'newtons-laws-forces',            'Hands-on simulation of inertia, acceleration, and action-reaction pairs.',                   'live',  'Physics',           'intermediate', true,  118, 4.7, true, now(), now(), now()),
  ('44444444-0001-0001-0001-000000000007', '22222222-0001-0001-0001-000000000003', 'Geometry & Proofs',              'geometry-and-proofs',            'SSS, SAS, ASA congruence theorems with two-column proof practice.',                          'live',  'Mathematics',       'intermediate', false, 88,  4.5, true, now(), now(), now()),
  ('44444444-0001-0001-0001-000000000008', '22222222-0001-0001-0001-000000000002', 'Periodic Table Mastery',         'periodic-table-mastery',         'Elements, symbols, atomic numbers and group properties from GCSE to A-Level.',              'video', 'Chemistry',         'beginner',     true,  71,  4.4, true, now(), now(), now())
ON CONFLICT (id) DO NOTHING;

-- ─── § 7. ENROLLMENTS ─────────────────────────────────────────────────────────

INSERT INTO enrollments (id, user_id, course_id, status, progress, enrolled_at) VALUES
  -- Alex Johnson
  ('55555555-0001-0001-0001-000000000001', '22222222-0002-0001-0001-000000000001', '44444444-0001-0001-0001-000000000001', 'active', 68, now()),
  ('55555555-0001-0001-0001-000000000002', '22222222-0002-0001-0001-000000000001', '44444444-0001-0001-0001-000000000006', 'active', 55, now()),
  ('55555555-0001-0001-0001-000000000003', '22222222-0002-0001-0001-000000000001', '44444444-0001-0001-0001-000000000005', 'active', 15, now()),
  -- Jordan M.
  ('55555555-0001-0001-0001-000000000004', '22222222-0002-0001-0001-000000000002', '44444444-0001-0001-0001-000000000001', 'active', 72, now()),
  ('55555555-0001-0001-0001-000000000005', '22222222-0002-0001-0001-000000000002', '44444444-0001-0001-0001-000000000002', 'active', 45, now()),
  -- Priya K.
  ('55555555-0001-0001-0001-000000000006', '22222222-0002-0001-0001-000000000003', '44444444-0001-0001-0001-000000000003', 'active', 42, now()),
  ('55555555-0001-0001-0001-000000000007', '22222222-0002-0001-0001-000000000003', '44444444-0001-0001-0001-000000000004', 'active', 88, now()),
  -- Marcus B.
  ('55555555-0001-0001-0001-000000000008', '22222222-0002-0001-0001-000000000004', '44444444-0001-0001-0001-000000000005', 'active', 60, now()),
  ('55555555-0001-0001-0001-000000000009', '22222222-0002-0001-0001-000000000004', '44444444-0001-0001-0001-000000000008', 'active', 35, now()),
  -- Aaliyah T.
  ('55555555-0001-0001-0001-000000000010', '22222222-0002-0001-0001-000000000005', '44444444-0001-0001-0001-000000000001', 'active', 50, now()),
  ('55555555-0001-0001-0001-000000000011', '22222222-0002-0001-0001-000000000005', '44444444-0001-0001-0001-000000000007', 'active', 30, now()),
  -- Leon S.
  ('55555555-0001-0001-0001-000000000012', '22222222-0002-0001-0001-000000000006', '44444444-0001-0001-0001-000000000006', 'active', 55, now()),
  ('55555555-0001-0001-0001-000000000013', '22222222-0002-0001-0001-000000000006', '44444444-0001-0001-0001-000000000001', 'active', 40, now()),
  -- Devon R.
  ('55555555-0001-0001-0001-000000000014', '22222222-0002-0001-0001-000000000008', '44444444-0001-0001-0001-000000000003', 'active', 25, now()),
  ('55555555-0001-0001-0001-000000000015', '22222222-0002-0001-0001-000000000008', '44444444-0001-0001-0001-000000000001', 'active', 60, now())
ON CONFLICT (id) DO NOTHING;

-- ─── § 8. USER AGENTS (student AI agents) ─────────────────────────────────────

INSERT INTO user_agents (id, user_id, agent_name, agent_emoji, agent_color, agent_bg, total_xp, is_active, created_at, updated_at) VALUES
  ('66666666-0001-0001-0001-000000000001', '22222222-0002-0001-0001-000000000001', 'Nexus',  '🤖', '#E8884A', '#FEF0E6', 2840, true, now(), now()),
  ('66666666-0001-0001-0001-000000000002', '22222222-0002-0001-0001-000000000002', 'Sigma',  '🔺', '#2563EB', '#C8D8E8', 2650, true, now(), now()),
  ('66666666-0001-0001-0001-000000000003', '22222222-0002-0001-0001-000000000003', 'Ada',    '✨', '#7C3AED', '#E4D4F0', 2490, true, now(), now()),
  ('66666666-0001-0001-0001-000000000004', '22222222-0002-0001-0001-000000000004', 'Kira',   '💎', '#9333EA', '#F8E8FF', 2310, true, now(), now()),
  ('66666666-0001-0001-0001-000000000005', '22222222-0002-0001-0001-000000000005', 'Lyra',   '🌙', '#D97706', '#F0E4C8', 2180, true, now(), now()),
  ('66666666-0001-0001-0001-000000000006', '22222222-0002-0001-0001-000000000006', 'Axiom',  '⚡', '#D97706', '#FFF4C8', 1970, true, now(), now()),
  ('66666666-0001-0001-0001-000000000007', '22222222-0002-0001-0001-000000000007', 'Nova',   '🌟', '#059669', '#D4EAD8', 1840, true, now(), now()),
  ('66666666-0001-0001-0001-000000000008', '22222222-0002-0001-0001-000000000008', 'Zeno',   '🌀', '#059669', '#D4EAD8', 1720, true, now(), now()),
  ('66666666-0001-0001-0001-000000000009', '22222222-0002-0002-0001-000000000001', 'Atlas',  '🗺',  '#2563EB', '#DBEAFE', 3100, true, now(), now()),
  ('66666666-0001-0001-0001-000000000010', '22222222-0002-0002-0001-000000000002', 'Orion',  '🔭', '#7C3AED', '#EDE8F8', 2950, true, now(), now()),
  ('66666666-0001-0001-0001-000000000011', '22222222-0002-0002-0001-000000000003', 'Aria',   '🎵', '#EC4899', '#FCE7F3', 2200, true, now(), now()),
  ('66666666-0001-0001-0001-000000000012', '22222222-0002-0002-0001-000000000004', 'Echo',   '🌊', '#0891B2', '#CFFAFE', 2400, true, now(), now()),
  ('66666666-0001-0001-0001-000000000013', '22222222-0002-0003-0001-000000000001', 'Pythia', '🔮', '#7C3AED', '#EDE8F8', 3800, true, now(), now()),
  ('66666666-0001-0001-0001-000000000014', '22222222-0002-0003-0001-000000000002', 'Lumen',  '💡', '#F59E0B', '#FEF3C7', 3200, true, now(), now()),
  ('66666666-0001-0001-0001-000000000015', '22222222-0002-0003-0001-000000000003', 'Vega',   '⭐', '#10B981', '#D1FAE5', 3500, true, now(), now())
ON CONFLICT (id) DO NOTHING;

-- ─── § 9. XP TRANSACTIONS & LEADERBOARD ───────────────────────────────────────

-- XP ledger (classroom scope — Dr. Amara's classroom)
INSERT INTO xp_transactions (id, user_id, classroom_id, reason, amount, created_at) VALUES
  ('77777777-0001-0001-0001-000000000001', '22222222-0002-0001-0001-000000000001', '33333333-0001-0001-0001-000000000001', 'session_complete',   420, now() - interval '30 days'),
  ('77777777-0001-0001-0001-000000000002', '22222222-0002-0001-0001-000000000001', '33333333-0001-0001-0001-000000000001', 'battle_win',         250, now() - interval '20 days'),
  ('77777777-0001-0001-0001-000000000003', '22222222-0002-0001-0001-000000000001', '33333333-0001-0001-0001-000000000001', 'streak_bonus',       120, now() - interval '10 days'),
  ('77777777-0001-0001-0001-000000000004', '22222222-0002-0001-0001-000000000001', '33333333-0001-0001-0001-000000000001', 'teach_agent',        350, now() - interval '5 days'),
  ('77777777-0001-0001-0001-000000000005', '22222222-0002-0001-0001-000000000001', '33333333-0001-0001-0001-000000000001', 'quiz_perfect',       180, now() - interval '2 days'),

  ('77777777-0001-0001-0001-000000000006', '22222222-0002-0001-0001-000000000002', '33333333-0001-0001-0001-000000000001', 'session_complete',   380, now() - interval '28 days'),
  ('77777777-0001-0001-0001-000000000007', '22222222-0002-0001-0001-000000000002', '33333333-0001-0001-0001-000000000001', 'battle_win',         200, now() - interval '18 days'),
  ('77777777-0001-0001-0001-000000000008', '22222222-0002-0001-0001-000000000002', '33333333-0001-0001-0001-000000000001', 'teach_agent',        280, now() - interval '8 days'),

  ('77777777-0001-0001-0001-000000000009', '22222222-0002-0001-0001-000000000003', '33333333-0001-0001-0001-000000000001', 'session_complete',   340, now() - interval '25 days'),
  ('77777777-0001-0001-0001-000000000010', '22222222-0002-0001-0001-000000000003', '33333333-0001-0001-0001-000000000001', 'teach_agent',        260, now() - interval '15 days'),

  ('77777777-0001-0001-0001-000000000011', '22222222-0002-0001-0001-000000000004', '33333333-0001-0001-0001-000000000001', 'session_complete',   300, now() - interval '22 days'),
  ('77777777-0001-0001-0001-000000000012', '22222222-0002-0001-0001-000000000004', '33333333-0001-0001-0001-000000000001', 'battle_win',         180, now() - interval '12 days'),

  ('77777777-0001-0001-0001-000000000013', '22222222-0002-0001-0001-000000000005', '33333333-0001-0001-0001-000000000001', 'session_complete',   320, now() - interval '20 days'),
  ('77777777-0001-0001-0001-000000000014', '22222222-0002-0001-0001-000000000005', '33333333-0001-0001-0001-000000000001', 'teach_agent',        200, now() - interval '7 days'),

  ('77777777-0001-0001-0001-000000000015', '22222222-0002-0001-0001-000000000006', '33333333-0001-0001-0001-000000000001', 'session_complete',   280, now() - interval '18 days'),
  ('77777777-0001-0001-0001-000000000016', '22222222-0002-0001-0001-000000000007', '33333333-0001-0001-0001-000000000001', 'session_complete',   240, now() - interval '15 days'),
  ('77777777-0001-0001-0001-000000000017', '22222222-0002-0001-0001-000000000008', '33333333-0001-0001-0001-000000000001', 'session_complete',   220, now() - interval '12 days')
ON CONFLICT (id) DO NOTHING;

-- Classroom leaderboard cache (Dr. Amara's classroom)
INSERT INTO xp_leaderboard (id, user_id, scope, classroom_id, total_xp, rank, updated_at) VALUES
  ('88888888-0001-0001-0001-000000000001', '22222222-0002-0001-0001-000000000001', 'classroom', '33333333-0001-0001-0001-000000000001', 2840, 1, now()),
  ('88888888-0001-0001-0001-000000000002', '22222222-0002-0001-0001-000000000002', 'classroom', '33333333-0001-0001-0001-000000000001', 2650, 2, now()),
  ('88888888-0001-0001-0001-000000000003', '22222222-0002-0001-0001-000000000003', 'classroom', '33333333-0001-0001-0001-000000000001', 2490, 3, now()),
  ('88888888-0001-0001-0001-000000000004', '22222222-0002-0001-0001-000000000004', 'classroom', '33333333-0001-0001-0001-000000000001', 2310, 4, now()),
  ('88888888-0001-0001-0001-000000000005', '22222222-0002-0001-0001-000000000005', 'classroom', '33333333-0001-0001-0001-000000000001', 2180, 5, now()),
  ('88888888-0001-0001-0001-000000000006', '22222222-0002-0001-0001-000000000006', 'classroom', '33333333-0001-0001-0001-000000000001', 1970, 6, now()),
  ('88888888-0001-0001-0001-000000000007', '22222222-0002-0001-0001-000000000007', 'classroom', '33333333-0001-0001-0001-000000000001', 1840, 7, now()),
  ('88888888-0001-0001-0001-000000000008', '22222222-0002-0001-0001-000000000008', 'classroom', '33333333-0001-0001-0001-000000000001', 1720, 8, now())
ON CONFLICT (id) DO NOTHING;

-- Course leaderboard cache
INSERT INTO xp_leaderboard (id, user_id, scope, course_id, total_xp, rank, updated_at) VALUES
  ('88888888-0002-0001-0001-000000000001', '22222222-0002-0001-0001-000000000001', 'course', '44444444-0001-0001-0001-000000000001', 9820, 1, now()),
  ('88888888-0002-0001-0001-000000000002', '22222222-0002-0001-0001-000000000006', 'course', '44444444-0001-0001-0001-000000000006', 8750, 2, now()),
  ('88888888-0002-0001-0001-000000000003', '22222222-0002-0001-0001-000000000003', 'course', '44444444-0001-0001-0001-000000000003', 8100, 3, now()),
  ('88888888-0002-0001-0001-000000000004', '22222222-0002-0001-0001-000000000004', 'course', '44444444-0001-0001-0001-000000000005', 7640, 4, now()),
  ('88888888-0002-0001-0001-000000000005', '22222222-0002-0001-0001-000000000005', 'course', '44444444-0001-0001-0001-000000000007', 6980, 5, now()),
  ('88888888-0002-0001-0001-000000000006', '22222222-0002-0001-0001-000000000003', 'course', '44444444-0001-0001-0001-000000000004', 6320, 6, now()),
  ('88888888-0002-0001-0001-000000000007', '22222222-0002-0001-0001-000000000004', 'course', '44444444-0001-0001-0001-000000000005', 5890, 7, now()),
  ('88888888-0002-0001-0001-000000000008', '22222222-0002-0001-0001-000000000008', 'course', '44444444-0001-0001-0001-000000000003', 5410, 8, now())
ON CONFLICT (id) DO NOTHING;

-- ─── § 10. QUESTION BANK ──────────────────────────────────────────────────────

INSERT INTO question_bank (id, question_text, options, correct_answer, topic, difficulty, subject, xp_value, created_by) VALUES
  -- Algebra
  ('99999999-0001-0001-0001-000000000001', 'Solve for x: 3x + 7 = 22',                    '["x = 3","x = 4","x = 5","x = 6"]',                                              'x = 5',                    'Algebra',       'medium', 'Mathematics', 30, '22222222-0001-0001-0001-000000000002'),
  ('99999999-0001-0001-0001-000000000002', 'Solve for x: 5x − 3 = 22',                    '["x = 4","x = 5","x = 3","x = 6"]',                                              'x = 5',                    'Algebra',       'medium', 'Mathematics', 30, '22222222-0001-0001-0001-000000000002'),
  ('99999999-0001-0001-0001-000000000003', 'Factorise: x² + 5x + 6',                      '["(x+2)(x+3)","(x+1)(x+6)","(x+2)(x+4)","(x+3)(x+4)"]',                          '(x+2)(x+3)',               'Quadratic',     'medium', 'Mathematics', 40, '22222222-0001-0001-0001-000000000002'),
  ('99999999-0001-0001-0001-000000000004', 'Expand: (x + 3)²',                            '["x² + 9","x² + 6x + 9","x² + 3x + 9","x² + 6x + 6"]',                           'x² + 6x + 9',              'Algebra',       'medium', 'Mathematics', 35, '22222222-0001-0001-0001-000000000002'),
  ('99999999-0001-0001-0001-000000000005', 'Solve simultaneously: x + y = 10, x − y = 2', '["x=6,y=4","x=7,y=3","x=5,y=5","x=8,y=2"]',                                      'x=6,y=4',                  'Simultaneous',  'hard',   'Mathematics', 45, '22222222-0001-0001-0001-000000000002'),
  -- Geometry
  ('99999999-0001-0001-0002-000000000001', 'Area of a triangle with base 8 and height 5?', '["20","40","25","16"]',                                                           '20',                       'Area',          'easy',   'Mathematics', 25, '22222222-0001-0001-0001-000000000003'),
  ('99999999-0001-0001-0002-000000000002', 'Sum of interior angles of a pentagon?',         '["360°","540°","480°","720°"]',                                                   '540°',                     'Polygons',      'medium', 'Mathematics', 35, '22222222-0001-0001-0001-000000000003'),
  ('99999999-0001-0001-0002-000000000003', 'Hypotenuse of a right triangle with legs 3 and 4?', '["5","6","7","√7"]',                                                         '5',                        'Pythagoras',    'easy',   'Mathematics', 35, '22222222-0001-0001-0001-000000000003'),
  ('99999999-0001-0001-0002-000000000004', 'Volume of a cube with side 4?',                '["16","32","48","64"]',                                                            '64',                       'Volume',        'easy',   'Mathematics', 30, '22222222-0001-0001-0001-000000000003'),
  -- Calculus
  ('99999999-0001-0001-0003-000000000001', 'Find dy/dx if y = sin(3x² + 2x)',              '["cos(3x² + 2x)","(6x + 2)cos(3x² + 2x)","sin(6x + 2)","−cos(3x² + 2x)"]',      '(6x + 2)cos(3x² + 2x)',   'Chain Rule',    'hard',   'Mathematics', 40, '22222222-0001-0001-0001-000000000006'),
  ('99999999-0001-0001-0003-000000000002', 'Integrate ∫ 3x² dx',                          '["6x + C","x³ + C","x³","3x³ + C"]',                                              'x³ + C',                   'Integration',   'medium', 'Mathematics', 30, '22222222-0001-0001-0001-000000000006'),
  ('99999999-0001-0001-0003-000000000003', 'What is lim(x→0) sin(x)/x?',                  '["0","∞","1","Undefined"]',                                                        '1',                        'Limits',        'hard',   'Mathematics', 35, '22222222-0001-0001-0001-000000000006'),
  ('99999999-0001-0001-0003-000000000004', 'Derivative of ln(x)?',                        '["x","1/x","e^x","ln(x)/x"]',                                                     '1/x',                      'Differentiation','medium','Mathematics', 30, '22222222-0001-0001-0001-000000000006'),
  -- Vocabulary
  ('99999999-0001-0001-0004-000000000001', 'What does ''ephemeral'' mean?',                '["Permanent","Short-lived","Ancient","Enormous"]',                                 'Short-lived',              'Vocabulary',    'medium', 'English Language', 30, '22222222-0001-0001-0001-000000000004'),
  ('99999999-0001-0001-0004-000000000002', '''Ubiquitous'' means?',                        '["Rare","Present everywhere","Ancient","Invisible"]',                              'Present everywhere',       'Vocabulary',    'hard',   'English Language', 30, '22222222-0001-0001-0001-000000000004'),
  ('99999999-0001-0001-0004-000000000003', '''Loquacious'' means?',                        '["Silent","Fearful","Talkative","Wise"]',                                          'Talkative',                'Vocabulary',    'medium', 'English Language', 30, '22222222-0001-0001-0001-000000000004'),
  ('99999999-0001-0001-0004-000000000004', 'Antonym of ''verbose'' is?',                   '["Wordy","Lengthy","Concise","Repetitive"]',                                       'Concise',                  'Antonyms',      'medium', 'English Language', 35, '22222222-0001-0001-0001-000000000004'),
  -- Grammar
  ('99999999-0001-0001-0005-000000000001', 'Which sentence is correct?',                   '["She don''t like it.","She doesn''t likes it.","She doesn''t like it.","She not like it."]', 'She doesn''t like it.', 'Grammar', 'easy', 'English Language', 25, '22222222-0001-0001-0001-000000000007'),
  ('99999999-0001-0001-0005-000000000002', 'Which is passive voice?',                      '["The dog bit the man.","The man bit the dog.","The man was bitten.","The dog bites."]',     'The man was bitten.',   'Voice',    'medium', 'English Language', 40, '22222222-0001-0001-0001-000000000007'),
  -- Biology
  ('99999999-0001-0001-0006-000000000001', 'What is the primary product of photosynthesis?', '["Oxygen","Glucose","Carbon dioxide","Water"]',                                  'Glucose',                  'Photosynthesis','easy',   'Biology', 25, '22222222-0001-0001-0001-000000000005'),
  ('99999999-0001-0001-0006-000000000002', 'How many chromosomes does a human cell have?',   '["23","46","48","44"]',                                                           '46',                       'Genetics',      'easy',   'Biology', 25, '22222222-0001-0001-0001-000000000005'),
  ('99999999-0001-0001-0006-000000000003', 'Mitosis produces how many daughter cells?',      '["1","2","3","4"]',                                                               '2',                        'Cell Division', 'medium', 'Biology', 30, '22222222-0001-0001-0001-000000000005'),
  -- Physics / Newton
  ('99999999-0001-0001-0007-000000000001', 'Newton''s 1st Law is called?',                  '["Law of Acceleration","Law of Inertia","Law of Action-Reaction","Law of Gravity"]', 'Law of Inertia',         'Newton''s Laws','easy',   'Physics', 25, '22222222-0001-0001-0001-000000000005'),
  ('99999999-0001-0001-0007-000000000002', 'Force = ?',                                     '["mass × velocity","mass × acceleration","weight × speed","mass × distance"]',    'mass × acceleration',      'Equations',     'easy',   'Physics', 30, '22222222-0001-0001-0001-000000000005'),
  ('99999999-0001-0001-0007-000000000003', 'Mass 4kg, accel 5m/s². Force?',                 '["20 N","9 N","1.25 N","25 N"]',                                                   '20 N',                     'F=ma',          'medium', 'Physics', 40, '22222222-0001-0001-0001-000000000005'),
  -- Chemistry
  ('99999999-0001-0001-0008-000000000001', 'Chemical symbol for Gold?',                     '["Go","Gd","Au","Ag"]',                                                            'Au',                       'Elements',      'easy',   'Chemistry', 30, '22222222-0001-0001-0001-000000000002'),
  ('99999999-0001-0001-0008-000000000002', 'Atomic number of Carbon?',                      '["6","8","12","14"]',                                                              '6',                        'Elements',      'easy',   'Chemistry', 25, '22222222-0001-0001-0001-000000000002'),
  ('99999999-0001-0001-0008-000000000003', 'Symbol for Sodium?',                            '["So","Sd","Sn","Na"]',                                                            'Na',                       'Elements',      'easy',   'Chemistry', 30, '22222222-0001-0001-0001-000000000002'),
  ('99999999-0001-0001-0008-000000000004', 'Highest electronegativity?',                    '["Oxygen","Nitrogen","Chlorine","Fluorine"]',                                      'Fluorine',                 'Properties',    'hard',   'Chemistry', 40, '22222222-0001-0001-0001-000000000002')
ON CONFLICT (id) DO NOTHING;

-- ─── § 11. BATTLES ────────────────────────────────────────────────────────────

INSERT INTO battles (id, course_id, challenger_id, opponent_id, battle_type, subject, title, description, xp_prize, time_limit, difficulty, status, viewers, started_at, created_at, updated_at) VALUES
  ('aaaaaaaa-0001-0001-0001-000000000001',
    '44444444-0001-0001-0001-000000000001',
    '22222222-0002-0001-0001-000000000001',
    '22222222-0002-0001-0001-000000000002',
    'standard', 'Mathematics', 'Speed Algebra Duel',
    '10 linear equations. First to finish with 100% accuracy wins.',
    250, 15, 'hard', 'live', 14,
    now() - interval '6 minutes', now(), now()),
  ('aaaaaaaa-0001-0001-0001-000000000002',
    '44444444-0001-0001-0001-000000000003',
    '22222222-0002-0001-0001-000000000003',
    '22222222-0002-0001-0001-000000000008',
    'standard', 'English Language', 'Vocabulary Blitz',
    '50 vocab words from the SAT prep list.',
    180, 10, 'medium', 'completed', 0,
    now() - interval '1 hour', now(), now()),
  ('aaaaaaaa-0001-0001-0001-000000000003',
    '44444444-0001-0001-0001-000000000008',
    '22222222-0002-0001-0001-000000000004',
    '22222222-0002-0002-0001-000000000001',
    'standard', 'Chemistry', 'Periodic Table Sprint',
    'Name the element, symbol, and atomic number from 20 random prompts.',
    200, 12, 'hard', 'scheduled', 0,
    now() + interval '1 day', now(), now()),
  ('aaaaaaaa-0001-0001-0001-000000000004',
    '44444444-0001-0001-0001-000000000002',
    '22222222-0001-0001-0001-000000000002',
    null,
    'classroom', 'Mathematics', 'Calculus Class Championship',
    'Teacher''s agent Pythia challenges the entire class. Highest score wins the XP pool.',
    500, 20, 'hard', 'live', 18,
    now() - interval '4 minutes', now(), now()),

  -- ─── CHALLENGES (incoming challenge requests) ────────────────────────────────
  ('aaaaaaaa-0001-0001-0001-000000000005',
    '44444444-0001-0001-0001-000000000001',
    '22222222-0002-0001-0001-000000000002',
    '22222222-0002-0001-0001-000000000001',
    'immediate', 'Mathematics', 'Speed Algebra Duel',
    'Jordan M. has challenged you! 10 linear equations. First to finish with 100% accuracy wins.',
    250, 15, 'hard', 'scheduled', 0,
    null, now(), now()),
  ('aaaaaaaa-0001-0001-0001-000000000006',
    '44444444-0001-0001-0001-000000000003',
    '22222222-0002-0001-0001-000000000003',
    '22222222-0002-0001-0001-000000000001',
    'immediate', 'English Language', 'Vocabulary Blitz',
    'Priya K. has challenged you! 50 SAT vocab words. Match definitions against the clock.',
    180, 10, 'medium', 'scheduled', 0,
    null, now(), now()),
  ('aaaaaaaa-0001-0001-0001-000000000007',
    '44444444-0001-0001-0001-000000000008',
    '22222222-0002-0001-0001-000000000004',
    '22222222-0002-0001-0001-000000000001',
    'scheduled', 'Chemistry', 'Periodic Table Sprint',
    'Marcus B. has scheduled a challenge! Name the element, symbol, and atomic number.',
    200, 12, 'hard', 'scheduled', 0,
    now() + interval '1 day 16 hours', now(), now()),
  ('aaaaaaaa-0001-0001-0001-000000000008',
    '44444444-0001-0001-0001-000000000002',
    '22222222-0002-0002-0001-000000000003',
    '22222222-0002-0001-0001-000000000001',
    'scheduled', 'Mathematics', 'Geometry Quick-Fire',
    'Aaliyah T. challenges you this Saturday! 20 geometry problems, shapes and proofs.',
    160, 10, 'medium', 'scheduled', 0,
    now() + interval '6 days 10 hours', now(), now()),
  ('aaaaaaaa-0001-0001-0001-000000000009',
    '44444444-0001-0001-0001-000000000007',
    '22222222-0002-0001-0001-000000000006',
    '22222222-0002-0001-0001-000000000001',
    'immediate', 'Physics', 'Newton''s Laws Blitz',
    'Leon S. is waiting! Identify the correct law for each scenario in under 90 seconds.',
    220, 12, 'hard', 'scheduled', 0,
    null, now(), now()),
  ('aaaaaaaa-0001-0001-0001-000000000010',
    '44444444-0001-0001-0001-000000000003',
    '22222222-0002-0001-0001-000000000008',
    '22222222-0002-0001-0001-000000000001',
    'scheduled', 'English Language', 'Grammar Gauntlet',
    'Devon R. challenges you Sunday afternoon! Identify and correct grammar errors.',
    140, 8, 'easy', 'scheduled', 0,
    now() + interval '7 days 14 hours', now(), now()),
  ('aaaaaaaa-0001-0001-0001-000000000011',
    '44444444-0001-0001-0001-000000000002',
    '22222222-0001-0001-0001-000000000002',
    null,
    'classroom', 'Mathematics', 'Calculus Class Championship',
    'Dr. Amara challenges the entire class to a calculus showdown. Highest score wins the XP pool.',
    500, 20, 'hard', 'scheduled', 0,
    now() + interval '2 days 9 hours', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Battle participants
INSERT INTO battle_participants (id, battle_id, participant_id, agent_name, agent_emoji, agent_bg, agent_color, is_you, score, hp, started_at) VALUES
  ('bbbbbbbb-0001-0001-0001-000000000001', 'aaaaaaaa-0001-0001-0001-000000000001', '22222222-0002-0001-0001-000000000001', 'Nexus', '🤖', '#FEF0E6', '#E8884A', true,  6, 62, now() - interval '6 minutes'),
  ('bbbbbbbb-0001-0001-0001-000000000002', 'aaaaaaaa-0001-0001-0001-000000000001', '22222222-0002-0001-0001-000000000002', 'Sigma', '🔺', '#C8D8E8', '#2563EB', false, 4, 78, now() - interval '6 minutes'),
  ('bbbbbbbb-0001-0001-0001-000000000003', 'aaaaaaaa-0001-0001-0001-000000000002', '22222222-0002-0001-0001-000000000003', 'Ada',   '✨', '#E4D4F0', '#7C3AED', false, 11, 28, now() - interval '1 hour'),
  ('bbbbbbbb-0001-0001-0001-000000000004', 'aaaaaaaa-0001-0001-0001-000000000002', '22222222-0002-0001-0001-000000000008', 'Zeno',  '🌀', '#D4EAD8', '#059669', true,  9, 0,  now() - interval '1 hour'),
  ('bbbbbbbb-0001-0001-0001-000000000005', 'aaaaaaaa-0001-0001-0001-000000000003', '22222222-0002-0001-0001-000000000004', 'Kira',  '💎', '#F8E8FF', '#9333EA', false, 0, 100, now() + interval '1 day'),
  ('bbbbbbbb-0001-0001-0001-000000000006', 'aaaaaaaa-0001-0001-0001-000000000003', '22222222-0002-0002-0001-000000000001', 'Atlas', '🗺',  '#DBEAFE', '#2563EB', false, 0, 100, now() + interval '1 day'),
  ('bbbbbbbb-0001-0001-0001-000000000007', 'aaaaaaaa-0001-0001-0001-000000000004', '22222222-0001-0001-0001-000000000002', 'Pythia','🔮', '#EDE8F8', '#7C3AED', false, 8, 72, now() - interval '4 minutes'),
  ('bbbbbbbb-0001-0001-0001-000000000008', 'aaaaaaaa-0001-0001-0001-000000000004', '22222222-0002-0001-0001-000000000001', 'Nexus', '🤖', '#FEF0E6', '#E8884A', true,  5, 85, now() - interval '4 minutes'),
  ('bbbbbbbb-0001-0001-0001-000000000009', 'aaaaaaaa-0001-0001-0001-000000000004', '22222222-0002-0001-0001-000000000003', 'Ada',   '✨', '#E4D4F0', '#7C3AED', false, 7, 70, now() - interval '4 minutes'),
  ('bbbbbbbb-0001-0001-0001-000000000010', 'aaaaaaaa-0001-0001-0001-000000000004', '22222222-0002-0001-0001-000000000002', 'Sigma', '🔺', '#C8D8E8', '#2563EB', false, 4, 90, now() - interval '4 minutes'),
  ('bbbbbbbb-0001-0001-0001-000000000011', 'aaaaaaaa-0001-0001-0001-000000000004', '22222222-0002-0002-0001-000000000004', 'Echo',  '🌊', '#CFFAFE', '#0891B2', false, 6, 78, now() - interval '4 minutes'),
  ('bbbbbbbb-0001-0001-0001-000000000012', 'aaaaaaaa-0001-0001-0001-000000000004', '22222222-0002-0002-0001-000000000001', 'Atlas', '🗺',  '#DBEAFE', '#2563EB', false, 3, 94, now() - interval '4 minutes')
ON CONFLICT (id) DO NOTHING;

-- ─── § 12. NOTIFICATIONS (sample) ─────────────────────────────────────────────

INSERT INTO notifications (id, user_id, type, title, content, is_read, created_at) VALUES
  ('cccccccc-0001-0001-0001-000000000001', '22222222-0002-0001-0001-000000000001', 'battle_challenge', 'New Battle Challenge!',   'Jordan M. has challenged you to a Speed Algebra Duel! Expires in 8 minutes.',    false, now() - interval '2 minutes'),
  ('cccccccc-0001-0001-0001-000000000002', '22222222-0002-0001-0001-000000000001', 'xp_earned',        'XP Earned!',              'You earned 250 XP for winning the Algebra Duel.',                                   true,  now() - interval '1 day'),
  ('cccccccc-0001-0001-0001-000000000003', '22222222-0002-0001-0001-000000000001', 'session_reminder', 'Session starting soon',   'Biology: Ecosystems starts in 8 minutes.',                                          false, now() - interval '5 minutes'),
  ('cccccccc-0001-0001-0001-000000000004', '22222222-0002-0001-0001-000000000002', 'battle_challenge', 'New Challenge!',          'Leon S. challenged you to Newton''s Laws Blitz! Expires in 3 minutes.',             false, now() - interval '1 minute'),
  ('cccccccc-0001-0001-0001-000000000005', '22222222-0002-0001-0001-000000000003', 'announcement',     'New Announcement',        'Mr. Chen posted: "Creative Writing assessment moved to Friday — check resources."', false, now() - interval '30 minutes')
ON CONFLICT (id) DO NOTHING;

-- =============================================================
-- END OF SEED
-- =============================================================
-- Summary:
--   8  schools
--   23 users  (1 admin, 6 instructors, 16 students across 3 schools)
--   6  classrooms
--   8  courses
--   15 enrollments
--   15 student AI agents
--   17 XP transactions
--   16 leaderboard entries (classroom + course)
--   29 question bank entries (Algebra, Geometry, Calculus, Vocab, Grammar, Biology, Physics, Chemistry)
--   4  battles (2 live, 1 completed, 1 scheduled)
--   12 battle participants
--   5  notifications
-- =============================================================
