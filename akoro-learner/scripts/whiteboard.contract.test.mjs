import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Whiteboard contract — the session composer gains a board tool beside the
 * reader tool; it opens a frontend-only sketchpad (canvas, pointer events,
 * stroke-stack undo, destination-out eraser). No API: nothing leaves the
 * device.
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [composer, chatView, board, teach, decay] = await Promise.all([
  read("../src/components/common/FortizoChatComposer.jsx"),
  read("../src/features/teaching/components/SessionChatView.jsx"),
  read("../src/features/teaching/components/WhiteboardModal.jsx"),
  // Teaching moved to src/features/teaching; the composer prop lives in the
  // chat view and the modal in the shell after the split.
  Promise.all([
    read("../src/features/teaching/components/TeachAgentModal.jsx"),
    read("../src/features/teaching/components/TeachAgentChat.jsx"),
  ]).then((a) => a.join("\n")),
  read("../src/features/teaching/components/DecaySessionModal.jsx"),
]);

test("the composer gains a whiteboard tool beside the reader tool", () => {
  assert.match(composer, /boardAction,/);
  assert.match(composer, /\{boardAction && \(/);
  assert.match(composer, /icon="ti-edit" label="Whiteboard"/);
  // The reader tool's contract is untouched: book-only when bookAction passed.
  assert.match(composer, /\{bookAction && \(/);
});

test("the session view passes the board opener to both composer variants", () => {
  assert.match(chatView, /onOpenBoard,/);
  const sites = (chatView.match(/boardAction=\{onOpenBoard\}/g) || []).length;
  assert.equal(sites, 2, "teach and guide composers both carry the board tool");
});

test("the whiteboard is a real canvas sketchpad", () => {
  assert.match(board, /<canvas/);
  // Pointer events, not mouse-only — pen and touch draw.
  assert.match(board, /onPointerDown=\{onDown\}/);
  assert.match(board, /setPointerCapture/);
  assert.match(board, /touchAction: 'none'/);
  // Erase truly erases; undo pops the stroke stack.
  assert.match(board, /destination-out/);
  assert.match(board, /strokesRef\.current\.pop\(\)/);
  // Hi-DPI crisp lines.
  assert.match(board, /devicePixelRatio/);
});

test("both session surfaces open it", () => {
  assert.match(teach, /import WhiteboardModal from '\.\/WhiteboardModal\.jsx';/);
  assert.match(teach, /onOpenBoard=\{\(\) => setBoardOpen\(true\)\}/);
  assert.match(teach, /\{boardOpen && \(/);
  assert.match(decay, /import WhiteboardModal from '\.\/WhiteboardModal\.jsx';/);
  assert.match(decay, /onOpenBoard=\{\(\) => setBoardOpen\(true\)\}/);
  assert.match(decay, /\{boardOpen && <WhiteboardModal/);
});
