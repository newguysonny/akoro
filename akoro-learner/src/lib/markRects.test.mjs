import assert from 'node:assert/strict';
import test from 'node:test';
import { selectionRects, cleanRects } from './markRects.js';

const box = { left: 100, top: 50, width: 400, height: 800 };
const r = (left, top, width, height) => ({ left, top, width, height });

test('client rects become page percentages; slivers and duplicates go, touching boxes on a line merge', () => {
  const out = selectionRects([
    r(140, 130, 100, 16), r(140, 130, 100, 16),   // duplicate (nested span)
    r(240, 131, 60, 15),                           // same line, touching → merged
    r(140, 150, 0.5, 16),                          // sliver
    r(140, 170, 200, 16),                          // next line
  ], box);
  assert.deepEqual(out, [
    { x: 10, y: 10, w: 40, h: 2 },
    { x: 10, y: 15, w: 50, h: 2 },
  ]);
});

test('no box, nothing; boxes are clamped to the page', () => {
  assert.deepEqual(selectionRects([r(1, 1, 10, 10)], null), []);
  assert.deepEqual(selectionRects([r(80, 50, 40, 16)], box), [{ x: 0, y: 0, w: 5, h: 2 }]);
});

test('saved rects are validated', () => {
  assert.deepEqual(cleanRects([{ x: 1, y: 2, w: 3, h: 4 }, { x: 'a' }, { x: 1, y: 1, w: 0, h: 1 }, { x: 120, y: 1, w: 1, h: 1 }]), [{ x: 1, y: 2, w: 3, h: 4 }]);
  assert.deepEqual(cleanRects(null), []);
});
