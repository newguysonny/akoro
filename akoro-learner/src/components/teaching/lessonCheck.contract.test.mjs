import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (f) => readFile(new URL(f, import.meta.url), 'utf8');

test('the short check result card: drawn in the lesson before the protégé line, guesses never counted', async () => {
  const [card, view, modal] = await Promise.all([read('./LessonCheckCard.jsx'), read('./SessionChatView.jsx'), read('./TeachAgentModal.jsx')]);
  assert.match(card, /A guess never counts/);
  assert.match(card, /you haven't taught this yet/);
  assert.match(card, /<ScoreRing /);
  assert.match(view, /b\.type === "lesson-check" \? \(\s*<LessonCheckCard/);
  assert.match(modal, /turn_complete", \(\{ blocks: newBlocks, currentPhase, teachingMode, assessment \}\)/);
  assert.match(modal, /\[\.\.\.prev, \.\.\.checkBlock, \.\.\.\(newBlocks \|\| \[\]\)\]/);
});

test('blog passage chips: the post and its section, opening the post', async () => {
  const [tab, ideas] = await Promise.all([read('../tabs/AgentChatTab.jsx'), read('../../lib/chatIdeas.js')]);
  assert.match(tab, /msg\.materials\.map\(\(m\)=>m\.sub\?\(/);
  assert.match(tab, />Blog</);
  assert.match(ideas, /m\.sub \? \{ sub: String\(m\.sub\)\.slice\(0, 90\) \}/);
});
