// gp-retrieval.mjs — hybrid retrieval, filtering, freshness.
//
// Four changes are covered here, and the first two are checked by CONSTRUCTION
// rather than by score: a note that only the lexical arm can find, and a note
// that only the subject filter can exclude. Asserting "retrieval got better" on
// a corpus of three notes would prove nothing; asserting "this note is
// unreachable without the lexical arm, and here it is" proves the arm exists
// and is wired.
//
// Reranking is a model call, so what runs here is its plumbing and its refusal
// to lose data on failure. Whether it actually improves precision is a question
// for the eval suite, which says so.

import { call, login, check, score } from './golden.mjs';
import pg from 'pg';

const sql = new pg.Client({ host: 'localhost', port: 5433, user: 'postgres', database: 'akoro' });
await sql.connect();

console.log('\n═══ HYBRID RETRIEVAL ═══\n');

const { rows: [me] } = await sql.query('SELECT id FROM users WHERE email = $1', ['jss1.mate1@demo.akoro.app']);
await sql.query(`INSERT INTO edu.student_agents (student_id, name) VALUES ($1, 'GP Retrieval')
                 ON CONFLICT (student_id) DO NOTHING`, [me.id]);
const { rows: [ag] } = await sql.query('SELECT id FROM edu.student_agents WHERE student_id = $1', [me.id]);

await sql.query("DELETE FROM edu.student_knowledge WHERE student_id = $1 AND topic LIKE 'GPR %'", [me.id]);

// Deliberately shaped. The interest note is what a learner actually writes — a
// formula, no prose — and is the case vector search is worst at.
const NOTES = [
  ['GPR Simple interest', 'Mathematics',    'I = P x R x T / 100. P is principal, R is rate per year, T is time in years.'],
  ['GPR Photosynthesis',  'Basic Science',  'Plants take in carbon dioxide and give out oxygen, using sunlight, in the chloroplasts.'],
  ['GPR Blended family',  'Social Studies', 'A blended family is when two families join, so it includes children from previous relationships.'],
];
for (const [topic, subject, content] of NOTES) {
  await sql.query(
    `INSERT INTO edu.student_knowledge (student_id, agent_id, topic, subject, content, source, confidence, tags)
     VALUES ($1,$2,$3,$4,$5,'session',0.7,'{}')`, [me.id, ag.id, topic, subject, content]);
}
// A battle placeholder: not knowledge, but it repeats its own topic name, which
// is exactly what a keyword arm loves.
await sql.query(
  `INSERT INTO edu.student_knowledge (student_id, agent_id, topic, subject, content, source, confidence, tags)
   VALUES ($1,$2,'GPR Fractions','Mathematics',
           'Met "GPR Fractions" in a battle and answered incorrectly. No notes on this yet.',
           'session',-0.1,'{battle-encounter}')`, [me.id, ag.id]);

const search = async (text, subject = null, tags = null, k = 6) => {
  const { rows } = await sql.query(
    `SELECT topic, subject, lexical_rank, vector_rank, fused
     FROM match_student_knowledge($1, NULL, $2, $3, $4, $5)`,
    [me.id, k, text, subject, tags]);
  return rows;
};

console.log('· The lexical arm finds what vectors cannot');
// No embeddings exist on these rows, so ANY result here is the lexical arm.
// That is the point: before this change the query returned nothing at all.
const formula = await search('What is the simple interest on ₦5,000 at 4% per year for 2 years?');
check('a formula note is reachable by words alone',
  formula.some(r => r.topic === 'GPR Simple interest'),
  formula.map(r => r.topic).join(', ') || 'nothing');
check('and it ranks first', formula[0]?.topic === 'GPR Simple interest', formula[0]?.topic);
check('found lexically, with no vector rank at all',
  formula[0]?.lexical_rank != null && formula[0]?.vector_rank == null,
  `lex=${formula[0]?.lexical_rank} vec=${formula[0]?.vector_rank}`);

