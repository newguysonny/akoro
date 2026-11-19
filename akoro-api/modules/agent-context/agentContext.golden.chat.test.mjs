import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

/**
 * P1 golden gate (Context Layer Adoption mini-plan, D1): the Agent Chat and
 * voice system prompts, now assembled from akoro-agent/ workspace files via
 * modules/agent-context/chat-doctrine.js, are BYTE-IDENTICAL to the literals
 * they replaced. The fixture was captured from the pre-migration chat.js +
 * modules/voice/routes.js source (git HEAD at extraction time) — a byte that
 * drifts here means doctrine changed silently.
 *
 * The seam module is side-effect-free (it imports only the context manager),
 * so this test needs no dummy env and boots fast.
 */

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/agent-chat-system.golden.json", import.meta.url), "utf8"),
);
const { assembleChatDoctrine, tutorSystemPrompt } = await import("./chat-doctrine.js");
const { loadDoctrine } = await import("./context-manager.js");

test("tutorSystemPrompt is byte-identical to the pre-migration literals (all roles, named agents)", async () => {
  for (const { label, input, expected } of fixture.tutor) {
    assert.equal(await tutorSystemPrompt(input), expected, `${label} drifted from the golden`);
  }
});

test("assembleChatDoctrine is byte-identical for every flag combination (think/research/durable/role/time)", async () => {
  for (const { label, input, expected } of fixture.doctrine) {
    const actual = await assembleChatDoctrine({ ...input, currentTimeContext: fixture.timeMarker });
    assert.equal(actual, expected, `${label} drifted from the golden`);
    // the time context keeps its pre-migration position: right after the persona
    assert.ok(
      actual.indexOf(fixture.timeMarker) < actual.indexOf("You are the unified Akoro Agent Chat"),
      `${label}: the time context moved`,
    );
  }
});

test("the voice bootstrap prompt is byte-identical: chat persona + speech channel rules", async () => {
  for (const { label, role, expected } of fixture.voice) {
    const actual = (await tutorSystemPrompt({ agentName: "Akoro", role })) + " " + (await loadDoctrine("channels/SPEECH.md"));
    assert.equal(actual, expected, `${label} drifted from the golden`);
  }
});

test("single-source rule (D4): the chat/voice prompt literals exist only as workspace files", async () => {
  const chat = await readFile(new URL("../adaptive-learning/chat.js", import.meta.url), "utf8");
  const prepare = await readFile(new URL("../adaptive-learning/chat/turn-prepare.js", import.meta.url), "utf8");
  const voice = await readFile(new URL("../../modules/voice/routes.js", import.meta.url), "utf8");
  // none of the migrated doctrine may live in code again
  assert.doesNotMatch(chat, /Formatting contract \(the chat renders/, "base persona still hardcoded in chat.js");
  assert.doesNotMatch(chat, /You are the unified Akoro Agent Chat\./, "agent-chat doctrine still hardcoded");
  assert.doesNotMatch(chat, /## Tool observations \(read before/, "tool-observation guide still hardcoded");
  assert.doesNotMatch(chat, /## Activity drafts \(human-in-the-loop\)/, "HITL guide still hardcoded");
  assert.doesNotMatch(chat, /## Durable memory \(read before/, "durable-memory guide still hardcoded");
  assert.doesNotMatch(chat, /const (THINK_ADDENDUM|RESEARCH_ADDENDUM|TOOL_OBSERVATION_GUIDE|INSTRUCTOR_HITL_GUIDE|DURABLE_MEMORY_GUIDE)/, "addendum/guide consts still exist");
  assert.doesNotMatch(voice, /You are speaking out loud in a live voice conversation/, "speech rules still hardcoded in voice");
  // and the surfaces really load the files through the seam — IMPORTED
  // locally, not just re-exported: `export { x } from` does not bind x, and
  // the /agent route calls assembleChatDoctrine directly (the P1 outage)
  assert.match(prepare, /import \{ tutorSystemPrompt, assembleChatDoctrine \} from "\.\.\/\.\.\/agent-context\/index\.js";/, "chat imports the doctrine seam locally");
  assert.match(chat, /export \{ tutorSystemPrompt, assembleChatDoctrine \};/, "chat re-exports the doctrine seam for voice");
  assert.match(prepare, /assembleChatDoctrine\(\{/, "the /agent route assembles doctrine through the seam");
  assert.match(voice, /await tutorSystemPrompt\(/, "voice awaits the async persona builder");
  assert.match(voice, /loadDoctrine\("channels\/SPEECH\.md"\)/, "voice loads the speech channel rules");
});
