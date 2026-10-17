-- =============================================================
-- 2026-seed-sandbox-syllabus.sql  (demo group: the gate SANDBOX only)
-- A small JSS1 Basic Science syllabus so the gate can exercise Study Prep
-- planning end to end (scenario studyprep.plan_completes). Production's
-- syllabus tables are filled by real ingestion (syllabus.js ingestSubject),
-- never by this seed. Idempotent.
-- =============================================================
DO $$
DECLARE v_subject uuid;
BEGIN
  INSERT INTO edu.syllabus_subjects (exam, name, slug, code, source)
  VALUES ('JSS', 'Basic Science', 'basic-science-jss1', 'JSS1-BSC', 'sandbox seed (gate testing only)')
  ON CONFLICT (exam, slug) DO NOTHING;
  SELECT id INTO v_subject FROM edu.syllabus_subjects WHERE exam = 'JSS' AND slug = 'basic-science-jss1';
  IF NOT EXISTS (SELECT 1 FROM edu.syllabus_topics WHERE subject_id = v_subject) THEN
    INSERT INTO edu.syllabus_topics (subject_id, title, sort_order)
    SELECT v_subject, t.title, t.n FROM (VALUES
      (1, 'Living and non-living things'),
      (2, 'Characteristics of living things'),
      (3, 'Family health: hygiene'),
      (4, 'Matter and its states'),
      (5, 'Energy and its forms'),
      (6, 'Measurement: length, mass and time')) AS t(n, title);
  END IF;
END $$;
