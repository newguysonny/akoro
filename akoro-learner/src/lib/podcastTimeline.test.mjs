import assert from 'node:assert/strict';
import test from 'node:test';
import { turnAt, turnStart, clock } from './podcastTimeline.js';

const segs = [{ byteStart: 0, byteEnd: 100 }, { byteStart: 100, byteEnd: 300 }, { byteStart: 300, byteEnd: 400 }];

test('the playing turn follows the byte fraction', () => {
  assert.equal(turnAt(segs, 400, 0, 40), 0);
  assert.equal(turnAt(segs, 400, 9.9, 40), 0);
  assert.equal(turnAt(segs, 400, 10, 40), 1);
  assert.equal(turnAt(segs, 400, 29.9, 40), 1);
  assert.equal(turnAt(segs, 400, 40, 40), 2);
  assert.equal(turnAt(segs, 400, 99, 40), 2);
  assert.equal(turnAt([], 400, 1, 40), -1);
  assert.equal(turnAt(segs, 400, 1, NaN), -1);   // duration unknown until metadata loads
});

test('a turn starts where its bytes start', () => {
  assert.equal(turnStart(segs, 400, 1, 40), 10);
  assert.equal(turnStart(segs, 400, 2, 40), 30);
  assert.equal(turnStart(segs, 400, 9, 40), 0);
});

test('clock', () => {
  assert.equal(clock(42), '0:42');
  assert.equal(clock(125.7), '2:05');
  assert.equal(clock(NaN), '0:00');
});
