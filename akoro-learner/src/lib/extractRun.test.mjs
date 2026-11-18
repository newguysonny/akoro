import assert from 'node:assert/strict';
import test from 'node:test';
import { runExtraction } from './extractRun.js';

/**
 * A fake API: POST queues a batch, each status poll finishes one page.
 * `script(pageNumber)` decides each page's fate: 'ok' | 'fail'.
 */
function fakeApi({ script = () => 'ok', busyFirst = 0 } = {}) {
  const calls = { submits: [], polls: 0 };
  let queue = [];
  let busy = busyFirst;   // 409s to answer before accepting
  return {
    calls,
    submit: async ({ pages }) => {
      if (busy > 0) {
        busy -= 1;
        queue = [{ pageNumber: 99, other: true }];   // another opener's batch
        const e = new Error('busy'); e.status = 409; throw e;
      }
      calls.submits.push(pages.map((p) => p.pageNumber));
      queue = pages.map((p) => ({ pageNumber: p.pageNumber }));
      return { pending: queue.map((q) => q.pageNumber) };
    },
    poll: async () => {
      calls.polls += 1;
      const next = queue.shift();
      const st = { done: queue.length === 0, pages: [], failed: [], pending: queue.map((q) => q.pageNumber) };
      if (next && !next.other) {
        if (script(next.pageNumber) === 'ok') st.pages.push({ pageNumber: next.pageNumber, markdown: `p${next.pageNumber}`, blocks: [] });
        else st.failed.push({ pageNumber: next.pageNumber, error: 'empty answer' });
      }
      return st;
    },
  };
}

const pages = (n) => Array.from({ length: n }, (_, i) => ({ pageNumber: i + 1, imageBase64: 'x' }));
const fast = { pollMs: 0, sleep: async () => {} };

test('pages go up in batches of 16; each batch is polled to completion before the next', async () => {
  const api = fakeApi();
  const progress = [];
  const res = await runExtraction({ ...api, ...fast, recordId: 'r', pages: pages(20), onProgress: (d, t) => progress.push([d, t]) });
  assert.deepEqual(api.calls.submits, [Array.from({ length: 16 }, (_, i) => i + 1), [17, 18, 19, 20]]);
  assert.deepEqual(res.pages.map((p) => p.pageNumber), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(res.error, null);
  assert.deepEqual(progress.at(-1), [20, 20]);
});

test('a batch also closes when the base64 budget fills, however few pages that is', async () => {
  const api = fakeApi();
  const big = Array.from({ length: 3 }, (_, i) => ({ pageNumber: i + 1, imageBase64: 'x'.repeat(8 * 1024 * 1024) }));
  const res = await runExtraction({ ...api, ...fast, recordId: 'r', pages: big });
  assert.deepEqual(api.calls.submits, [[1], [2], [3]], 'two 8 MB pages would breach the 14 MB batch budget');
  assert.equal(res.pages.length, 3);
});

test('failed pages are reported with a readable error; saved pages are kept', async () => {
  const api = fakeApi({ script: (n) => (n === 3 || n === 5 ? 'fail' : 'ok') });
  const res = await runExtraction({ ...api, ...fast, recordId: 'r', pages: pages(6) });
  assert.deepEqual(res.pages.map((p) => p.pageNumber), [1, 2, 4, 6]);
  assert.deepEqual(res.failed.map((f) => f.pageNumber), [3, 5]);
  assert.match(res.error, /2 pages could not be read \(pages 3, 5\)/);
});

test('a 409 means another batch holds the file: help finish it, then submit ours', async () => {
  const api = fakeApi({ busyFirst: 1 });
  const res = await runExtraction({ ...api, ...fast, contentKey: 'shared/key', pages: pages(3) });
  assert.deepEqual(api.calls.submits, [[1, 2, 3]], 'our batch went up after the other one finished');
  assert.deepEqual(res.pages.map((p) => p.pageNumber), [1, 2, 3]);
});

test('closing the reader stops polling at once', async () => {
  const api = fakeApi();
  let open = true;
  const res = await runExtraction({
    ...api, ...fast, recordId: 'r', pages: pages(8),
    onProgress: () => { open = false; },
    isCancelled: () => !open,
  });
  assert.equal(res.error, 'Stopped.');
  assert.equal(api.calls.polls, 1);
});

test('a batch that never settles stops at the deadline instead of polling forever', async () => {
  let t = 0;
  const api = { submit: async () => ({ pending: [1] }), poll: async () => ({ done: false, pages: [], failed: [], pending: [1] }) };
  const res = await runExtraction({ ...api, pollMs: 0, sleep: async () => { t += 60_000; }, now: () => t, recordId: 'r', pages: pages(1) });
  assert.match(res.error, /taking too long/);
});

test('pages another opener saved are filled in from the saved extraction', async () => {
  const api = {
    submit: async () => ({ pending: [1, 2] }),
    poll: async () => ({ done: true, pages: [{ pageNumber: 1, markdown: 'p1', blocks: [] }], failed: [], pending: [] }),
  };
  const res = await runExtraction({
    ...api, ...fast, recordId: 'r', pages: pages(2),
    readSaved: async () => ({ pages: [{ pageNumber: 1, markdown: 'p1' }, { pageNumber: 2, markdown: 'p2 (saved by someone else)' }, { pageNumber: 9, markdown: 'not ours' }] }),
  });
  assert.deepEqual(res.pages.map((p) => p.markdown), ['p1', 'p2 (saved by someone else)']);
  assert.equal(res.error, null);
});

test('a 429 on submit or poll backs off and carries on instead of failing the run', async () => {
  const api = fakeApi();
  let submit429 = 1, poll429 = 2;
  const res = await runExtraction({
    ...fast, recordId: 'r1', pages: pages(3),
    submit: async (a) => { if (submit429-- > 0) { const e = new Error("That's a lot at once"); e.status = 429; throw e; } return api.submit(a); },
    poll: async (a) => { if (poll429-- > 0) { const e = new Error('slow down'); e.status = 429; throw e; } return api.poll(a); },
  });
  assert.equal(res.error, null);
  assert.deepEqual(res.pages.map((p) => p.pageNumber), [1, 2, 3]);
});

test('a rate limit that never lifts still ends with an error', async () => {
  const res = await runExtraction({
    ...fast, recordId: 'r1', pages: pages(1),
    submit: async () => ({ pending: [1] }),
    poll: async () => { const e = new Error("That's a lot at once"); e.status = 429; throw e; },
  });
  assert.match(res.error, /a lot at once/);
});

test('a dropped poll rides out the blip: the run continues and completes', async () => {
  const api = fakeApi();
  const realPoll = api.poll;
  let drops = 0, attempts = 0;
  api.poll = async () => {
    attempts += 1;
    if (attempts === 3 || attempts === 4) { drops += 1; throw new TypeError('Failed to fetch'); }
    return realPoll();
  };
  const sleeps = [];
  const out = await runExtraction({ ...api, recordId: 'r1', pages: pages(3),
    pollMs: 0, sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); } });
  assert.equal(out.error, null);
  assert.equal(out.pages.length, 3);
  assert.equal(drops, 2);
  assert.ok(sleeps.includes(5000), 'the backoff sleep ran between retries');
});

