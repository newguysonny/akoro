/**
 * Phase 11 — UI backends on a live server.
 *   models.tier_lists                the picker's tier list (§7.11.5a): the
 *     models a learner may use are the default plus their payer's tier list,
 *     matching tiers.allowed_models (or the plan's list while unset).
 *   teaching.direct_workflow         POST /api/teaching/workflows (§15, Scenario
 *     A): a direct session is a teaching workflow before the modal opens.
 *   school.struggles_recorded        the school's struggles view reads
 *     edu.learning_struggles: every open non-sensitive recorded struggle of a
 *     linked learner is on the view; sensitive ones are only counted.
 */
import { SENSITIVE_TYPES } from "../../adaptive-learning/learner/struggleTypes.js";

const MISSING = /does not exist|schema cache|column/i;

export const modelTierLists = {
  name: "models.tier_lists", area: "chat", risk: "read",
  description: "GET /api/adaptive/chat/models with the picker on names the learner's tier and its list; every usable model is the default or on that list (the tier row's allowed_models, or the plan's starting list while unset); a Pilot tier offers DeepSeek and nothing else; Fable is on no list.",
  params: { learner: { default: "@tester01" } },
  async run(ctx, p) {
    const rows = await ctx.db.rows("tiers", {}, { columns: "id, platform, name, allowed_models", limit: 100 })
      .catch((e) => ctx.expect.blocked(MISSING.test(e.message) ? `tiers.allowed_models isn't migrated here (2026-tier-allowed-models.sql): ${e.message}` : e.message));
    const { allowedModelsOf } = await import("../../../lib/modelTiers.js");
    const pilot = rows.find((t) => t.platform === "school" && /^pilot$/i.test(t.name));
    if (pilot) ctx.expect.eq("the Pilot tier: DeepSeek only", allowedModelsOf(pilot), ["deepseek"]);
    else ctx.note("no school Pilot tier row here — that check skipped");
    ctx.expect.ok("Claude Fable is on no tier", rows.every((t) => !allowedModelsOf(t).includes("claude-fable")), rows.map((t) => [t.name, t.allowed_models]));

    const r = await ctx.http({ as: p.learner, path: "/api/adaptive/chat/models" });
    ctx.expect.status("the models list answers", r, 200);
    const picker = r.body?.picker || {};
    if (!picker.enabled) ctx.expect.blocked("AI_MODEL_PICKER_ENABLED is off here — the tier list only applies with the picker on");
    ctx.expect.ok("it names the learner's tier and where it came from", typeof picker.tier === "string" && !!picker.tierSource, picker);
    const allowed = new Set(picker.allowedModels || []);
    const models = r.body?.models || [];
    const usable = models.filter((m) => m.available).map((m) => m.id);
    ctx.expect.ok("every usable model is the default or on the tier's list", usable.every((id) => id === picker.defaultId || allowed.has(id)), { usable, allowed: [...allowed] });
    ctx.expect.ok("a model outside the list is marked locked to a plan", models.filter((m) => !m.default && !allowed.has(m.id)).every((m) => !m.available && m.locked === "plan"));
    const row = rows.find((t) => t.name === picker.tier);
    if (row && picker.tierSource !== "fallback") ctx.expect.eq("the list is the tier row's", [...allowed].sort(), allowedModelsOf(row).sort());
    ctx.note(`tier ${picker.tier} (${picker.tierSource}) · may switch to ${[...allowed].join(", ") || "nothing"} · usable here: ${usable.join(", ")}`);
  },
};

