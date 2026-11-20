/**
 * modules/records/studyMaterial.js — the reader's study tools, callable from
 * anywhere (the reader's routes and Agent Chat).
 *
 *   generateToolResult({ userId, target, tool, scope, pageNumber, pageText, values })
 *       summary | quiz | flashcards → { result } | { status, message }
 *   startPodcast({ userId, target, scope, pageNumber, pageText, values })
 *       → { artifact } (status "making"; the episode is finished in the background) | { status, message }
 *   toReaderContent(tool, result)   the tab content the reader shows (its citation shape)
 *   makeStudyMaterial({ userId, tool, query, folder, focus, count, difficulty, length,
 *                       conversationId, fromChatFile, source })
 *       Agent Chat: build the tool from the WHOLE document, save it as a
 *       reader tab. WHERE it comes from is the source action (like a domain
 *       tool's actions): "taught" (the learner's taught notes, materialised
 *       as a Library record), "library" (their documents — or the best one
 *       in a named folder), "discover" (Discover's free notes: one winner is
 *       first copied into their Library, several that would help become ONE
 *       gathered content), "upload" (a file they sent in this chat). An
 *       explicit action runs only its resolver; a miss returns
 *       { code: "no_match", next } naming the next source to try. No source
 *       runs the whole cascade in one call (taught → library → discover).
 *       The result carries the winning source →
 *       { made, tool, recordId, artifactId, name, href, count } | { needsChoice } | { error }
 *
 * Whatever chat makes is the same saved item the reader makes (edu.record_artifacts),
 * so the link `/library?record=<id>&artifact=<id>` opens the reader on that tab.
 *
 * This file is the entry point: the model calls live in
 * study-material-generate.js, the source queries in study-material-store.js,
 * and the pure shapes in study-material-shape.js. The public exports below
 * are re-exported from those files.
 */
import { TOOL_LIMITS } from "./toolsLib.js";
import { findDuplicateArtifact, SOURCE_ACTIONS, sourceMiss } from "./studyMaterialCore.js";
import { createArtifact, listArtifacts } from "./artifactsLib.js";
import { generateToolResult, startPodcast, podcastDeps } from "./study-material-generate.js";
import { buildGatheredContent, copyPlatformRecord, findStudyRecord, resolveDiscoverRecord, resolveLibraryRecord, resolveTaughtRecord, resolveUploadRecord } from "./study-material-store.js";
import { CHAT_STUDY_TOOLS, LABEL, clean, toolValues, toReaderContent } from "./study-material-shape.js";

export { CHAT_STUDY_TOOLS, toolValues, toReaderCite, toReaderContent } from "./study-material-shape.js";
export { generateToolResult, startPodcast } from "./study-material-generate.js";
export { findStudyRecord } from "./study-material-store.js";

