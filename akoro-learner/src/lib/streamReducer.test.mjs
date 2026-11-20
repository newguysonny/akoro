// node --test src/lib/streamReducer.test.mjs — the shared stream reducer (Grand Plan §13.2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { streamReducer, reduceStream, initialStreamState, settle } from '../features/agent-chat/lib/streamReducer.js';
import { groupTraceBlocks } from './agentChatTrace.js';

let seq = 0;
const wf = (type, payload = {}, extra = {}) => ({
  v: 3, workflowId: 'W1', workflowType: 'study_prep', sequence: ++seq, type, visibility: 'learner', payload,
  narration: { headline: extra.headline || type, description: extra.description || '', result: extra.result || '' }, ...extra,
});

test('thinking → tools → activity, in any order; tools fold into TraceBlocks groups', () => {
  seq = 0;
  const s = reduceStream([
    wf('agent.narration.start', {}, { contextSet: 'planning' }),
    { v: 3, type: 'agent.narration.delta', turnId: 't', payload: { text: 'Checking the syllabus first.' } },
    wf('agent.narration', { durationMs: 2000 }),
    wf('tool.started', { tool: 'syllabus.resolve' }, { headline: 'Checking the syllabus' }),
    wf('tool.completed', { tool: 'syllabus.resolve', resultLine: '6 topics found', durationMs: 142 }),
    wf('tool.started', { tool: 'learner.get_state' }, { headline: 'Reviewing what you know' }),
    wf('tool.completed', { tool: 'learner.get_state', resultLine: '2 weak topics', durationMs: 90 }),
    wf('activity', { message: 'I found six topics; two need work.' }),
  ], { now: 5000 });
  assert.deepEqual(s.items.map((b) => b.type), ['thinking', 'tool', 'tool', 'activity']);
  assert.equal(s.items[0].text, 'Checking the syllabus first.');
  assert.equal(s.items[0].ms, 2000);
  assert.equal(s.items[0].contextSet, 'planning');
  assert.deepEqual(s.items.slice(1, 3).map((b) => [b.status, b.ok, b.result, b.ms]), [['done', true, '6 topics found', 142], ['done', true, '2 weak topics', 90]]);
  assert.deepEqual(groupTraceBlocks(s.items).map((b) => b.type), ['thinking', 'group', 'activity'], 'the existing ToolGroup renders them');
  // A lone activity, no thinking or tools, is valid too.
  assert.deepEqual(reduceStream([wf('activity', { message: 'Hi' })]).items.map((b) => b.type), ['activity']);
});

test('cards: score, plan + its gate, handoff, and the red verification row', () => {
  seq = 0;
  const s = reduceStream([
    wf('decision.proposed', { plan: { title: 'Basic Science', coins: 12, topics: ['Water cycle', { label: 'Evaporation', minutes: 20 }] } }),
    wf('learner.action_required', { action: 'approve_plan', label: 'Approve the plan', options: ['Approve', { id: 'adjust', label: 'Change it' }] }),
    wf('learner.action_received', { action: 'approve_plan', choice: 'Approve' }),
    wf('decision.rejected', { code: 'over_budget', reason: 'That would pass the coins you approved' }, { headline: 'Not allowed' }),
    wf('assessment.completed', { topicLabel: 'Evaporation', score: 4, total: 5, passed: true }),
    wf('workflow.handoff_created', { childWorkflowId: 'T9', to: 'teaching', topicLabel: 'Transpiration' }),
    wf('workflow.handoff_completed', { childWorkflowId: 'T9', outcome: 'taught' }),
  ]);
  const by = Object.fromEntries(s.items.map((b) => [b.type === 'tool' ? 'verification' : b.type, b]));
  assert.deepEqual(by.plan.topics, [{ label: 'Water cycle' }, { label: 'Evaporation', minutes: 20 }]);
  assert.equal(by.plan.status, 'approved');
  assert.equal(by.gate.status, 'answered');
  assert.deepEqual(by.gate.options.map((o) => o.label), ['Approve', 'Change it']);
  assert.deepEqual([by.verification.ok, by.verification.verification, by.verification.result], [false, true, 'That would pass the coins you approved']);
  assert.deepEqual([by.score.score, by.score.total, by.score.percentage, by.score.passed, by.score.title], [4, 5, 80, true, 'Evaporation']);
  assert.deepEqual([by.handoff.status, by.handoff.outcome, by.handoff.title], ['completed', 'taught', 'Transpiration']);
});

test('the workflow badge follows status and state; a terminal status sticks', () => {
  seq = 0;
  let s = reduceStream([wf('workflow.created', {}, { workflowState: 'planning' }), wf('learner.action_required', { label: 'Your turn' }, { workflowState: 'awaiting_confirmation' })]);
  assert.deepEqual(s.workflow, { id: 'W1', type: 'study_prep', status: 'waiting_learner', state: 'awaiting_confirmation', subState: null });
  s = streamReducer(s, wf('workflow.completed', {}, { workflowState: 'completed' }));
  s = streamReducer(s, wf('workflow.resumed'));
  assert.equal(s.workflow.status, 'completed');
});

test('replayed events are ignored; developer-only events need developer mode, which adds the dev line', () => {
  seq = 0;
  const e1 = wf('activity', { message: 'One' });
  let s = streamReducer(initialStreamState(), e1);
  assert.equal(streamReducer(s, e1), s, 'same sequence again: unchanged');
  const dev = wf('tool.started', { tool: 'plan.validate', durationMs: 30 }, { visibility: 'developer', contextSet: 'planning', operation: 'validate' });
  assert.equal(streamReducer(s, dev), s, 'a learner never sees developer events');
  s = streamReducer(s, dev, { developer: true });
  const row = s.items.at(-1);
  assert.equal(row.dev.tool, 'plan.validate');
  assert.equal(row.dev.operation, 'validate');
  assert.equal(row.dev.sequence, dev.sequence);
  assert.equal(s.items[0].dev, undefined);
});

test('chat envelopes: streamed activity promoted to the reply, dropped text discarded, the reply settles what runs', () => {
  const chat = (type, payload = {}) => ({ v: 3, type, turnId: 't1', workflowType: 'agent_chat', visibility: 'learner', payload });
  const s = reduceStream([
    chat('tool.started', { id: 'a', headline: 'Checking your goals' }),
    chat('activity.start'), chat('activity.delta', { text: 'Half a ' }), chat('activity.drop'),
    chat('activity.start'), chat('activity.delta', { text: 'The answer ' }), chat('activity.promote'),
    chat('reply.delta', { text: 'is 42.' }), chat('reply'),
  ], { now: 1000 });
  assert.equal(s.reply, 'The answer is 42.');
  assert.equal(s.replyDone, true);
  assert.deepEqual(s.items.map((b) => [b.type, b.status]), [['tool', 'done']]);
  assert.equal(settle([{ type: 'tool', status: 'running', startedAt: 0 }], 500, { stopped: true })[0].status, 'stopped');
});

test('nothing for bad input', () => {
  const s = initialStreamState();
  assert.equal(streamReducer(s, null), s);
  assert.equal(streamReducer(s, { type: '' }), s);
  assert.equal(streamReducer(s, { type: 'tool.completed', visibility: 'audit' }), s);
});
