import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const tab = await readFile(new URL('../components/tabs/AgentChatTab.jsx', import.meta.url), 'utf8');
const api = await readFile(new URL('../services/api.js', import.meta.url), 'utf8');
const composer = await readFile(new URL('../components/common/FortizoChatComposer.jsx', import.meta.url), 'utf8');
const blocks = await readFile(new URL('../components/tabs/agentChat/TraceBlocks.jsx', import.meta.url), 'utf8');

const between = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));

test('thinking, tools and text stream as interleaved steps of one turn', () => {
  assert.match(api, /TRACE_EVENTS = new Set\(\[\s+'think_start', 'think_delta', 'think_end', 'tool_start', 'tool_end',\s+'activity',/);
  assert.match(api, /onTrace\?\.\(event, parsed\)/);
  const send = between(tab, 'const sendMessage=async', 'const toLocalInput=');
  assert.match(send, /onTrace: appendTrace/);
  assert.match(send, /applyTraceEvent\(m\.blocks,event,data,Date\.now\(\)\)/);
  assert.match(tab, /<TraceBlocks blocks=\{\[\.\.\.\(msg\.blocks\|\|\[\]\),\.\.\.studyPrepSteps\(msg\)\]\}\/>/);
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
  // Each saved message (the open page and every older page) rebuilds through fromSaved.
  const saved = between(tab, 'const fromSaved = (m)', 'const openSession = async');
  assert.match(saved, /blocksFromSavedTrace\(m\.trace\)/);
  const open = between(tab, 'const openSession = async', 'const retryHistoryLoad');
  assert.match(open, /map\(fromSaved\)/);
});

test('the trace UI never shows backend tool names (only the opt-in developer view shows raw I/O)', () => {
  assert.doesNotMatch(blocks, /\.tool\b/);
  assert.match(blocks, /<RawPanels raw=\{block\.raw\}\/>/);
  // Developer view is opt-in, per device, and sent with the turn.
  assert.match(tab, /\.\.\.\(devView \? \{ developer: true \} : \{\}\)/);
  assert.match(tab, /role="switch" aria-checked=\{devView\}/);
  assert.match(blocks, /What I checked/);
  assert.match(blocks, /What I found/);
});

test('the last step\'s streamed words become the reply instead of being written twice', () => {
  const send = between(tab, 'const sendMessage=async', 'const toLocalInput=');
  assert.match(send, /if\(event==="activity_promote"\)/);
  assert.match(send, /promoteActivity\(m\.blocks, data\?\.id\)/);
  assert.match(api, /'activity_start', 'activity_delta', 'activity_end', 'activity_promote', 'activity_drop'/);
  assert.match(blocks, /<ChangeRow key=\{item\.id\} block=\{item\}\/>/);
});

test('history loads a page at a time: the newest 10 on open, older pages on scrolling to the top', () => {
  assert.match(tab, /const HISTORY_PAGE = 10;/);
  const open = between(tab, 'const openSession = async', 'const retryHistoryLoad');
  assert.match(open, /messages\?limit=\$\{HISTORY_PAGE\}/);
  const older = between(tab, 'const loadOlder = async', 'const removeSession');
  assert.match(older, /&before=\$\{encodeURIComponent\(page\.before\)\}/);
  assert.match(older, /\[\.\.\.fresh, \.\.\.prev\]/);
  assert.match(tab, /if\(el\.scrollTop<80\) loadOlder\(\);/);
  // The reading position is kept when older messages go in above.
  assert.match(tab, /el\.scrollTop=el\.scrollHeight-kept\.height\+kept\.top;/);
  // Copy chat still asks for the whole transcript (no limit).
  const copy = between(tab, 'const copySession = async', 'useEffect(');
  assert.match(copy, /sessions\/\$\{s\.id\}\/messages`\)/);
});
