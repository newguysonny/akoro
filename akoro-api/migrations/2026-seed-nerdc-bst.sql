-- =============================================================
-- 2026-seed-nerdc-bst.sql
-- NERDC Basic Science and Technology Curriculum (Revised 2012), Primary 4-6.
--
-- This is the STRUCTURE, taken from the printed table of contents: four
-- curriculum themes, their sub-themes per class, and every topic listed under
-- them with its page in the source document.
--
-- The per-topic detail — performance objectives, content, teacher and student
-- activities, materials and evaluation guide — is NOT here. Those live on the
-- inner pages of the curriculum, which the supplied scan does not include, so every
-- topic is seeded with `detailed = false`. The grounding layer says so out loud
-- rather than letting an agent imply it has read objectives it has never seen.
-- Running the inner pages through POST /api/curriculum/:id/ingest fills them in
-- and flips the flag.
--
-- Idempotent throughout.
-- =============================================================

DO $$
DECLARE
  v_cur uuid;
  v_theme uuid;
  v_sub uuid;
  r RECORD;
BEGIN
  SELECT id INTO v_cur FROM edu.curricula
   WHERE body_slug = 'nerdc' AND title = 'Basic Science and Technology Curriculum' AND edition_year = 2012;

  IF v_cur IS NULL THEN
    INSERT INTO edu.curricula
      (body_slug, title, subject, edition_year, stage, classes, page_count, status, meta)
    VALUES ('nerdc', 'Basic Science and Technology Curriculum', 'Basic Science and Technology',
            2012, 'primary', ARRAY['Primary 4','Primary 5','Primary 6'], 60, 'published',
      jsonb_build_object(
        'publisher', 'Nigerian Educational Research and Development Council (NERDC)',
        'programme', '9-Year Basic Education Curriculum',
        'foreword_by', 'Prof. (Mrs) Ruqayyatu Ahmed Rufa''i, Honourable Minister of Education',
        'preface_by', 'Prof. Godswill Obioma, Executive Secretary, NERDC',
        'integrates', jsonb_build_array('Basic Science', 'Basic Technology',
                                        'Physical and Health Education',
                                        'Information Technology'),
        'detail_source', 'structure from the printed table of contents; per-topic detail pending ingest of the inner pages'))
    RETURNING id INTO v_cur;
  END IF;

  -- ── Themes ────────────────────────────────────────────────
  FOR r IN SELECT * FROM (VALUES
    ('Basic Science', 1),
    ('Basic Technology', 2),
    ('Physical and Health Education', 3),
    ('Information Technology', 4)
  ) AS t(title, ord) LOOP
    INSERT INTO edu.curriculum_themes (curriculum_id, title, sort_order)
    VALUES (v_cur, r.title, r.ord)
    ON CONFLICT (curriculum_id, title) DO NOTHING;
  END LOOP;

  -- ── Sub-themes, per class ─────────────────────────────────
  FOR r IN SELECT * FROM (VALUES
    ('Basic Science', 'Learning About Our Environment', 'Primary 4', 1, 6, 1),
    ('Basic Science', 'Living and Non-Living Things', 'Primary 4', 1, 6, 2),
    ('Basic Technology', 'Understanding Basic Technology', 'Primary 4', 7, 9, 3),
    ('Basic Technology', 'You and Energy', 'Primary 4', 7, 9, 4),
    ('Physical and Health Education', 'Basic Movements', 'Primary 4', 10, 12, 5),
    ('Physical and Health Education', 'Sports and Games', 'Primary 4', 10, 12, 6),
    ('Physical and Health Education', 'Health Education', 'Primary 4', 10, 12, 7),
    ('Information Technology', 'Basic Computer Operations', 'Primary 4', 14, 16, 8),
    ('Information Technology', 'Basic Concepts of IT', 'Primary 4', 14, 16, 9),
    ('Basic Science', 'Learning About Our Environment', 'Primary 5', 17, 23, 10),
    ('Basic Science', 'Living and Non-Living Things', 'Primary 5', 17, 23, 11),
    ('Basic Technology', 'Understanding Basic Technology', 'Primary 5', 24, 28, 12),
    ('Basic Technology', 'You and Energy', 'Primary 5', 24, 28, 13),
    ('Physical and Health Education', 'Basic Movements', 'Primary 5', 29, 34, 14),
    ('Physical and Health Education', 'Sports and Games', 'Primary 5', 29, 34, 15),
    ('Physical and Health Education', 'Health Education', 'Primary 5', 29, 34, 16),
    ('Information Technology', 'Basic Computer Operations', 'Primary 5', 35, 37, 17),
    ('Information Technology', 'Basic Concepts of IT', 'Primary 5', 35, 37, 18),
    ('Basic Science', 'Learning About Our Environment', 'Primary 6', 38, 45, 19),
    ('Physical and Health Education', 'Basic Movement', 'Primary 6', 51, 59, 20),
    ('Physical and Health Education', 'Sports and Games', 'Primary 6', 51, 59, 21),
    ('Physical and Health Education', 'Health Education', 'Primary 6', 51, 59, 22),
    ('Information Technology', 'Basic Computer Operations', 'Primary 6', 59, 60, 23),
    ('Information Technology', 'Basic Concepts of IT', 'Primary 6', 59, 60, 24)
  ) AS s(theme, title, class_label, page_from, page_to, ord) LOOP
    SELECT id INTO v_theme FROM edu.curriculum_themes
     WHERE curriculum_id = v_cur AND title = r.theme;
    IF v_theme IS NOT NULL THEN
      INSERT INTO edu.curriculum_subthemes (theme_id, title, class_label, page_from, page_to, sort_order)
      VALUES (v_theme, r.title, r.class_label, r.page_from, r.page_to, r.ord)
      ON CONFLICT (theme_id, title, class_label) DO NOTHING;
    END IF;
  END LOOP;

  -- ── Topics ────────────────────────────────────────────────
  FOR r IN SELECT * FROM (VALUES
    ('Learning About Our Environment', 'Primary 4', 'Changes in Nature', 1, 1),
    ('Learning About Our Environment', 'Primary 4', 'Our Weather', 1, 2),
    ('Learning About Our Environment', 'Primary 4', 'Safety in Our Environment', 1, 3),
    ('Learning About Our Environment', 'Primary 4', 'Changes in Plants and Animals', 1, 4),
    ('Living and Non-Living Things', 'Primary 4', 'Human Body (The Mouth)', 1, 5),
    ('Living and Non-Living Things', 'Primary 4', 'Water', 1, 6),
    ('Living and Non-Living Things', 'Primary 4', 'Water Cycle', 1, 7),
    ('Living and Non-Living Things', 'Primary 4', 'Measuring Liquids', 1, 8),
    ('Understanding Basic Technology', 'Primary 4', 'Technology and You', 7, 9),
    ('Understanding Basic Technology', 'Primary 4', 'Shape Construction with Paper, Wood or Metal', 7, 10),
    ('Understanding Basic Technology', 'Primary 4', 'Vehicles', 7, 11),
    ('You and Energy', 'Primary 4', 'Forms of Energy', 7, 12),
    ('Basic Movements', 'Primary 4', 'Moving our Body Parts', 10, 13),
    ('Basic Movements', 'Primary 4', 'Moving our Body Parts II', 10, 14),
    ('Sports and Games', 'Primary 4', 'Athletics', 10, 15),
    ('Sports and Games', 'Primary 4', 'Ball Games', 10, 16),
    ('Health Education', 'Primary 4', 'Personal Hygiene', 10, 17),
    ('Health Education', 'Primary 4', 'First Aid and Safety Education', 10, 18),
    ('Health Education', 'Primary 4', 'Safety Education and Accident Prevention', 10, 19),
    ('Basic Computer Operations', 'Primary 4', 'Computer Hardware', 14, 20),
    ('Basic Computer Operations', 'Primary 4', 'Computer Software', 14, 21),
    ('Basic Computer Operations', 'Primary 4', 'Starting Up the Computer', 14, 22),
    ('Basic Computer Operations', 'Primary 4', 'Data and Information', 14, 23),
    ('Basic Concepts of IT', 'Primary 4', 'Common IT Devices', 14, 24),
    ('Learning About Our Environment', 'Primary 5', 'Environmental Changes', 17, 25),
    ('Learning About Our Environment', 'Primary 5', 'Waste and Waste Disposal', 17, 26),
    ('Learning About Our Environment', 'Primary 5', 'Environmental Quality', 17, 27),
    ('Living and Non-Living Things', 'Primary 5', 'The Human Body (The Skeleton)', 17, 28),
    ('Living and Non-Living Things', 'Primary 5', 'Reproduction in Plants', 17, 29),
    ('Living and Non-Living Things', 'Primary 5', 'Rocks', 17, 30),
    ('Living and Non-Living Things', 'Primary 5', 'Acids and Bases', 17, 31),
    ('Understanding Basic Technology', 'Primary 5', 'Materials and Maintenance', 24, 32),
    ('Understanding Basic Technology', 'Primary 5', 'Basic Motor Vehicle Parts (Internal)', 24, 33),
    ('Understanding Basic Technology', 'Primary 5', 'Drawing Instruments', 24, 34),
    ('You and Energy', 'Primary 5', 'Energy Conversion', 24, 35),
    ('You and Energy', 'Primary 5', 'Heat and Temperature', 24, 36),
    ('You and Energy', 'Primary 5', 'Basic Electricity', 24, 37),
    ('You and Energy', 'Primary 5', 'Magnetism', 24, 38),
    ('Basic Movements', 'Primary 5', 'Creative Rhythmic Activities', 29, 39),
    ('Basic Movements', 'Primary 5', 'Athletics', 29, 40),
    ('Basic Movements', 'Primary 5', 'Field Events', 29, 41),
    ('Sports and Games', 'Primary 5', 'Ball Games', 29, 42),
    ('Health Education', 'Primary 5', 'Nutrition', 29, 43),
    ('Health Education', 'Primary 5', 'Diseases', 29, 44),
    ('Health Education', 'Primary 5', 'Drug Education', 29, 45),
    ('Basic Computer Operations', 'Primary 5', 'Computer Games', 35, 46),
    ('Basic Computer Operations', 'Primary 5', 'Care and Protection of Computers', 35, 47),
    ('Basic Concepts of IT', 'Primary 5', 'Internet I', 35, 48),
    ('Learning About Our Environment', 'Primary 6', 'The Solar System', 38, 49),
    ('Learning About Our Environment', 'Primary 6', 'The Earth and its Movements', 38, 50),
    ('Learning About Our Environment', 'Primary 6', 'Changes in Our Climate', 38, 51),
    ('Learning About Our Environment', 'Primary 6', 'Force', 38, 52),
    ('Basic Movement', 'Primary 6', 'Physical Fitness and Body Conditioning', 51, 53),
    ('Sports and Games', 'Primary 6', 'Athletics I', 51, 54),
    ('Sports and Games', 'Primary 6', 'Athletics II', 51, 55),
    ('Sports and Games', 'Primary 6', 'Ball Games', 51, 56),
    ('Sports and Games', 'Primary 6', 'Indigenous Games', 51, 57),
    ('Health Education', 'Primary 6', 'Personal and Environmental Health', 51, 58),
    ('Health Education', 'Primary 6', 'Use of Medicine', 51, 59),
    ('Health Education', 'Primary 6', 'Effects of Drug Abuse', 51, 60),
    ('Basic Computer Operations', 'Primary 6', 'Learning Word Processing With the Computer', 59, 61),
    ('Basic Computer Operations', 'Primary 6', 'Drawing with the Computer', 59, 62),
    ('Basic Computer Operations', 'Primary 6', 'Precautions in the Use of Computers', 59, 63),
    ('Basic Concepts of IT', 'Primary 6', 'Classification: Uses of Common IT Gadgets', 59, 64),
    ('Basic Concepts of IT', 'Primary 6', 'Internet II', 59, 65)
  ) AS t(subtheme, class_label, title, page, ord) LOOP
    SELECT st.id INTO v_sub
      FROM edu.curriculum_subthemes st
      JOIN edu.curriculum_themes th ON th.id = st.theme_id
     WHERE th.curriculum_id = v_cur AND st.title = r.subtheme AND st.class_label = r.class_label
     LIMIT 1;
    IF v_sub IS NOT NULL THEN
      INSERT INTO edu.curriculum_topics
        (curriculum_id, subtheme_id, title, class_label, source_page, detailed, sort_order)
      VALUES (v_cur, v_sub, r.title, r.class_label, r.page, false, r.ord)
      ON CONFLICT (subtheme_id, title) DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- Verify:
-- SELECT th.title AS theme, st.class_label, count(*) AS topics
-- FROM edu.curriculum_topics t
-- JOIN edu.curriculum_subthemes st ON st.id = t.subtheme_id
-- JOIN edu.curriculum_themes th ON th.id = st.theme_id
-- JOIN edu.curricula c ON c.id = th.curriculum_id
-- WHERE c.body_slug = 'nerdc' GROUP BY 1, 2 ORDER BY 2, 1;
