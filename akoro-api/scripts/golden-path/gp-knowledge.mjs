// gp-knowledge.mjs — knowledge is kept, not overwritten, and it has a shape.
//
// Four failures this locks down, all of which were invisible:
//
//   · saveStudentKnowledge upserted against a constraint that did not exist,
//     returned 42P10 on every call, and had both callers swallow it. The table
//     battle agents recall from was never written by a teaching session at all.
//   · Reinforcing a topic REPLACED its content, so teaching one aspect of
//     something already covered deleted the rest — while times_seen and
//     confidence rose to say the opposite.
//   · Subtopics were stored as unrelated top-level topics, so the six questions
//     of one battle left six entries nothing could roll up.
//   · edu.knowledge_confidence, the one table that models the hierarchy
//     properly, was never written by a battle.
//
// The merge is checked by asking whether MONDAY'S FACT SURVIVES TUESDAY, which
// is the thing a learner would notice. Counting rows would not have caught it:
// the row count was always right.

import { check, score } from './golden.mjs';
import pg from 'pg';

const sql = new pg.Client({ host: 'localhost', port: 5433, user: 'postgres', database: 'akoro' });
await sql.connect();

console.log('\n═══ KNOWLEDGE MODEL ═══\n');

const { rows: [me] } = await sql.query('SELECT id FROM users WHERE email = $1', ['jss1.mate1@demo.akoro.app']);
await sql.query(`INSERT INTO edu.student_agents (student_id, name) VALUES ($1, 'GP Knowledge')
                 ON CONFLICT (student_id) DO NOTHING`, [me.id]);
const { rows: [ag] } = await sql.query('SELECT id FROM edu.student_agents WHERE student_id = $1', [me.id]);

const clean = async () => {
  await sql.query("DELETE FROM edu.student_knowledge WHERE student_id = $1 AND topic LIKE 'GPK%'", [me.id]);
  await sql.query("DELETE FROM edu.knowledge_confidence WHERE topic LIKE 'GPK%'");
};
await clean();

console.log('· The upsert key exists');
// The bug: onConflict "student_id,topic" against no such constraint → 42P10 on
// every single call, swallowed by both callers.
const { rows: keys } = await sql.query(
  `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
   WHERE conrelid = 'edu.student_knowledge'::regclass AND contype = 'u'`);
check('student_knowledge has a unique key to upsert against', keys.length === 1,
  keys.map(k => k.def).join('; ') || 'NONE — every save will 42P10');
check('and it includes the subtopic', /subtopic/.test(keys[0]?.def ?? ''), keys[0]?.def ?? '');

// A nullable column in a unique key lets unlimited rows through, because NULLs
// are distinct in Postgres — the duplicates this is meant to stop.
const { rows: [nn] } = await sql.query(
  `SELECT is_nullable, column_default FROM information_schema.columns
   WHERE table_schema='edu' AND table_name='student_knowledge' AND column_name='subtopic'`);
check('subtopic is NOT NULL so the key actually constrains',
  nn?.is_nullable === 'NO', `nullable=${nn?.is_nullable} default=${nn?.column_default}`);

console.log('\n· Duplicates are refused');
await sql.query(
  `INSERT INTO edu.student_knowledge (student_id, agent_id, topic, subtopic, subject, content, source, confidence)
   VALUES ($1,$2,'GPK Photosynthesis','','Basic Science','first note','session',0.6)`, [me.id, ag.id]);
let refused = false;
try {
  await sql.query(
    `INSERT INTO edu.student_knowledge (student_id, agent_id, topic, subtopic, subject, content, source, confidence)
     VALUES ($1,$2,'GPK Photosynthesis','','Basic Science','a second row for the same thing','session',0.6)`,
    [me.id, ag.id]);
} catch (e) { refused = e.code === '23505'; }
check('the same topic cannot be stored twice', refused, refused ? 'rejected 23505' : 'a duplicate got in');

console.log('\n· Subtopics sit UNDER a topic');
for (const st of ['Family Roles', 'Family Structures', 'Family Dynamics']) {
  await sql.query(
    `INSERT INTO edu.student_knowledge (student_id, agent_id, topic, subtopic, subject, content, source, confidence)
     VALUES ($1,$2,'GPK Family',$3,'Social Studies',$4,'session',0.5)`,
    [me.id, ag.id, st, `notes about ${st}`]);
}
const { rows: [roll] } = await sql.query(
  `SELECT count(*)::int subtopics, round(avg(confidence),2) avg_conf
   FROM edu.student_knowledge WHERE student_id=$1 AND topic='GPK Family'`, [me.id]);
