/**
 * Phase 5 tools (Grand Plan §8.8, §7.14, §7.13, §7.12):
 *   materials.syllabus_from_documents  a non-curricular session plans from the learner's own
 *                                      folder (labelled documents outline); request_materials once
 *   blog.passage_search                blog search reads article bodies and returns passages
 *   peer.breakthrough_help             what worked for 3 opted-in testers on a marked concept;
 *                                      opt-out removes a story; no pattern under 5 learners
 *   studyprep.agent_check_tools        the §7.12 tool names and the locked model roles
 * Everything written is marked and removed afterwards.
 */
import { randomUUID } from "node:crypto";

const edu = (db) => db.schema("edu");

export const syllabusFromDocuments = {
  name: "materials.syllabus_from_documents", area: "study-prep", risk: "write",
  description: "A scholarship goal is non-curricular: it plans from the learner's own uploaded folder via syllabus.from_documents (saved as a documents outline, labelled), and asks for materials only once.",
  params: { learner: { default: "@tester15" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const { default: db } = await import("../../../db.js");
    const tag = ctx.marker.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-10);
    const probe = await edu(db).from("study_prep_sessions").select("goal_type, material_record_ids, materials_requested_at").limit(1);
    if (probe.error) ctx.expect.blocked(`2026-study-prep-materials-goal-type.sql not applied yet: ${probe.error.message}`);

    const { data: folder, error: fErr } = await edu(db).from("library_folders").insert({ user_id: me.id, name: `Scholarship gate ${tag}` }).select("id, name").single();
    if (fErr) ctx.expect.blocked(`couldn't add the test folder: ${fErr.message}`);
    ctx.cleanup(() => edu(db).from("library_folders").delete().eq("id", folder.id));
    const { data: rec, error: rErr } = await edu(db).from("records").insert({ user_id: me.id, kind: "paste", name: `XYZ handbook ${tag}`, content: "Cells, energy and forces are tested." }).select("id").single();
    if (rErr) ctx.expect.blocked(`couldn't add the test record: ${rErr.message}`);
    ctx.cleanup(() => edu(db).from("records").delete().eq("id", rec.id));
    const structure = { items: [{ topics: [{ name: `Cells ${tag}`, pages: [1] }, { name: `Energy ${tag}`, pages: [2] }] }] };
    const { data: ing, error: iErr } = await edu(db).from("material_ingests").insert({
      user_id: me.id, state: "ready", names: ["handbook.txt"], record_ids: [rec.id], folder_id: folder.id, folder_name: folder.name, doc_kind: "syllabus", subject: "Science", structure,
    }).select("id").single();
    if (iErr) ctx.expect.blocked(`couldn't add the test upload: ${iErr.message}`);
    ctx.cleanup(() => edu(db).from("material_ingests").delete().eq("id", ing.id));

    const { getHarness } = await import("../../adaptive-learning/study-prep/wiring.js");
    const harness = getHarness();
    const active = await edu(db).from("study_prep_sessions").select("id").eq("learner_id", me.id).not("status", "in", "(completed,cancelled)").limit(5);
    for (const s of active.data || []) await harness.cancelSession({ sessionId: s.id, learnerId: me.id }).catch(() => null);
    ctx.cleanup(() => ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: `${ctx.marker}%` } } }));
    const session = await harness.createSession({ learnerId: me.id, goal: `${ctx.marker} Prepare for the XYZ scholarship test`, subject: "Science" });
    ctx.expect.eq("a scholarship goal is non-curricular", session.goalType, "non_curricular");

    const listed = await harness.listMaterials({ sessionId: session.id, learnerId: me.id });
    ctx.expect.ok("materials.list shows the upload", listed.items.some((i) => i.records.some((r) => r.recordId === rec.id)), listed);
    await ctx.expect.ok("another learner can't read this session's materials",
      await harness.listMaterials({ sessionId: session.id, learnerId: randomUUID() }).then(() => false, (e) => e.code === "session_not_found"));

    const out = await harness.syllabusFromDocuments({ sessionId: session.id, learnerId: me.id, folderId: folder.id });
    ctx.note(`from_documents: ${JSON.stringify(out).slice(0, 300)}`);
    ctx.expect.eq("planned from documents", out.source, "documents");
    ctx.expect.ok("labelled as drawn from the files", /Outline drawn from your files/.test(out.label || ""), out.label);
    ctx.expect.ok("the folder's topics", out.topics.some((t) => t.label === `Cells ${tag}`), out.topics);
    const [row] = await ctx.db.rows("edu.study_prep_sessions", { id: session.id }, { columns: "syllabus_source, syllabus_ref, material_record_ids", limit: 1 });
    ctx.expect.eq("session source is documents", row?.syllabus_source, "documents");
    ctx.expect.eq("…from this folder", row?.syllabus_ref, folder.id);
    const outlines = await ctx.db.rows("edu.generated_syllabi", { created_by_learner: me.id, source: "documents" }, { columns: "id, record_ids, grounding" });
    const mine = outlines.filter((o) => o.grounding?.folderId === folder.id);
    for (const o of mine) ctx.cleanup(() => edu(db).from("generated_syllabi").delete().eq("id", o.id));
    ctx.expect.eq("one documents outline saved", mine.length, 1);
    ctx.expect.ok("…with the record it came from", (mine[0]?.record_ids || []).includes(rec.id), mine[0]?.record_ids);
    const resolved = await harness.resolveSyllabus({ sessionId: session.id, learnerId: me.id });
    ctx.expect.eq("syllabus.resolve now returns the documents topics", resolved.source, "documents");

    const asked = await harness.requestMaterials({ sessionId: session.id, learnerId: me.id, reason: `${ctx.marker} the handbook lists the tested topics` });
    if (asked.suggestionId) ctx.cleanup(() => db.from("agent_suggestions").delete().eq("id", asked.suggestionId));
    ctx.expect.eq("learner.request_materials asks", asked.asked, true);
    const again = await harness.requestMaterials({ sessionId: session.id, learnerId: me.id, reason: "again" }).then(() => null, (e) => e.code);
    ctx.expect.eq("…only once per session", again, "materials_already_requested");
    await harness.cancelSession({ sessionId: session.id, learnerId: me.id }).catch(() => null);
  },
};