export const teachingDirectWorkflow = {
  name: "teaching.direct_workflow", area: "workflows", risk: "write",
  description: "POST /api/teaching/workflows as a test learner: 201 with a workflowId — a teaching workflow (entry direct, scheduled) of that learner; the same topic again returns the same one; GET and resume work for the owner only; the dashboard descriptor routes it to the teaching modal with its workflowId; a missing topic is 422.",
  params: { learner: { default: "@tester46" }, other: { default: "@tester47" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    await ctx.as(p.other);
    const topic = `${ctx.marker} Evaporation`;
    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/teaching/workflows", body: { topic, subject: "Basic Science", focus: ["Evaporation vs transpiration"] } });
    if (made.status === 503) ctx.expect.blocked("workflows are switched off here (WORKFLOW_ENGINE_ENABLED)");
    if (made.status === 404) ctx.expect.blocked("POST /api/teaching/workflows isn't deployed here yet");
    const id = made.body?.workflowId;
    if (id) ctx.cleanup(() => ctx.db.deleteOwned("edu.workflow_instances", { ownerColumn: "learner_id", ownerId: me.id, filters: { id } }));
    ctx.expect.status("a direct session is created", made, 201);
    const [row] = await ctx.db.rows("edu.workflow_instances", { id }, { columns: "learner_id, workflow_type, entry_mode, state, status" });
    ctx.expect.eq("…a teaching workflow of this learner, entry direct, scheduled", [row?.learner_id, row?.workflow_type, row?.entry_mode, row?.state], [me.id, "teaching", "direct", "scheduled"]);
    const again = await ctx.http({ as: p.learner, method: "POST", path: "/api/teaching/workflows", body: { topic } });
    ctx.expect.eq("the same topic again reopens it (no duplicate)", [again.status, again.body?.workflowId], [200, id]);
    ctx.expect.status("the owner reads it", await ctx.http({ as: p.learner, path: `/api/teaching/workflows/${id}` }), 200);
    ctx.expect.status("another learner can't", await ctx.http({ as: p.other, path: `/api/teaching/workflows/${id}` }), 404);
    const resume = await ctx.http({ as: p.learner, method: "POST", path: `/api/teaching/workflows/${id}/resume` });
    ctx.expect.eq("resume says what the modal opens", [resume.body?.open?.surface, resume.body?.open?.workflowId, resume.body?.open?.mode], ["teaching_modal", id, "fresh"]);
    const card = await ctx.http({ as: p.learner, path: `/api/workflows/dashboard/${id}` });
    ctx.expect.eq("the dashboard routes it to the teaching modal with its workflowId", [card.body?.workflow?.action?.route?.surface, card.body?.workflow?.action?.route?.workflowId], ["teaching_modal", id]);
    ctx.expect.status("no topic is refused", await ctx.http({ as: p.learner, method: "POST", path: "/api/teaching/workflows", body: {} }), 422);
  },
};

export const schoolStrugglesRecorded = {
  name: "school.struggles_recorded", area: "security", risk: "read",
  description: "The school admin's struggles view against edu.learning_struggles: every open, non-sensitive recorded struggle of a LINKED learner shows on that learner; each class's sensitiveOpen equals its linked learners' open sensitive rows; no sensitive type, summary or learner outside the school appears anywhere.",
  params: { admin: { default: "@demo_school_admin" } },
  async run(ctx, p) {
    const admin = await ctx.as(p.admin);
    const r = await ctx.http({ as: p.admin, path: "/api/school/mgmt/learning/struggles" });
    if (r.status === 404) ctx.expect.blocked(`${p.admin} has no school on this server`);
    ctx.expect.status("the view loads", r, 200);
    const view = r.body?.data || {};
    const [school] = await ctx.db.rows("school_profiles", { admin_user_id: admin.id }, { columns: "id", limit: 1 });
    const students = school ? await ctx.db.rows("mgmt.students", { school_id: school.id, status: "active" }, { columns: "id, user_id, class_id", limit: 2000 }) : [];
    const linked = students.filter((s) => s.user_id);
    const classIds = new Set((view.classes || []).map((c) => c.classId));
    const inView = linked.filter((s) => classIds.has(s.class_id));
    if (!inView.length) ctx.expect.blocked("no linked learners in this school's classes — nothing to compare");
    const recorded = await ctx.db.rows("edu.learning_struggles", { learner_id: { in: inView.map((s) => s.user_id) }, status: "open" },
      { columns: "learner_id, struggle_type, sensitive, expires_at, detected_at", limit: 2000 })
      .catch((e) => ctx.expect.blocked(MISSING.test(e.message) ? `edu.learning_struggles isn't migrated here: ${e.message}` : e.message));
    const live = recorded.filter((s) => !s.expires_at || Date.parse(s.expires_at) > Date.now());
    const byUser = new Map(inView.map((s) => [s.user_id, s]));
    const learners = new Map((view.learners || []).map((l) => [l.studentId, l]));
    const plain = live.filter((s) => !SENSITIVE_TYPES.includes(s.struggle_type));
    const missing = plain.filter((s) => !(learners.get(byUser.get(s.learner_id)?.id)?.open || []).some((i) => i.type === s.struggle_type));
    ctx.expect.ok("every open recorded struggle of a linked learner is on the view", missing.length === 0, missing.slice(0, 5));
    for (const c of view.classes || []) {
      const want = live.filter((s) => SENSITIVE_TYPES.includes(s.struggle_type) && byUser.get(s.learner_id)?.class_id === c.classId).length;
      ctx.expect.eq(`${c.name || c.classId}: sensitive struggles counted`, c.sensitiveOpen, want);
    }
    const text = JSON.stringify(view);
    ctx.expect.ok("no sensitive type is described", !SENSITIVE_TYPES.some((t) => text.includes(`"${t}"`)));
    const outsiders = (view.learners || []).filter((l) => !inView.some((s) => s.id === l.studentId));
    ctx.expect.ok("no learner outside the school's linked students", outsiders.length === 0, outsiders.map((l) => l.studentId));
    ctx.note(`${inView.length} linked learners · ${plain.length} open recorded struggles shown · ${live.length - plain.length} sensitive counted`);
  },
};

export const PHASE11_UI = [modelTierLists, teachingDirectWorkflow, schoolStrugglesRecorded];
