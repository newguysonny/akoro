import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTraceEvent, blocksFromSavedTrace, durationLabel, groupLabel, groupTraceBlocks, promoteActivity, settleRunning, thoughtLabel,
  studyPrepEventBlocks,
} from './agentChatTrace.js';

const fold = (events, start = 1000) => events.reduce(
  (blocks, [event, data], index) => applyTraceEvent(blocks, event, data, start + index * 100), []);

test('one turn interleaves thinking, tools and text many times, in order', () => {
  const blocks = fold([
    ['think_start', { id: 'think_1' }],
    ['think_end', { id: 'think_1', ms: 1200, text: 'Next: checking your goals.' }],
    ['tool_start', { id: 'tool_2', category: 'research', headline: 'Checking your goals', description: 'Looking at your active study goals' }],
    ['tool_end', { id: 'tool_2', ok: true, result: '3 found', ms: 80 }],
    ['activity', { id: 'act_3', text: 'You have three goals.' }],
    ['think_start', { id: 'think_4' }],
    ['think_end', { id: 'think_4', ms: 900, text: 'Next: checking your tasks.' }],
    ['tool_start', { id: 'tool_5', category: 'research', headline: 'Checking your tasks', description: '' }],
    ['tool_end', { id: 'tool_5', ok: true, result: '2 found', ms: 60 }],
    ['think_start', { id: 'think_6' }],
    ['think_end', { id: 'think_6', ms: 400, text: 'I have what I need — writing your answer.' }],
  ]);
  assert.deepEqual(blocks.map((block) => block.type), ['thinking', 'tool', 'activity', 'thinking', 'tool', 'thinking']);
  assert.ok(blocks.every((block) => block.type === 'activity' || block.status === 'done'));
  assert.equal(blocks[1].result, '3 found');
  assert.equal(blocks[0].text, 'Next: checking your goals.');
});

test('consecutive tool rows group; a lone tool row stays single', () => {
  const blocks = fold([
    ['tool_start', { id: 'a', category: 'research', headline: 'A' }], ['tool_end', { id: 'a', ms: 10 }],
    ['tool_start', { id: 'b', category: 'research', headline: 'B' }], ['tool_end', { id: 'b', ms: 10 }],
    ['tool_start', { id: 'c', category: 'research', headline: 'C' }], ['tool_end', { id: 'c', ms: 10 }],
    ['activity', { id: 'x', text: 'text' }],
    ['tool_start', { id: 'd', category: 'action', headline: 'D' }], ['tool_end', { id: 'd', ms: 10 }],
  ]);
  const items = groupTraceBlocks(blocks);
  assert.deepEqual(items.map((item) => item.type), ['group', 'activity', 'tool']);
  assert.equal(items[0].tools.length, 3);
  assert.equal(groupLabel(items[0].tools), 'Checked 3 things');
  assert.equal(groupLabel([{ category: 'action' }, { category: 'action' }]), 'Did 2 things');
  assert.equal(groupLabel([{ category: 'action' }, { category: 'research' }]), 'Ran 2 steps');
});

test('reasoning-summary deltas stream into one live row; settling closes it', () => {
  let blocks = fold([['thinking', { text: 'Looking at ' }], ['thinking', { text: 'your goals' }]]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, 'Looking at your goals');
  assert.equal(blocks[0].status, 'running');
  blocks = settleRunning(blocks, 4000);
  assert.equal(blocks[0].status, 'done');
  assert.equal(blocks[0].ms, 3000);
});

test('Think mode: real reasoning streams into its own decision row, then settles', () => {
  const blocks = fold([
    ['think_start', { id: 'think_1' }],
    ['think_delta', { id: 'think_1', text: 'The learner asks about goals, ' }],
    ['think_delta', { id: 'think_1', text: 'so check them first.' }],
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].source, 'reasoning');
  assert.equal(blocks[0].status, 'running');
  assert.equal(blocks[0].text, 'The learner asks about goals, so check them first.');
  const done = applyTraceEvent(blocks, 'think_end', { id: 'think_1', ms: 2100, text: 'The learner asks about goals, so check them first.', source: 'reasoning' }, 5000);
  assert.equal(done[0].status, 'done');
  assert.equal(done[0].source, 'reasoning');
  assert.equal(done[0].ms, 2100);
});

