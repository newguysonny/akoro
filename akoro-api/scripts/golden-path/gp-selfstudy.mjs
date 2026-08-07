import { call, check } from './golden.mjs';

export async function selfStudyPath(teacher, learner) {
  console.log('\n═══ GOLDEN PATH 3 — SELF STUDY ═══\n');

  const cls = await call(teacher, 'GET', '/api/instructor/classrooms');
  const jss1 = (cls.json?.data ?? []).find(c => c.name === 'JSS1');
  check('teacher lists classes', cls.status === 200 && !!jss1, `${cls.json?.data?.length ?? 0} class(es)`);

  const roster = await call(teacher, 'GET', `/api/instructor/classrooms/${jss1.id}/students`);
  check('class roster for the picker', roster.status === 200 && (roster.json?.data ?? []).length > 0,
    `${roster.json?.data?.length ?? 0} learners`);

  // /plan calls the model; skip it and supply the brief directly, which is the
  // same body the form sends after the teacher edits the draft.
  const mk = await call(teacher, 'POST', '/api/self-study', {
    title: 'Water cycle — self study', subject: 'Basic Science', topic: 'The water cycle',
    subtopics: ['Evaporation', 'Condensation', 'Precipitation'],
    objectives: { Evaporation: ['Explain how water becomes vapour'] },
    instructions: 'Finish before Friday.',
    whole_class: true, classroom_id: jss1.id,
    due_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
  });
  check('assign to the whole class', mk.status === 201,
    mk.status !== 201 ? JSON.stringify(mk.json).slice(0,160) : `assigned to ${mk.json.data.assigned}`);
  const aid = mk.json?.data?.id;
  check('no course was needed', mk.json?.data?.course_id === null, `course_id=${mk.json?.data?.course_id}`);
  check('class was recorded', mk.json?.data?.classroom_id === jss1.id);

  const list = await call(teacher, 'GET', '/api/self-study');
  const row = (list.json?.data ?? []).find(a => a.id === aid);
  check('teacher sees progress', !!row, row ? `assigned=${row.progress.assigned} started=${row.progress.started}` : '');

  const mine = await call(learner, 'GET', '/api/self-study/mine');
  const got = (mine.json?.data ?? []).find(a => a.id === aid);
  check('learner receives it', !!got, got ? `"${got.title}" from ${got.assignedBy}` : `${mine.json?.data?.length ?? 0} items`);
  check('brief travels with it', (got?.subtopics ?? []).length === 3, `${got?.subtopics?.length} subtopics`);

  const start = await call(learner, 'POST', `/api/self-study/${aid}/start`, {});
  check('learner starts it', start.status === 200 && start.json?.data?.target?.status === 'started');

  const after = await call(teacher, 'GET', '/api/self-study');
  const row2 = (after.json?.data ?? []).find(a => a.id === aid);
  check('progress moves for the teacher', row2?.progress?.started === 1, `started=${row2?.progress?.started}`);

  const named = await call(teacher, 'POST', '/api/self-study', {
    title: 'Picked learners only', subject: 'Mathematics', topic: 'Fractions',
    subtopics: ['Adding fractions'], objectives: {},
    usernames: ['jss1_mate1', 'jss1_mate2'],
  });
  check('assign to named learners only', named.status === 201 && named.json?.data?.assigned === 2,
    named.status !== 201 ? JSON.stringify(named.json).slice(0,160) : `assigned to ${named.json.data.assigned} (must be 2, not the class)`);

  const del = await call(teacher, 'DELETE', `/api/self-study/${aid}`);
  check('delete an assignment', del.status === 200 && del.json?.data?.deleted === true);
}
