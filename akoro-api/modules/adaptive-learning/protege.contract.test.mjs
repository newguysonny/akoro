import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { loadTaughtKnowledge, renderTaughtContext, buildGuideMessages, shapeGuideAnswer, teachRequest, PROTEGE_LIMITS } = await import("./protege.js");
const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const [chat, social, toolCatalogue, doctrine, manifest, trace, learnerTab, dashboard] = await Promise.all([
  read("./chat.js"), read("./chat/handlers-social.js"), read("./chat/tool-catalogue-rest.js"), read("../../akoro-agent/policies/PROTEGE.md"), read("../agent-context/manifest.mjs"), read("./chat/chat-trace.js"),
  read("../../../akoro-learner/src/components/tabs/AgentChatTab.jsx"), read("../../../akoro-learner/src/pages/LearnerDashboard.jsx"),
]);

const deps = (chunks, topics = [{ topic: "Photosynthesis", subject: "Biology" }], agent = { id: "a1" }) => ({
  findAgent: async () => agent,
  retrieve: async () => chunks,
  listTopics: async () => topics,
});

test("only knowledge close to the message counts as taught about it", async () => {
  const k = await loadTaughtKnowledge({ studentId: "s", query: "explain photosynthesis", deps: deps([
    { topic: "Photosynthesis", subject: "Biology", content: "Plants use light to make food.", confidence: 0.8, similarity: 0.71 },
    { topic: "Osmosis", subject: "Biology", content: "Water moves…", confidence: 0.9, similarity: PROTEGE_LIMITS.minSimilarity - 0.05 },
  ], [{ topic: "Photosynthesis", subject: "Biology" }, { topic: "photosynthesis", subject: "biology" }, { topic: "Osmosis", subject: "Biology" }]) });
  assert.deepEqual(k.chunks.map((c) => c.topic), ["Photosynthesis"]);
  assert.deepEqual(k.topics, ["Biology: Photosynthesis", "Biology: Osmosis"], "topics deduped");
  assert.equal(k.taughtAnything, true);
  const none = await loadTaughtKnowledge({ studentId: "s", query: "x", deps: deps([], [], null) });
  assert.deepEqual(none, { agentId: null, chunks: [], topics: [], taughtAnything: false });
  const broken = await loadTaughtKnowledge({ studentId: "s", query: "x", deps: { findAgent: async () => ({ id: "a" }), retrieve: async () => { throw new Error("down"); }, listTopics: async () => { throw new Error("down"); } } });
  assert.equal(broken.chunks.length, 0, "a lookup failure reads as nothing taught");
});

test("the prompt says plainly what was taught — or that it wasn't", () => {
  const taught = renderTaughtContext({ chunks: [{ topic: "Photosynthesis", subject: "Biology", content: "Plants use light.", confidence: 0.3 }], topics: ["Biology: Photosynthesis"], taughtAnything: true });
  assert.match(taught, /your ONLY subject knowledge/);
  assert.match(taught, /\[T1\] Biology — Photosynthesis \(30% sure, fading — you remember it only vaguely\): Plants use light\./);
  assert.match(taught, /Topics you have been taught at all: Biology: Photosynthesis\./);
  assert.match(renderTaughtContext({ chunks: [], topics: ["Biology: Osmosis"], taughtAnything: true }), /NOTHING you were taught relates to this message/);
  assert.match(renderTaughtContext({}), /has not taught you anything yet/);
});

test("the teaching guide: NaNa, short, flags taught mistakes, suggests what to teach next", () => {
  const [sys, user] = buildGuideMessages({ question: "What is photosynthesis?", topic: "Photosynthesis", subject: "Biology",
    taught: [{ content: "Plants eat soil." }], syllabus: "JSS2 Basic Science — photosynthesis" });
  assert.match(sys.content, /You are NaNa Esumai, the teaching guide/);
  assert.match(sys.content, new RegExp(`under ${PROTEGE_LIMITS.guideWords} words`));
  assert.match(sys.content, /Note: the learner taught X, but/);
  assert.match(user.content, /- Plants eat soil\./);
  assert.match(user.content, /Syllabus reference:/);
  assert.match(buildGuideMessages({ question: "q" })[1].content, /taught the protégé nothing on this/);
  assert.deepEqual(shapeGuideAnswer('{"explanation":" Plants make food. ","teach_next":"Teach me the word equation"}'), { explanation: "Plants make food.", teachNext: "Teach me the word equation" });
  assert.deepEqual(shapeGuideAnswer("bad"), { explanation: "", teachNext: "" });
  assert.deepEqual(teachRequest({ topic: "  Photo  synthesis ", subject: "Biology" }), { topic: "Photo synthesis", subject: "Biology" });
  assert.equal(teachRequest({}), null);
});