test('stop marks running rows as stopped', () => {
  const blocks = settleRunning(fold([['tool_start', { id: 't', headline: 'Checking' }]]), 2000, { stopped: true });
  assert.equal(blocks[0].status, 'stopped');
});

test('a saved trace rebuilds the same settled blocks on reload', () => {
  const saved = [
    { type: 'thinking', id: 'think_1', ms: 1000, text: 'Next.' },
    { type: 'tool', id: 'tool_2', headline: 'Checking your goals', category: 'research', ok: true, result: '3 found', ms: 50 },
    { type: 'unknown', id: 'z' },
  ];
  const blocks = blocksFromSavedTrace(saved);
  assert.deepEqual(blocks.map((block) => block.type), ['thinking', 'tool']);
  assert.ok(blocks.every((block) => block.status === 'done'));
  assert.deepEqual(blocksFromSavedTrace(null), []);
});

test('labels read like the reference', () => {
  assert.equal(thoughtLabel(200), 'Thought for 1 second');
  assert.equal(thoughtLabel(7400), 'Thought for 7 seconds');
  assert.equal(durationLabel(81), '81ms');
  assert.equal(durationLabel(1400), '1.4s');
});

test('words between steps stream into one activity block; the answer is promoted out of the trace', () => {
  let blocks = fold([
    ['activity_start', { id: 'act_1' }],
    ['activity_delta', { id: 'act_1', text: 'Let me ' }],
    ['activity_delta', { id: 'act_1', text: 'check.' }],
  ]);
  assert.equal(blocks[0].status, 'running');
  assert.equal(blocks[0].text, 'Let me check.');
  blocks = applyTraceEvent(blocks, 'activity_end', { id: 'act_1', text: 'Let me check.' });
  assert.equal(blocks[0].status, 'done');
  blocks = applyTraceEvent(blocks, 'activity_start', { id: 'act_2' });
  blocks = applyTraceEvent(blocks, 'activity_delta', { id: 'act_2', text: 'The answer.' });
  const promoted = promoteActivity(blocks, 'act_2');
  assert.equal(promoted.text, 'The answer.');
  assert.deepEqual(promoted.blocks.map((block) => block.id), ['act_1']);
  // A dropped stream (failed call) vanishes; an empty ended one too.
  assert.deepEqual(applyTraceEvent(blocks, 'activity_drop', { id: 'act_2' }).map((block) => block.id), ['act_1']);
  assert.deepEqual(fold([['activity_start', { id: 'e' }], ['activity_end', { id: 'e', text: '' }]]), []);
});

test('tool rows carry what was found and what changed; changes stand alone, reads group as sources', () => {
  const blocks = fold([
    ['tool_start', { id: 'r1', category: 'read', headline: 'Reading a blog article' }], ['tool_end', { id: 'r1', ms: 5, items: ['Photosynthesis basics'] }],
    ['tool_start', { id: 'r2', category: 'read', headline: 'Searching your notes' }], ['tool_end', { id: 'r2', ms: 5 }],
    ['tool_start', { id: 'c1', category: 'action', headline: 'Creating a task' }],
    ['tool_end', { id: 'c1', ms: 9, change: { label: 'Created a task', title: 'Revise', fields: [{ label: 'Due', value: '2026-10-12' }] } }],
    ['tool_start', { id: 'q1', category: 'research', headline: 'Checking your goals' }], ['tool_end', { id: 'q1', ms: 5 }],
  ]);
  assert.deepEqual(blocks[0].items, ['Photosynthesis basics']);
  const items = groupTraceBlocks(blocks);
  assert.deepEqual(items.map((item) => item.type), ['group', 'tool', 'tool']);
  // A check right after reads starts its own row rather than joining their group.
  assert.deepEqual(groupTraceBlocks(fold([
    ['tool_start', { id: 'a', category: 'research', headline: 'A' }], ['tool_end', { id: 'a', ms: 1 }],
    ['tool_start', { id: 'b', category: 'read', headline: 'B' }], ['tool_end', { id: 'b', ms: 1 }],
    ['tool_start', { id: 'c', category: 'read', headline: 'C' }], ['tool_end', { id: 'c', ms: 1 }],
  ])).map((item) => item.type), ['tool', 'group']);
  assert.equal(groupLabel(items[0].tools), 'Read 2 sources');
  assert.equal(items[1].change.label, 'Created a task');
});

