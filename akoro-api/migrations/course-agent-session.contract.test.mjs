import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Course agent-session contract — "Agent session" on the course details
 * page. The old "Link my agent" chip was a dead toggle; it now opens the
 * course VIDEO as a learning session in the SAME reader the teaching
 * sessions and library records use — tab strip, Generate tools, Q&A —
 * with the shared toolbar driving playback (±10s, speed).
 *
 * The session shares the course player's timeline, not a parallel one:
 * same stream seam (GET /api/lessons/:id), same resume position, same
 * progress/completion writes.
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [parts, page, viewer, player, reader] = await Promise.all([
  read("../../akoro-learner/src/pages/course-details/parts.jsx"),
  read("../../akoro-learner/src/pages/course-details/CourseDetailsPage.jsx"),
  read("../../akoro-learner/src/components/courses/AgentSessionViewer.jsx"),
  read("../../akoro-learner/src/components/library/MediaPlayer.jsx"),
  read("../../akoro-learner/src/components/teaching/SessionReaderModal.jsx"),
]);

test("the chip is an Agent session opener, not a dead toggle", () => {
  assert.ok(parts.includes("label: 'Agent session'"), "renamed to Agent session");
  assert.ok(!parts.includes("Link my agent"), "the old label is gone");
  assert.ok(!parts.includes("agentLinked"), "no more local toggle state");
  assert.ok(parts.includes("onAgentSession?.(lesson)"), "the enrolled view opens on the CURRENT lesson");
  assert.ok(parts.includes("l?.id) || null"), "the overview opens on the first real lesson");
});

test("the session is the shared reader with the video as content", () => {
  assert.ok(page.includes("<AgentSessionViewer"), "the page renders the session viewer");
  assert.ok(page.includes("onAgentSession={openAgentSession}"), "both views forward the opener");
  assert.ok(viewer.includes("<TeachAgentModal"), "it opens a real teaching session");
  assert.ok(viewer.includes("kind: 'video'"), "the content is the video");
  assert.ok(viewer.includes("media: stream ? {"), "through the reader's media seam (only with a real stream)");
  assert.ok(reader.includes("startAt={media.startAt}"), "resume position flows through the reader");
  assert.ok(reader.includes("onTimeUpdate={media.onTimeUpdate}"), "position ticks flow through the reader");
});

test("one timeline with the course player — same stream, same writes", () => {
  assert.ok(viewer.includes("/api/lessons/${lesson.id}`"), "same stream seam as the course player");
  assert.ok(viewer.includes("last_position_seconds"), "resumes from the learner's last position");
  assert.ok(viewer.includes("/api/lessons/${lesson.id}/progress"), "persists position");
  assert.ok(viewer.includes("/api/lessons/${lesson.id}/complete"), "marks the lesson complete near the end");
  assert.ok(viewer.includes("position >= duration - 5"), "same completion rule as the course player");
});

test("streamed course videos (HLS) play in the session too", () => {
  assert.ok(player.includes("hls.js"), "hls.js attaches .m3u8 sources");
  assert.ok(player.includes("Hls.isSupported()"), "with the plain element as fallback");
  assert.ok(player.includes("startAt"), "the player resumes positions");
  assert.ok(player.includes("onTimeUpdate"), "the player reports position ticks");
});

test("honest states — no pretending", () => {
  assert.ok(viewer.includes("Video coming soon"), "lesson without a video says so");
  assert.ok(viewer.includes("You may need to enrol"), "access failures say what to do");
  assert.ok(viewer.includes("Couldn"), "load failures are shown, not swallowed");
});
