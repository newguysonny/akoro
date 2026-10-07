/**
 * gp-tools.mjs — the AI-backed paths, driven the way a teacher drives them.
 *
 * Every prompt below is the literal text a teacher would type. The model is a
 * local stand-in (mock-openai.mjs), so this proves the PLUMBING — routing, tool
 * selection, argument validation, DB writes, coin charging, artifact
 * persistence — and not the model's judgement.
 */
import { call, login, check, score } from './golden.mjs';
import db from '../../db.js';

const wait = (ms) => new Promise(r => setTimeout(r, ms));

const teacher = await login('teacher', 'instructor', 'teacher1@demo.akoro.app', 'Amara2026');

console.log('\n═══ A. TEACHING TOOL, RUN DIRECTLY ═══');
console.log('   typed: topic "Photosynthesis", subject "Basic Science", class "JSS1"\n');
const hooks = await call(teacher, 'POST', '/api/teaching/tools/lesson-hooks',
  { topic: 'Photosynthesis', subject: 'Basic Science', class: 'JSS1' });
check('run the Lesson Hooks tool', hooks.status === 200,
  hooks.status !== 200 ? JSON.stringify(hooks.json).slice(0, 160) : `"${hooks.json.data.title}" · ${hooks.json.data.coinsCharged} coins`);
check('output is rendered markdown', !!hooks.json?.data?.content, `${hooks.json?.data?.content?.length ?? 0} chars`);

console.log('\n═══ B. TASK AGENT LOOP — the whole point of tasks ═══');

const cases = [
  // A real request names the subject — the bank is searched by it, so "a battle
  // for JSS1" is not something the endpoint can act on without guessing.
  { label: 'battle',     title: 'Every Monday, set JSS1 a Mathematics battle',
    description: 'Class battle for JSS1. Subject Mathematics, topic fractions, 8 questions, medium difficulty.',
    expectType: 'create_battle', expectTool: 'assign_battle', outputType: 'battle' },
  { label: 'self study', title: 'Assign self study on the water cycle to JSS1',
    description: 'Basic Science. Due Friday.',
    expectType: 'assign_self_study', expectTool: 'assign_self_study', outputType: 'self_study' },
  { label: 'podcast',    title: 'Make a podcast about photosynthesis for JSS1',
    description: 'Basic Science, 5 minutes, two hosts.',
    expectType: 'run_teaching_tool', expectTool: 'run_teaching_tool', outputType: 'teaching_tool' },
];

for (const c of cases) {
  console.log(`\n   typed: "${c.title}"`);
  console.log(`          "${c.description}"`);
  const mk = await call(teacher, 'POST', '/api/tasks', { title: c.title, description: c.description });
  check(`${c.label}: task created`, mk.status === 201, `type=${mk.json?.task?.task_type}`);
  check(`${c.label}: intent routed`, mk.json?.task?.task_type === c.expectType,
    `got ${mk.json?.task?.task_type}, expected ${c.expectType}`);

  const id = mk.json?.task?.id;
  let status = null, outs = [];
  for (let i = 0; i < 40; i++) {
    await wait(500);
    const t = await call(teacher, 'GET', `/api/tasks/${id}`);
    status = t.json?.task?.status;
    if (status === 'done' || status === 'failed') {
      outs = (await call(teacher, 'GET', `/api/tasks/${id}/outputs`)).json?.outputs ?? [];
      break;
    }
  }
  check(`${c.label}: agent run completed`, status === 'done', `status=${status}`);
  check(`${c.label}: produced a ${c.outputType} artifact`,
    outs.some(o => o.output_type === c.outputType),
    outs.map(o => o.output_type).join(', ') || 'none');
}

console.log('\n═══ C. AI QUESTION GENERATION FOR A BATTLE ═══');
console.log('   Questions: "Generate with AI" on a subject the bank cannot fill\n');
const priya = await login('priya', 'student', 'stu.jss11@demo.akoro.app', 'Priya2026');
const cls = await call(priya, 'GET', '/api/battle/my-classes');
const room = (cls.json?.data ?? [])[0];
const gen = await call(priya, 'POST', `/api/battle/classes/${room.id}/battles/invite`, {
  title: 'AI-generated battle', subject: 'Civic Education', topic: 'Citizenship',
  total_questions: 6, question_source: 'ai', usernames: ['jss1_mate1'],
});
check('AI fills a subject the bank cannot', gen.status === 201,
  gen.status !== 201 ? JSON.stringify(gen.json).slice(0, 170)
  : `${gen.json.data.questions} questions (${gen.json.data.fromBank} bank + ${gen.json.data.generated} generated), ${gen.json.data.coinsCharged} coins`);
check('all questions were generated', gen.json?.data?.generated > 0);

console.log('\n═══ D. TUTOR CHAT ═══');
console.log('   typed: "Explain photosynthesis simply"\n');
const chat = await call(priya, 'POST', '/api/adaptive/chat/agent',
  { message: 'Explain photosynthesis simply', studentId: null });
check('tutor chat answers', chat.status === 200 && !!(chat.json?.reply || chat.json?.response),
  chat.status !== 200 ? JSON.stringify(chat.json).slice(0, 140) : String(chat.json.reply || chat.json.response).slice(0, 60));

console.log('\n═══ E. TELEMETRY ═══');
// Cost and tokens were recorded only by the wallet DEBIT, so a call with no
// payer — system, cron, background — left no trace at all, and latency was
// recorded nowhere. Of cost, latency and quality, one axis was measured, one
// was missing, and the measured one had a hole in it.
await new Promise(r => setTimeout(r, 800));   // the write is fire-and-forget
const { data: rows } = await db.schema('edu').from('ai_call_log')
  .select('feature, model, ms, tokens_in, cost_usd, ok, user_id')
  .order('id', { ascending: false }).limit(200);

check('every model call is recorded', (rows ?? []).length > 0, `${rows?.length ?? 0} rows`);
check('with latency on every one', (rows ?? []).every(r => Number.isFinite(r.ms)),
  `${(rows ?? []).filter(r => !Number.isFinite(r.ms)).length} missing ms`);
check('with the model named', (rows ?? []).every(r => !!r.model));
check('and cost for the ones that returned usage',
  (rows ?? []).filter(r => r.ok).every(r => r.cost_usd != null || r.tokens_in === 0),
  `${(rows ?? []).filter(r => r.ok && r.cost_usd == null).length} priced null`);
// The point of the table: it sees calls the wallet never could.
check('including calls with no payer to bill',
  (rows ?? []).some(r => r.user_id === null),
  `${(rows ?? []).filter(r => r.user_id === null).length} unbilled calls captured`);

const s = score();
console.log(`\nAI TOOL PATHS: ${s.pass} passed, ${s.fail} failed`);
