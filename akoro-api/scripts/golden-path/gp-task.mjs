import { call, login, check } from './golden.mjs';

export async function taskPath(teacher) {
  console.log('\n═══ GOLDEN PATH 2 — TASK ═══\n');

  const mk = await call(teacher, 'POST', '/api/tasks', {
    title: 'Draft lesson hooks for next week',
    description: 'JSS1, photosynthesis. Five openers.',
    priority: 'high',
    dueAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  check('create a scheduled task', mk.status === 201,
    mk.status !== 201 ? JSON.stringify(mk.json).slice(0,160) : `type=${mk.json.task.task_type} status=${mk.json.task.status}`);
  const id = mk.json?.task?.id;
  check('intent routed to a teacher tool', mk.json?.task?.task_type === 'run_teaching_tool', mk.json?.task?.task_type);
  check('description was stored', !!mk.json?.task?.description, JSON.stringify(mk.json?.task?.description)?.slice(0,60));
  check('due date was stored', !!mk.json?.task?.due_at);

  const list = await call(teacher, 'GET', '/api/tasks');
  check('task appears in the list', list.status === 200 && (list.json?.tasks ?? []).some(t => t.id === id),
    `${list.json?.tasks?.length ?? 0} task(s)`);

  const newDue = new Date(Date.now() + 7200_000).toISOString();
  const ed = await call(teacher, 'PATCH', `/api/tasks/${id}`, { title: 'Edited title', dueAt: newDue, priority: 'low' });
  check('edit reschedules', ed.status === 200 && ed.json?.task?.title === 'Edited title',
    ed.status !== 200 ? JSON.stringify(ed.json).slice(0,120) : `due=${ed.json.task.due_at?.slice(0,16)} status=${ed.json.task.status}`);

  const rec = await call(teacher, 'PATCH', `/api/tasks/${id}`, { isRecurring: true, cronExpr: '0 8 * * 1' });
  check('turn into a repeat', rec.status === 200 && rec.json?.task?.is_recurring === true,
    rec.status !== 200 ? JSON.stringify(rec.json).slice(0,120) : 'cron accepted');

  const back = await call(teacher, 'GET', '/api/tasks');
  const row = (back.json?.tasks ?? []).find(t => t.id === id);
  check('cron comes back for the edit form', !!row?.cron_expr, row?.cron_expr);

  const del = await call(teacher, 'DELETE', `/api/tasks/${id}`);
  check('delete', del.status === 200 && del.json?.deleted === true);
  const after = await call(teacher, 'GET', '/api/tasks');
  check('deleted task is really gone', !(after.json?.tasks ?? []).some(t => t.id === id));
}