/** Agent Chat: make the study material and save it as a reader tab. Never throws. */
export async function makeStudyMaterial({ userId, tool, query = "", folder = "", recordId = null, focus = "", count = "", difficulty = "", length = "", scope = "document", pageNumber = null, conversationId = null, fromChatFile = false, source = null } = {}) {
  try {
    if (!CHAT_STUDY_TOOLS.includes(tool)) return { error: `tool must be one of: ${CHAT_STUDY_TOOLS.join(", ")}.` };
    const docScope = scope === "page" ? "page" : "document";
    const page = Number.isInteger(Number(pageNumber)) && Number(pageNumber) >= 1 ? Number(pageNumber) : null;
    if (docScope === "page" && !page) return { error: "Which page? Say the page number (1-based) for a page-scoped request, or ask for the whole document." };
    // The source action (Matt, 2026-11-16): one tool, the source is the
    // action — like a domain tool. An explicit action runs ONLY its
    // resolver, and a miss answers with the next source to try (guided
    // chaining); no action keeps the full cascade as one call.
    const act = SOURCE_ACTIONS.includes(source) ? source : (fromChatFile ? "upload" : null);
    let found = null;
    if (act === "taught") found = await resolveTaughtRecord({ userId, query });
    else if (act === "library") found = await resolveLibraryRecord({ userId, query, folder, recordId });
    else if (act === "discover") found = await resolveDiscoverRecord({ userId, query });
    else if (act === "upload") found = await resolveUploadRecord({ userId, query, conversationId });
    else found = await findStudyRecord({ userId, query, folder, recordId, conversationId, fromChatFile });
    if (act && !found) return sourceMiss({ source: act, query });
    if (found.error) return { error: found.error, ...(found.code ? { code: found.code } : {}) };
    if (found.needsChoice) {
      return { needsChoice: true, tool, folder: found.folder?.name || null, records: found.needsChoice,
        note: found.chat
          ? `More than one file they sent in this chat could be the one — ask which one (by name) to make the ${tool} from; don't guess.`
          : found.folder
            ? `Their "${found.folder.name}" folder has several documents — ask which one (by name) to make the ${tool} from; don't guess.`
            : `More than one of their documents matches almost equally — ask which one (by name) to make the ${tool} from; don't guess.` };
    }
    // Platform tier: the source is other learners' free notes. A single
    // winner is copied into the learner's Library first; several that would
    // help become ONE gathered content (below). Either way the artifact, its
    // reader card and its dedupe hang off a record the learner owns, and the
    // reply can say where it came from.
    let platformNote = null;
    if (found.records?.length) {
      // Several free notes would help: ONE gathered content written from
      // all of them, cited to each source, saved as a single text in the
      // Library — the build then reads that content like any document.
      const built = await buildGatheredContent({ userId, query, sources: found.records });
      if (built.error) return { error: built.error };
      const list = built.sources.map((s) => `"${s.name}" by ${s.ownerName || "another learner"}`).join(", ");
      platformNote = { source: "platform", sourceName: built.record.name, sourceOwner: null,
        sources: built.sources.map((s) => ({ name: s.name, ownerName: s.ownerName })),
        note: `This was built from a gathered content now saved in their Library ("${built.record.name}") — Akoro brought together ${built.sources.length} free notes from Discover (${list}) and wrote them into one cited text, and the ${tool} was made from that text. Say so in your reply: name Discover and the gathered content; don't call the sources their own documents.` };
      found = { ...found, record: built.record };
    } else if (found.platform) {
      const copied = await copyPlatformRecord({ userId, sourceId: found.record.id });
      if (copied.error) return { error: copied.error };
      platformNote = { source: "platform", sourceName: found.record.name, sourceOwner: found.platform.ownerName || null,
        note: `This was built from ${found.platform.ownerName || "another learner"}'s free notes in Discover ("${found.record.name}") — a copy is now saved in their Library. Say so in your reply: name Discover and the owner, don't call it their own document.` };
      found = { ...found, record: copied.record };
    }
    const { resolveAskTargetFor } = await import("./access.js");
    const target = await resolveAskTargetFor({ userId, recordId: found.record.id });
    if (target.status) return { error: target.message };
    const taughtNote = found.taught ? { source: "taught",
      note: `This was built from what the learner taught their agent — their taught notes on the topic, saved in their Library as "${found.record.name}". Say so in your reply: it comes from their own teaching.` } : null;
    const base = { tool, recordId: found.record.id,
      // A platform build carries its provenance in the name the result
      // reports: the card title is built from it ("Quiz · Free notes in
      // Discover · <name>") and the model reads it too. The Library record
      // itself keeps its real name.
      name: platformNote ? `Free notes in Discover · ${found.record.name}` : found.record.name,
      ...(found.folder ? { folder: found.folder.name } : {}),
      ...(platformNote || taughtNote || { source: found.chat ? "chat" : "library" }) };

    // An identical rebuild returns the tab that already exists: same
    // document, same tool, same page, same knobs — no second generation, no
    // second save. (A podcast still in the making is caught here too; its
    // in-flight guard inside startPodcast stays as the backstop.)
    const dup = await listArtifacts({ userId, recordId: found.record.id })
      .then((arts) => findDuplicateArtifact(arts, {
        kind: tool, pageNumber: docScope === "page" ? page : null,
        focus: clean(focus, TOOL_LIMITS.MAX_FOCUS_CHARS), count, difficulty, length,
      }))
      .catch(() => null);
    if (dup) {
      const items = dup.content?.quizQuestions || dup.content?.cardSet || dup.content?.summaryPoints || [];
      return { made: true, deduped: true, ...base, artifactId: dup.id, label: LABEL[tool],
        ...(tool === "podcast" ? { status: dup.content?.podcast?.status || "ready" } : { count: items.length }),
        scope: docScope === "page" ? `Page ${page}` : "Whole document",
        href: `/library?record=${found.record.id}&artifact=${dup.id}` };
    }

    if (tool === "podcast") {
      const out = await startPodcast({ userId, target, scope: docScope, pageNumber: page, values: { focus, length }, deps: await podcastDeps() });
      if (out.status) return { error: out.message };
      return { made: true, ...base, artifactId: out.artifact.id, status: "making", label: LABEL.podcast,
        href: `/library?record=${found.record.id}&artifact=${out.artifact.id}` };
    }

    const values = toolValues({ focus, count, difficulty });
    const g = await generateToolResult({ userId, target, tool, scope: docScope, pageNumber: page, values, feature: `chat_${tool}` });
    if (g.status) return { error: g.message };
    const content = toReaderContent(tool, g.result);
    const created = await createArtifact({ userId, recordId: found.record.id, row: {
      kind: tool, page_number: docScope === "page" ? page : null, open: true,
      params: { ...values, scope: docScope === "page" ? `Page ${page}` : "Whole document", from: "chat",
        ...(platformNote?.sources ? { gathered: true, sources: platformNote.sources.map((s) => s.name) } : {}) }, content } });
    if (created.error) return { error: created.error };
    const n = (content.quizQuestions || content.cardSet || content.summaryPoints || []).length;
    return { made: true, ...base, artifactId: created.artifact.id, count: n, label: LABEL[tool],
      scope: docScope === "page" ? `Page ${page}` : "Whole document",
      href: `/library?record=${found.record.id}&artifact=${created.artifact.id}` };
  } catch (e) {
    console.warn("[study-material] not made:", String(e?.message || e).slice(0, 160));
    return { error: "Couldn't make that right now — try again in a moment." };
  }
}
