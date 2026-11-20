import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (f) => readFile(new URL(f, import.meta.url), 'utf8');

test('shared stream cards: one badge, score ring, red refused row, dev line', async () => {
  const src = await read('./StreamCards.jsx');
  for (const name of ['WorkflowStateBadge', 'ScoreRing', 'RejectedRow', 'DevLine']) assert.match(src, new RegExp(`export function ${name}`));
  for (const tone of ['your_turn', 'working', 'paused', 'failed', 'done']) assert.match(src, new RegExp(`${tone}:`));
});

test('the Study Prep plan uses Allow / Reject / Later; Reject ends the session before anything is spent', async () => {
  const card = await read('../../../components/tabs/studyPrep/StudyPrepChatCard.jsx');
  assert.match(card, /<ApprovalButtons onAllow=\{confirmPlan\} onReject=\{rejectPlan\}/);
  assert.match(card, /cancelStudyPrepSession\(session\.id\)/);
  assert.doesNotMatch(card, />Approve & Start</);
  assert.match(card, /<ScoreRing /);
  assert.match(card, /developer && <DevLine/);
});

test('refused steps render as the red row; Needs you rows carry the server badge', async () => {
  const [trace, needs] = await Promise.all([read('./TraceBlocks.jsx'), read('./NeedsYouList.jsx')]);
  assert.match(trace, /if \(block\.verification\) return <RejectedRow/);
  assert.match(needs, /<WorkflowStateBadge badge=\{it\.badge\}/);
});
