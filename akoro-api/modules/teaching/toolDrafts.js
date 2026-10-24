/**
 * teaching/toolDrafts.js — a teaching tool's result as a DRAFT, versioned like an assignment.
 *
 * Asking the agent for a podcast, lesson hooks, a lesson plan… no longer saves straight to the
 * Library. It files a draft (the same activity_drafts row the activities use, type
 * "teaching_tool") with Version 1 being written in the background; the instructor previews it,
 * asks for changes in chat ("make the hooks more playful") — each round a NEW version built
 * from the one on screen — and Save to Library is the approval. Only then does a Library row
 * exist, so a draft never clutters it and a revision never overwrites the first attempt.
 *
 *   payload = { type: "teaching_tool", tool, input, title, subject, topic,
 *               versions: [{ n, status: drafting|ready|failed, request, basedOn, note,
 *                            summary, error, result (the template), coinsCharged }] }
 */
import db from "../../db.js";
import { mySchool, invalid } from "../self-study/createAssignment.js";
import {
  updateDraftPayload, newVersion, versionsOf, versionAt, latestReady,
} from "../self-study/draftVersions.js";
import { cleanToolInput, generateToolResult, saveToolOutput, toolByKey, toolPayload, ToolError } from "./tools.js";

const JOB_TIMEOUT_MS = 170_000;   // two bounded model calls and the writes

/** Short line for the preview tab and the agent's own view of a version. */
const summaryOf = (result) => ({
  line: `${result.entries.length} ${result.entries.length === 1 ? "entry" : "entries"}${result.title ? ` — ${result.title}` : ""}`.slice(0, 160),
});

/** Build one version in the background. Never throws: a failure is written onto the version. */
export async function runToolVersion(draftId, n) {
  const work = (async () => {
    const { data: draft } = await db.from("activity_drafts").select("*").eq("id", draftId).maybeSingle();
    if (!draft || draft.status !== "draft") return;
    const payload = draft.payload || {};
    const v = versionAt(payload, n);
    if (!v || v.status !== "drafting") return;
    const tool = toolByKey(payload.tool);
    if (!tool) throw new ToolError("That tool is no longer available.", "UNKNOWN_TOOL");
    const base = v.basedOn ? versionAt(payload, v.basedOn) : null;
    if (v.basedOn && !base?.result) throw new Error(`Version ${v.basedOn} isn't ready to build on.`);
    const { result, coinsCharged } = await generateToolResult({
      tool, input: payload.input || {}, userId: draft.created_by,
      base: base?.result || null, request: base ? v.request : null,
    });
    await updateDraftPayload(draftId, (p, row) => {
      if (row.status !== "draft") return null;
      const i = versionsOf(p).findIndex((x) => x.n === n);
      if (i < 0 || p.versions[i].status !== "drafting") return null;
      p.versions[i] = {
        ...p.versions[i], status: "ready", result, coinsCharged, error: null, summary: summaryOf(result),
        note: base ? "Revised as asked." : "First draft.", readyAt: new Date().toISOString(),
      };
      return p;
    });
  })();
  let timer;
  const deadline = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("Drafting took too long.")), JOB_TIMEOUT_MS); timer.unref?.(); });
  try {
    await Promise.race([work, deadline]);
  } catch (e) {
    console.error(`[tool-drafts] ${draftId} v${n} failed:`, String(e?.message || e).slice(0, 200));
    await updateDraftPayload(draftId, (p) => {
      const i = versionsOf(p).findIndex((x) => x.n === n);
      if (i < 0 || p.versions[i].status !== "drafting") return null;
      p.versions[i] = { ...p.versions[i], status: "failed", error: String(e?.message || "Could not draft this.").slice(0, 200), code: e?.code || null };
      return p;
    }).catch(() => {});
  } finally { clearTimeout(timer); }
}

/**
 * File a tool draft. Validates the tool's fields (so a missing topic is asked about NOW, not
 * discovered by a failed version) and starts Version 1.
 */
