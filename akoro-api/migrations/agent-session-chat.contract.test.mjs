import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Agent-session chat + reader polish contract.
 *
 * The agent session is now a CHAT first (the teaching session's shape):
 * the learner and their agent talk over the lesson, the video opens from
 * the content box on top of the composer, mobile stacks (reader over
 * chat, chat button returns) and desktop/tablet splits side by side.
 *
 * Plus the visual repairs: the ±10s and Annotate glyphs were MISSING
 * from the tabler webfont (blank buttons), the reader tab lost its
 * textbook glyph, and light-theme muted greys (#9CA3AF on #F3F4F6 ≈ 2:1)
 * made the modal's icons nearly invisible.
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [viewer, chat, reader] = await Promise.all([
  read("../../akoro-learner/src/components/courses/AgentSessionViewer.jsx"),
  read("../../akoro-learner/src/components/courses/SessionChatPane.jsx"),
  read("../../akoro-learner/src/components/teaching/SessionReaderModal.jsx"),
]);

test("the agent session is a chat with the video one tap away", () => {
  assert.ok(viewer.includes("<SessionChatPane"), "the session renders the chat pane");
  assert.ok(viewer.includes("contentBox={contentBox}"), "the content box rides above the composer");
  assert.ok(viewer.includes("setReaderOpen(true)"), "tapping the box opens the material");
  assert.ok(viewer.includes("tap to watch"), "the box says what it does");
  assert.ok(viewer.includes("videoPct"), "the box carries the video's progress");
});

test("mobile stacks, desktop splits — and the chat icon works again", () => {
  assert.ok(viewer.includes("onOpenChat={() => setReaderOpen(false)}"), "the reader's chat button returns to the chat (the dead icon is fixed)");
  assert.ok(viewer.includes("chatNode={split ? chatPane : null}"), "desktop/tablet is the side-by-side split");
  assert.ok(viewer.includes("const split = !isMobile && showReader"), "the split is exactly desktop + reader open");
  assert.ok(viewer.includes("!split && ("), "mobile/reader-closed shows the chat surface");
  assert.ok(viewer.includes("showReader = readerOpen && !!stream"), "never an empty reader pane");
  assert.ok(viewer.includes("state === 'ready' && !isMobile"), "desktop auto-opens the reader when the stream lands");
});

test("the chat is the learner's real agent — same seam, honest failures", () => {
  // The pump lives in the viewer so the conversation survives the pane
  // moving between the desktop split and the standalone surface.
  assert.ok(viewer.includes("apiPost('/api/adaptive/chat/sessions'"), "owns the conversation through the real session seam");
  assert.ok(viewer.includes("agentChatEndpoint({ stream: true })"), "replies stream from the unified agent endpoint");
  assert.ok(viewer.includes("createAgentChatTurnId()"), "turns are idempotent");
  assert.ok(viewer.includes("apiPost(agentChatEndpoint(), payload)"), "with the plain JSON fallback");
  assert.ok(viewer.includes("couldn\\u2019t reach the chat service"), "connection failures say so honestly");
  assert.ok(chat.includes("contentBox = null"), "the content box is a slot — the pane stays reusable");
  assert.ok(viewer.includes("messages={messages}"), "the pane is presentational — state is lifted");
});

test("the content box is honest about the video", () => {
  assert.ok(viewer.includes("'Video coming soon — this lesson has no video yet'"), "no video says so");
  assert.ok(viewer.includes("You may need to enrol"), "access failures say what to do");
  assert.ok(viewer.includes("setRetry((r) => r + 1)"), "errors offer a retry");
  assert.ok(viewer.includes("Opening the lesson…"), "loading says so");
  assert.ok(viewer.includes("disabled={state !== 'ready'}"), "the box only opens a real stream");
});

test("one timeline with the course player — unchanged", () => {
  assert.ok(viewer.includes("/api/lessons/${lesson.id}`"), "same stream seam");
  assert.ok(viewer.includes("last_position_seconds"), "resumes from last position");
  assert.ok(viewer.includes("/api/lessons/${lesson.id}/progress"), "persists position");
  assert.ok(viewer.includes("/api/lessons/${lesson.id}/complete"), "completes near the end");
  assert.ok(viewer.includes("setNowStudying(uid, {"), "still parks on the now-studying bar");
  assert.ok(viewer.includes("updateNowProgress(uid, barId,"), "progress still follows the video");
});

test("missing glyphs restored — no blank buttons", () => {
  assert.ok(reader.includes('name="ti-player-track-prev"'), "±10s back uses a glyph that exists in the webfont");
  assert.ok(reader.includes('name="ti-player-track-next"'), "±10s forward too");
  assert.ok(reader.includes('name="ti-highlight"'), "the Annotate action too");
  for (const bad of ['ti-player-track-back"', 'ti-player-track-forward"', 'ti-highlighter"']) {
    assert.ok(!reader.includes(bad), `${bad} is gone (not in the tabler webfont)`);
  }
});

test("the textbook glyph is back on the reader tab", () => {
  assert.ok(reader.includes('tab.id === "reader") return <Icon name="ti-book-2"'), "the Original Content tab wears the book");
});

test("light theme reads clearly — muted greys stepped up", () => {
  assert.ok(!reader.includes("var(--ak-text-muted)"), "no near-invisible muted grey left in the modal");
  assert.ok(reader.includes(".folio-tab-pill{background:var(--ak-tag-bg);border-color:var(--ak-border2);color:var(--ak-text-sub);}"), "tab pills use the readable tier");
  assert.ok(reader.includes(".folio-icon-btn{color:var(--ak-text-sub);}"), "icon buttons too");
  assert.ok(reader.includes(".folio-form-field::placeholder{color:var(--ak-text-sub);}"), "placeholders too");
});