export const blogPassageSearch = {
  name: "blog.passage_search", area: "blog", risk: "read",
  description: "The agent's blog search reads article bodies: a word found only in a published post's body returns that passage with the post's title and link.",
  async run(ctx) {
    const { contentDb } = await import("../../../db.js");
    const { data: posts, error } = await contentDb.from("blog_posts").select("slug, title, body").eq("status", "published").order("published_at", { ascending: false }).limit(20);
    if (error) ctx.expect.blocked(`blog unavailable: ${error.message}`);
    const { blogPassages, searchBlogPassages, searchBlogPosts } = await import("../../../lib/blogResearch.js");
    // A word from a post's body that its title does not contain.
    let pick = null;
    for (const post of posts || []) {
      const words = blogPassages(post.body).flatMap((x) => x.text.toLowerCase().match(/[a-z]{8,}/g) || []);
      const word = words.find((w) => !post.title.toLowerCase().includes(w));
      if (word) { pick = { post, word }; break; }
    }
    if (!pick) ctx.expect.blocked("no published post with body text to search");
    ctx.note(`searching "${pick.word}" (from the body of ${pick.post.slug})`);
    const found = await searchBlogPassages({ query: pick.word, limit: 8 });
    ctx.note(`index: ${found.index}, ${found.count} passages`);
    ctx.expect.ok("a passage comes back", found.count > 0, found);
    const hit = (found.passages || []).find((x) => x.passage.toLowerCase().includes(pick.word));
    ctx.expect.ok("…containing the body word", Boolean(hit), found.passages);
    ctx.expect.ok("…with its post's title and link", Boolean(hit?.title && hit?.link === `/blog/${hit?.slug}`), hit);
    const cards = await searchBlogPosts({ query: pick.word });
    ctx.expect.ok("search_blog_posts carries the passages too", (cards.passages || []).length > 0, cards);
  },
};

