import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { answerBlocks, citeLabel, inlinePieces, toReaderCite } from './askAnswer.js';

// The teaching screens were split into feature files (Phase 19 step 6):
// read the whole feature surface so the assertions keep covering it.
const readTeaching = async (files) => (await Promise.all(
  files.map((f) => readFile(new URL(`../features/teaching/${f}`, import.meta.url), 'utf8')),
)).join('\n');
const READER_FILES = [
  'components/SessionReaderModal.jsx', 'components/SessionReaderChrome.jsx',
  'components/SessionReaderDocument.jsx', 'components/SessionReaderResult.jsx',
  'components/SessionReaderOverlays.jsx', 'components/sessionReaderModel.js',
  'hooks/useSessionReader.js',
];
const TEACH_FILES = [
  'components/TeachAgentModal.jsx', 'components/TeachAgentChat.jsx',
  'components/TeachAgentSummary.jsx', 'components/TeachAgentMaterialBox.jsx',
  'components/TeachAgentSwitcher.jsx', 'hooks/useTeachAgent.js',
];

const cites = [
  { n: 1, pageNumber: 3, bbox: [50, 100, 950, 300], quote: 'Photosynthesis converts light…' },
  { n: 2, startMs: 725000, endMs: 760000, quote: 'enzymes…' },
];

const readSession = async () => {
  const [view, hook] = await Promise.all([
    readFile(new URL('../features/library/components/RecordTeachSession.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../features/library/hooks/useRecordSession.js', import.meta.url), 'utf8'),
  ]);
  return `${view}\n${hook}`;
};

test('[n] markers become citation chips; unknown markers stay text; **bold** renders', () => {
  const pieces = inlinePieces('Light becomes **chemical energy** [1]. Enzymes help [2][7].', cites);
  assert.deepEqual(pieces.map((p) => p.type), ['text', 'bold', 'text', 'cite', 'text', 'cite', 'text', 'text']);
  assert.equal(pieces.find((p) => p.type === 'cite').cite.pageNumber, 3);
  assert.deepEqual(pieces.slice(-2).map((p) => p.text), ['[7]', '.'], 'a marker with no citation is left as text');
});

test('answers split into paragraphs and lists', () => {
  const blocks = answerBlocks('## Key points\n- one [1]\n- two\n\n1. first\n2. second\nClosing line.', cites);
  assert.deepEqual(blocks.map((b) => b.type), ['h', 'ul', 'ol', 'p']);
  assert.equal(blocks[0].level, 2, 'headings carry their level'); assert.equal(blocks[0].pieces[0].text, 'Key points', 'heading text is parsed');
  assert.equal(blocks[1].items.length, 2);
  assert.equal(blocks[1].items[0].find((p) => p.type === 'cite').n, 1);
});

test('chips say where they go, and map to the reader’s jump shape', () => {
  assert.equal(citeLabel(cites[0]), 'p. 3');
  assert.equal(citeLabel(cites[1]), '12:05');
  assert.deepEqual(toReaderCite(cites[0]), { page: 2, bbox: [50, 100, 950, 300] }, '0-based page + the block box');
  assert.deepEqual(toReaderCite(cites[1]), { startMs: 725000 });
  assert.equal(toReaderCite({ n: 3 }), null, 'pasted text has nowhere to jump');
});

test('the reader wires Ask: tool, tab kept mounted, selection pin, seek for recordings', async () => {
  const reader = await readTeaching(READER_FILES);
  const session = await readSession();
  const modal = await readTeaching(TEACH_FILES);
  assert.match(reader, /needsAsk: true/);
  assert.match(reader, /askEnabled=\{!!ask\}/, 'Ask only appears when the opener can answer');
  assert.match(reader, /display: activeTabId === "ask" \? "flex" : "none"/, 'a streaming answer survives switching tabs');
  assert.match(reader, /handleSelectionAction\("ask"\)/);
  assert.match(reader, /pageNumber: selection\.pageIndex \+ 1/, 'the pinned passage carries its page');
  assert.match(reader, /playerApi\?\.seekTo\?\.\(cite\.startMs \/ 1000\)/, 'recording citations seek the player');
  assert.match(session, /const ask = useMemo\(/, 'a stable ask object');
  assert.match(session, /record\?\.contentKey\s*\? \{ contentKey: record\.contentKey \}/, 'shared files ask by content key');
  assert.match(modal, /ask: content\.ask \|\| null/);
});

test('the teaching session sends the document and its protégé cites into the reader', async () => {
  const session = await readSession();
  const modal = await readTeaching(TEACH_FILES);
  const chat = await readTeaching(['components/SessionChatView.jsx']);
  const blocks = await readFile(new URL('../components/sessions/BlockRenderer.jsx', import.meta.url), 'utf8');
  const reader = await readTeaching(READER_FILES);
  assert.match(session, /\.\.\.\(askTarget \? \{ document: askTarget \} : \{\}\)/, 'the record session passes its document');
  assert.match(modal, /document:\s+config\?\.document \|\| null/, 'and the socket start carries it');
  assert.match(modal, /onCite=\{content \? jumpToCitation : null\}/);
  assert.match(modal, /const closeReader\s+= \(\) => \{ setReaderOpen\(false\); setReaderJump\(null\); \}/, 'closing clears a pending jump');
  assert.match(chat, /onCite=\{onCite\}/);
  assert.match(blocks, /block\.citations\?\.length\s+\? <CitedText/, 'only cited protégé messages get chips');
  assert.match(reader, /if \(jumpTo\?\.cite\) citeJump\(jumpTo\.cite\);/);
});

test('the reader generates Summary / Quiz / Flashcards for real when the opener can', async () => {
  const reader = await readTeaching(READER_FILES);
  const session = await readSession();
  const api = await readFile(new URL('../services/recordsApi.js', import.meta.url), 'utf8');
  assert.match(reader, /const SERVER_TOOLS = new Set\(\["summary", "quiz", "flashcards"\]\)/);
  assert.match(reader, /if \(tools && SERVER_TOOLS\.has\(toolId\)\) \{/);
  assert.match(reader, /scope: scope === "Whole document" \? "document" : "page"/);
  assert.match(reader, /\.catch\(\(e\) => fail\?\.\(e\?\.message/, 'a failure keeps the form open with the reason');
  assert.match(reader, /const cite = \(c\) => \(c \? \{ \.\.\.toReaderCite\(c\), quote: c\.quote \} : null\)/, 'server citations map to the jump shape');
  assert.match(reader, /q\.explanation &&/, 'quiz answers explain themselves');
  assert.match(reader, /const cardCite = card\.cite \|\| sentenceCiteFor/);
  assert.match(session, /generate: \(tool, args\) => generateRecordTool\(\{ \.\.\.askTarget, tool, \.\.\.args \}\)/);
  assert.match(api, /apiPost\(`\/api\/records\/tools\/\$\{encodeURIComponent\(tool\)\}`/);
});
