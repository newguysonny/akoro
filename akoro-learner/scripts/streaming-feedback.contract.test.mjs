import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Streaming token feedback contract (REASON → ACT → OBSERVE → LLM, drawn
 * live): the orchestrators emit student_token / guide_token as replies are
 * generated; the session UIs must accumulate them into live bubbles with a
 * blinking caret and drop them the moment turn_complete lands.
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
// Teaching moved to src/features/teaching and split into hook + views.
const teach = (await Promise.all([
  read("../src/features/teaching/components/TeachAgentModal.jsx"),
  read("../src/features/teaching/hooks/useTeachAgent.js"),
])).join("\n");
const decay = await read("../src/features/teaching/components/DecaySessionModal.jsx");
const chatView = await read("../src/features/teaching/components/SessionChatView.jsx");
const aiChat = await read("../src/features/agent-chat/AgentChatTab.jsx");
const caret = await read("../src/components/common/StreamCaret.jsx");

test("session modals observe protégé and guide token streams", () => {
  for (const [name, src] of [["TeachAgentModal", teach], ["DecaySessionModal", decay]]) {
    assert.match(src, /ws\.on\("student_token"/, `${name} ignores protégé tokens`);
    assert.match(src, /ws\.on\("guide_token"/, `${name} ignores guide tokens`);
    // Both wire shapes are accepted: node socket {token}, python SSE {text}.
    assert.match(src, /d\?\.token \?\? d\?\.text/);
    // Live bubbles never outlive their turn.
    assert.match(src, /clearLiveStream\(\)/);
    assert.match(src, /turn_complete/);
  }
});

test("SessionChatView draws the stream with a blinking caret", () => {
  assert.match(chatView, /liveStudent/);
  assert.match(chatView, /liveGuide/);
  // Caret comes from the shared component (keyframes live there).
  assert.match(chatView, /import StreamCaret from '\.\.\/\.\.\/\.\.\/components\/common\/StreamCaret\.jsx';/);
  assert.match(chatView, /<StreamCaret\/>/);
  // The "waiting" dots yield to the stream once tokens arrive.
  assert.match(chatView, /loading && !liveStudent && !liveGuide/);
});

test("AI chat ends its streaming answer and thought process with the caret", () => {
  // The caret is the one shared implementation, not a local copy.
  assert.match(caret, /ak-caret-blink/);
  assert.match(caret, /prefers-reduced-motion/);
  assert.match(chatView, /import StreamCaret from '\.\.\/\.\.\/\.\.\/components\/common\/StreamCaret\.jsx';/);
  // The answer bubble shows the caret only while tokens still arrive
  // (phase "answering"); onDone flips the phase and the caret drops.
  assert.match(aiChat, /msg\.phase==="answering"&&<StreamCaret\/>/);
  // The reasoning summary streams into the ThoughtBlock with a caret too.
  assert.match(aiChat, /streaming && expanded && <StreamCaret\/>/);
  assert.match(aiChat, /import StreamCaret from '\.\.\/\.\.\/components\/common\/StreamCaret\.jsx';/);
});