test('developer view: raw I/O lives on the live row only and is dropped from a saved trace', () => {
  const blocks = fold([
    ['tool_start', { id: 't', headline: 'Checking your goals', raw: { name: 'list_my_goals', args: '{}' } }],
    ['tool_end', { id: 't', ms: 3, raw: { output: '{"goals":[]}' } }],
  ]);
  assert.deepEqual(blocks[0].raw, { name: 'list_my_goals', args: '{}', output: '{"goals":[]}' });
  assert.ok(!('raw' in blocksFromSavedTrace(blocks)[0]));
});

test('study-prep steps become trace rows for the turn they happened in', () => {
  const events = [
    { sequence: 1, eventType: 'harness_decision', narrative: 'Checked the plan.', at: '2026-10-17T10:00:00Z' },
    { sequence: 2, eventType: 'agent_tool_call', narrative: null, at: '2026-10-17T10:00:01Z' },
    { sequence: 3, eventType: 'engine_result', narrative: 'Your agent answered 3 of 5.', at: '2026-10-17T10:05:00Z' },
  ];
  const all = studyPrepEventBlocks(events);
  assert.deepEqual(all.map((b) => b.headline), ['Checked the plan.', 'Your agent answered 3 of 5.']);
  assert.equal(all[1].description, 'The Education Engine scored it');
  assert.ok(all.every((b) => b.type === 'tool' && b.status === 'done' && b.category === 'study_prep'));
  // Their own row, apart from the turn's tool rows — even a single step.
  const turnTool = { type: 'tool', id: 't1', status: 'done', category: 'action', headline: 'Starting your study session' };
  const items = groupTraceBlocks([turnTool, ...all]);
  assert.deepEqual(items.map((i) => i.type), ['tool', 'group']);
  assert.equal(groupLabel(items[1].tools), 'Study Prep · 2 steps');
  const one = groupTraceBlocks(studyPrepEventBlocks(events.slice(0, 1)));
  assert.equal(one[0].type, 'group');
  assert.equal(groupLabel(one[0].tools), 'Study Prep · 1 step');
  const later = studyPrepEventBlocks(events, { from: Date.parse('2026-10-17T10:01:00Z') });
  assert.deepEqual(later.map((b) => b.id), ['study_prep_3']);
  assert.equal(studyPrepEventBlocks(events, { to: Date.parse('2026-10-17T10:00:00Z') }).length, 0);
});

test('study-prep rows carry the agent\'s stated intent and only real durations', () => {
  const rows = studyPrepEventBlocks([
    { sequence: 1, eventType: 'agent_tool_call', agentIntent: 'Weak topics first.', durationMs: 840, at: '2026-10-17T10:00:00Z' },
    { sequence: 2, eventType: 'harness_decision', narrative: 'Checked the plan.', at: '2026-10-17T10:00:01Z' },
  ]);
  assert.equal(rows[0].headline, 'agent says: Weak topics first.');
  assert.equal(rows[0].ms, 840);
  assert.equal(rows[1].ms, null, 'no recorded duration, none shown');
});

