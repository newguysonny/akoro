-- =============================================================
-- 2026-school-modules-catalog.sql
-- The optional school modules become purchasable apps.
--
-- Everything a school needs to run day one stays free and always on:
-- Staff & Teams, Student Information, Academics, the Modules area (courses,
-- battles, tasks, assessments, AI chat, tools), Document Templates, Help
-- Centre, Reports & Analytics and the Apps Center itself. Those have no
-- moduleKey in the sidebar and cannot be switched off.
--
-- The eighteen OPTIONAL modules are listed here as kind='management' rows in
-- the same catalog that already serves agent tools and assets, so they use the
-- purchase, ownership and App Center machinery that exists rather than a
-- parallel one. The catalog `key` is `module-<moduleKey>`, which is what ties a
-- purchase back to the sidebar entry it unlocks.
--
-- `tag` carries the lifecycle status for management rows ('active' | 'soon').
-- The modules whose pages are still stubs are marked 'soon' and priced, but the
-- App Center will not sell a 'soon' app — better than taking money for a screen
-- that isn't built.
--
-- Idempotent: ON CONFLICT (key) refreshes the catalog entry but never touches
-- anyone's purchase.
-- =============================================================

INSERT INTO edu.platform_tools (key, kind, name, description, emoji, tag, price_kobo, audience, sort_order) VALUES
  -- ── Ready to use ─────────────────────────────────────────────────────────
  ('module-fees_collection',      'management', 'Finance & Fees',
   'Fee structures, invoices, collections, receipts and outstanding balances — with parent-facing payment links.', '💰', 'active', 2500000, 'schools', 101),
  ('module-accounts_finance',     'management', 'Accounts',
   'Income and expenditure, chart of accounts, ledgers and financial statements for the whole school.', '🏦', 'active', 2500000, 'schools', 102),
  ('module-front_office',         'management', 'Front Office',
   'Visitors, enquiries, phone log, postal dispatch and admission enquiries at the school gate.', '🚪', 'active', 1200000, 'schools', 103),
  ('module-offline_examinations', 'management', 'Offline Examinations',
   'Exam schedules, seating, marks entry, grading scales, report cards and result publishing.', '📋', 'active', 2500000, 'schools', 104),
  ('module-online_examinations',  'management', 'Online Examinations',
   'Set and run exams online, auto-mark objective papers and release results to students.', '💻', 'active', 2000000, 'schools', 105),
  ('module-cbc_academics',        'management', 'CBC / Competency Academics',
   'Competency-based curriculum: strands, learning outcomes and competency-level reporting.', '🧩', 'active', 1800000, 'schools', 106),
  ('module-human_resource',       'management', 'Human Resource',
   'Staff records, contracts, leave, payroll inputs, appraisals and disciplinary history.', '👥', 'active', 2500000, 'schools', 107),
  ('module-ptm',                  'management', 'Parent–Teacher Meetings',
   'Schedule PTMs, record attendance and remarks, track follow-ups and report on turnout.', '🗓️', 'active', 900000, 'schools', 108),
  ('module-lesson_planner',       'management', 'Lesson Planner',
   'Teachers plan lessons against the scheme of work; leadership reviews, approves and tracks coverage.', '📝', 'active', 1500000, 'schools', 109),
  ('module-digital_evaluation',   'management', 'OSM / Digital Evaluation',
   'On-screen marking: scan scripts, evaluate digitally, moderate and publish — no paper shuffling.', '🖊️', 'active', 2200000, 'schools', 110),
  ('module-qr_attendance',        'management', 'QR Code Attendance',
   'Students and staff check in by scanning a QR code, with live registers and absence reports.', '📱', 'active', 900000, 'schools', 111),
  ('module-communications',       'management', 'Communicate',
   'Notice board, events and holidays, SMS and email broadcasts, and a shared image gallery.', '📣', 'active', 1200000, 'schools', 112),

  -- ── Built but still shells ───────────────────────────────────────────────
  ('module-study_center',         'management', 'Study Center',
   'Syllabus, classwork logbook, resources, homework and live classes in one place for teachers.', '📚', 'soon', 1500000, 'schools', 113),
  ('module-library',              'management', 'Library',
   'Catalogue books, issue and return them, track categories and see who is holding what.', '📖', 'soon', 900000, 'schools', 114),
  ('module-inventory',            'management', 'Inventory',
   'Stock, suppliers, purchase orders, goods receipts, supplier payments and a point of sale.', '📦', 'soon', 2000000, 'schools', 115),
  ('module-transport',            'management', 'Transport',
   'Vehicles, routes, stops, per-student assignment and live tracking of the school run.', '🚌', 'soon', 1800000, 'schools', 116),
  ('module-hostel',               'management', 'Hostel',
   'Rooms, bed allocation, boarders'' movement and hostel-level attendance.', '🛏️', 'soon', 1500000, 'schools', 117),
  ('module-asset_management',     'management', 'Asset Management',
   'Asset register, assignment, depreciation, maintenance, audits and disposals.', '🗄️', 'soon', 1500000, 'schools', 118)
ON CONFLICT (key) DO UPDATE
  SET kind = EXCLUDED.kind, name = EXCLUDED.name, description = EXCLUDED.description,
      emoji = EXCLUDED.emoji, tag = EXCLUDED.tag, price_kobo = EXCLUDED.price_kobo,
      audience = EXCLUDED.audience, sort_order = EXCLUDED.sort_order, updated_at = now();

-- Grandfather every school that already exists.
--
-- These modules were free and visible yesterday. Charging for them retroactively
-- would take working screens away from schools that are mid-term on them, so
-- every school profile created before this migration is granted the twelve
-- ready-to-use modules outright. New schools buy them.
INSERT INTO edu.instructor_tool_access (instructor_id, tool_id, amount_kobo, paystack_ref, paystack_status, access_granted, verified_at)
SELECT s.admin_user_id, t.id, 0, 'GRANDFATHERED-' || s.id || '-' || t.id, 'success', true, now()
FROM public.school_profiles s
CROSS JOIN edu.platform_tools t
WHERE t.kind = 'management'
  AND t.key LIKE 'module-%'
  AND t.tag = 'active'
  AND s.created_at < now()
ON CONFLICT (instructor_id, tool_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- Verify:
-- SELECT key, name, tag, price_kobo/100 AS naira FROM edu.platform_tools
-- WHERE key LIKE 'module-%' ORDER BY sort_order;