test('a submit that fails to fetch is retried, not fatal', async () => {
  const api = fakeApi();
  const realSubmit = api.submit;
  let drops = 0;
  api.submit = async (args) => {
    if (api.calls.submits.length === 0 && drops === 0) { drops += 1; throw new TypeError('Failed to fetch'); }
    return realSubmit(args);
  };
  const out = await runExtraction({ ...api, recordId: 'r1', pages: pages(2),
    pollMs: 0, sleep: async () => {} });
  assert.equal(out.error, null);
  assert.equal(out.pages.length, 2);
  assert.equal(drops, 1, 'the dropped submit was retried');
});

test('a sustained outage still ends the run with an error', async () => {
  const api = fakeApi();
  api.poll = async () => { api.calls.polls += 1; throw new TypeError('Failed to fetch'); };
  const out = await runExtraction({ ...api, recordId: 'r1', pages: pages(1),
    pollMs: 0, sleep: async () => {} });
  assert.match(out.error, /Failed to fetch/);
});

test('a 409 run that still collected every page reports clean, not busy', async () => {
  // Another opener holds the claim the whole time, but their batch settles
  // while we poll: the pages are ours from the cache — no error.
  const calls = { submits: 0, polls: 0 };
  const submit = async () => {
    calls.submits += 1;
    const e = new Error('busy'); e.status = 409; throw e;
  };
  const poll = async () => {
    calls.polls += 1;
    return { done: true, pages: [{ pageNumber: 1, markdown: 'cached', blocks: [] }], failed: [], pending: [] };
  };
  const out = await runExtraction({ submit, poll, recordId: 'r1', pages: pages(1), pollMs: 0, sleep: async () => {} });
  assert.equal(out.error, null);
  assert.equal(out.pages.length, 1);
  assert.equal(out.pages[0].markdown, 'cached');
});
