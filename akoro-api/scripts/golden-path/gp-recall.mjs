// gp-recall.mjs — the agent answers from what its owner taught it.
//
// The thing being replaced: agents used to answer by rolling dice against a
// per-topic confidence number, never reading the question. A learner with pages
// of notes and a learner with none went through identical code; only a number
// differed. So the checks here are about PROVENANCE, not about scores — that
// the notes are what reached the model, that an answer is labelled as recalled
// or guessed, and that a learner who taught their agent nothing does not
// quietly answer as though they had.
//
// The stand-in model cannot judge which option a note supports, so what runs
// here is the plumbing: retrieval, the similarity floor, the guess path, the
// provenance columns. Whether a real model reads a note correctly is a
// different question and belongs to the eval suite, which says so.

import { call, login, check, score } from './golden.mjs';
import pg from 'pg';

const sql = new pg.Client({ host: 'localhost', port: 5433, user: 'postgres', database: 'akoro' });
await sql.connect();

console.log('\n═══ AGENT RECALL ═══\n');

const learner = await login('learner', 'student', 'jss1.mate1@demo.akoro.app', 'Password123!');
const { rows: [me] } = await sql.query('SELECT id FROM users WHERE email = $1', ['jss1.mate1@demo.akoro.app']);

await sql.query(
  `INSERT INTO edu.student_agents (student_id, name) VALUES ($1, 'Recall Probe')
   ON CONFLICT (student_id) DO NOTHING`, [me.id]);
const { rows: [ag] } = await sql.query('SELECT id FROM edu.student_agents WHERE student_id = $1', [me.id]);

await sql.query("DELETE FROM edu.student_knowledge WHERE student_id = $1 AND topic LIKE 'GP Recall%'", [me.id]);

const { recall, recallStrength, answerFromRecall, guess } = await import('../../modules/battle/agentRecall.js');

console.log('· An agent taught nothing knows nothing');
const empty = await recall({ studentId: me.id, embedding: null, topic: 'GP Recall Photosynthesis' });
check('no notes, no recall', empty.length === 0, `${empty.length} notes`);

// The important one. With no notes the agent must NOT produce a considered
// answer — it has to declare that it does not know, so the log can say so and
// the learner can see what to go and teach it.
const blind = await answerFromRecall({
  question: 'What gas do plants take in during photosynthesis?',
  options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'],
  notes: [], userId: me.id,
});
check('and says so rather than answering anyway',
  blind.basis === 'unknown' && blind.index === null, `basis=${blind.basis} index=${blind.index}`);

// A guess is uniform over ALL options including the right one — a learner who
// knows nothing and picks at random does sometimes get it right, and excluding
// the correct option would make "doesn't know" strictly worse than random.
const picks = new Set();
for (let i = 0; i < 200; i++) picks.add(guess(4));
check('a guess can land on any option, including the right one',
  picks.size === 4 && [...picks].every(i => i >= 0 && i < 4), `hit ${picks.size} of 4`);

console.log('\n· Teach it something, and it can be recalled');
await sql.query(
  `INSERT INTO edu.student_knowledge (student_id, agent_id, topic, subject, content, source, confidence, tags)
   VALUES ($1, $2, 'GP Recall Photosynthesis', 'Basic Science',
           'Plants take in carbon dioxide through their leaves and give out oxygen. This happens in the chloroplasts and needs sunlight.',
           'session', 0.8, '{}')`, [me.id, ag.id]);

const taught = await recall({ studentId: me.id, embedding: null, topic: 'GP Recall Photosynthesis' });
check('the note comes back', taught.length === 1, `${taught.length} notes`);
check('and carries the content the learner wrote',
  /carbon dioxide/i.test(taught[0]?.content ?? ''), (taught[0]?.content ?? '').slice(0, 60));

// Topic strings come from whatever generated the question, so the match cannot
// be case-sensitive or most of what the learner wrote is invisible.
const cased = await recall({ studentId: me.id, embedding: null, topic: 'gp recall photosynthesis' });
check('the topic match is not case-sensitive', cased.length === 1, `${cased.length} notes`);

console.log('\n· Battle placeholders are not treated as knowledge');
await sql.query(
  `INSERT INTO edu.student_knowledge (student_id, agent_id, topic, subject, content, source, confidence, tags)
   VALUES ($1, $2, 'GP Recall Fractions', 'Mathematics',
           'Met "GP Recall Fractions" in a battle and answered incorrectly. No notes on this yet.',
           'session', -0.10, '{battle-encounter}')`, [me.id, ag.id]);

const placeholder = await recall({ studentId: me.id, embedding: null, topic: 'GP Recall Fractions' });
// It records that the learner MET the topic, which is a fact about them, not
// knowledge about fractions. Handed over as a note the agent would reason from
// "got this wrong once".
check('an encounter placeholder is not recalled as a note', placeholder.length === 0,
  `${placeholder.length} notes: ${placeholder.map(n => n.content?.slice(0, 30)).join(' | ')}`);

console.log('\n· Recall strength paces the answer, it does not decide it');
const { thinkingTimeMs } = await import('../../modules/battle/agentPlayer.js');
check('nothing recalled scores zero strength', recallStrength([]) === 0, `${recallStrength([])}`);
const strong = recallStrength([{ similarity: 0.9, confidence: 0.9 }]);
const weak   = recallStrength([{ similarity: 0.35, confidence: 0.2 }]);
check('more relevant notes score higher', strong > weak, `${strong.toFixed(2)} vs ${weak.toFixed(2)}`);
// Averaged over samples because the jitter is deliberate — two equally prepared
// agents must not answer on the same tick.
const avg = (s) => Array.from({ length: 200 }, () => thinkingTimeMs(s, 15)).reduce((a, b) => a + b, 0) / 200;
check('a prepared agent answers sooner', avg(strong) < avg(weak),
  `${Math.round(avg(strong))}ms vs ${Math.round(avg(weak))}ms`);
check('but always inside the question clock',
  Array.from({ length: 200 }, () => thinkingTimeMs(Math.random(), 15)).every(ms => ms < 15000), 'all under 15s');

console.log('\n· The dice are gone, not deprecated');
const player = await import('../../modules/battle/agentPlayer.js');
// A probability that produces plausible battle logs is exactly what gets
// quietly reinstated when something is slow or expensive, so its absence is
// worth asserting rather than trusting.
check('no accuracy roll is exported any more',
  !('accuracyFor' in player) && !('chooseAnswer' in player), Object.keys(player).join(', '));

console.log('\n· An answer records where it came from');
const { rows: cols } = await sql.query(
  `SELECT column_name FROM information_schema.columns
   WHERE table_name = 'battle_answers' AND column_name IN ('answer_basis','recalled_topic')`);
check('battle_answers can say recalled or guessed', cols.length === 2,
  cols.map(c => c.column_name).join(', '));

await sql.query("DELETE FROM edu.student_knowledge WHERE student_id = $1 AND topic LIKE 'GP Recall%'", [me.id]);
await sql.end();
score();
process.exit(0);
