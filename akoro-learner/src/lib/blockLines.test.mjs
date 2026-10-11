import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutBlockLines, dealByWidth } from './blockLines.js';
import { findInkLines } from './inkLines.js';

// A monospace-ish fake: every character is 0.5 em wide.
const measure = (t, f) => String(t).length * 0.5 * f;

/** A page crop with dark bars where printed lines are. */
function crop(w, h, lines, { bg = 235, ink = 30 } = {}) {
  const lum = new Uint8ClampedArray(w * h).fill(bg);
  for (const l of lines) for (let y = l.top; y < l.bottom; y++) for (let x = l.left; x < l.right; x++) {
    if ((x + y) % 5) lum[y * w + x] = ink;   // gaps between "glyphs"
  }
  return lum;
}

test('findInkLines: one band per printed line, with its left and right', () => {
  const want = [{ top: 4, bottom: 20, left: 2, right: 380 }, { top: 30, bottom: 46, left: 2, right: 395 }, { top: 56, bottom: 72, left: 2, right: 170 }];
  const got = findInkLines(crop(400, 80, want), 400, 80);
  assert.equal(got.length, 3);
  got.forEach((g, i) => {
    assert.ok(Math.abs(g.top - want[i].top) <= 1 && Math.abs(g.bottom - want[i].bottom) <= 1, `line ${i} rows`);
    assert.ok(Math.abs(g.left - want[i].left) <= 1 && Math.abs(g.right - want[i].right) <= 1, `line ${i} extent`);
  });
});

test('findInkLines: i-dots and accents above a line merge into it; noise specks do not make lines', () => {
  const lines = [{ top: 10, bottom: 12, left: 50, right: 60 }, { top: 14, bottom: 30, left: 2, right: 300 }];
  const lum = crop(320, 40, lines);
  lum[38 * 320 + 100] = 0;   // one dark speck
  const got = findInkLines(lum, 320, 40);
  assert.equal(got.length, 1);
  assert.ok(got[0].top <= 10 && got[0].bottom >= 29);
});

test('findInkLines: a blank crop has no lines', () => {
  assert.deepEqual(findInkLines(new Uint8ClampedArray(100 * 50).fill(240), 100, 50), []);
});

test('with seen lines: words go onto those rows, each stretched to its printed width', () => {
  const ink = [{ top: 0, bottom: 16, left: 0, right: 400 }, { top: 22, bottom: 38, left: 0, right: 400 }, { top: 44, bottom: 60, left: 0, right: 150 }];
  const text = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen';
  const { lines } = layoutBlockLines(text, 400, 60, measure, { ink });
  assert.equal(lines.length, 3);
  assert.equal(lines.map((l) => l.text).join(' '), text, 'every word kept, in order');
  lines.forEach((l, i) => {
    assert.equal(l.top, ink[i].top);
    assert.ok(Math.abs(l.width - (ink[i].right - ink[i].left)) < 1e-6);
    assert.ok(Math.abs(measure(l.text, l.fontPx) * l.scaleX - l.width) < 1e-6);
  });
  assert.ok(measure(lines[2].text, 1) < measure(lines[0].text, 1), 'the short last line gets fewer words');
});

test('dealByWidth never leaves a printed line empty', () => {
  const out = dealByWidth(['a', 'b', 'c'], [100, 100, 100, 100].slice(0, 3), measure, 10);
  assert.equal(out.length, 3);
  assert.ok(out.every((l) => l.length > 0));
});

test('explicit line breaks are kept when they match the seen lines', () => {
  const ink = [{ top: 0, bottom: 10, left: 0, right: 80 }, { top: 14, bottom: 24, left: 0, right: 200 }];
  const { lines } = layoutBlockLines('Word equation:\ncarbon dioxide + water', 200, 24, measure, { ink });
  assert.deepEqual(lines.map((l) => l.text), ['Word equation:', 'carbon dioxide + water']);
});

test('without pixels: a paragraph box is split into the line count its size implies', () => {
  // 4 lines of ~60 chars at font 0.8·pitch: box 4 lines tall.
  const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
  const pitch = 20, boxH = pitch * 4;
  const boxW = (text.length / 3.5) * 0.5 * (0.8 * pitch);
  const { lines } = layoutBlockLines(text, boxW, boxH, measure);
  assert.equal(lines.length, 4);
  assert.equal(lines.map((l) => l.text).join(' '), text);
  assert.ok(lines.every((l) => l.left === 0 && Math.abs(l.height - pitch) < 1e-6));
});

test('a single-line box stays one line; empty text lays out nothing', () => {
  assert.equal(layoutBlockLines('Photosynthesis in green plants', 300, 30, measure, { singleLine: true }).lines.length, 1);
  assert.deepEqual(layoutBlockLines('  ', 300, 30, measure).lines, []);
});
