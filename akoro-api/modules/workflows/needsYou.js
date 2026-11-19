/**
 * workflows/needsYou.js — the one "needs you" list (Grand Plan Phase 18
 * item 2): a learner's or an instructor's open work across workflows,
 * proactive proposals, chat suggestions, pending change / permission cards,
 * drafts and uploads, each in exactly one category. PURE — the rows come in
 * already loaded (needsYouSources.js); nothing here reads a reply's text.
 *
 *   needsYou({ ownerId, audience, workflows, workflowFacts, suggestions, proposals,
 *              confirmations, drafts, ingests, now })
 *     → { items: [{ ref, source, category, title, why, waitsFor, action,
 *                   createdAt, updatedAt, expiresAt }],
 *         counts: { answer, review, decision, blocked, failed, total } }
 *
 * Every row must be the owner's (each source's owner column is checked
 * again here). Counts are computed from the list, so a count always equals
 * the list it links to. Healthy things (category none) take no row.
 *
 * Which category, by source (the categories are defined in dashboard.js):
 *   workflow       its state's row in ATTENTION (dashboard.js)
 *   suggestion     open chat suggestion               → decision
 *   proposal       pending planner proposal           → decision
 *                  failed in the last FAILED_WINDOW   → failed
 *   confirmation   pending permission card            → decision
 *                  pending change card (exact rows)   → review
 *   draft          an instructor's AI-prepared draft  → review
 *   upload         material_ingest, by its state      (ATTENTION.material_ingest)
 */
import { ATTENTION, NEEDS_YOU, attentionOf, describeWorkflow } from "./dashboard.js";
import { isTerminalStatus } from "./definition.js";
import { mergeInbox } from "../agent-proposals/index.js";
import { appLink } from "../../lib/urls.js";

export const AUDIENCES = Object.freeze(["learner", "instructor"]);
export const SOURCES = Object.freeze(["workflow", "suggestion", "proposal", "confirmation", "draft", "upload"]);
/** A failed proposal stays on the list this long after it failed. */
export const FAILED_WINDOW_MS = 3 * 86_400_000;
/** An instructor's draft expires after this long (self-study/drafts.js DRAFT_TTL_DAYS). */
export const DRAFT_TTL_MS = 7 * 86_400_000;

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const ms = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? t : null; };
const live = (expiresAt, now) => { const t = ms(expiresAt); return t == null || t > now; };

const HREF = {
  learner: {
    inbox: (ref) => appLink(`tab=agent&inbox=${encodeURIComponent(ref)}`),
    chat: () => appLink("tab=agent"),
    draft: () => null,
  },
  instructor: {
    inbox: (ref) => `/chat?inbox=${encodeURIComponent(ref)}`,
    chat: () => "/chat",
    draft: (id) => `/activities/draft?draft=${encodeURIComponent(id)}`,
  },
};

/** The category of a pending write confirmation: a permission is a yes/no; a change lists exact rows to check. */
export const confirmationCategory = (row) => (row?.tool_arguments?.kind === "permission" ? "decision" : "review");

/** One open workflow run → a row, or null when healthy. */
function workflowItem(r, { parents, facts }) {
  if (!r || isTerminalStatus(r.status)) return null;
  const d = describeWorkflow(r, { parent: parents.get(r.source_workflow_id || r.parent_workflow_id) || null, facts: facts.get(r.id) || null });
  if (!d.needsYou) return null;
  return {
    ref: `w:${r.id}`, source: "workflow", category: d.needsYou, title: d.title, why: d.focus,
    waitsFor: { who: "you", label: d.waitsFor.label }, workflowType: d.workflowType, state: d.state,
    action: d.action ? { label: d.action.label, href: d.action.route.href, route: d.action.route } : null,
    badge: d.badge, progress: d.progress,
    createdAt: d.createdAt, updatedAt: d.updatedAt, expiresAt: null,
  };
}