export const peerBreakthroughHelp = {
  name: "peer.breakthrough_help", area: "learning", risk: "write",
  description: "Three opted-in testers got past the same struggle on a marked concept: the asker's agent gets their what-worked stories (agent name only, no ids), no pattern under 5 learners, and an opt-out removes that story.",
  params: { asker: { default: "@tester34" }, helpers: { default: "@tester31,@tester32,@tester33" } },
  async run(ctx, p) {
    const asker = await ctx.as(p.asker);
    const helpers = [];
    for (const h of String(p.helpers).split(",")) helpers.push(await ctx.as(h.trim()));
    const { default: db } = await import("../../../db.js");
    const probe = await db.from("user_agents").select("user_id, help_others_opt_in, help_others_chosen_at").in("user_id", helpers.map((h) => h.id));
    if (probe.error) ctx.expect.blocked(`2026-peer-help-opt-in.sql / 2026-peer-help-default-on.sql not applied yet: ${probe.error.message}`);
    if ((probe.data || []).length < helpers.length) ctx.expect.blocked("a helper tester has no agent");
    // Restored exactly (choice and its time), so a tester who never chose is back to the default (on).
    const before = new Map(probe.data.map((a) => [a.user_id, { help_others_opt_in: a.help_others_opt_in === true, help_others_chosen_at: a.help_others_chosen_at || null }]));
    ctx.cleanup(async () => { for (const [id, v] of before) await db.from("user_agents").update(v).eq("user_id", id); });

    const tag = ctx.marker.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-10);
    const { data: concept, error } = await edu(db).from("concept_catalog").insert({
      curriculum_key: "verify-gate", subject: "Basic Science", topic_key: `transpiration-gate-${tag}`, code: `gate.transpiration.${tag}`,
      title: `Transpiration gate ${tag}`, objective: "Tell transpiration from evaporation.", source_type: "reviewed_content", source_ref: { gate: ctx.marker }, status: "approved",
    }).select("id").single();
    if (error) ctx.expect.blocked(`couldn't add the test concept: ${error.message}`);
    ctx.cleanup(async () => {
      await edu(db).from("learning_struggles").delete().eq("concept_id", concept.id);
      await edu(db).from("concept_catalog").delete().eq("id", concept.id);
    });
    const now = new Date().toISOString();
    const rows = helpers.map((h, i) => ({
      learner_id: h.id, category: "recall", struggle_type: "interference", concept_id: concept.id, topic_label: `Transpiration gate ${tag}`,
      detected_by: "rule", status: "resolved", struggle_summary: "Mixed up evaporation and transpiration",
      attempts_before: 2 + i, what_worked_strategy: "teach_back", what_worked: `${ctx.marker} drew a leaf's stomata and taught it back`,
      score_before: 0.4, score_after: 0.8 + i * 0.05, resolved_at: now, sensitive: false, shareable: true, source_workflow: "verify",
    }));
    const ins = await edu(db).from("learning_struggles").insert(rows);
    if (ins.error) ctx.expect.blocked(`couldn't seed breakthroughs: ${ins.error.message}`);

    const { consultBreakthroughs, setHelpOthersOptIn } = await import("../../../lib/peerConsult.js");
    for (const h of helpers) await setHelpOthersOptIn(h.id, true);
    const out = await consultBreakthroughs({ userId: asker.id, struggleType: "interference", conceptId: concept.id });
    ctx.note(`consult: ${JSON.stringify(out).slice(0, 400)}`);
    ctx.expect.eq("three stories, one per helper", out.stories?.length, 3);
    ctx.expect.ok("…each says what worked", out.stories.every((s) => s.whatWorked.includes(ctx.marker) && s.strategy === "teach_back"), out.stories);
    ctx.expect.eq("no pattern under 5 learners", out.pattern, null);
    const json = JSON.stringify(out);
    ctx.expect.ok("no learner id travels", helpers.every((h) => !json.includes(h.id)) && !json.includes(asker.id));

    await setHelpOthersOptIn(helpers[0].id, false);
    const after = await consultBreakthroughs({ userId: asker.id, struggleType: "interference", conceptId: concept.id });
    ctx.expect.eq("an opt-out removes that learner's story", after.stories?.length, 2);
    const [shared] = await ctx.db.rows("edu.learning_struggles", { learner_id: helpers[0].id, concept_id: concept.id }, { columns: "shareable", limit: 1 });
    ctx.expect.eq("…and marks their records unshareable", shared?.shareable, false);
    const own = await consultBreakthroughs({ userId: helpers[1].id, struggleType: "interference", conceptId: concept.id });
    ctx.expect.ok("a learner never gets their own story back", own.stories.length === 1, own.stories);
  },
};

export const agentCheckTools = {
  name: "studyprep.agent_check_tools", area: "study-prep", risk: "read",
  description: "The Study Prep agent is offered practice.run_agent_check and agent.get_knowledge_coverage (old names stay callable aliases), and the recall, question and assessor model roles stay locked whatever the learner picks.",
  async run(ctx) {
    const { buildRegistry, llmFacingTools, TOOL_ALIASES } = await import("../../adaptive-learning/tools/registry.js");
    const names = llmFacingTools().map((t) => t.name);
    for (const n of ["practice.run_agent_check", "agent.get_knowledge_coverage", "materials.list", "materials.search", "syllabus.from_documents", "learner.request_materials"]) {
      ctx.expect.ok(`${n} is offered`, names.includes(n));
    }
    ctx.expect.ok("old names are not offered twice", Object.keys(TOOL_ALIASES).every((a) => !names.includes(a)));
    const seen = [];
    const registry = buildRegistry({ readTools: {}, learnerId: "L", sessionId: "S", harness: {
      startTopicPractice: async (a) => { seen.push(["check", a]); return {}; }, topicNotes: async (a) => { seen.push(["notes", a]); return {}; } } });
    await registry.execute("practice.run_agent_check", { topicId: "t", mode: "diagnostic" }, "gate");
    await registry.execute("practice.generate", { topicId: "t", mode: "diagnostic" }, "gate");
    await registry.execute("agent.get_knowledge_coverage", {});
    ctx.expect.eq("both check names run the same harness operation", seen.filter(([k]) => k === "check").length, 2);
    ctx.expect.ok("…inside the approved coins only", seen.filter(([k]) => k === "check").every(([, a]) => a.withinEstimateOnly === true));
    const { modelRegistry } = await import("../../../lib/modelRegistry.js");
    for (const role of ["agent_recall", "question_generator", "assessor"]) {
      for (const choice of ["claude-opus", "gpt-4.1"]) {
        ctx.expect.eq(`${role} stays locked with "${choice}" picked`, modelRegistry.resolve({ role, learnerChoice: choice }).source, "locked");
      }
    }
  },
};

export const PHASE5_TOOLS = [syllabusFromDocuments, blogPassageSearch, peerBreakthroughHelp, agentCheckTools];
