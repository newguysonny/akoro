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
