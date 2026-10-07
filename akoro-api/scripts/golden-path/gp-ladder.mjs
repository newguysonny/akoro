// gp-ladder.mjs — the lesson ladder is a PATH, not a list.
//
// What went wrong: the generator was asked for a progression and returned a
// table of contents. On "The water cycle" it opened with "States of Water:
// Solid, Liquid, and Gas" — not the beginning. A learner who does not yet know
// what water IS cannot be taught that it has three states, so the ladder
// started on its second rung with the first one missing, and nothing could
// tell: an ordered list and a list look identical.
//
// The fix makes each step state what it BUILDS ON and what it unlocks. That is
// also what makes it testable — a dependency that points forwards, or a
// foundation that is not first, is now a detectable defect rather than a
// judgement call.
//
// The stand-in model cannot produce a real curriculum, so what runs here is the
// STRUCTURE: normalisation, ordering invariants, and the shape that reaches the
// learner. Whether the model picks good steps belongs to the eval suite.

import { check, score } from './golden.mjs';
import pg from 'pg';

const sql = new pg.Client({ host: 'localhost', port: 5433, user: 'postgres', database: 'akoro' });
await sql.connect();

console.log('\n═══ LESSON LADDER / KNOWLEDGE MAP ═══\n');

console.log('· The ladder can carry its own reasoning');
const { rows: cols } = await sql.query(
  `SELECT column_name, data_type, column_default FROM information_schema.columns
   WHERE table_schema='edu' AND table_name='lesson_ladders' AND column_name='knowledge_map'`);
check('lesson_ladders stores a knowledge map', cols.length === 1, cols[0]?.data_type ?? 'missing');
// Defaulted rather than nullable: a scheme of work has no generated map, and
// every reader would otherwise need to handle null separately from empty.
check('and it defaults to empty rather than null', /\[\]/.test(cols[0]?.column_default ?? ''),
  cols[0]?.column_default ?? '');

console.log('\n· A step names what it builds on, by position');
// buildsOn arrives from the model as the PREVIOUS STEP'S TITLE, which drifts by
// a word and then matches nothing. It is normalised to an index on the way in,
// because an index is what the UI can actually follow.
const { NaNaEsumai } = await import('../../modules/adaptive-learning/agents/nana-esumai/guide.js');
const guide = new NaNaEsumai();
check('the guide exposes a ladder builder', typeof guide?.generateSubtopics === 'function',
  guide ? 'generateSubtopics' : 'guide unavailable');

const built = await guide.generateSubtopics('The water cycle', 'Basic Science');
check('it returns titles and a map together',
  Array.isArray(built?.subtopics) && Array.isArray(built?.map),
  `${built?.subtopics?.length} titles, ${built?.map?.length} mapped`);
// subtopics stays a plain string array on purpose: the orchestrator, the
// websocket, self-study and the learner app all index it that way.
check('titles are plain strings, so nothing downstream breaks',
  built.subtopics.every(t => typeof t === 'string' && t.length > 0),
  built.subtopics.slice(0, 2).join(' | '));
check('the map runs parallel to the titles', built.map.length === built.subtopics.length,
  `${built.map.length} vs ${built.subtopics.length}`);

// The invariants are checked against FIXTURES, not against whatever the model
// returned. The stand-in produces no steps, so asserting on its output passes
// by having nothing to disagree with — the emptiest kind of green.
const { normaliseLadder } = await import('../../modules/adaptive-learning/agents/nana-esumai/guide.js');

const water = normaliseLadder([
  { title: 'What water is',            kind: 'foundation', buildsOn: null,            whyNow: 'Name the substance.' },
  { title: 'What water is made of',    kind: 'foundation', buildsOn: 'What water is', whyNow: 'Describe its parts.' },
  { title: 'The three states of water', kind: 'mechanism', buildsOn: 'What water is made of', whyNow: 'Tell solid from liquid from gas.' },
  { title: 'Evaporation',              kind: 'mechanism',  buildsOn: 'The three states of water', whyNow: 'Explain how water leaves a puddle.' },
  { title: 'The complete water cycle', kind: 'synthesis',  buildsOn: 'Evaporation',   whyNow: 'Trace a drop all the way round.' },
]);
check('the first step depends on nothing', water.map[0].buildsOn === null, `buildsOn=${water.map[0].buildsOn}`);
// A title, resolved to a position — the model returns wording, the UI needs an index.
check('a named dependency resolves to its index', water.map[2].buildsOn === 1,
  `"What water is made of" → ${water.map[2].buildsOn}`);
// The invariant that makes it a ladder rather than a pile: you can only lean on
// something already climbed.
check('every step depends on an EARLIER one',
  water.map.slice(1).every((m, i) => Number.isInteger(m.buildsOn) && m.buildsOn <= i),
  water.map.map(m => m.buildsOn).join(','));
check('and it starts at the real beginning', water.map[0].kind === 'foundation', water.map[0].title);

// Everything the model can get wrong, in one fixture.
const messy = normaliseLadder([
  { title: 'Step one',   kind: 'nonsense',   buildsOn: 'Step four' },   // forward dependency
  { title: '',           kind: 'foundation', buildsOn: null },          // empty title
  { title: 'Step two',   kind: 'mechanism',  buildsOn: 'Renamed step' },// dependency that matches nothing
  { title: 'Step three', kind: 'synthesis' },                           // no buildsOn at all
]);
check('empty titles are dropped', messy.subtopics.length === 3, messy.subtopics.join(' | '));
// The dangerous one: a forward dependency is a rung above the one you're on.
check('a dependency pointing FORWARD is repaired, not kept',
  messy.map.every((m, i) => m.buildsOn === null || m.buildsOn < i),
  messy.map.map(m => m.buildsOn).join(','));
check('an unmatched dependency falls back to the previous step', messy.map[1].buildsOn === 0,
  `${messy.map[1].buildsOn}`);
check('a missing dependency still gets one', messy.map[2].buildsOn === 1, `${messy.map[2].buildsOn}`);
check('an unknown kind becomes mechanism rather than being dropped',
  messy.map[0].kind === 'mechanism', messy.map[0].kind);
check('a garbage response yields an empty ladder, not a throw',
  normaliseLadder(null).subtopics.length === 0 && normaliseLadder(undefined).map.length === 0, 'empty');

console.log('\n· It survives a model that returns nonsense');
// The stand-in returns a fixed reply, so this path runs on every local session
// — and a ladder builder that throws takes the whole session with it.
check('a malformed response yields an empty ladder rather than an exception',
  Array.isArray(built.subtopics), 'no throw');

console.log('\n· The header carries the map to the learner');
const orch = await import('../../modules/adaptive-learning/agents/student/orchestrator.js');
check('the orchestrator module loads', !!orch, 'ok');
// Checked as source rather than by running a session: building one needs a live
// model, and what matters is that the block carries the field at all — without
// it the learner sees the steps but never the path between them.
const src = await import('node:fs').then(fs =>
  fs.readFileSync('modules/adaptive-learning/agents/student/orchestrator.js', 'utf8'));
check('the subtopic header block includes the map', /type:\s*"subtopic-hdr"[\s\S]{0,400}map:/.test(src),
  'map on subtopic-hdr');
check('and the phase plan block is gone for good', !/type:\s*"plan"/.test(src), 'no plan block');

await sql.end();
score();
process.exit(0);