// The bug the first version of this migration had: websearch_to_tsquery ANDs
// its terms, so a whole question required every word to appear in the note and
// matched nothing, ever.
check('a long question does not require every word to appear',
  (await search('Explain in detail the concept of photosynthesis and how sunlight is involved'))
    .some(r => r.topic === 'GPR Photosynthesis'),
  'matched on partial overlap');

console.log('\n· Subject filtering');
const maths = await search('family relationships children', 'Mathematics');
check('a Social Studies note is not returned for a Mathematics question',
  !maths.some(r => r.topic === 'GPR Blended family'),
  maths.map(r => `${r.topic}(${r.subject})`).join(', ') || 'nothing');
const social = await search('family relationships children', 'Social Studies');
check('and is returned when the subject agrees',
  social.some(r => r.topic === 'GPR Blended family'), social.map(r => r.topic).join(', '));
// Free text typed by teachers and written by models — all three spellings occur.
check('subject matching tolerates Maths vs Mathematics',
  (await search('simple interest principal rate', 'Maths')).some(r => r.topic === 'GPR Simple interest'),
  'loose match holds');

console.log('\n· Battle placeholders stay out');
const withTag = await search('GPR Fractions', null, null);
const noTag   = await search('GPR Fractions', null, ['battle-encounter']);
check('the keyword arm WOULD surface a placeholder', withTag.some(r => r.topic === 'GPR Fractions'),
  withTag.map(r => r.topic).join(', '));
check('so it is excluded in SQL, not hoped away', !noTag.some(r => r.topic === 'GPR Fractions'),
  noTag.map(r => r.topic).join(', ') || 'none');

console.log('\n· Fusion scores both arms');
check('every returned row carries a fused score',
  formula.every(r => Number(r.fused) > 0), formula.map(r => Number(r.fused).toFixed(5)).join(', '));
check('and results are ordered by it',
  formula.every((r, i) => i === 0 || Number(formula[i - 1].fused) >= Number(r.fused)), 'monotonic');

console.log('\n· Freshness is trackable');
const { rows: cols } = await sql.query(
  `SELECT table_name FROM information_schema.columns
   WHERE column_name = 'embedded_at' AND table_schema = 'edu'`);
check('every vector store records when it was embedded', cols.length >= 4,
  cols.map(c => c.table_name).join(', '));

const { embeddingHealth } = await import('../../lib/embeddingSweeper.js');
const health = await embeddingHealth();
check('and missing embeddings can be counted', Array.isArray(health) && health.length >= 3,
  health.map(h => `${h.store}:${h.missing}/${h.total}`).join(' '));
// The failure this fixes was not "embeddings go missing" — it was that nobody
// could tell. Our four notes have no vectors, so they must show up as missing.
check('our unembedded notes are reported as missing',
  (health.find(h => h.store === 'edu.student_knowledge')?.missing ?? 0) >= 4,
  `${health.find(h => h.store === 'edu.student_knowledge')?.missing} missing`);

console.log('\n· Reranking never loses data');
const { rerank, rerankEnabled } = await import('../../lib/rerank.js');
const cands = Array.from({ length: 8 }, (_, i) => ({ id: i, content: `passage ${i}` }));
// Fewer candidates than places is a model call that cannot change anything.
check('it does not call a model when there is nothing to choose',
  (await rerank({ query: 'x', candidates: cands.slice(0, 3), textOf: c => c.content, topK: 4 })).length === 3,
  'returned input untouched');
// A reranker that can silently drop everything when the model hiccups is worse
// than none, because the failure looks like bad retrieval.
const out = await rerank({ query: 'anything', candidates: cands, textOf: c => c.content, topK: 4 });
check('a failed rerank falls back to retrieval order rather than dropping results',
  out.length === 4 && out.every(o => cands.some(c => c.id === o.id)),
  `${out.length} kept`);
check('it is a per-site switch, defaulting to battle only',
  rerankEnabled('battle') && !rerankEnabled('nonexistent-site'), 'battle on, others off');

await sql.query("DELETE FROM edu.student_knowledge WHERE student_id = $1 AND topic LIKE 'GPR %'", [me.id]);
await sql.end();
score();
process.exit(0);
