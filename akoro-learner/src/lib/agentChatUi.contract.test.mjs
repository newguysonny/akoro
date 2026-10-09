import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const tab = await readFile(new URL('../components/tabs/AgentChatTab.jsx', import.meta.url), 'utf8');
const api = await readFile(new URL('../services/api.js', import.meta.url), 'utf8');
const composer = await readFile(new URL('../components/common/FortizoChatComposer.jsx', import.meta.url), 'utf8');
const blocks = await readFile(new URL('../components/tabs/agentChat/TraceBlocks.jsx', import.meta.url), 'utf8');

const between = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));

test('thinking, tools and text stream as interleaved steps of one turn', () => {
  assert.match(api, /TRACE_EVENTS = new Set\(\['think_start', 'think_end', 'tool_start', 'tool_end', 'activity'\]\)/);
  assert.match(api, /onTrace\?\.\(event, parsed\)/);
  const send = between(tab, 'const sendMessage=async', 'const toLocalInput=');
  assert.match(send, /onTrace: appendTrace/);
  assert.match(send, /applyTraceEvent\(m\.blocks,event,data,Date\.now\(\)\)/);
  assert.match(tab, /<TraceBlocks blocks=\{msg\.blocks\}\/>/);
  // Consecutive tool rows group; thinking rows read "Thought for Ns".
  assert.match(blocks, /groupTraceBlocks\(blocks\)/);
  assert.match(blocks, /thoughtLabel\(/);
});

test('the ■ stop button replaces send while a turn is running, and stopping never re-runs the turn', () => {
  assert.match(composer, /running && onStop \?/);
  assert.match(tab, /running=\{running\}\s+onStop=\{stopTurn\}/);
  const stop = between(tab, 'const stopTurn=async', 'const toLocalInput=');
  // The explicit stop request goes first; only then does the stream close.
  const stopAt = stop.indexOf('apiPost(AGENT_CHAT_STOP_ENDPOINT, { turnId })');
  assert.ok(stopAt > 0 && stop.indexOf('controller.abort()') > stopAt);
  assert.match(api, /\.\.\.\(signal \? \{ signal \} : \{\}\)/);
  const send = between(tab, 'const sendMessage=async', 'const toLocalInput=');
  assert.match(send, /signal: controller\?\.signal/);
  // An aborted stream is handled BEFORE the non-streaming fallback branch.
  const abortedAt = send.indexOf('if(controller?.signal.aborted)');
  const fallbackAt = send.indexOf('apiPost(agentChatEndpoint(), payload)');
  assert.ok(abortedAt > 0 && fallbackAt > abortedAt, 'stop must short-circuit the JSON retry');
  assert.match(send, /setRunning\(false\)/);
});

test('the view follows new output only at the bottom; otherwise a ↓ jump button appears', () => {
  assert.match(tab, /el\.scrollHeight-el\.scrollTop-el\.clientHeight<80/);
  assert.match(tab, /if\(atBottomRef\.current\) feedRef\.current\.scrollTop=feedRef\.current\.scrollHeight;\s+else setShowJump\(true\);/);
  assert.match(tab, /onScroll=\{onFeedScroll\}/);
  assert.match(tab, /\{showJump&&\(/);
  assert.match(tab, /onClick=\{\(\)=>scrollToLatest\(true\)\}/);
  // Sending your own message always brings you back to the bottom.
  assert.match(tab, /atBottomRef\.current=true; setShowJump\(false\);/);
});

test('a reloaded chat rebuilds the same steps from the saved trace', () => {
  const open = between(tab, 'const openSession = async', 'const retryHistoryLoad');
  assert.match(open, /blocksFromSavedTrace\(m\.trace\)/);
});

test('the trace UI never shows backend tool names', () => {
  assert.doesNotMatch(blocks, /\.tool\b/);
  assert.match(blocks, /What I checked/);
  assert.match(blocks, /What I found/);
});
