// Grand Plan §8.8 (D33): files and non-traditional goals in Study Prep —
// materials.list / materials.search / syllabus.from_documents /
// learner.request_materials, the goal type and its syllabus order.
// No db, no model: in-memory doubles behind the harness.
import assert from "node:assert/strict";
import test from "node:test";

process.env.OPENAI_API_KEY ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";

const { createHarness } = await import("./harness.js");
const { classifyGoal, syllabusOrderFor, goalTypeHint } = await import("./goal-type.js");
const { DOCUMENTS_OUTLINE_LABEL, documentsLabel, generateGate } = await import("./materials-ops.js");
const { TOOL_DEFINITIONS, TOOL_ARGS, TOOL_ALIASES, buildRegistry, llmFacingTools, toolByName } = await import("../tools/registry.js");
const { searchMaterials } = await import("../../materials/index.js");

const FOLDER = "11111111-2222-4333-8444-555555555555";

function harnessWith({ platformTopics = [], chain = null, materials = {} } = {}) {
  const sessions = new Map();
  const events = [];
  const calls = { outline: [], request: [], list: [], search: [], generate: 0 };
  let n = 0;
  const store = {
    findActiveSession: async () => null,
    createSession: async (row) => { const s = { id: `s${++n}`, created_at: "t", updated_at: "t", ...row }; sessions.set(s.id, s); return s; },
    getSession: async (id) => sessions.get(id) || null,
    updateSessionConditional: async (id, status, patch) => { const r = sessions.get(id); if (!r || r.status !== status) return null; const u = { ...r, ...patch }; sessions.set(id, u); return u; },
    appendEvents: async (_id, rows) => { events.push(...rows); return rows; },
    listEvents: async () => events, getTopics: async () => [],
  };
  const syllabus = {
    resolveTopics: async () => platformTopics,
    prerequisiteEdges: async () => [],
    generateOutline: async () => { calls.generate += 1; return { id: "g1", reused: false, topics: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }] }; },
    generatedTopics: async () => [],
    ...(chain ? { resolveSyllabusChain: async () => chain } : {}),
    materialTopics: async () => [{ id: "past-questions-topic", label: "Past questions topic" }],
    materials: {
      list: async (args) => { calls.list.push(args); return { folder: args.folderId ? { id: args.folderId, name: "Scholarship" } : null, items: [{ ingestId: "i1", docKind: "past_paper", records: [{ recordId: "r1", name: "paper.pdf", read: true }] }] }; },
      search: async (args) => { calls.search.push(args); return [{ recordId: "r1", name: "paper.pdf", page: 2, snippet: "Photosynthesis needs light" }]; },
      latestFolder: async () => ({ folderId: FOLDER, name: "Scholarship", subject: "Science" }),
      outlineFromDocuments: async (args) => { calls.outline.push(args); return { id: "d1", folderName: "Scholarship", from: "structure", recordIds: ["r1"], topics: [{ id: "cells", label: "Cells", papers: 2, marks: 10 }, { id: "energy", label: "Energy" }] }; },
      request: async (args) => { calls.request.push(args); return { suggestionId: "sg1" }; },
      ...materials,
    },
  };
  return { harness: createHarness({ store, topicWorkflow: {}, syllabus }), sessions, events, calls };
}

test("goal type: school and national exams are curricular; scholarships, competitions, professional exams and own topics are not", () => {
  assert.equal(classifyGoal("Pass my JSS1 Basic Science test"), "curricular");
  assert.equal(classifyGoal("WAEC Biology in May"), "curricular");
  assert.equal(classifyGoal("Help me prepare for the XYZ scholarship test"), "non_curricular");
  assert.equal(classifyGoal("Win the national maths olympiad"), "non_curricular");
  assert.equal(classifyGoal("ICAN professional exam, skills level"), "non_curricular");
  assert.equal(classifyGoal("IELTS in June"), "non_curricular");
  assert.equal(classifyGoal("I sat my test yesterday, help me revise fractions"), "curricular", "the word 'sat' is not the SAT");
  assert.equal(classifyGoal("WAEC quiz competition at my school"), "curricular", "the school system wins a loose match");
  assert.equal(classifyGoal("anything", { goalType: "non_curricular" }), "non_curricular", "an explicit type wins");
  assert.equal(classifyGoal("anything", { goalType: "bogus" }), "curricular");
  assert.deepEqual(syllabusOrderFor("non_curricular"), ["documents", "platform", "request_materials", "generate"]);
  assert.deepEqual(syllabusOrderFor("curricular").slice(0, 2), ["documents", "class"]);
  assert.match(goalTypeHint("non_curricular"), /learner\.request_materials/);
});

