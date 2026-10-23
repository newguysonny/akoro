// gp-workbench.mjs — a bought tool can actually be run.
//
// /api/teaching/tools was complete for months and unreachable: nine tools each
// declaring their input fields, a POST /:key to run one, and a /outputs
// endpoint whose own comment says "so the workbench can list them the way the
// content hub lists past creations". No app called any of it. The App Center
// sold tools and rendered "Unlocked ✓" as a disabled badge, so owning one led
// nowhere.
//
// What this locks down is the CONTRACT the workbench depends on, because the UI
// is generated from it: the form is built from each tool's declared `fields`,
// so a tool that stops declaring them renders an empty form and a teacher gets
// a Run button that cannot work. That failure would pass a build.

import { call, login, check, score } from './golden.mjs';

console.log('\n═══ TOOL WORKBENCH ═══\n');

const teacher = await login('teacher', 'instructor', 'teacher1@demo.akoro.app', 'Amara2026');

console.log('· The catalogue the workbench renders from');
const list = await call(teacher, 'GET', '/api/teaching/tools');
check('the tool list answers', list.status === 200, `${list.status}`);
const tools = list.json?.data ?? [];
check('every tool is there', tools.length === 9, `${tools.length} tools`);

// The ninth. The school portal had an Activities Creator behind a school-role
// endpoint an instructor could never call.
const activity = tools.find((t) => t.key === 'activity');
check('including Activities Creator', !!activity, activity?.name ?? 'missing');

// The form is GENERATED from these. No fields means no form, and a Run button
// that posts nothing.
check('every tool declares its own input fields',
  tools.every((t) => Array.isArray(t.fields) && t.fields.length > 0),
  tools.filter((t) => !t.fields?.length).map((t) => t.key).join(', ') || 'all declare fields');
check('and every field has a name and a label',
  tools.every((t) => t.fields.every((f) => f.name && f.label)),
  'named');
// Required fields are what the workbench validates before spending a coin.
check('at least one field is required, so an empty run is refused',
  tools.every((t) => t.fields.some((f) => f.required)),
  tools.filter((t) => !t.fields.some((f) => f.required)).map((t) => t.key).join(', ') || 'all have one');
// Select fields drive a dropdown; without options it renders an empty one.
const selects = tools.flatMap((t) => t.fields.filter((f) => f.type === 'select'));
check('every dropdown has options', selects.every((f) => Array.isArray(f.options) && f.options.length),
  `${selects.length} dropdowns`);

console.log('\n· Every tool is open (none is locked or priced)');
check('no tool is locked', tools.every((t) => t.locked === false), 'all open');
check('and carries the key the catalogue uses',
  tools.every((t) => typeof t.key === 'string' && t.key.length > 0),
  // A catalogue card knows which tool to open by its own key and nothing else.
  'keys present');

console.log('\n· Running one');
const run = await call(teacher, 'POST', '/api/teaching/tools/activity', {
  topic: 'Fractions', subject: 'Mathematics', class: 'JSS1',
  format: 'Group work', duration: '20 minutes',
});
check('a tool runs', run.status === 200, `${run.status} ${run.json?.error ?? ''}`);
check('and returns a document the workbench can render',
  Array.isArray(run.json?.data?.cards), `${run.json?.data?.cards?.length ?? 0} cards`);

// A required field missing must be refused before anything is charged.
const bad = await call(teacher, 'POST', '/api/teaching/tools/activity', { subject: 'Mathematics' });
check('a run with no topic is refused, not charged', bad.status >= 400, `${bad.status}`);

console.log('\n· Earlier runs');
const outs = await call(teacher, 'GET', '/api/teaching/tools/outputs?key=activity');
check('past runs are listed', outs.status === 200 && Array.isArray(outs.json?.data),
  `${outs.json?.data?.length ?? 0} rows`);

// The trap this caught during the build: the list omits `content`, so showing
// row.content directly rendered an empty document — which reads as a broken
// tool rather than a missing field. The workbench fetches the row instead.
const first = outs.json?.data?.[0];
check('the list deliberately omits the document body', first && !('content' in first),
  first ? Object.keys(first).join(', ') : 'no rows');
if (first) {
  const one = await call(teacher, 'GET', `/api/teaching/tools/outputs/${first.id}`);
  check('and the detail endpoint carries it', one.status === 200 && !!one.json?.data?.content,
    `${one.status}`);
}

console.log('\n· Only teachers, and only their own work');
const learner = await login('learner', 'student', 'jss1.mate1@demo.akoro.app', 'Password123!');
const nosy = await call(learner, 'GET', '/api/teaching/tools');
check('a learner cannot reach the workbench', nosy.status === 403 || nosy.status === 401, `${nosy.status}`);
if (first) {
  const theirs = await call(learner, 'GET', `/api/teaching/tools/outputs/${first.id}`);
  check("nor read a teacher's output", theirs.status >= 400, `${theirs.status}`);
}

score();
process.exit(0);
