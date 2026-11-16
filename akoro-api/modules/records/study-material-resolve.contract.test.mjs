import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { escapeLike, rankContentHits, pickContentWinner, findDuplicateArtifact, passagesFromExtraction, rankChatRecords, pickChatRecord, platformTerms, platformChunkScore } from "./studyMaterialCore.js";

const studyMaterial = await readFile(new URL("./studyMaterial.js", import.meta.url), "utf8");
const searchLib = await readFile(new URL("./searchLib.js", import.meta.url), "utf8");
const materialsRoutes = await readFile(new URL("../materials/routes.js", import.meta.url), "utf8");
const chat = await readFile(new URL("../adaptive-learning/chat.js", import.meta.url), "utf8");

/* A tiny Postgres LIKE (default \ escape), so the filename tests prove
   semantics, not just string shapes. */
const likeToRegex = (pattern) => {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (c === "%") out += "[\\s\\S]*";
    else if (c === "_") out += "[\\s\\S]";
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${out}$`, "i");
};

test("exact camera filename: escaping keeps the name matchable (deleting its _ broke it)", () => {
  const name = "FB_IMG_1792564566090.jpg";
  const pattern = `%${escapeLike(name)}%`;
  assert.ok(likeToRegex(pattern).test(name), "the escaped pattern matches the record's real name");
  assert.ok(!likeToRegex(pattern).test("FBXIMG_1792564566090.jpg"), "_ is literal now, not a wildcard");
  const oldPattern = `%${name.replace(/[%_]/g, "")}%`;
  assert.ok(!likeToRegex(oldPattern).test(name), "the old delete-the-underscores pattern could never match it");
  assert.equal(escapeLike("100%_\\"), "100\\%\\_\\\\");
  // Wiring: both ILIKE lookups escape, and the name lookup has a fixed order.
  assert.match(studyMaterial, /ilike\("name", `%\$\{escapeLike\(f\)\}%`\)/);
  assert.match(studyMaterial, /ilike\("name", `%\$\{escapeLike\(q\)\}%`\)\.order\("created_at", \{ ascending: false \}\)/);
  assert.ok(!studyMaterial.includes('replace(/[%_]/g, "")'), "no query has its characters deleted anymore");
});

test("hit-count trap: a long off-topic document's many weak hits lose to a short on-topic one", () => {
  const hits = [];
  for (let i = 0; i < 12; i++) hits.push({ recordId: "big-pdf", name: "Cell Structure.pdf", fused: 0.010 });
  hits.push({ recordId: "photo", name: "FB_IMG_1792564566090.jpg", fused: 0.030 });
  hits.push({ recordId: "photo", name: "FB_IMG_1792564566090.jpg", fused: 0.028 });
  // The old rule (count the hits) picked big-pdf 12–2. Relevance must not.
  const ranked = rankContentHits(hits);
  assert.equal(ranked[0].recordId, "photo");
  assert.ok(ranked[0].score > ranked[1].score);
  assert.deepEqual(pickContentWinner(ranked), { recordId: "photo" });
});

test("close call: the top two within 10% come back as a choice, not a silent pick", () => {
  const ranked = rankContentHits([
    { recordId: "a", name: "Algebra notes.pdf", fused: 0.050 },
    { recordId: "b", name: "Algebra past paper.pdf", fused: 0.047 },
    { recordId: "c", name: "Cooking.pdf", fused: 0.004 },
  ]);
  const pick = pickContentWinner(ranked);
  assert.deepEqual(pick.needsChoice.map((r) => r.recordId), ["a", "b"]);
  assert.equal(pick.needsChoice[0].name, "Algebra notes.pdf");
  // A clear winner still resolves outright.
  assert.deepEqual(pickContentWinner(rankContentHits([
    { recordId: "a", fused: 0.050 }, { recordId: "b", fused: 0.030 },
  ])), { recordId: "a" });
  assert.equal(pickContentWinner([]), null);
});

test("dedupe: an identical request returns the saved tab; any knob changed makes a new one", () => {
  const saved = [
    { id: "art-1", kind: "quiz", pageNumber: null, params: { focus: "", count: "5", difficulty: "", scope: "Whole document", from: "chat" }, content: { quizQuestions: [1, 2, 3, 4, 5] } },
    { id: "art-2", kind: "podcast", pageNumber: null, params: { focus: "cells", length: "long", scope: "Whole document" }, content: { podcast: { status: "ready" } } },
    { id: "art-3", kind: "summary", pageNumber: 2, params: { focus: "", count: "", difficulty: "" }, content: { summaryPoints: [1] } },
  ];
  assert.equal(findDuplicateArtifact(saved, { kind: "quiz", focus: "", count: "5", difficulty: "" })?.id, "art-1");
  assert.equal(findDuplicateArtifact(saved, { kind: "quiz", focus: "", count: 5, difficulty: "" })?.id, "art-1", "a numeric count still matches");
  assert.equal(findDuplicateArtifact(saved, { kind: "quiz", focus: "", count: "10", difficulty: "" }), null, "a different count is a different quiz");
  assert.equal(findDuplicateArtifact(saved, { kind: "quiz", pageNumber: 2, focus: "", count: "5", difficulty: "" }), null, "page scope is a different item");
  assert.equal(findDuplicateArtifact(saved, { kind: "podcast", focus: "cells", length: "long" })?.id, "art-2");
  assert.equal(findDuplicateArtifact(saved, { kind: "podcast", focus: "cells", length: "short" }), null);
  assert.equal(findDuplicateArtifact(saved, { kind: "summary", pageNumber: 2, focus: "", count: "", difficulty: "" })?.id, "art-3");
  // Wiring: makeStudyMaterial checks before it generates, and says so.
  assert.match(studyMaterial, /findDuplicateArtifact\(arts, \{/);
  assert.match(studyMaterial, /deduped: true/);
  assert.ok(studyMaterial.indexOf("findDuplicateArtifact(arts") < studyMaterial.indexOf("generateToolResult({ userId, target, tool, scope: docScope"));
});

test("extraction fallback: a record whose text is only an extraction still gives passages", () => {
  const pages = [
    { pageNumber: 1, markdown: "Organic chemistry is the study of carbon compounds and their reactions in living and non-living systems.", blocks: [] },
    { pageNumber: 2, markdown: "The vital force theory held that organic compounds could only be made by living organisms, until Wöhler's synthesis.", blocks: [] },
  ];
  const doc = passagesFromExtraction({ pages, scope: "document" });
  assert.ok(doc.length >= 1);
  assert.ok(doc.every((p) => [1, 2].includes(p.pageNumber)));
  const page2 = passagesFromExtraction({ pages, scope: "page", pageNumber: 2 });
  assert.ok(page2.length >= 1 && page2.every((p) => p.pageNumber === 2));
  assert.deepEqual(passagesFromExtraction({ pages: [], scope: "document" }), []);
  assert.deepEqual(passagesFromExtraction({ pages, scope: "page", pageNumber: 9 }), []);
  // Wiring: generateToolResult falls back to the extraction when the gather is empty.
  assert.match(studyMaterial, /if \(!passages\.length\) passages = await extractedPassages\(\{ target, scope, pageNumber \}\)/);
  assert.match(studyMaterial, /getExtraction\(key\)/);
});

/* ── Stage 2: "this material" — the files of this chat ─────────────────────
   Candidates in the shape chatReadRecords builds: the record's name plus
   what its read found (title, subject, topic names). */
const chatPhoto = { recordId: "photo", name: "FB_IMG_1792564566090.jpg", title: "Organic Chemistry: Definition, Derivatives and Vital Force Theory", subject: "Chemistry", topics: ["Introduction to organic chemistry", "Derivatives of organic compounds", "Vital force theory"] };
const chatCellPdf = { recordId: "cell-pdf", name: "Cell Structure.pdf", title: "Cell Structure and Organization", subject: "Biology", topics: ["Cell structure", "Organelles"] };

test("chat files: the one read file in the chat is the pick, whatever the words", () => {
  assert.deepEqual(pickChatRecord([chatPhoto], "this material"), { recordId: "photo" });
  // Even words that name a different document: with one file in the chat,
  // "this material" can only mean it — the Library is a different question,
  // and the resolver only reaches this helper on the chat path.
  assert.deepEqual(pickChatRecord([chatPhoto], "cell structure"), { recordId: "photo" });
});

test("chat files: several read files — the best match against the words wins", () => {
  const ranked = rankChatRecords([chatCellPdf, chatPhoto], "organic chemistry");
  assert.equal(ranked[0].recordId, "photo");
  assert.ok(ranked[0].score > ranked[1].score, "the read's title/topics/subject carry the match the camera filename can't");
  assert.deepEqual(pickChatRecord([chatCellPdf, chatPhoto], "organic chemistry"), { recordId: "photo" });
  assert.deepEqual(pickChatRecord([chatPhoto, chatCellPdf], "cell structure"), { recordId: "cell-pdf" });
});

test("chat files: a close call — or no topic in the words at all — comes back as a choice", () => {
  const algA = { recordId: "alg-a", name: "Algebra notes.pdf", title: "Algebra basics", subject: "Mathematics", topics: ["Algebra"] };
  const algB = { recordId: "alg-b", name: "Algebra past paper.pdf", title: "Algebra questions", subject: "Mathematics", topics: ["Algebra"] };
  const close = pickChatRecord([algA, algB], "algebra");
  assert.deepEqual(close.needsChoice.map((r) => r.recordId), ["alg-a", "alg-b"]);
  // Pointing words carry no topic: every candidate is offered, none is picked.
  const pointing = pickChatRecord([algA, algB], "this material");
  assert.deepEqual(pointing.needsChoice.map((r) => r.recordId), ["alg-a", "alg-b"]);
  assert.deepEqual(pickChatRecord([], "algebra"), null, "no read chat files → no pick (the caller turns this into no_chat_file)");
});

test("chat files: precedence and the no-fall-through rule are wired into the resolver", () => {
  // The chat branch sits before the library content search in findStudyRecord,
  // behind fromChatFile, and a named folder still outranks it (!f).
  const chatAt = studyMaterial.indexOf("chatReadRecords({ userId, conversationId })");
  const searchAt = studyMaterial.indexOf("searchRecordChunks({ userId, q, limit: 20 })");
  assert.ok(chatAt >= 0 && searchAt > chatAt, "chat resolution runs before the library content search");
  assert.match(studyMaterial, /if \(fromChatFile && !f && UUID\.test\(String\(conversationId \|\| ""\)\)\)/);
  // Nothing read in this chat → the coded error; the branch returns there,
  // it cannot drift on into the name/content search below it.
  assert.match(studyMaterial, /code: "no_chat_file"/);
  assert.match(studyMaterial, /Don't build from a different document\./);
  // Eligibility is the ingest pipeline's own shape: this chat's ingests, not
  // undone, read (structure present), records named by record_ids and covered
  // by a structure item.
  assert.match(studyMaterial, /\.eq\("chat_session_id", conversationId\)/);
  assert.match(studyMaterial, /\.not\("structure", "is", null\)/);
  assert.match(studyMaterial, /row\.record_ids/);
  // makeStudyMaterial hands both values through and surfaces the code.
  assert.match(studyMaterial, /findStudyRecord\(\{ userId, query, folder, recordId, conversationId, fromChatFile \}\)/);
  assert.match(studyMaterial, /\{ error: found\.error, \.\.\.\(found\.code \? \{ code: found\.code \} : \{\}\) \}/);
});

test("chat files: the tool carries from_chat_file and the handler hands the conversation in", () => {
  assert.match(chat, /from_chat_file: \{ type: "boolean", description: "OPTIONAL\. Set true when the learner means a file they sent in this chat/);
  const callAt = chat.indexOf("makeStudyMaterial({ userId: studentId");
  assert.ok(callAt >= 0);
  const call = chat.slice(callAt, callAt + 600);
  assert.ok(call.includes("conversationId, fromChatFile: !!input?.from_chat_file"), "the handler passes conversationId and the flag");
});

/* ── Platform tier: Discover's free notes ───────────────────────────────────
   Reached only when the learner's own Library has nothing. Candidates in
   the shape the Discover feed allows: someone else's upload or paste, not
   private, not deleted, never a Premium subscriber's. */

test("platform terms: task words and stopwords carry no topic", () => {
  assert.deepEqual(platformTerms("create a quiz on properties of matter"), ["properties", "matter"]);
  assert.deepEqual(platformTerms("properties of matter"), ["properties", "matter"]);
  assert.deepEqual(platformTerms("make flashcards from my notes"), []);
  assert.equal(platformTerms("alpha bravo charlie delta echo foxtrot golf").length, 6, "capped at 6 terms");
});

test("platform chunk score: coverage of the topic, not repetition of one word", () => {
  const terms = platformTerms("properties of matter");
  assert.equal(platformChunkScore("Matter has properties: mass, volume and density.", terms), 1);
  assert.equal(platformChunkScore("Matter matter matter, everywhere.", terms), 0.5, "one term repeated is half the topic");
  assert.equal(platformChunkScore("Photosynthesis happens in green plants.", terms), 0);
  assert.equal(platformChunkScore("anything at all", []), 0);
  // Ranked like the own tier: a full-coverage short note beats a long
  // document whose best passage covers only half the topic.
  const ranked = rankContentHits([
    { recordId: "long", name: "Science textbook.pdf", fused: platformChunkScore("matter is everywhere in science class today", terms) },
    { recordId: "long", name: "Science textbook.pdf", fused: platformChunkScore("photosynthesis and respiration in plants", terms) },
    { recordId: "note", name: "Properties of Matter.txt", fused: platformChunkScore("the properties of matter include mass", terms) },
  ]);
  assert.equal(ranked[0].recordId, "note");
  assert.deepEqual(pickContentWinner(ranked), { recordId: "note" });
});

test("platform tier: wired after the own-Library search, folder-gated, discovery-guarded", () => {
  const searchAt = studyMaterial.indexOf("searchRecordChunks({ userId, q, limit: 20 })");
  const platAt = studyMaterial.indexOf("await platformFind({ userId, q })");
  assert.ok(searchAt >= 0 && platAt > searchAt, "the platform tier runs only after the own-Library tiers miss");
  assert.match(studyMaterial, /if \(!candidates && q\.length >= 3\)/, "no folder constraint, a real query");
  // The name arm applies the discovery rule itself.
  assert.match(studyMaterial, /\.eq\("private", false\)\.in\("kind", \["upload", "paste"\]\)/);
  assert.match(studyMaterial, /activePremiumUserIds/);
  // The content arm is the discovery-scoped chunk search, scored by coverage.
  assert.match(studyMaterial, /searchPlatformChunks\(\{ userId, q, limit: 60 \}\)/);
  assert.match(studyMaterial, /platformChunkScore\(h\.text, terms\)/);
});

test("platform tier: searchPlatformChunks re-verifies every hit against its record", () => {
  assert.match(searchLib, /export async function searchPlatformChunks/);
  assert.match(searchLib, /\.neq\("user_id", userId\)/, "never the requester's own chunks");
  assert.match(searchLib, /\.eq\("private", false\)/, "chat uploads (private) never surface");
  assert.match(searchLib, /\.in\("kind", \["upload", "paste"\]\)/);
  assert.match(searchLib, /activePremiumUserIds/, "Premium owners are excluded");
});

test("copy-on-use: a platform winner is copied into the learner's Library before anything is built", () => {
  const copyAt = studyMaterial.indexOf("copyPlatformRecord({ userId, sourceId: found.record.id })");
  const targetAt = studyMaterial.indexOf("resolveAskTargetFor({ userId, recordId: found.record.id })", copyAt);
  assert.ok(copyAt >= 0 && targetAt > copyAt, "the copy lands before the build target resolves, so the artifact hangs off the learner's own record");
  // The discovery rule is re-verified at copy time, not trusted from the search.
  assert.match(studyMaterial, /if \(!src \|\| src\.user_id === userId \|\| src\.private/);
  // The copy is private (never a duplicate feed entry), shares the file, and
  // the result carries the provenance for the agent's reply.
  assert.match(studyMaterial, /private: true,/);
  assert.match(studyMaterial, /file_key: src\.kind === "upload" \? src\.file_key : null/);
  assert.match(studyMaterial, /source: "platform", sourceName: found\.record\.name, sourceOwner:/);
  // …and the reported name carries the provenance into the card title.
  assert.match(studyMaterial, /name: platformNote \? `Free notes in Discover · \$\{found\.record\.name\}` : found\.record\.name/);
  // The result instructs the reply to name the source (the battery found the
  // bare fields were not enough — the agent called it "your own document").
  assert.match(studyMaterial, /free notes in Discover/);
  assert.match(studyMaterial, /don't call it their own document/);
  // A copy of the same file is reused, never duplicated.
  assert.match(studyMaterial, /\.eq\("file_key", src\.file_key\)/);
});

test("platform tier: the agent is told to call the tool for bare topic asks and to name the source", () => {
  assert.match(chat, /bare topic ask like 'create a quiz on properties of matter'/);
  assert.match(chat, /source 'platform'/);
});

test("indexing wiring: a chat upload is indexed when its read completes", () => {
  assert.match(materialsRoutes, /import \{ indexRecord \} from "\.\.\/records\/searchLib\.js";/);
  const structureAt = materialsRoutes.indexOf('"/ingest/:id/structure"');
  const readyAt = materialsRoutes.indexOf('move(row, "ready", { structure', structureAt);
  const indexAt = materialsRoutes.indexOf("indexRecord({", structureAt);
  assert.ok(structureAt >= 0 && readyAt > structureAt && indexAt > readyAt, "indexing runs after the move to ready, inside the structure handler");
});
