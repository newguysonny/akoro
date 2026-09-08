import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = name => readFile(new URL(name, import.meta.url), 'utf8');
const composer = await read('../src/components/common/FortizoChatComposer.jsx');
const session = await read('../src/components/teaching/SessionChatView.jsx');
const agent = await read('../src/components/tabs/AgentChatTab.jsx');
const reference = await read('../reference/FortizoApp.jsx');
const reader = await read('../src/components/teaching/SessionReaderModal.jsx');
const teach = await read('../src/components/teaching/TeachAgentModal.jsx');

test('shared composer follows the supplied Fortizo reference, without its search control', () => {
  assert.match(reference, /function ChatPanel/);
  assert.match(reference, /folio-composer/);
  assert.match(composer, /Fortizo-style composer/);
  assert.match(composer, /ti-microphone/);
  assert.match(composer, /ti-paperclip/);
  assert.match(composer, /ti-wave-sine/);
  assert.match(composer, /modelOptions/);
  assert.doesNotMatch(composer, /ti-search|SearchIcon|Search the web/);
});

test('teaching session keeps voice and audio actions while marking uploads unavailable', () => {
  assert.match(session, /FortizoChatComposer/);
  assert.match(session, /voiceAction=\{onToggleVoice\}/);
  assert.match(session, /audioAction=\{onToggleRecording\}/);
  assert.match(session, /attachmentUnavailable/);
  assert.match(session, /Attachments are not available in teaching sessions yet/);
});

test('AI chat retains files and maps the model menu to existing supported modes', () => {
  assert.match(agent, /attachmentAction=\{\(\)=>fileInputRef\.current\?\.click\(\)\}/);
  assert.match(agent, /id:"default"/);
  assert.match(agent, /id:"think"/);
  assert.match(agent, /id:"research"/);
  assert.match(agent, /onModelChange=\{chooseChatMode\}/);
  assert.match(agent, /const mode = thinkMode \? "think" : researchMode \? "research" : "default"/);
});

test('learning session opens the Fortizo reader from a book control in the composer', () => {
  // The book tool lives in the shared composer's tool rail, but only renders
  // when a host passes bookAction — the AI chat stays book-free.
  assert.match(composer, /bookAction/);
  assert.match(composer, /ti-book-2/);
  assert.match(session, /bookAction=\{onOpenReader\}/);
  // The modal is opened by the session host, which owns the WebSocket and
  // passes the live chat in as a node — the reader never re-implements chat.
  assert.match(teach, /SessionReaderModal/);
  assert.match(teach, /chatNode=\{sessionChat\(true\)\}/);
  assert.match(teach, /buildSessionReaderPages/);
});

test('session reader reuses the Fortizo reader architecture with Akoro branding', () => {
  // Same Fortizo architecture: folio chrome classes, tab pills, tools grid,
  // community boards, citations, annotations, redactions, selection popover.
  for (const marker of [
    /folio-tab-pill/, /GenerateGrid/, /CommunityBoard/, /folio-citation/,
    /folio-redaction/, /folio-annotation/, /handleSelectionAction/, /doc-page/,
  ]) assert.match(reader, marker);
  // Akoro branding: purple brand token, no lucide imports, tabler icons only.
  assert.match(reader, /from "\.\.\/\.\.\/constants\.js"/);
  assert.match(reader, /BRAND/);
  assert.doesNotMatch(reader, /lucide-react/);
  assert.match(reader, /from "\.\.\/common\/Icons\.jsx"/);
  // Mobile: full-screen modal; the chat button hands back to the session.
  assert.match(reader, /onOpenChat/);
  assert.match(reader, /showChatButton=\{isMobile\}/);
});