test('workflow v3 events become trace rows: narrated headline and detail, quiet lifecycle rows hidden, failures shown as failed', async () => {
  const { workflowEventBlocks } = await import('./agentChatTrace.js');
  const at = '2026-10-19T10:00:00Z';
  const ev = (sequence, type, narration, payload = {}) => ({ workflowId: 'w', sequence, type, timestamp: at, narration, payload });
  const rows = workflowEventBlocks([
    ev(0, 'workflow.created', { headline: 'Started Study Prep' }),
    ev(1, 'tool.started', { headline: 'Checking the syllabus' }),
    ev(2, 'tool.completed', { headline: 'Checking the syllabus', description: "Looking for your class's topics", result: 'Done' }, { durationMs: 420 }),
    ev(3, 'decision.accepted', { headline: 'Plan checked', description: 'Everything lines up.' }, { narrative: 'Everything lines up.' }),
    ev(4, 'tool.failed', { headline: 'Preparing practice', result: "Couldn't finish" }),
  ]);
  assert.deepEqual(rows.map((r) => [r.headline, r.ok, r.ms]), [['Checking the syllabus', true, 420], ['Plan checked', true, null], ['Preparing practice', false, null]]);
  assert.equal(rows[0].description, "Looking for your class's topics");
  assert.equal(workflowEventBlocks([ev(2, 'activity', { headline: 'x' })], { from: Date.parse(at) + 1 }).length, 0, 'outside the turn');
});

test('the workflow card: a tool step runs until its result; decisions are done; rejections fail; lifecycle moves are not steps', async () => {
  const { workflowCardSteps, studyPrepCardHead, AI_DRAFTED_TAG } = await import('./agentChatTrace.js');
  const n = (headline, result = '') => ({ headline, description: '', result, narration: headline });
  const ev = (sequence, type, narration, payload = {}) => ({ sequence, type, narration, payload });
  const events = [
    ev(0, 'workflow.created', n('Started Study Prep')),
    ev(1, 'tool.started', n('Checking your class syllabus'), { tool: 'syllabus.resolve_class' }),
    ev(2, 'tool.completed', n('Checking your class syllabus', 'Done'), { tool: 'syllabus.resolve_class', durationMs: 400 }),
    ev(3, 'activity', n('Outline drafted'), { decisionNode: 'syllabus_generated' }),
    ev(4, 'workflow.state_changed', n('Moved on')),
    ev(5, 'decision.rejected', n('Not allowed')),
    ev(6, 'tool.started', n('Ordering the topics'), { tool: 'concept.get_prerequisites' }),
  ];
  const steps = workflowCardSteps(events);
  assert.deepEqual(steps.map((s) => [s.headline, s.status, s.ms]), [
    ['Checking your class syllabus', 'done', 400], ['Outline drafted', 'done', null], ['Not allowed', 'failed', null], ['Ordering the topics', 'running', null],
  ]);
  assert.equal(steps[1].tag, AI_DRAFTED_TAG);
  assert.equal(workflowCardSteps(events, { running: false }).at(-1).status, 'done', 'not working now: nothing spins');
  assert.deepEqual(studyPrepCardHead('awaiting_confirmation'), { title: 'Your study plan', badge: 'Waiting for you', tone: 'wait' });
  assert.equal(studyPrepCardHead('topic_active', 'Cells').title, 'Studying: Cells');
});

test('the workflow card keeps why a step was taken and what it found', async () => {
  const { workflowCardSteps } = await import('./agentChatTrace.js');
  const n = (headline, result = '') => ({ headline, description: '', result, narration: headline });
  const steps = workflowCardSteps([
    { sequence: 1, type: 'tool.started', narration: n('Reviewing what you know'), payload: { tool: 'learner.get_state', intent: 'Find their weakest topics first.' } },
    { sequence: 2, type: 'tool.completed', narration: n('Reviewing what you know', 'Weakest: Cells 21%'), payload: { tool: 'learner.get_state', resultLine: 'Weakest: Cells 21%' } },
  ]);
  assert.deepEqual([steps.length, steps[0].why, steps[0].result, steps[0].status], [1, 'Find their weakest topics first.', 'Weakest: Cells 21%', 'done']);
});