test("registry: the §8.8 tools are registered at the plan's levels, with schemas, and dispatch to the harness as the session's owner", async () => {
  const level = (name) => toolByName(name)?.level;
  assert.equal(level("materials.list"), "read");
  assert.equal(level("materials.search"), "read");
  assert.equal(level("syllabus.from_documents"), "execute");
  assert.equal(level("learner.request_materials"), "propose");
  assert.deepEqual(TOOL_ARGS["materials.search"].required, ["query"]);
  assert.deepEqual(TOOL_ARGS["learner.request_materials"].required, ["reason"]);
  const seen = [];
  const harness = new Proxy({}, { get: (_t, name) => async (args) => { seen.push([name, args]); return { ok: true }; } });
  const registry = buildRegistry({ readTools: {}, harness, learnerId: "owner-1", sessionId: "session-1" });
  await registry.execute("materials.list", {});
  await registry.execute("materials.search", { query: "light" });
  await registry.execute("syllabus.from_documents", { folderId: FOLDER }, "They uploaded a handbook.");
  await registry.execute("learner.request_materials", { reason: "Your handbook lists the topics." }, "Nothing on Akoro.");
  assert.deepEqual(seen.map(([n]) => n), ["listMaterials", "searchMaterials", "syllabusFromDocuments", "requestMaterials"]);
  for (const [, args] of seen) { assert.equal(args.learnerId, "owner-1"); assert.equal(args.sessionId, "session-1"); }
  assert.equal(seen[2][1].folderId, FOLDER);
  assert.equal(seen[3][1].intent, "Nothing on Akoro.");
  assert.equal(registry.validate("materials.search", {}).code, "tool_schema_invalid");
  assert.equal(registry.validate("learner.request_materials", { reason: "x" }).ok, true, "a propose tool has its workflow basis");
});

test("owner only: another learner's session is not found for any materials tool", async () => {
  const { harness } = harnessWith();
  const s = await harness.createSession({ learnerId: "L", goal: "XYZ scholarship test", subject: "Science" });
  for (const op of ["listMaterials", "searchMaterials", "syllabusFromDocuments", "requestMaterials"]) {
    await assert.rejects(() => harness[op]({ sessionId: s.id, learnerId: "intruder", query: "x", reason: "x" }), (e) => e.code === "session_not_found", op);
  }
});

test("syllabus.from_documents: the files' topics become the session's labelled source; the plan validates against them", async () => {
  const { harness, sessions, events, calls } = harnessWith();
  const s = await harness.createSession({ learnerId: "L", goal: "XYZ scholarship test", subject: "Science" });
  assert.equal(s.goalType, "non_curricular");
  const out = await harness.syllabusFromDocuments({ sessionId: s.id, learnerId: "L", intent: "They uploaded files." });
  assert.equal(out.source, "documents");
  assert.equal(out.label, `${DOCUMENTS_OUTLINE_LABEL}: Scholarship`);
  assert.deepEqual(out.topics.map((t) => t.id), ["cells", "energy"]);
  assert.equal(calls.outline[0].folderId, FOLDER, "the learner's newest folder when the session has none");
  assert.equal(calls.outline[0].learnerId, "L");
  const row = sessions.get(s.id);
  assert.equal(row.syllabus_source, "documents");
  assert.equal(row.syllabus_ref, FOLDER);
  assert.deepEqual(row.material_record_ids, ["r1"]);
  assert.ok(events.some((e) => e.decision_node === "syllabus_resolved" && e.facts?.fromDocuments === true && /own files/.test(e.narrative || "")));
  // syllabus.generate is refused now: the learner's documents are the source.
  await assert.rejects(() => harness.generateSyllabus({ sessionId: s.id, learnerId: "L" }), (e) => e.code === "syllabus_exists");
  assert.equal(documentsLabel(null), DOCUMENTS_OUTLINE_LABEL);
});

test("syllabus.from_documents with no uploads (or unread files) is refused with no_materials and changes nothing", async () => {
  const none = harnessWith({ materials: { latestFolder: async () => null } });
  const s = await none.harness.createSession({ learnerId: "L", goal: "Olympiad prep", subject: "Maths" });
  await assert.rejects(() => none.harness.syllabusFromDocuments({ sessionId: s.id, learnerId: "L" }), (e) => e.code === "no_materials" && e.httpStatus === 422);
  const unread = harnessWith({ materials: { outlineFromDocuments: async () => ({ topics: [], recordIds: ["r1"] }) } });
  const s2 = await unread.harness.createSession({ learnerId: "L", goal: "Olympiad prep", subject: "Maths" });
  await assert.rejects(() => unread.harness.syllabusFromDocuments({ sessionId: s2.id, learnerId: "L" }), (e) => e.code === "no_materials");
  assert.equal(unread.sessions.get(s2.id).syllabus_source, undefined);
});