export async function createToolDraft({ instructor, key, body = {}, sessionId = null, channel = "ai_chat" }) {
  const tool = toolByKey(key);
  if (!tool) throw invalid(`Unknown teaching tool: ${key}`, 404);
  let input;
  try { input = cleanToolInput(tool, body); }
  catch (e) { throw invalid(e.code === "MISSING_FIELD" ? `${e.message} — what should it be?` : e.message, "clarify"); }

  const title = `${tool.name}: ${input.topic || input.subject || "your class"}`.slice(0, 200);
  const payload = {
    type: "teaching_tool", tool: tool.key, input, title,
    subject: input.subject || "General", topic: input.topic || tool.name,
  };
  payload.versions = [newVersion(payload, { request: `${tool.name}${input.topic ? ` on ${input.topic}` : ""}` })];
  const school = await mySchool(instructor.id);
  const { data: draft, error } = await db.from("activity_drafts").insert({
    created_by: instructor.id, school_id: school?.id ?? null,
    type: "teaching_tool", title, subject: payload.subject, topic: payload.topic, payload,
    audience: { label: "Saved to your Library when you approve it" },
    source: channel === "task_run" ? "task_run" : "ai_chat", session_id: sessionId,
  }).select().single();
  if (error) throw invalid(error.message, 500);
  void runToolVersion(draft.id, 1);
  return { draft, tool };
}

/** A follow-up round: the next version, built from the latest ready one (or the one named). */
export async function reviseToolDraft(draft, { request, baseVersion = null }) {
  const text = String(request || "").trim().slice(0, 1500);
  if (!text) throw invalid("What should change? Say it in your own words.", "clarify");
  const payload = draft.payload || {};
  const list = versionsOf(payload);
  const base = baseVersion ? versionAt(payload, baseVersion) : latestReady(payload);
  if (baseVersion && !base) throw invalid(`There is no version ${baseVersion} on this draft.`);
  if (!base || base.status !== "ready") {
    const last = list.at(-1);
    throw invalid(last?.status === "failed"
      ? `Version ${last.n} couldn't be drafted — press Try again on it in the preview (or discard and start again).`
      : `Version ${last?.n ?? 1} is still being drafted — wait for it, then ask again.`, 409);
  }
  let v;
  try { v = newVersion(payload, { request: text, basedOn: base.n }); }
  catch (e) { throw invalid(e.message, e.status || 409); }
  await updateDraftPayload(draft.id, (p) => ({ ...p, versions: [...versionsOf(p), v] }));
  void runToolVersion(draft.id, v.n);
  return { version: v.n };
}

/** Try a failed version again. */
export async function retryToolVersion(draft, n) {
  const v = versionAt(draft.payload, n);
  if (!v) throw invalid("No such version", 404);
  if (v.status !== "failed") throw invalid(`Version ${v.n} didn't fail — nothing to retry.`, 409);
  await updateDraftPayload(draft.id, (p) => {
    const i = versionsOf(p).findIndex((x) => x.n === v.n);
    p.versions[i] = { ...p.versions[i], status: "drafting", error: null, startedAt: new Date().toISOString() };
    return p;
  });
  void runToolVersion(draft.id, v.n);
  return { n: v.n, status: "drafting" };
}

/**
 * The approval: the version on screen (the newest ready one when none is named) goes to the
 * Library. Claim-first like an assignment, so two taps can never save twice.
 * → { outputId, title, tool, version }
 */
export async function saveToolDraft(draft, { version = null } = {}) {
  const payload = draft.payload || {};
  const tool = toolByKey(payload.tool);
  if (!tool) throw invalid("That tool is no longer available.", 400);
  const v = version != null ? versionAt(payload, version) : latestReady(payload);
  if (!v || v.status !== "ready" || !v.result) {
    throw invalid(version != null ? `Version ${version} isn't ready to save.` : "It's still being drafted — try again in a moment.", 409);
  }
  const { data: claim, error: claimErr } = await db.from("activity_drafts")
    .update({ status: "assigned", resolved_at: new Date().toISOString() })
    .eq("id", draft.id).eq("status", "draft").select();
  if (claimErr) throw invalid(claimErr.message, 500);
  if (!claim?.length) throw invalid("This draft was already resolved", 409);

  const input = payload.input || {};
  const outputId = await saveToolOutput({ userId: draft.created_by, tool, input, payload: toolPayload(tool, v.result) });
  if (!outputId) {
    await db.from("activity_drafts").update({ status: "draft", resolved_at: null }).eq("id", draft.id).eq("status", "assigned");
    throw invalid("Could not save it to your Library — try again.", 500);
  }
  await db.from("activity_drafts").update({ assignment_id: outputId }).eq("id", draft.id);
  return { outputId, title: v.result.title || draft.title, tool: tool.key, version: v.n };
}