test('a workflow run reads as the agent working: thought → tool (found) → what it said, per decision', async () => {
  const { workflowRunBlocks } = await import('./agentChatTrace.js');
  const n = (headline, description = '') => ({ headline, description, result: '', narration: headline });
  const events = [
    { sequence: 1, type: 'tool.started', narration: n('Checking the syllabus', "Looking for your class's topics"), payload: { tool: 'syllabus.resolve', intent: 'Fetch the topics first.', durationMs: 2100, iteration: 1 } },
    { sequence: 2, type: 'tool.completed', narration: n('Checking the syllabus'), payload: { tool: 'syllabus.resolve', resultLine: '6 topics found' } },
    { sequence: 3, type: 'activity', narration: n('x'), payload: { message: "I found 6 topics. Next I'll look at what you already know." } },
    { sequence: 4, type: 'activity', narration: n('Syllabus found'), payload: { decisionNode: 'syllabus_resolved', narrative: 'x' } },
    { sequence: 5, type: 'tool.started', narration: n('Reviewing what you know'), payload: { tool: 'learner.get_state', intent: 'Their state.', durationMs: 3000, iteration: 2 } },
  ];
  const live = workflowRunBlocks(events, { running: true, notes: [{ payload: { iteration: 2, thinking: 'No evidence yet; check history next.', intent: 'Their state.' } }] });
  assert.deepEqual(live.map((b) => [b.type, b.status]), [['thinking', 'done'], ['tool', 'done'], ['activity', undefined], ['thinking', 'done'], ['tool', 'running']]);
  assert.equal(live[0].text, 'Fetch the topics first.');
  assert.equal(live[1].result, '6 topics found');
  assert.match(live[3].text, /No evidence yet/, 'developer notes replace the reason for that decision');
  const done = workflowRunBlocks(events.slice(0, 3), { running: true });
  assert.equal(done.at(-1).status, 'running', 'between decisions: Thinking…');
  assert.ok(workflowRunBlocks(events, { running: false }).every((b) => b.status !== 'running'));
});

test('wakes: each is its own run; the planning run stays before them; a wake bound is never a card step', async () => {
  const { splitWakes, wakeOpen, workflowCardSteps, countdownLabel } = await import('./agentChatTrace.js');
  const at = (s) => new Date(Date.UTC(2026, 9, 19, 12, 0, s)).toISOString();
  const ev = (sequence, type, payload = {}, headline = 'x') => ({ sequence, type, timestamp: at(sequence), payload, narration: { headline } });
  const events = [
    ev(1, 'tool.started', { tool: 'syllabus.resolve', iteration: 1 }),
    ev(2, 'tool.completed', { tool: 'syllabus.resolve', iteration: 1 }),
    ev(3, 'operation.started', { operation: 'wake', wakeId: 'w1', trigger: 'plan_confirmed', label: 'You approved the plan' }, 'You approved the plan'),
    ev(4, 'tool.started', { tool: 'topic.get_notes', iteration: 1 }),
    ev(5, 'activity', { message: 'You have 2 notes.', iteration: 1 }),
    ev(6, 'operation.completed', { operation: 'wake', wakeId: 'w1' }, 'You approved the plan'),
    ev(7, 'assessment.started', { topicLabel: 'Cells' }),
    ev(8, 'operation.started', { operation: 'wake', wakeId: 'w2', trigger: 'check_scored' }, 'An Agent Check was marked'),
    ev(9, 'tool.started', { tool: 'session.get_state', iteration: 1 }),
  ];
  const { before, wakes } = splitWakes(events);
  assert.deepEqual(before.map((e) => e.sequence), [1, 2]);
  assert.deepEqual(wakes.get('w1').events.map((e) => e.sequence), [4, 5, 7], 'between wakes: with the latest one');
  assert.equal(wakes.get('w1').open, false);
  assert.equal(wakes.get('w2').open, true);
  assert.equal(wakeOpen(events, Date.parse(at(30))), true);
  assert.equal(wakeOpen(events, Date.parse(at(9)) + 4 * 60_000), false, 'a wake left open for minutes is not running');
  assert.ok(!workflowCardSteps(events).some((s) => s.id === 'wf_6'), 'the end of a wake is not a step');
  assert.equal(countdownLabel(42_000), '0:42');
  assert.equal(countdownLabel(60_000), '1:00');
  assert.equal(countdownLabel(-5), '0:00');
});

