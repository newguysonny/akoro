/**
 * workflows/needsYouSources.js — reads the rows the "needs you" list and the
 * dashboard descriptors are made from, for ONE owner (every query is pinned
 * to their id). Read-only: nothing here expires, claims or writes a row.
 *
 *   makeNeedsYouSources({ db, engine })
 *     .learner(userId)     → { workflows, workflowFacts, suggestions, proposals, confirmations, ingests, unavailable }
 *     .instructor(userId)  → { suggestions, proposals, confirmations, drafts, unavailable }
 *     .studyPrepFacts(rows) → { [workflowId]: { topics, understood } }
 *
 * A source that fails to load is named in `unavailable` (the list says it is
 * incomplete) instead of being silently counted as empty.
 */
const LOOKBACK_MS = 14 * 86_400_000;

export function makeNeedsYouSources({ db, engine, now = () => Date.now() }) {
  const edu = () => db.schema("edu");
  const iso = (t) => new Date(t).toISOString();

  async function settle(named) {
    const out = {};
    const unavailable = [];
    await Promise.all(Object.entries(named).map(async ([name, load]) => {
      try { out[name] = (await load()) ?? []; } catch { out[name] = []; unavailable.push(name); }
    }));
    return { ...out, unavailable: unavailable.sort() };
  }
  const rows = async (q) => { const { data, error } = await q; if (error) throw error; return data || []; };

  const suggestions = (userId) => rows(db.from("agent_suggestions")
    .select("id, user_id, kind, title, rationale, status, created_at")
    .eq("user_id", userId).eq("status", "open").order("created_at", { ascending: false }).limit(50));
  const proposals = (userId) => rows(edu().from("agent_proposals").select("*")
    .eq("user_id", userId).in("status", ["proposed", "failed"]).gte("created_at", iso(now() - LOOKBACK_MS))
    .order("created_at", { ascending: false }).limit(60));
  const confirmations = (userId) => rows(edu().from("agent_tool_write_confirmations")
    .select("id, principal_id, status, preview, tool_arguments, expires_at, created_at")
    .eq("principal_id", userId).eq("status", "pending").gt("expires_at", iso(now()))
    .order("created_at", { ascending: false }).limit(30));

  /** Study Prep runs' topic counts (progress), from their own topics table. */
  async function studyPrepFacts(workflows) {
    const bySession = new Map();
    for (const w of workflows || []) {
      const sid = w.workflow_type === "study_prep" ? w.metadata?.studyPrepSessionId : null;
      if (sid) bySession.set(sid, w.id);
    }
    if (!bySession.size) return {};
    const topics = await rows(edu().from("study_prep_topics").select("session_id, status").in("session_id", [...bySession.keys()]));
    const facts = {};
    for (const t of topics) {
      const id = bySession.get(t.session_id);
      if (!id) continue;
      facts[id] ||= { topics: 0, understood: 0 };
      facts[id].topics += 1;
      if (t.status === "understood") facts[id].understood += 1;
    }
    return facts;
  }

  async function learner(userId) {
    const got = await settle({
      workflows: () => engine.listForLearner(userId, { active: true }),
      suggestions: () => suggestions(userId),
      proposals: () => proposals(userId),
      confirmations: () => confirmations(userId),
      ingests: () => rows(edu().from("material_ingests")
        .select("id, user_id, state, names, folder_name, created_at, updated_at")
        .eq("user_id", userId).in("state", ["offering_more", "failed"]).gte("created_at", iso(now() - LOOKBACK_MS))
        .order("created_at", { ascending: false }).limit(30)),
    });
    let workflowFacts = {};
    try { workflowFacts = await studyPrepFacts(got.workflows); } catch { got.unavailable.push("workflowFacts"); }
    return { ...got, workflowFacts };
  }

  async function instructor(userId) {
    return settle({
      suggestions: () => suggestions(userId),
      proposals: () => proposals(userId),
      confirmations: () => confirmations(userId),
      drafts: () => rows(db.from("activity_drafts").select("id, created_by, status, title, created_at")
        .eq("created_by", userId).eq("status", "draft").order("created_at", { ascending: false }).limit(30)),
    });
  }

  return { learner, instructor, studyPrepFacts };
}