/** The whole list, sorted by category (NEEDS_YOU order), newest first within one. */
export function needsYou({ ownerId, audience = "learner", workflows = [], workflowFacts = {}, suggestions = [], proposals = [], confirmations = [], drafts = [], ingests = [], now = Date.now() } = {}) {
  if (!ownerId) return { items: [], counts: countsOf([]) };
  const hrefs = HREF[audience] || HREF.learner;
  const mine = (rows, col) => (Array.isArray(rows) ? rows : []).filter((r) => r && r[col] === ownerId);
  const items = [];

  // Workflows — the learner's own runs only (an instructor has none of their own).
  if (audience === "learner") {
    const runs = mine(workflows, "learner_id");
    const parents = new Map(runs.map((r) => [r.id, r]));
    const facts = new Map(Object.entries(workflowFacts || {}));
    for (const r of runs) { const it = workflowItem(r, { parents, facts }); if (it) items.push(it); }
  }

  // Suggestions and pending proposals: one inbox (each title once), each a yes/no.
  const pending = mine(proposals, "user_id").filter((p) => p.status === "proposed" && live(p.expires_at, now));
  const open = mine(suggestions, "user_id").filter((s) => s.status === "open");
  for (const it of mergeInbox({ suggestions: open, proposals: pending })) {
    items.push({
      ref: `i:${it.ref}`, source: it.source === "planner" ? "proposal" : "suggestion", category: "decision",
      title: clip(it.title, 200), why: it.why ? clip(it.why, 300) : null, kind: it.kind,
      waitsFor: { who: "you", label: "Yes or no" },
      action: { label: it.yes || "Decide", href: hrefs.inbox(it.ref) },
      createdAt: it.createdAt || null, updatedAt: null, expiresAt: it.expiresAt || null,
    });
  }
  // A proposal that failed when it ran: said once, plainly, for a few days.
  for (const p of mine(proposals, "user_id")) {
    if (p.status !== "failed") continue;
    const at = ms(p.decided_at || p.updated_at || p.created_at);
    if (at == null || now - at > FAILED_WINDOW_MS) continue;
    items.push({
      ref: `i:p:${p.id}`, source: "proposal", category: "failed", title: clip(p.title, 200), why: null, kind: p.kind,
      waitsFor: { who: "you", label: "It didn't go through" },
      action: { label: "See what happened", href: hrefs.chat() },
      createdAt: p.created_at || null, updatedAt: p.decided_at || null, expiresAt: null,
    });
  }

  // Pending confirm cards: a permission (yes/no) or a change (the exact rows to check).
  for (const c of mine(confirmations, "principal_id")) {
    if (c.status !== "pending" || !live(c.expires_at, now)) continue;
    const category = confirmationCategory(c);
    items.push({
      ref: `c:${c.id}`, source: "confirmation", category,
      title: clip(c.preview?.title || c.preview?.action || "A change waits for you", 200),
      why: c.preview?.action ? clip(c.preview.action, 300) : null,
      waitsFor: { who: "you", label: category === "decision" ? "Allow it or not" : "Check the changes" },
      action: { label: category === "decision" ? "Decide" : "Check the changes", href: hrefs.chat() },
      createdAt: c.created_at || null, updatedAt: null, expiresAt: c.expires_at || null,
    });
  }

  // An instructor's AI-prepared drafts: made, waiting to be checked and assigned.
  for (const d of mine(drafts, "created_by")) {
    if (d.status !== "draft") continue;
    const at = ms(d.created_at);
    if (at != null && now - at > DRAFT_TTL_MS) continue;
    const href = hrefs.draft(d.id);
    if (!href) continue;
    items.push({
      ref: `d:${d.id}`, source: "draft", category: "review", title: clip(d.title || d.payload?.title || "Prepared activity", 200), why: null,
      waitsFor: { who: "you", label: "Check it, then assign" },
      action: { label: "Review the draft", href },
      createdAt: d.created_at || null, updatedAt: d.updated_at || null, expiresAt: at != null ? new Date(at + DRAFT_TTL_MS).toISOString() : null,
    });
  }

  // Uploads (material_ingest): by their state's row.
  for (const g of mine(ingests, "user_id")) {
    const a = attentionOf("material_ingest", g.state);
    if (!a.needs) continue;
    const names = Array.isArray(g.names) ? g.names.filter(Boolean) : [];
    items.push({
      ref: `u:${g.id}`, source: "upload", category: a.needs,
      title: clip(g.folder_name || names[0] || "Your upload", 200), why: names.length > 1 ? `${names.length} files` : null,
      waitsFor: { who: "you", label: a.says },
      action: { label: a.action, href: hrefs.chat() },
      createdAt: g.created_at || null, updatedAt: g.updated_at || null, expiresAt: null,
    });
  }

  const order = (c) => NEEDS_YOU.indexOf(c);
  const when = (it) => ms(it.updatedAt) ?? ms(it.createdAt) ?? 0;
  items.sort((x, y) => order(x.category) - order(y.category) || when(y) - when(x) || String(x.ref).localeCompare(String(y.ref)));
  return { items, counts: countsOf(items) };
}

/** Counts from the list itself: a count is always the length of the list it links to. */
export function countsOf(items) {
  const counts = Object.fromEntries(NEEDS_YOU.map((c) => [c, 0]));
  for (const it of items) counts[it.category] += 1;
  return { ...counts, total: items.length };
}

/** The list for one category (what a count links to). */
export const itemsIn = (list, category) => (list?.items || []).filter((it) => it.category === category);

export { ATTENTION };
