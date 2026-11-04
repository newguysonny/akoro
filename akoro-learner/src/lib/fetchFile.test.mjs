import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchFileWithRetry } from './fetchFile.js';

const noSleep = { sleep: async () => {} };
const ok = () => new Response('bytes', { status: 200 });
const notFound = () => new Response('', { status: 404 });
const boom = () => new Response('', { status: 502 });

test('a dropped file read is retried and the run proceeds', async () => {
  let attempts = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError('Failed to fetch');
    return ok();
  };
  try {
    const res = await fetchFileWithRetry('https://store/x.png', noSleep);
    assert.equal(res.status, 200);
    assert.equal(attempts, 2);
  } finally { globalThis.fetch = real; }
});

test('a 500 answers with a retry, a 404 comes back immediately', async () => {
  let calls = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls += 1;
    if (String(url).includes('gone')) return notFound();
    return calls === 1 ? boom() : ok();
  };
  try {
    assert.equal((await fetchFileWithRetry('https://store/x.png', noSleep)).status, 200);
    const start = calls;
    assert.equal((await fetchFileWithRetry('https://store/gone.png', noSleep)).status, 404);
    assert.equal(calls, start + 1, 'a 404 is a real answer — no retries');
  } finally { globalThis.fetch = real; }
});

test('a sustained outage still throws, saying the store was unreachable', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  try {
    await assert.rejects(() => fetchFileWithRetry('https://store/x.png', noSleep), /could not be reached/);
  } finally { globalThis.fetch = real; }
});

test('reachable-but-blocked is named as CORS, not a dead network', async () => {
  const real = globalThis.fetch;
  let opaqueProbed = false;
  globalThis.fetch = async (url, opts = {}) => {
    if (opts.mode === 'no-cors') { opaqueProbed = true; return { type: 'opaque' }; }
    throw new TypeError('Failed to fetch');
  };
  try {
    await assert.rejects(
      () => fetchFileWithRetry('https://store/x.png', noSleep),
      (e) => { assert.match(e.message, /CORS/); assert.equal(e.corsBlocked, true); return true; },
    );
    assert.equal(opaqueProbed, true, 'the opaque probe ran');
  } finally { globalThis.fetch = real; }
});
