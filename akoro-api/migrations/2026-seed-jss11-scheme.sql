-- =============================================================
-- 2026-seed-jss11-scheme.sql  —  demo group (auto-runs on deploy)
--
-- Full week-by-week SCHEME OF WORK for JSS 11 in mgmt.scheme_of_work — the
-- table the school "Academics → Scheme of Work" UI reads (term + week +
-- objectives/activities/resources). 13 teaching weeks × 3 terms × 6 subjects
-- = 234 weekly rows, so full-testing has a complete term plan, not just a few
-- topics. Status varies by term for realistic testing:
--   First Term = completed, Second Term = ongoing, Third Term = planned.
--
-- Scheme of work is CLASS-scoped (no section column), so one plan covers every
-- JSS 11 section. Runs after the all-sections seed. Idempotent: the whole
-- JSS 11 scheme is rebuilt on each deploy. Fail-safe: skips if the class or a
-- subject is absent.
--
-- Reversible: 2026-teardown-jss11-all-sections.sql clears the JSS 11 scheme.
-- =============================================================
DO $$
DECLARE
  v_email  text := 'stu.jss11@demo.akoro.app';
  v_user   uuid;
  v_school uuid;
  v_class  uuid;
  v_plan   jsonb;
  elem     jsonb;
  wk       jsonb;
  v_subj   uuid;
  v_week   int;
  v_status text;
  v_topic  text;
  v_inserted int := 0;