test('an upload\'s steps: tool rows and messages in time order, across its uploads; a running read', async () => {
  const { ingestRunBlocks } = await import('./agentChatTrace.js');
  const t = (s) => new Date(Date.UTC(2026, 9, 19, 12, 0, s)).toISOString();
  const a = { id: 'i1', state: 'ready', steps: [
    { id: 'sort:b', type: 'tool', headline: 'Sorting your files', result: 'a Biology past paper · Biology notes', ms: 1400, at: t(1) },
    { id: 'sort:b:say', type: 'message', text: '2 files.', at: t(2) },
    { id: 'read:i1:r1', type: 'tool', headline: 'Reading WAEC 2019', result: '8 topics · 50 questions', ms: 18000, at: t(9) },
  ] };
  const b = { id: 'i2', state: 'extracting', names: ['BIO111.pdf'], steps: [{ id: 'filed:i2', type: 'tool', headline: 'Filing into Biology — Notes', at: t(5) }] };
  const blocks = ingestRunBlocks([a, b]);
  assert.deepEqual(blocks.map((x) => x.type), ['tool', 'activity', 'tool', 'tool', 'tool']);
  assert.equal(blocks[2].headline, 'Filing into Biology — Notes', 'merged by time');
  assert.equal(blocks[4].status, 'running');
  assert.equal(blocks[4].headline, 'Reading BIO111.pdf');
  assert.equal(ingestRunBlocks([{ id: 'x', state: 'ready', steps: [] }]).length, 0, 'an older upload without steps shows nothing new');
});

test('planner notes for learners: each step with its plain reason, never the raw thinking; the messages kept apart', async () => {
  const { plannerNotes } = await import('./agentChatTrace.js');
  const out = plannerNotes([
    { type: 'thinking', id: 'a', text: 'Looking at the WAEC Biology syllabus' },
    { type: 'tool', id: 'b', headline: 'Reading the syllabus', result: '32 topics', status: 'done', ok: true },
    { type: 'thinking', id: 'c', text: 'raw chain of thought…', source: 'reasoning' },
    { type: 'tool', id: 'd', headline: 'Putting topics in order', status: 'running' },
    { type: 'activity', id: 'e', text: 'Your plan is ready.' },
  ]);
  assert.deepEqual(out.steps.map((s) => [s.headline, s.reason, s.result, s.running]), [
    ['Reading the syllabus', 'Looking at the WAEC Biology syllabus', '32 topics', false],
    ['Putting topics in order', '', '', true],
  ]);
  assert.deepEqual(out.said.map((b) => b.text), ['Your plan is ready.']);
  assert.equal(out.running, true);
});

test('an Agent Check card: one tracking line from its run — running with the count, then the result', async () => {
  const { agentCheckCard } = await import('./agentChatTrace.js');
  const q = (n) => ({ type: 'tool.completed', payload: { tool: 'study_prep.check_question', headline: `Q${n} of 5` } });
  const check = { total: 5, battleId: 'b1' };
  assert.deepEqual(agentCheckCard(check, []), { state: 'running', line: 'Running in Battles · 0 of 5 answered', answered: 0, total: 5 });
  assert.equal(agentCheckCard(check, [q(1), q(2), q(3)]).line, 'Running in Battles · 3 of 5 answered');
  const marked = { type: 'tool.completed', payload: { tool: 'study_prep.check_marked', headline: 'Marked: 2 of 5 · below the pass mark (80%)' } };
  assert.deepEqual(agentCheckCard(check, [q(1), marked]), { state: 'marked', line: '2 of 5 · below the pass mark (80%)', answered: 1, total: 5 });
  assert.equal(agentCheckCard(check, [{ type: 'tool.completed', payload: { tool: 'study_prep.check_marked', headline: 'Marked: 5 of 5 · passed' } }]).state, 'passed');
  assert.equal(agentCheckCard(check, [{ type: 'tool.completed', payload: { tool: 'study_prep.check_marked', headline: 'Agent Check stopped: Osmosis' } }]).state, 'stopped');
});
