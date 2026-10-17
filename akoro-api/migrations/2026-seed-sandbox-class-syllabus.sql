-- =============================================================
-- 2026-seed-sandbox-class-syllabus.sql  (demo group: the gate SANDBOX only)
-- Grand Plan §8.7: Study Prep plans from the learner's OWN class syllabus
-- first. Akoro Demo Academy's JSS2 (tester11-15) gets a Basic Science class
-- syllabus in mgmt.syllabus_items, so the gate's
-- studyprep.class_syllabus_first can check a plan comes from it.
-- Idempotent (only inserts topics the class doesn't have yet).
-- =============================================================
DO $$
DECLARE v_school uuid; v_class uuid; v_subject uuid;
BEGIN
  SELECT id INTO v_school FROM public.school_profiles WHERE name = 'Akoro Demo Academy' LIMIT 1;
  IF v_school IS NULL THEN RETURN; END IF;
  SELECT id INTO v_class FROM mgmt.classes WHERE school_id = v_school AND name = 'JSS2' LIMIT 1;
  IF v_class IS NULL THEN RETURN; END IF;
  INSERT INTO mgmt.subjects (school_id, name, code, subject_type)
  VALUES (v_school, 'Basic Science', 'BSC', 'core')
  ON CONFLICT (school_id, name) DO NOTHING;
  SELECT id INTO v_subject FROM mgmt.subjects WHERE school_id = v_school AND name = 'Basic Science' LIMIT 1;

  INSERT INTO mgmt.syllabus_items (school_id, class_id, subject_id, term, topic, description, status)
  SELECT v_school, v_class, v_subject, t.term, t.topic, t.description, t.status
  FROM (VALUES
    ('First',  'Family Health: Nutrition',         'Classes of food, balanced diet and deficiency diseases.', 'covered'),
    ('First',  'Environmental Conservation',       'Soil erosion, flooding and how communities prevent them.', 'covered'),
    ('First',  'Kinetic and Potential Energy',     'Energy forms, conversion and conservation of energy.',    'pending'),
    ('Second', 'Simple Machines',                  'Levers, pulleys, inclined planes and mechanical advantage.', 'pending'),
    ('Second', 'Thermal Energy',                   'Heat transfer by conduction, convection and radiation.',  'pending'),
    ('Third',  'Drug Abuse',                       'Common abused drugs, their effects and prevention.',      'pending')
  ) AS t(term, topic, description, status)
  WHERE NOT EXISTS (
    SELECT 1 FROM mgmt.syllabus_items s
    WHERE s.school_id = v_school AND s.class_id = v_class AND s.subject_id = v_subject AND s.topic = t.topic
  );
END $$;