test("learner.request_materials: asked once per session, an inbox card, then syllabus.generate opens for a non-curricular goal", async () => {
  const { harness, sessions, events, calls } = harnessWith();
  const s = await harness.createSession({ learnerId: "L", goal: "Prepare for the XYZ scholarship test", subject: "General Knowledge" });
  // A non-curricular goal: Akoro's platform syllabus only — the class/school chain is skipped.
  const resolved = await harness.resolveSyllabus({ sessionId: s.id, learnerId: "L" });
  assert.equal(resolved.found, false);
  assert.match(resolved.next, /learner\.request_materials/);
  // Before asking, an outline may not be drafted.
  await assert.rejects(() => harness.generateSyllabus({ sessionId: s.id, learnerId: "L" }), (e) => e.code === "materials_not_requested");
  assert.equal(calls.generate, 0);
  const asked = await harness.requestMaterials({ sessionId: s.id, learnerId: "L", reason: "The handbook lists what is tested." });
  assert.equal(asked.asked, true);
  assert.equal(asked.suggestionId, "sg1");
  assert.equal(calls.request[0].learnerId, "L");
  assert.ok(sessions.get(s.id).materials_requested_at);
  assert.ok(events.some((e) => e.decision_node === "materials_requested"));
  await assert.rejects(() => harness.requestMaterials({ sessionId: s.id, learnerId: "L", reason: "again" }), (e) => e.code === "materials_already_requested");
  assert.equal(calls.request.length, 1, "never asked twice");
  // They had nothing to upload: now the outline may be drafted from the goal.
  const drafted = await harness.generateSyllabus({ sessionId: s.id, learnerId: "L" });
  assert.equal(drafted.source, "generated");
  assert.equal(generateGate({ goal_type: "curricular" }), null, "a school exam keeps the old order");
});

test("a curricular goal is unchanged: class/school chain first, no materials gate on syllabus.generate", async () => {
  const chain = { source: "class", ref: "c1", topics: [{ id: "cells", label: "Cells" }], className: "JSS1A" };
  const { harness } = harnessWith({ chain });
  const s = await harness.createSession({ learnerId: "L", goal: "JSS1 Basic Science end of term exam", subject: "Basic Science" });
  assert.equal(s.goalType, "curricular");
  const resolved = await harness.resolveSyllabus({ sessionId: s.id, learnerId: "L" });
  assert.equal(resolved.source, "class");
  const empty = harnessWith();
  const s2 = await empty.harness.createSession({ learnerId: "L", goal: "JSS1 Agric test", subject: "Agricultural Science" });
  assert.equal((await empty.harness.generateSyllabus({ sessionId: s2.id, learnerId: "L" })).source, "generated");
});

test("materials.list / materials.search read the session's own materials", async () => {
  const { harness, calls } = harnessWith();
  const s = await harness.createSession({ learnerId: "L", goal: "XYZ scholarship test", subject: "Science", materials: { folderId: FOLDER, name: "Scholarship" } });
  const listed = await harness.listMaterials({ sessionId: s.id, learnerId: "L" });
  assert.equal(listed.sessionUsesMaterials, true);
  assert.equal(calls.list[0].folderId, FOLDER);
  assert.equal(listed.items[0].records[0].read, true);
  const found = await harness.searchMaterials({ sessionId: s.id, learnerId: "L", query: "photosynthesis" });
  assert.equal(found.count, 1);
  assert.equal(calls.search[0].folderId, FOLDER);
  assert.equal(calls.search[0].learnerId, "L");
  await assert.rejects(() => harness.searchMaterials({ sessionId: s.id, learnerId: "L", query: " " }), (e) => e.code === "tool_schema_invalid");
});

test("searchMaterials keeps the library search to the given records", async () => {
  const hits = [
    { recordId: "r1", name: "mine.pdf", pageNumber: 3, snippet: "in folder", fused: 0.5 },
    { recordId: "other", name: "elsewhere.pdf", pageNumber: 1, snippet: "outside", fused: 0.9 },
  ];
  const asked = [];
  const out = await searchMaterials({ learnerId: "L", recordIds: ["r1"], query: "cells", limit: 5 }, { search: async (a) => { asked.push(a); return a.recordId ? [] : hits; } });
  assert.deepEqual(out, [{ recordId: "r1", name: "mine.pdf", page: 3, snippet: "in folder" }]);
  assert.ok(asked.every((a) => a.userId === "L"), "only the learner's own library");
  assert.deepEqual(await searchMaterials({ learnerId: "L", recordIds: [], query: "x" }, { search: async () => hits }), []);
});

test("the catalogue offers each operation once: the §7.12 names, with the old names as callable aliases", () => {
  const names = llmFacingTools().map((t) => t.name);
  for (const alias of Object.keys(TOOL_ALIASES)) assert.ok(!names.includes(alias), `${alias} is not offered twice`);
  assert.ok(names.includes("practice.run_agent_check") && names.includes("agent.get_knowledge_coverage"));
  assert.ok(TOOL_DEFINITIONS.some((t) => t.name === "practice.generate"), "the old name stays callable");
});
