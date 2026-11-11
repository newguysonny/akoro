/**
 * agentConsole/cleanup.js — pure plan for stale Tool Cleanup.
 *
 * One tool per VIEW, but only archive what a domain tool genuinely supersedes:
 *  - other DOMAIN tools (code tool with an `action` enum) over the same view;
 *  - simple read tools (count/list/search/breakdown) whose goal has no extra
 *    dimension (weekly, per day, top/most, average, accuracy…).
 * Write tools (anything with capabilities) are never touched. A bespoke reader
 * (e.g. "Weekly XP by subject") is kept beside the domain tool, because the
 * generic count/list/by_<field> actions can't reproduce it.
 */

const isDomainTool = (t) => t?.mode === "code" && Array.isArray(t?.params_schema?.action?.enum);
const SIMPLE_READ = /\b(count|counts|list|listing|show|how many|number of|search|find|breakdown|grouped by|total)\b/i;
const RICH_READ = /\b(week|weekly|month|monthly|last \d+|over the|compare|trend|streak|top|most|highest per|lowest per|rank|average|accuracy|percentage|score|per day|per week|by .* and)\b/i;

/** A read tool whose intent the domain actions can reproduce. */
export function isSimpleRead(t) {
  const text = `${t?.goal || ""} ${t?.label || ""}`;
  return SIMPLE_READ.test(text) && !RICH_READ.test(text);
}

/** Group active tools by data view, keep the best READ tool per view, and list
 *  the ones a domain tool supersedes. */
export function cleanupPlan(tools) {
  const byDomain = new Map();
  for (const t of tools || []) {
    if ((t.capabilities || []).length) continue;                     // write tool
    const domain = t.domain || (Array.isArray(t.views) && t.views[0]);
    if (!domain) continue;
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(t);
  }
  const kept = {}, archive = [];
  for (const [domain, list] of byDomain) {
    list.sort((a, b) => {
      const ad = isDomainTool(a) ? 1 : 0;
      const bd = isDomainTool(b) ? 1 : 0;
      if (bd !== ad) return bd - ad;                                 // prefer a domain tool
      const al = (a.params_schema?.action?.enum || []).length;
      const bl = (b.params_schema?.action?.enum || []).length;
      if (bl !== al) return bl - al;                                 // then the richer one
      return String(b.created_at).localeCompare(String(a.created_at));
    });
    kept[domain] = list[0].name;
    for (const t of list.slice(1)) {
      if (isDomainTool(t) || isSimpleRead(t)) archive.push(t);       // never a bespoke reader
    }
  }
  return { kept, archive };
}
