import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRich } from './richText.js';

const spans = (text) => parseRich(text)[0].spans;

test('an in-app link is a link span; its label is plain text', () => {
  const s = spans('Watch it here: [Watch in Battles](/app?tab=battles&battle=b1). Good luck');
  assert.deepEqual(s.map((x) => [x.text, x.href || null]), [
    ['Watch it here: ', null], ['Watch in Battles', '/app?tab=battles&battle=b1'], ['. Good luck', null],
  ]);
});

test('the app site\'s own home is a link too: "/", "/?tab=…", "/#…"', () => {
  const s = spans('See [Battles](/?tab=battles&battle=b1) or [Home](/) now');
  assert.deepEqual(s.filter((x) => x.href).map((x) => [x.text, x.href]), [['Battles', '/?tab=battles&battle=b1'], ['Home', '/']]);
});

test('anything but an /app path or the app home stays literal text (no links out of the app)', () => {
  for (const text of ['[x](https://evil.example)', '[x](javascript:alert(1))', '[x](/apples)', '[x](//evil.example/app)', '[x](//evil.example)', '[x](/\\evil)', '[x](/path)']) {
    assert.ok(spans(text).every((x) => !x.href), text);
    assert.equal(spans(text).map((x) => x.text).join(''), text);
  }
});

test('inside bold the link keeps the bold; inside code it stays code', () => {
  assert.deepEqual(spans('**[Open](/app)**').map((x) => [x.text, x.bold, x.href || null]), [['Open', true, '/app']]);
  assert.ok(spans('`[Open](/app)`').every((x) => x.code && !x.href));
});
