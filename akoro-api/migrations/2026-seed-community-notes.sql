-- Two community notes so the Discover → Contents/Materials feed has real rows
-- in every environment (including a fresh sandbox, where it was empty).
--
-- Paste records, deliberately: their content lives in the row, so the seed
-- needs no storage object and cannot leave a broken card. Idempotent by name.

-- The premium showcase learner's own rows never appear in Discover (premium
-- owners are excluded), so the seed belongs to tester01 instead.
DELETE FROM edu.records
 WHERE kind = 'paste'
   AND name IN ('Cell structure: organelle functions', 'Photosynthesis: light and dark reactions')
   AND user_id = (SELECT id FROM public.users WHERE email = 'stu.jss11@demo.akoro.app');

INSERT INTO edu.records (user_id, kind, name, content, size, private)
SELECT u.id, 'paste', 'Cell structure: organelle functions',
$note$Cell structure — quick reference

Nucleus: holds DNA, controls activity.
Mitochondria: aerobic respiration, ATP.
Ribosomes: protein synthesis (free and on the rough ER).
Rough ER: folds and transports proteins. Smooth ER: lipids, detox.
Golgi: modifies, sorts and packages proteins.
Lysosomes: digestion of waste and worn organelles.
Chloroplasts (plants): photosynthesis.
Vacuole (plants): storage and turgor.
Cell membrane: selective barrier, transport.$note$,
length($note$Cell structure — quick reference

Nucleus: holds DNA, controls activity.
Mitochondria: aerobic respiration, ATP.
Ribosomes: protein synthesis (free and on the rough ER).
Rough ER: folds and transports proteins. Smooth ER: lipids, detox.
Golgi: modifies, sorts and packages proteins.
Lysosomes: digestion of waste and worn organelles.
Chloroplasts (plants): photosynthesis.
Vacuole (plants): storage and turgor.
Cell membrane: selective barrier, transport.$note$), false
FROM public.users u
WHERE u.email = 'tester01@demo.akoro.app'
  AND NOT EXISTS (SELECT 1 FROM edu.records r WHERE r.name = 'Cell structure: organelle functions');

INSERT INTO edu.records (user_id, kind, name, content, size, private)
SELECT u.id, 'paste', 'Photosynthesis: light and dark reactions',
$note$Photosynthesis — the two stages

Light reactions (thylakoid membrane)
- Light splits water: O2 released, electrons energise photosystems.
- Produces ATP and NADPH.

Calvin cycle / light-independent (stroma)
- CO2 fixed by RuBisCO onto RuBP.
- ATP and NADPH reduce the product to triose phosphate.
- Regenerates RuBP; product becomes glucose.

Limiting factors: light intensity, CO2 concentration, temperature.$note$,
length($note$Photosynthesis — the two stages

Light reactions (thylakoid membrane)
- Light splits water: O2 released, electrons energise photosystems.
- Produces ATP and NADPH.

Calvin cycle / light-independent (stroma)
- CO2 fixed by RuBisCO onto RuBP.
- ATP and NADPH reduce the product to triose phosphate.
- Regenerates RuBP; product becomes glucose.

Limiting factors: light intensity, CO2 concentration, temperature.$note$), false
FROM public.users u
WHERE u.email = 'tester01@demo.akoro.app'
  AND NOT EXISTS (SELECT 1 FROM edu.records r WHERE r.name = 'Photosynthesis: light and dark reactions');
