import assert from 'node:assert/strict';
import test from 'node:test';
import { homeNeedsYou, homeHref, NEEDS_YOU_HREF } from './needsYouHome.js';

const wf = { ref: 'w:1', source: 'workflow', category: 'answer', title: 'Teaching: Transpiration', action: { label: 'Continue', href: '/app?workflow=abc' } };
const sug = { ref: 'i:2', source: 'suggestion', category: 'decision', title: 'Join a circle?', action: { label: 'Decide', href: '/app?tab=agent&inbox=x' } };

test('nothing waiting and nothing running → no card', () => {
  assert.equal(homeNeedsYou({ needsYou: { items: [] }, workflows: [] }), null);
  assert.equal(homeNeedsYou(null), null);
});

test('an open workflow leads, even when it is not first; the rest are counted', () => {
  const r = homeNeedsYou({ needsYou: { items: [sug, wf] } });
  assert.equal(r.lead.ref, 'w:1');
  assert.equal(r.more, 1);
  assert.equal(r.total, 2);
});

test('with no workflow, the first item leads', () => {
  assert.equal(homeNeedsYou({ needsYou: { items: [sug] } }).lead.ref, 'i:2');
});

test('only running work → a card with no lead, just the working line', () => {
  const r = homeNeedsYou({ needsYou: { items: [] }, workflows: [{ workflowId: 'a', title: 'Agent Check', action: { route: {} } }] });
  assert.equal(r.lead, null);
  assert.equal(r.working.length, 1);
});

test('links: workflows open their screen; inbox items open Tasks → Suggestions; "see all" opens Needs you', () => {
  assert.equal(homeHref(wf), '/app?workflow=abc');
  assert.equal(homeHref(sug), '/app?tab=agent&tasks=suggestions');
  assert.equal(homeHref({}), NEEDS_YOU_HREF);
  assert.equal(NEEDS_YOU_HREF, '/app?tab=agent&tasks=needs');
});
