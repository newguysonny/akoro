import { signInternalAccess } from "../auth/index.js";
import { isDocumentGoal } from "../self-tooling/index.js";
import { resolveContentAccess, getExtraction } from "../records/index.js";
import { cleanupPlan } from "./cleanup.js";
import { bad, chat, fail, resolveLearner } from "./console-rules.js";
import * as store from "./console-store.js";

/* POST /agent-console/repair-library-tools { learner, build? }
   Production repair for a learner whose saved "library count" reads a
   subject-bearing view (sessions/XP) and reports the wrong total. Archives
   every active document-goal tool that does NOT read my_library, then (unless
   build:false) builds the correct my_library count tool and returns its total. */
export async function repairLibraryTools(req, res) {
  let learner;
  try { learner = await resolveLearner(req.body?.learner); } catch (e) { return fail(res, e); }
  const tools = await store.activeDocumentTools(learner.id);
  const wrong = (tools || []).filter((t) => isDocumentGoal(t.goal || t.label || "") && !(t.views || []).includes("my_library"));
  for (const t of wrong) {
    await store.archiveTool(t.id, learner.id);
  }
  let built = null;
  if (req.body?.build !== false) {
    const { executeChatTool } = await chat();
    const b = await executeChatTool("create_tool",
      { goal: "Count the documents in my library", name: "library_documents_count", label: "Count my library documents" },
      learner.id, { role: "student", channel: "agent-console" });
    let total = b?.result?.total ?? null;
    // A correct tool already existed (reused): run it so the repair reports the real count.
    if (b?.status === "reused" && b.tool) {
      try { const r = await executeChatTool(b.tool, {}, learner.id, { role: "student", channel: "agent-console" }); total = r?.total ?? total; } catch { /* best-effort */ }
    }
    built = { status: b?.status, tool: b?.tool, mode: b?.mode, total };
  }
  res.json({ success: true, data: {
    learner: learner.username,
    archived: wrong.map((t) => t.name),
    built: built ? { status: built.status, tool: built.tool, mode: built.mode, total: built.result?.total ?? null } : null,
  } });
}

/* POST /agent-console/cleanup-domain-tools { learner, dry? } | { all: true, dry?, confirm? }
   One tool per DOMAIN (view): keep the best READ tool over a view and archive the
   rest. Write tools (anything with capabilities) are never touched — the split
   keeps them separate and Confirm-gated. `all:true` sweeps every learner
   (dry by default; archiving needs confirm:true). */
export async function cleanupDomainTools(req, res) {
  const dry = req.body?.dry === true;
  const all = req.body?.all === true;
  if (!all) {
    let learner;
    try { learner = await resolveLearner(req.body?.learner); } catch (e) { return fail(res, e); }
    const tools = await store.activeToolsForCleanup(learner.id);
    const plan = cleanupPlan(tools || []);
    for (const t of plan.archive) {
      if (!dry) await store.archiveTool(t.id, learner.id);
    }
    return res.json({ success: true, data: { learner: learner.username, dry, kept: plan.kept, archived: plan.archive.map((t) => t.name) } });
  }
  if (!dry && req.body?.confirm !== true) {
    return bad(res, "Sweeping every learner needs confirm:true (or dry:true to preview).");
  }
  const tools = await store.allActiveLearnerTools();
  const byOwner = new Map();
  for (const t of tools || []) {
    if (!byOwner.has(t.owner_id)) byOwner.set(t.owner_id, []);
    byOwner.get(t.owner_id).push(t);
  }
  const archived = [];
  for (const [ownerId, list] of byOwner) {
    const plan = cleanupPlan(list);
    for (const t of plan.archive) {
      archived.push({ owner: ownerId, tool: t.name });
      if (!dry) await store.archiveTool(t.id, ownerId);
    }
  }
  res.json({ success: true, data: { all: true, dry, owners: byOwner.size, archived: archived.length, tools: archived.slice(0, 200) } });
}

/* Read-only: what the shared parse cache holds for a content key. */
export async function contentParses(req, res) {
  const key = String(req.query?.key || "");
  if (!key) return bad(res, "A key is required.");
  const { data, error } = await store.contentParses(key);
  if (error) return bad(res, error.message, 500);
  const pages = (data || []).map((p) => ({ page: p.page_number, model: p.model, chars: String(p.markdown || "").length, updatedAt: p.updated_at }));
  // Mirror the reader's path: access resolution + what the cached GET returns.
  let access = null;
  if (req.query?.learner) {
    try {
      const learner = await resolveLearner(req.query.learner);
      const a = await resolveContentAccess({ userId: learner.id, contentKey: key });
      if (a.status) access = { status: a.status, message: a.message };
      else {
        const got = await getExtraction(a.contentKey);
        access = { status: 200, contentKey: a.contentKey, name: a.name, pages: (got.pages || []).length };
      }
    } catch (e) { access = { error: String(e?.message || e) }; }
  }
  res.json({ success: true, data: { key, count: pages.length, pages, access } });
}

/* A short internal token for an allow-listed learner, so an operator can
   call a learner-scoped endpoint exactly as the app does. Console-key only. */
export async function debugToken(req, res) {
  let learner;
  try { learner = await resolveLearner(req.body?.learner); } catch (e) { return fail(res, e); }
  const token = signInternalAccess({ id: learner.id, role: learner.role || "student" }, 120);
  res.json({ success: true, data: { learner: learner.username, token } });
}

/* Hash older PHARM.D topics and move their cached parses to the versioned
   key. Batched: pass { limit } and call again until checked < limit. */
export async function pharmdHashBackfill(req, res) {
  const { runPharmdHashBackfill } = await import("../pharmd/index.js");
  const limit = Math.max(1, Math.min(50, Number(req.body?.limit) || 10));
  const lines = [];
  const course = req.body?.course ? String(req.body.course) : null;
  const out = await runPharmdHashBackfill({ limit, course, onLog: (line) => lines.push(line) });
  res.json({ success: true, data: { ...out, limit, log: lines } });
}

/* GET /agent-console/learner-tools?learner=@x&status=active
   Read-only inspection of a learner's saved tools (name, view/domain, actions,
   capabilities, params) — the console can otherwise only see built-in tools. */
export async function learnerTools(req, res) {
  let learner;
  try { learner = await resolveLearner(req.query?.learner); } catch (e) { return fail(res, e); }
  const status = String(req.query?.status || "active");
  const { data: tools, error } = await store.learnerTools(learner.id, status);
  if (error) return bad(res, error.message, 500);
  res.json({ success: true, data: { learner: learner.username, status, count: (tools || []).length,
    tools: (tools || []).map((t) => ({ name: t.name, label: t.label, goal: t.goal, mode: t.mode, status: t.status,
      view: t.domain || (t.views || [])[0] || null, actions: t.actions || t.params_schema?.action?.enum || null,
      capabilities: t.capabilities || [], params: Object.keys(t.params_schema || {}),
      verification: t.verification ? { verdict: t.verification.verdict, at: t.verification.at, assertions: t.verification.assertions || [] } : null,
      createdAt: t.created_at, lastUsedAt: t.last_used_at, uses: t.usage_count })) } });
}