BEGIN
  -- Resolve the same school as the demo/all-sections seed.
  SELECT id INTO v_user FROM public.users WHERE lower(email) = lower(v_email);
  IF v_user IS NOT NULL THEN
    SELECT c.school_id INTO v_school
    FROM public.classroom_students cs JOIN public.classrooms c ON c.id = cs.classroom_id
    WHERE cs.user_id = v_user AND c.school_id IS NOT NULL LIMIT 1;
  END IF;
  IF v_school IS NULL THEN SELECT id INTO v_school FROM public.school_profiles ORDER BY created_at LIMIT 1; END IF;
  IF v_school IS NULL THEN RAISE NOTICE 'No school found — skipping JSS 11 scheme seed.'; RETURN; END IF;

  SELECT id INTO v_class FROM mgmt.classes WHERE school_id = v_school AND name = 'JSS 11' LIMIT 1;
  IF v_class IS NULL THEN RAISE NOTICE 'No JSS 11 class — skipping scheme seed.'; RETURN; END IF;

  -- Rebuild the class scheme cleanly.
  DELETE FROM mgmt.scheme_of_work WHERE class_id = v_class;

  -- Curriculum plan: 13 topics per term per subject. `subject` matches the
  -- subject name (school_id + name is unique) so ids resolve per school.
  v_plan := $json$
  [
    {"subject":"Mathematics","term":"First Term","topics":["Whole numbers & place value","LCM and HCF","Fractions","Decimals and approximation","Number bases (base 2 and 10)","Basic operations on number bases","Factors, multiples and prime numbers","Squares and square roots","Ratio and proportion","Rates and speed","Percentages","Revision","Examination"]},
    {"subject":"Mathematics","term":"Second Term","topics":["Algebraic expressions","Simplification of algebraic expressions","Substitution in algebra","Simple equations","Word problems on equations","Directed numbers (integers)","Operations on integers","Plane figures and their properties","Angles","Construction of angles","Perimeter of plane shapes","Revision","Examination"]},
    {"subject":"Mathematics","term":"Third Term","topics":["Area of plane shapes","Volume of solids","Statistics: data collection","Frequency tables","Bar charts and pictograms","Pie charts","Mean, median and mode","Probability (introduction)","Money and simple interest","Profit and loss","Number sequences","Revision","Examination"]},

    {"subject":"English Language","term":"First Term","topics":["Reading comprehension","Nouns and pronouns","Verbs and tenses","Vowel sounds","Informal letter writing","Adjectives","Summary writing","Consonant sounds","Narrative essay","Adverbs","Comprehension: main ideas","Revision","Examination"]},
    {"subject":"English Language","term":"Second Term","topics":["Prepositions","Conjunctions","Formal letter writing","Descriptive essay","Diphthongs","Direct and indirect speech","Active and passive voice","Comprehension and vocabulary","Punctuation","Argumentative essay","Stress and intonation","Revision","Examination"]},
    {"subject":"English Language","term":"Third Term","topics":["Question tags","Concord (subject-verb agreement)","Article usage","Expository essay","Idioms and proverbs","Comprehension: inference","Report writing","Figures of speech","Literature: prose","Literature: poetry","Summary practice","Revision","Examination"]},

    {"subject":"Biology","term":"First Term","topics":["Introduction to biology","Characteristics of living things","The cell: structure","Cell organelles and functions","Plant vs animal cells","Levels of organisation","Tissues","Organs and systems","Classification of living things","Kingdom Monera and Protista","Kingdom Fungi and Plantae","Revision","Examination"]},
    {"subject":"Biology","term":"Second Term","topics":["Kingdom Animalia","Nutrition in plants (photosynthesis)","Nutrition in animals","Food classes","The digestive system","Respiration","The respiratory system","Transport in plants","The circulatory system","Excretion","The skin","Revision","Examination"]},
    {"subject":"Biology","term":"Third Term","topics":["Reproduction in plants","Reproduction in animals","Growth and development","The ecosystem","Food chains and webs","Habitats","Adaptation","Conservation of natural resources","Environmental pollution","Diseases and pathogens","Personal hygiene","Revision","Examination"]},

    {"subject":"Physics","term":"First Term","topics":["Introduction to physics","Measurement of length","Measurement of mass and time","Fundamental and derived units","Scalars and vectors","Types of motion","Speed and velocity","Acceleration","Distance-time graphs","Force and its effects","Friction","Revision","Examination"]},
    {"subject":"Physics","term":"Second Term","topics":["Density and relative density","Pressure in solids","Pressure in liquids","Work, energy and power","Forms of energy","Energy transformation","Machines: levers","Mechanical advantage","Heat and temperature","Effects of heat","Expansion of solids","Revision","Examination"]},
    {"subject":"Physics","term":"Third Term","topics":["Light: sources and rays","Reflection of light","Plane mirrors","Refraction (introduction)","Sound: production","Propagation of sound","Magnetism","Properties of magnets","Electric charges","Simple electric circuits","Conductors and insulators","Revision","Examination"]},

    {"subject":"Chemistry","term":"First Term","topics":["Introduction to chemistry","Matter and its states","Physical and chemical changes","Particulate nature of matter","Elements, compounds and mixtures","Separation techniques","Filtration and evaporation","Distillation","Chromatography","Atoms, molecules and ions","Symbols and formulae","Revision","Examination"]},
    {"subject":"Chemistry","term":"Second Term","topics":["Atomic structure","Electron configuration","The periodic table (introduction)","Metals and non-metals","Chemical combination","Writing chemical equations","Acids and their properties","Bases and alkalis","Salts","Indicators and pH","Neutralisation","Revision","Examination"]},
    {"subject":"Chemistry","term":"Third Term","topics":["Air and its composition","Oxygen: preparation and uses","Carbon dioxide","Water: properties","Hardness of water","Water treatment","Rusting and its prevention","Combustion","Hydrocarbons (introduction)","Chemistry in everyday life","Laboratory safety","Revision","Examination"]},

    {"subject":"Geography","term":"First Term","topics":["Introduction to geography","The Earth in the solar system","Shape and size of the Earth","Rotation and revolution","Latitude and longitude","Maps: types and uses","Map reading and scale","Directions and bearings","The Earth's structure","Rocks and rock types","Landforms","Revision","Examination"]},
    {"subject":"Geography","term":"Second Term","topics":["Weather and climate","Elements of weather","Weather instruments","The atmosphere","Rainfall and its types","Vegetation belts","Rivers and drainage","Erosion and deposition","Soil formation","Soil types and uses","Environmental hazards","Revision","Examination"]},
    {"subject":"Geography","term":"Third Term","topics":["Population","Settlement types","Rural and urban settlement","Agriculture in Nigeria","Farming systems","Mineral resources of Nigeria","Industries","Transportation","Trade and commerce","Map of Nigeria: states","Environmental conservation","Revision","Examination"]}
  ]
  $json$::jsonb;

  FOR elem IN SELECT * FROM jsonb_array_elements(v_plan)
  LOOP
    SELECT id INTO v_subj FROM mgmt.subjects
      WHERE school_id = v_school AND name = (elem->>'subject') LIMIT 1;
    IF v_subj IS NULL THEN CONTINUE; END IF;  -- subject not present; skip

    v_status := CASE elem->>'term'
                  WHEN 'First Term'  THEN 'completed'
                  WHEN 'Second Term' THEN 'ongoing'
                  ELSE 'planned' END;

    v_week := 0;
    FOR wk IN SELECT * FROM jsonb_array_elements(elem->'topics')
    LOOP
      v_week := v_week + 1;
      v_topic := wk #>> '{}';
      INSERT INTO mgmt.scheme_of_work
        (school_id, class_id, subject_id, term, week, topic, objectives, activities, resources, status)
      VALUES (
        v_school, v_class, v_subj, elem->>'term', 'Week ' || v_week, v_topic,
        'By the end of the week, students should understand and apply the key ideas of ' || lower(v_topic) || '.',
        'Teacher-led explanation, worked examples, class discussion and a short exercise.',
        'Recommended textbook, worksheets and the teaching materials attached to this subject.',
        v_status
      );
      v_inserted := v_inserted + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Seeded JSS 11 scheme of work: % weekly rows (13 weeks × 3 terms).', v_inserted;
END $$;
