import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTraceEvent, blocksFromSavedTrace, durationLabel, groupLabel, groupTraceBlocks, settleRunning, thoughtLabel,
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
