// gp-continuation.mjs — coming back to a session finds it where you left it.
//
// Two failures, and either alone was enough to lose everything.
//
//   · GET /adaptive/teaching/sessions/:id/history — the endpoint behind the "Continue
//     Teaching" button — did JSON.parse(session.subtopics). Those are JSONB
//     columns, so the driver has already parsed them; JSON.parse coerces its
//     argument to a string first, and JSON.parse(["a","b"]) is
//     JSON.parse("a,b"), which throws. The `|| "[]"` fallback never fired
//     because an empty array is truthy. The endpoint threw on every call it
//     ever received.
//
//   · current_phase and current_subtopic_idx were written once at creation as
//     "1" and 0 and never updated. So even a working history handed back a row
//     claiming the learner was on the first phase of the first subtopic, and
//     the continuation restarted the lesson from the beginning underneath a
//     greyed-out transcript of the one they had already done.
//
// The first is checked against a row written the way PostgREST writes one —
// real arrays, not strings — because a fixture of JSON strings would pass
// against the broken code.

import { call, login, check, score } from './golden.mjs';
import pg from 'pg';

const sql = new pg.Client({ host: 'localhost', port: 5433, user: 'postgres', database: 'akoro' });
await sql.connect();

console.log('\n═══ SESSION CONTINUATION ═══\n');

const learner = await login('learner', 'student', 'jss1.mate1@demo.akoro.app', 'Password123!');
const { rows: [me] } = await sql.query('SELECT id FROM users WHERE email = $1', ['jss1.mate1@demo.akoro.app']);
await sql.query("DELETE FROM edu.adaptive_sessions WHERE topic = 'GPC Water cycle'");

// Written as PostgREST writes it: jsonb columns holding real JSON, and a
// session that got four subtopics in.
const SUBTOPICS = ['What water is', 'Evaporation', 'Condensation', 'Precipitation', 'The whole cycle'];
const { rows: [sess] } = await sql.query(
  `INSERT INTO edu.adaptive_sessions
     (student_id, topic, subject, subtopics, objectives, current_subtopic_idx, current_phase,
      status, block_history, started_at, updated_at)
   VALUES ($1,'GPC Water cycle','Basic Science',$2::jsonb,$3::jsonb,3,'2','active',$4::jsonb, now() - interval '2 days', now() - interval '2 days')
   RETURNING id`,
  [me.id, JSON.stringify(SUBTOPICS),
   JSON.stringify({ 'What water is': ['Name the substance.'] }),
   JSON.stringify([{ type: 'user', text: 'Water is made of tiny drops' },
                   { type: 'guide', text: 'Good — now tell your agent what it turns into.' }])]);

console.log('· The history endpoint answers at all');
const hist = await call(learner, 'GET', `/api/adaptive/teaching/sessions/${sess.id}/history`);
// It threw on every call before this: JSON.parse on an already-parsed JSONB
// array. A 500 here is the whole bug.
check('it does not throw on a normal row', hist.status === 200,
  `${hist.status} ${hist.json?.error ?? ''}`);
check('the previous transcript comes back', (hist.json?.historyBlocks ?? []).length > 0,
  `${hist.json?.historyBlocks?.length ?? 0} blocks`);
check('and is marked as previous rather than current',
  hist.json?.historyBlocks?.[0]?.type === 'system-divider' &&
  /Previous session/.test(hist.json.historyBlocks[0].label ?? ''),
  hist.json?.historyBlocks?.[0]?.label ?? 'no divider');
check('faded, so it reads as history', hist.json?.historyBlocks?.slice(1).every(b => b.faded === true),
  'all faded');

console.log('\n· The ladder survives the round trip');
check('subtopics come back as an array, not a mangled string',
  Array.isArray(hist.json?.subtopics) && hist.json.subtopics.length === SUBTOPICS.length,
  JSON.stringify(hist.json?.subtopics)?.slice(0, 60));
check('and in the right order', hist.json?.subtopics?.[0] === 'What water is', hist.json?.subtopics?.[0]);
check('objectives come back as an object',
  hist.json?.objectives && typeof hist.json.objectives === 'object' && !Array.isArray(hist.json.objectives),
  JSON.stringify(hist.json?.objectives)?.slice(0, 50));

console.log('\n· And it says where to pick up');
// The half that made a working transcript useless: without this the lesson
// restarts at step one under a greyed-out copy of itself.
check('the resume position is returned', !!hist.json?.resumeAt, JSON.stringify(hist.json?.resumeAt));
check('at the subtopic they reached, not the first',
  hist.json?.resumeAt?.subtopicIdx === 3, `idx=${hist.json?.resumeAt?.subtopicIdx}`);
check('at the phase they reached, not phase 1',
  hist.json?.resumeAt?.phase === 'PHASE_2', hist.json?.resumeAt?.phase);
check('and names that subtopic', hist.json?.resumeAt?.subtopic === 'Precipitation',
  hist.json?.resumeAt?.subtopic);

console.log('\n· A session with nothing in it degrades quietly');
const { rows: [bare] } = await sql.query(
  `INSERT INTO edu.adaptive_sessions (student_id, topic, subject, status)
   VALUES ($1,'GPC Water cycle','Basic Science','active') RETURNING id`, [me.id]);
const empty = await call(learner, 'GET', `/api/adaptive/teaching/sessions/${bare.id}/history`);
check('an empty session still answers 200', empty.status === 200, `${empty.status}`);
check('with no history rather than an error', empty.json?.hasHistory === false,
  `hasHistory=${empty.json?.hasHistory}`);
check('and a resume position of the start', empty.json?.resumeAt?.subtopicIdx === 0,
  `idx=${empty.json?.resumeAt?.subtopicIdx}`);

console.log('\n· The orchestrator starts where it is told');
const { StudentSessionOrchestrator } = await import('../../modules/adaptive-learning/index.js')
  .then(m => ({ StudentSessionOrchestrator: m.default ?? m.StudentSessionOrchestrator }));
check('the orchestrator class loads', typeof StudentSessionOrchestrator === 'function',
  typeof StudentSessionOrchestrator);

// Clamping matters: a stored index of 4 against a three-step ladder would put
// the learner past the end of their own lesson.
const src = await import('node:fs').then(fs =>
  fs.readFileSync('modules/adaptive-learning/agents/student/orchestrator.js', 'utf8'));
check('resumeFrom is read when the ladder is set', /resumeFrom/.test(src), 'present');
check('and clamped to the ladder that actually resolved',
  /Math\.min\(idx,\s*Math\.max\(0,\s*mustKnow\.length\s*-\s*1\)\)/.test(src), 'clamped');

console.log('\n· Position is written as the session runs');
// It was set once at creation and never again, so the row always claimed
// phase 1 / subtopic 0 no matter how far anyone got.
const ws = await import('node:fs').then(fs =>
  fs.readFileSync('modules/adaptive-learning/realtime/websocket.js', 'utf8'));
// Matched on the append path's own expression rather than by proximity to the
// function name — a comment growing between the two should not fail the check.
check('every turn records the phase and subtopic reached',
  /current_subtopic_idx:\s*Number\.isInteger\(sess\.mustKnowIndex\)/.test(ws), 'updated per turn');
check('and the ladder, which is resolved after the row is created',
  /subtopics:\s*sess\.mustKnowParts/.test(ws), 'subtopics refreshed');

await sql.query("DELETE FROM edu.adaptive_sessions WHERE topic = 'GPC Water cycle'");
await sql.end();
score();
process.exit(0);