test("the rules: taught-only, point to sources and ask, the guide only on insistence and always marked, curious about conflicts", () => {
  for (const rule of [
    /These rules come last and win/,
    /"Quiz me" asks only about topics you were taught/,
    /Point to where they can learn it first/,
    /call ask_to_be_taught/,
    /\*\*If they insist\*\*[\s\S]*consult_teaching_guide/,
    /ALWAYS open with "From NaNa, my teaching guide \(you haven't taught me this\):"/,
    /My notes say X, but the syllabus mentions Y — which is right\?/,
    /Never correct them silently/,
  ]) assert.match(doctrine, rule);
  assert.match(manifest, /chat_protege: Object\.freeze\(\{[\s\S]*?"policies\/PROTEGE\.md"/);
});

test("wiring: every learner turn carries the taught knowledge; the two tools; the app's Teach me and guide mark", () => {
  assert.match(chat, /role === "student"\s*\? timed\("taught", loadTaughtKnowledge\(\{ studentId: req\.user\.id, query: userMessage, deps: protegeDeps \}\)/);
  assert.match(chat, /const protegeCtx = taught \? `\\n\\n\$\{await loadDoctrine\("policies\/PROTEGE\.md"\)\}\$\{renderTaughtContext\(taught\)\}` : "";/);
  assert.match(chat, /\(goalsCtx \|\| ""\) \+\n\s*protegeCtx \+/);
  assert.match(toolCatalogue, /name: "ask_to_be_taught",/);
  assert.match(toolCatalogue, /name: "consult_teaching_guide",/);
  assert.match(social, /async ask_to_be_taught\(input/);
  assert.match(social, /async consult_teaching_guide\(input[\s\S]*?__feature: "teaching_guide"/);
  assert.match(chat, /tool === "consult_teaching_guide" && toolResult\?\.consulted \? \{ guide:/);
  assert.match(trace, /consult_teaching_guide: +\{ category: "read", +headline: "Asking NaNa, my teaching guide"/);
  assert.match(learnerTab, /\{msg\.teach&&onTeachTopic&&\(/);
  assert.match(learnerTab, /t\('agent\.from_guide'\)/);
  assert.match(dashboard, /onTeachTopic=\{\(\{ topic, subject \}\)=>\{ setConfigInitial\(\{ topic,/);
});

test("voice: the learner talks to the same protégé", async () => {
  const voice = await read("../voice/routes.js");
  // The mic feeds the same chat (so every protégé rule holds), and a reply to
  // something said aloud is read aloud.
  assert.match(learnerTab, /const mic=useVoiceAnswer\(\{ onTranscript:\(said\)=>\{ voiceTurnRef\.current=true; sendRef\.current\?\.\(said\); \} \}\);/);
  assert.doesNotMatch(learnerTab, /Voice input is not available in AI Chat yet/);
  // "Always read replies aloud": the composer's audio switch, remembered on the device.
  assert.match(learnerTab, /if\(\(spokenTurn\|\|readAloud\) && finalReply && !controller\?\.signal\.aborted\) tts\.speak\(replyId, finalReply\);/);
  assert.match(learnerTab, /localStorage\.setItem\('ak_read_aloud', next\?'1':'0'\)/);
  assert.match(learnerTab, /audioAction=\{toggleReadAloud\}/);
  assert.doesNotMatch(learnerTab, /Audio notes are not available in AI Chat yet/);
  // A learner's realtime voice session carries the protégé rules and taught topics.
  assert.match(voice, /\+ \(role === "student" \? await protegeVoiceRules\(req\.user\.id\) : ""\)/);
  assert.match(voice, /loadDoctrine\("policies\/PROTEGE\.md"\)\) \+ renderTaughtContext\(taught\)/);
});
