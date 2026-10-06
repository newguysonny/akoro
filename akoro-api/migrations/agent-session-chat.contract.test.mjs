import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Teaching over material — records and course lessons open as REAL
 * teaching sessions (the "Start teaching" flow: WebSocket teach-back,
 * confidence, turn budget, continuation, revision history), with the
 * record's file / the lesson video as the session's material.
 *
 * The chat is the teaching chat; a compact content box above the composer
 * opens the material in the reader — mobile full-screen over the chat,
 * desktop/tablet the Fortizo split beside it.
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [teach, chatView, viewer, recordTeach, dash, lib, agentTab, composer] = await Promise.all([
  read("../../akoro-learner/src/components/teaching/TeachAgentModal.jsx"),
  read("../../akoro-learner/src/components/teaching/SessionChatView.jsx"),
  read("../../akoro-learner/src/components/courses/AgentSessionViewer.jsx"),
  read("../../akoro-learner/src/components/library/RecordTeachSession.jsx"),
  read("../../akoro-learner/src/pages/LearnerDashboard.jsx"),
  read("../../akoro-learner/src/pages/LibraryPage.jsx"),
  read("../../akoro-learner/src/components/tabs/AgentChatTab.jsx"),
  read("../../akoro-learner/src/components/common/FortizoChatComposer.jsx"),
]);

test("TeachAgentModal carries real material beside the teaching pump", () => {
  assert.ok(teach.includes("content = null"), "an optional content prop");
  assert.ok(teach.includes("materialBox={materialBox}"), "the chat gets the content box");
  assert.ok(teach.includes("content.pages || []"), "the reader shows the material's pages, not the guide");
  assert.ok(teach.includes("content.media || null"), "or its media");
  assert.ok(teach.includes("content.renderPageContent || null"), "or its custom page renderer");
  assert.ok(teach.includes("content.allowTextMarking ?? true"), "canvases can opt out of annotate/redact");
  assert.ok(teach.includes("content.state === 'ready' && (config?.readerFirst || !isMobileView)"), "desktop opens the split when the material lands — and readerFirst opens it on mobile too (the Pharm.D topic flow)");
  assert.ok(teach.includes("if (!content || content.state === 'ready')"), "the reader never opens on unloaded material");
});

test("the content box sits above the composer", () => {
  assert.ok(chatView.includes("materialBox = null"), "an optional materialBox prop");
  assert.ok(/\{materialBox && \(/.test(chatView), "rendered when present");
  assert.ok(chatView.indexOf("materialBox &&") < chatView.indexOf("<FortizoChatComposer"), "above the composer");
});

test("course lessons: a teaching session over the video", () => {
  assert.ok(viewer.includes("<TeachAgentModal"), "the agent session IS a teaching session");
  assert.ok(viewer.includes("content={content}"), "with the lesson video as the material");
  assert.ok(viewer.includes("kind: 'video'"), "the video is the content");
  assert.ok(viewer.includes("startAt: stream.lastPosition"), "resumes the course player's timeline");
  assert.ok(viewer.includes("/api/lessons/${lesson.id}/progress"), "persists position to the same seam");
  assert.ok(viewer.includes("readStoredSid(lesson?.id)"), "reopening continues the teaching thread");
  assert.ok(viewer.includes("setNowStudying(uid, {"), "parks on the now-studying bar");
  assert.ok(viewer.includes("Sign in to teach your agent"), "guests get an honest sign-in prompt");
});

test("records: a teaching session over the real file, grounded", () => {
  assert.ok(recordTeach.includes("<TeachAgentModal"), "records open as teaching sessions");
  assert.ok(recordTeach.includes("content={content}"), "the file is the material");
  assert.ok(recordTeach.includes("text.slice(0, MAX_REFERENCE_CHARS)"), "paste/text records ground the agent in their real text");
  assert.ok(recordTeach.includes("joined.slice(0, MAX_REFERENCE_CHARS)"), "PDFs ground it too — from the loader's own extraction");
  assert.ok(recordTeach.includes("MAX_REFERENCE_CHARS = 12_000"), "respecting the server's reference cap");
  assert.ok(recordTeach.includes("readStoredSid(record.id)"), "reopening continues the teaching thread");
  assert.ok(recordTeach.includes("onPosition: handlePosition"), "watched-through milestones still report");
  assert.ok(recordTeach.includes("fileMissing"), "legacy missing-file records stay honest");
  assert.ok(recordTeach.includes("not_viewable"), "unrenderable files stay download-to-view");
});

test("both call sites open the teaching session", () => {
  assert.ok(dash.includes("RecordTeachSession"), "the dashboard shelf does");
  assert.ok(lib.includes("RecordTeachSession"), "the library does");
});

test("the superseded viewers are gone", async () => {
  const { readdir } = await import("node:fs/promises");
  const libFiles = await readdir(new URL("../../akoro-learner/src/components/library", import.meta.url));
  assert.ok(!libFiles.includes("RecordSessionViewer.jsx"), "RecordSessionViewer retired");
  const courseFiles = await readdir(new URL("../../akoro-learner/src/components/courses", import.meta.url));
  assert.ok(!courseFiles.includes("SessionChatPane.jsx"), "SessionChatPane retired");
});

test("the session composer matches the agent chat tab — no hardcoded dark", () => {
  // The teaching sheet is theme-aware (--ak-* vars); the composer used to be
  // pinned to its dark treatment, which washed out on the light theme. The
  // agent chat tab renders the SAME FortizoChatComposer with its default
  // (light) treatment — the session must match, in every mode.
  const sessionComposerCalls = chatView.split("<FortizoChatComposer").length - 1;
  assert.ok(sessionComposerCalls >= 2, "both teach and guide modes render the composer");
  assert.ok(!/\{?\s*<FortizoChatComposer[^>]*\bdark\b/.test(chatView), "neither call site passes the dark override");
  assert.ok(!agentTab.includes("<FortizoChatComposer") || !/\{?\s*<FortizoChatComposer[^>]*\bdark\b/.test(agentTab),
    "the agent chat tab (the reference) stays on the default treatment");
  // The shared composer's default is the light, theme-aware one.
  assert.ok(composer.includes("const surface = dark ? 'rgba(255,255,255,.075)' : '#F8F9FC';"),
    "light surface matches the agent tab");
  assert.ok(composer.includes("const inputColor = dark ? '#E5EAFB' : 'var(--ak-text)';"),
    "input text is the theme's own text color on the light path");
});
