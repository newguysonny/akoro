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
const teach = await read("../src/components/teaching/TeachAgentModal.jsx");
const decay = await read("../src/components/teaching/DecaySessionModal.jsx");
const chatView = await read("../src/components/teaching/SessionChatView.jsx");

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
  assert.match(chatView, /ak-caret/);
  assert.match(chatView, /ak-caret-blink/);
  // Reduced motion gets a static caret, not a blinking one.
  assert.match(chatView, /prefers-reduced-motion/);
  // The "waiting" dots yield to the stream once tokens arrive.
  assert.match(chatView, /loading && !liveStudent && !liveGuide/);
});
