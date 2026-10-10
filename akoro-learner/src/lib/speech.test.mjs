import test from 'node:test';
import assert from 'node:assert/strict';
import { speakableText } from './speech.js';

test('a reply reads aloud as plain sentences', () => {
  assert.equal(speakableText("You haven't taught me about **photosynthesis** yet! See [the syllabus](https://x.y) [T1]."),
    "You haven't taught me about photosynthesis yet! See the syllabus.");
  assert.equal(speakableText('## Steps\n- First, *mix*\n- Then `heat`\n\n> Note'), 'Steps First, mix Then heat. Note');
  assert.equal(speakableText('Code:\n```js\nx()\n```\nDone'), 'Code: Done');
  assert.equal(speakableText(null), '');
  const long = speakableText('This is a sentence. '.repeat(200));
  assert.ok(long.length <= 1500 && long.endsWith('.'));
});