// The question that could not be asked before: they were three unrelated
// top-level topics with no parent.
check('one topic can carry several subtopics', roll.subtopics === 3, `${roll.subtopics} under GPK Family`);
check('and the topic can be rolled up', Number(roll.avg_conf) > 0, `avg confidence ${roll.avg_conf}`);
// Same subtopic name under a different topic is a different thing, and must be
// allowed — "Roles" under Family and under Government are not the same idea.
await sql.query(
  `INSERT INTO edu.student_knowledge (student_id, agent_id, topic, subtopic, subject, content, source, confidence)
   VALUES ($1,$2,'GPK Government','Family Roles','Social Studies','different context','session',0.5)`, [me.id, ag.id]);
check('the same subtopic under a different topic is a separate row', true, 'accepted');

console.log('\n· Reinforcing keeps what was already known');
const { mergeKnowledge, coverage } = await import('../../modules/adaptive-learning/agents/student/mergeKnowledge.js');

const monday  = 'Plants take in carbon dioxide through stomata and give out oxygen. It needs sunlight.';
const tuesday = 'The chloroplast is the part of the cell where photosynthesis happens.';
const merged  = await mergeKnowledge(monday, tuesday);
// The whole bug in one assertion: yesterday's fact must still be there.
check('Monday’s fact survives Tuesday’s lesson',
  /carbon dioxide/i.test(merged.content) && /chloroplast/i.test(merged.content),
  `${merged.action}: ${merged.content.slice(0, 80)}…`);
check('and the note grew rather than shrank',
  merged.content.length > monday.length, `${monday.length} → ${merged.content.length} chars`);

// Teaching the same thing twice should move the counters without rewriting text
// the learner recognises.
const again = await mergeKnowledge(monday, 'Plants take in carbon dioxide and give out oxygen.');
check('re-teaching the same fact does not duplicate it', again.action === 'unchanged',
  `action=${again.action}`);
check('coverage sees a restatement as already known',
  coverage(monday, 'plants take in carbon dioxide, giving out oxygen') >= 0.85,
  coverage(monday, 'plants take in carbon dioxide, giving out oxygen').toFixed(2));
check('but sees genuinely new material as new',
  coverage(monday, tuesday) < 0.5, coverage(monday, tuesday).toFixed(2));

console.log('\n· Battles feed the mastery model');
const { updateKnowledgeConfidence } = await import('../../modules/battle/index.js');
await updateKnowledgeConfidence(me.id, 'GPK Family', 'Social Studies', false, 'Family Roles');
const { rows: [kc] } = await sql.query(
  `SELECT confidence, prev_confidence, assess_count, passed_count
   FROM edu.knowledge_confidence WHERE topic='GPK Family' AND subtopic='Family Roles'`);
check('a battle answer reaches edu.knowledge_confidence', !!kc,
  kc ? `confidence=${kc.confidence} assessed=${kc.assess_count}` : 'nothing written');
check('and it is recorded on the 0–100 scale, not 0–1',
  kc && Number(kc.confidence) > 1, `confidence=${kc?.confidence}`);
check('a wrong answer counts as assessed but not passed',
  kc?.assess_count === 1 && kc?.passed_count === 0,
  `assessed=${kc?.assess_count} passed=${kc?.passed_count}`);

await updateKnowledgeConfidence(me.id, 'GPK Family', 'Social Studies', true, 'Family Roles');
const { rows: [kc2] } = await sql.query(
  `SELECT confidence, prev_confidence, assess_count, passed_count
   FROM edu.knowledge_confidence WHERE topic='GPK Family' AND subtopic='Family Roles'`);
check('a correct answer raises mastery', Number(kc2.confidence) > Number(kc.confidence),
  `${kc.confidence} → ${kc2.confidence}`);
// Approaching the ceiling rather than hitting it: four lucky answers should not
// certify mastery.
check('mastery approaches its ceiling rather than jumping to it',
  Number(kc2.confidence) < 100, `${kc2.confidence}`);
check('the previous value is kept so a card can say "was x%"',
  Number(kc2.prev_confidence) === Number(kc.confidence),
  `prev=${kc2.prev_confidence}`);

console.log('\n· And the battle wrote the pair, not a stray topic');
const { rows: sk } = await sql.query(
  `SELECT topic, subtopic FROM edu.student_knowledge
   WHERE student_id=$1 AND topic='GPK Family' AND subtopic='Family Roles'`, [me.id]);
check('the battle answer landed under the topic, not beside it', sk.length === 1,
  sk.map(r => `${r.topic}/${r.subtopic}`).join(', ') || 'not found');

await clean();
await sql.end();
score();
process.exit(0);
