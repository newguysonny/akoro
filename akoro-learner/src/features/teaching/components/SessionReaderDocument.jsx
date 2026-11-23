// Reader pane: the toolbar, the page stack (or the media player and its
// transcript), the generate menu and the thumbnails.
import { useState } from "react";
import { BRAND, GREEN, GOLD, RED } from '../../../constants.js';
import { Icon } from '../../../components/common/Icons.jsx';
import MediaPlayer from '../../../components/library/MediaPlayer.jsx';
import { artifactToTab } from '../../../lib/readerArtifacts.js';
import ContextPicker from './ContextPicker.jsx';
import {
  TOOL_DEFS, toolById, SERVER_TOOLS, isServerPodcast, FORM_DEFS, SCOPE_FIELD, mediaTime,
} from './sessionReaderModel.js';

function SavedList({ items, onOpen, onDelete }) {
  if (!items?.length) return null;
  return (
    <>
      <div className="font-display text-base font-semibold mb-2 mt-1" style={{ color: "var(--ak-text)" }}>Saved</div>
      <div className="flex flex-col gap-1.5 mb-4">
        {items.map((a) => {
          const def = toolById(a.kind);
          const title = artifactToTab(a, a.id).title;
          return (
            <div key={a.id} className="folio-gen-card flex items-center gap-2 px-2.5 py-1.5 border rounded-lg min-w-0">
              <button type="button" onClick={() => onOpen(a)} className="flex-1 flex items-center gap-2 min-w-0 text-left" style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                <span className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: def?.bg }}>
                  <Icon name={def?.icon || "ti-file-text"} size={13} color={def?.fg}/>
                </span>
                <span className="truncate text-sm" style={{ color: "var(--ak-text)" }}>{title}</span>
              </button>
              <button type="button" onClick={() => onDelete(a)} aria-label={`Delete ${title}`} title="Delete"
                className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ak-text-sub)" }}>
                <Icon name="ti-trash" size={13}/>
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * One tool's creations as a list — the tool tab's home (Matt, 2026-11-17).
 * Open creations (tabs) and closed saved items of the kind merge here,
 * newest first; a row opens the creation, the trash deletes it for real
 * (the same delete the Generate menu's Saved list always offered).
 */

function GenerateGrid({ onPick, discussion, askEnabled = false, saved = null, serverOnly = false }) {
  // Over a folder there are no pages to derive from: only the tools the
  // server builds from the folder's documents (plus Ask) are offered.
  const generated = TOOL_DEFS.filter((t) => !t.community && (!t.needsAsk || askEnabled)
    && (!serverOnly || t.id === "ask" || SERVER_TOOLS.has(t.id) || t.id === "podcast"));
  // The Discussion card only features when this content is CONNECTED to
  // one of the learner's communities — that's when the messaging exists.
  // Q&A stays a session-local board either way.
  const community = TOOL_DEFS.filter((t) => t.community
    && (t.id !== "discussion" || !!discussion?.communities?.length));
  const Card = (t) => (
    <button
      key={t.id}
      type="button"
      onClick={() => onPick(t)}
      className="folio-gen-card flex items-center gap-2 px-2.5 py-2 border rounded-lg text-left min-w-0"
    >
      <span className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: t.bg }}>
        <Icon name={t.icon} size={15} color={t.fg}/>
      </span>
      <span className="flex-1 flex items-center gap-1.5 min-w-0 text-sm" style={{ color: "var(--ak-text)" }}>
        <span className="truncate">{t.label}</span>
      </span>
      <Icon name="ti-chevron-right" size={13} color="var(--ak-text-sub)"/>
    </button>
  );
  return (
    <div className="px-4 pt-3.5 pb-2 flex-shrink-0">
      <div className="font-display text-base font-semibold mb-2" style={{ color: "var(--ak-text)" }}>Generate</div>
      <div className="grid grid-cols-2 gap-2 mb-4">{generated.map(Card)}</div>
      {saved && <SavedList items={saved.items} onOpen={saved.onOpen} onDelete={saved.onDelete}/>}
      {community.length > 0 && (
        <>
          <div className="font-display text-base font-semibold mb-2" style={{ color: "var(--ak-text)" }}>Community</div>
          <div className="grid grid-cols-2 gap-2">{community.map(Card)}</div>
        </>
      )}
    </div>
  );
}

function ToolHeader({ label, sub, onBack }) {
  return (
    <div className="flex items-center gap-2.5 mb-3.5">
      <button type="button" onClick={onBack} className="folio-btn-outline w-7 h-7 rounded-full border flex items-center justify-center flex-shrink-0">
        <Icon name="ti-chevron-left" size={15}/>
      </button>
      <div>
        <div className="font-display text-base font-semibold mb-0.5" style={{ color: "var(--ak-text)" }}>{label}</div>
        {sub && <div className="text-xs" style={{ color: "var(--ak-text-sub)" }}>{sub}</div>}
      </div>
    </div>
  );
}

function CreationForm({ toolId, initialFocus, onBack, onSubmit, withScope = false, pageCount = 0, currentPage = 0 }) {
  const base = FORM_DEFS[toolId];
  const def = withScope ? { ...base, fields: [SCOPE_FIELD, ...base.fields] } : base;
  const [values, setValues] = useState(() => {
    const v = {};
    def.fields.forEach((f) => {
      v[f.id] = f.type === "select" ? f.options[0]
        : f.type === "number" ? (f.default ?? "")
        : (f.id === "focus" ? initialFocus || "" : "");
    });
    if (withScope) { v.pages = []; v.context = []; }
    return v;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const pickedPages = Array.isArray(values.pages) ? values.pages : [];
  const pickPage = (n) => setValues((v) => {
    const cur = Array.isArray(v.pages) ? v.pages : [];
    return { ...v, pages: cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n].sort((a, b) => a - b) };
  });

  function handleSubmit() {
    if (withScope && values.scope === "Selected pages" && !pickedPages.length) {
      setError("Choose at least one page.");
      return;
    }
    setSubmitting(true);
    setError("");
    // done() on success; fail(msg) keeps the form open with the reason.
    onSubmit(values, () => setSubmitting(false), (msg) => { setSubmitting(false); setError(msg || "Couldn't build that — try again."); });
  }

  return (
    <div>
      <ToolHeader label={def.title} sub={withScope && values.scope === "Whole document" ? def.sub.replace("this page", "the whole document") : def.sub} onBack={onBack}/>
      <div className="flex flex-col gap-3.5">
        {def.fields.map((f) => (
          <label key={f.id} className="flex flex-col gap-1.5">
            <span className="text-xs font-medium" style={{ color: "var(--ak-text-sub)" }}>{f.label}</span>
            {f.type === "number" ? (
              <input
                type="number"
                inputMode="numeric"
                min={f.min ?? 1}
                max={f.max ?? 100}
                value={values[f.id]}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value.replace(/[^0-9]/g, "") }))}
                className="folio-form-field border rounded-lg px-2.5 py-2 text-sm focus:outline-none"
                style={{ color: "var(--ak-text)" }}
              />
            ) : f.type === "text" ? (
              <input
                type="text"
                value={values[f.id]}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                className="folio-form-field border rounded-lg px-2.5 py-2 text-sm focus:outline-none"
                style={{ color: "var(--ak-text)" }}
              />
            ) : (
              <select
                value={values[f.id]}
                onChange={(e) => setValues((v) => (f.id === "scope" && e.target.value === "Selected pages" && !(v.pages || []).length
                  ? { ...v, [f.id]: e.target.value, pages: [currentPage + 1] }
                  : { ...v, [f.id]: e.target.value }))}
                className="folio-form-field border rounded-lg px-2.5 py-2 text-sm focus:outline-none"
                style={{ color: "var(--ak-text)" }}
              >
                {f.options.map((o) => <option key={o}>{o}</option>)}
              </select>
            )}
            {f.id === "focus" && (
              <span className="text-[11px] leading-relaxed" style={{ color: "var(--ak-text-sub)" }}>
                The prompt can set pages, count, difficulty and exam style — e.g. “20 hard WAEC questions from pages 5–15 using the attached past questions”.
              </span>
            )}
          </label>
        ))}
        {withScope && values.scope === "Selected pages" && pageCount > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium" style={{ color: "var(--ak-text-sub)" }}>Pages ({pickedPages.length} selected)</span>
              <div className="flex gap-2">
                <button type="button" className="text-[11px] font-semibold" style={{ background: "none", border: "none", color: "var(--ak-accent)", cursor: "pointer" }}
                  onClick={() => setValues((v) => ({ ...v, pages: Array.from({ length: pageCount }, (_, i) => i + 1) }))}>All</button>
                <button type="button" className="text-[11px] font-semibold" style={{ background: "none", border: "none", color: "var(--ak-text-sub)", cursor: "pointer" }}
                  onClick={() => setValues((v) => ({ ...v, pages: [] }))}>Clear</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5" style={{ maxHeight: 132, overflowY: "auto" }}>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => {
                const on = pickedPages.includes(n);
                return (
                  <button key={n} type="button" onClick={() => pickPage(n)} aria-pressed={on}
                    className="rounded-md text-xs font-semibold"
                    style={{ width: 34, height: 30, border: `1px solid ${on ? "var(--ak-accent)" : "var(--ak-border)"}`,
                      background: on ? "var(--ak-accent)" : "transparent", color: on ? "#fff" : "var(--ak-text)" }}>
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {withScope && (
          <ContextPicker value={values.context || []} onChange={(next) => setValues((v) => ({ ...v, context: next }))}/>
        )}
        {error && (
          <div role="alert" className="text-xs leading-relaxed rounded-lg p-2.5" style={{ color: "var(--ak-danger-text)", background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.25)" }}>
            {error}
          </div>
        )}
        <button
          type="button"
          disabled={submitting}
          onClick={handleSubmit}
          className="folio-primary-btn mt-1 w-full py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-75"
        >
          {submitting ? (
            <>
              <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin inline-block"/>
              Building…
            </>
          ) : (
            `Build ${def.title.toLowerCase()}`
          )}
        </button>
      </div>
    </div>
  );
}

export default function SessionReaderDocument({ reader }) {
  const {
    activeTabId, isMedia, playerApi, setPlayerApi, playerState, setPlayerState, goToPage, currentPage, pages,
    pageNumDraft, setPageNumDraft, commitPageNumDraft, zoomTo, zoom, isMobile,
    isPlaying, setIsPlaying, genMenuRef, genMenuOpen, setGenMenuOpen,
    formTool, setFormTool, prefillFocus, handleFormSubmit, tools, folderHome,
    handleToolPick, discussion, ask, artifacts, savedItems, openSavedItem, deleteSavedItem,
    viewerRef, rawPages, buildPageHtml, handleViewerClick, renderPageContent,
    annotations, redactions, revealedRedactions, sourceCitations, media, docTitle,
    onTranscribe, transcribeState, transcribeError, transcript,
  } = reader;

  return (
    <>
        {/* Reader pane — kept mounted (just hidden) when a tool tab is active,
            so scroll position and zoom survive switching back. Media records
            swap the pages for the player (audio keeps playing while a tool
            tab is open — notes over a recorded lesson). */}
        <div className="flex-col min-h-0 flex-1" style={{ display: activeTabId === "reader" ? "flex" : "none" }}>
          <div className="sreader-bg flex-shrink-0 flex items-center gap-2 md:gap-3.5 px-2.5 md:px-4 border-b" style={{ height: "3.25rem", borderColor: "var(--ak-border)" }}>
            {isMedia ? (
              /* ── Record transport — same toolbar, playback controls ── */
              <div className="flex items-center gap-1.5 mr-auto min-w-0">
                <button onClick={() => playerApi?.skip(-10)} title="Back 10 seconds" aria-label="Back 10 seconds"
                  className="folio-btn-outline w-7 h-7 rounded border flex items-center justify-center">
                  <Icon name="ti-player-track-prev" size={14}/>
                </button>
                <button onClick={() => playerApi?.toggle()} title={playerState.playing ? "Pause" : "Play"} aria-label={playerState.playing ? "Pause" : "Play"}
                  className="folio-icon-btn w-8 h-8 rounded flex items-center justify-center"
                  style={{ background: BRAND, color: "#fff" }}>
                  <Icon name={playerState.playing ? "ti-player-pause" : "ti-player-play"} size={16}/>
                </button>
                <button onClick={() => playerApi?.skip(10)} title="Forward 10 seconds" aria-label="Forward 10 seconds"
                  className="folio-btn-outline w-7 h-7 rounded border flex items-center justify-center">
                  <Icon name="ti-player-track-next" size={14}/>
                </button>
                <span className="font-ui-mono text-xs whitespace-nowrap" style={{ color: "var(--ak-text-sub)" }}>
                  {mediaTime(playerState.time)} / {mediaTime(playerState.duration)}
                </span>
              </div>
            ) : (
            <div className="flex items-center gap-1.5 mr-auto">
              <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 0} className="folio-btn-outline w-7 h-7 rounded border flex items-center justify-center disabled:opacity-35">
                <Icon name="ti-chevron-up" size={15}/>
              </button>
              <span className="font-ui-mono text-xs md:text-sm flex items-center gap-0.5 whitespace-nowrap" style={{ color: "var(--ak-text-sub)" }}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={pageNumDraft}
                  onChange={(e) => setPageNumDraft(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => e.key === "Enter" && (commitPageNumDraft(), e.target.blur())}
                  onBlur={commitPageNumDraft}
                  className="w-6 bg-transparent text-right outline-none rounded"
                  style={{ color: "var(--ak-text)" }}
                />
                <span> / {pages.length}</span>
              </span>
              <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage === pages.length - 1} className="folio-btn-outline w-7 h-7 rounded border flex items-center justify-center disabled:opacity-35">
                <Icon name="ti-chevron-down" size={15}/>
              </button>
            </div>
            )}

            {/* Speed — the record viewer's reason for a shared toolbar:
                slow a lesson down to take notes, speed it up to revise. */}
            {isMedia && (
              <button onClick={() => playerApi?.cycleRate(1)}
                title="Playback speed" aria-label={`Playback speed ${playerState.rate} times`}
                className="folio-btn-outline h-7 rounded border flex items-center justify-center px-2.5 gap-1 whitespace-nowrap">
                <Icon name="ti-clock-bolt" size={13}/>
                <span className="font-ui-mono text-xs font-bold" style={{ color: "var(--ak-text)" }}>
                  {playerState.rate}×
                </span>
              </button>
            )}

            {!isMedia && (
            <div className="hidden md:flex items-center gap-1">
              <button onClick={() => zoomTo((z) => z - 0.1)} className="folio-btn-outline w-6 h-6 rounded border flex items-center justify-center">
                <Icon name="ti-minus" size={13}/>
              </button>
              <span className="font-ui-mono text-xs w-9 text-center" style={{ color: "var(--ak-text-sub)" }}>{Math.round(zoom * 100)}%</span>
              <button onClick={() => zoomTo((z) => z + 0.1)} className="folio-btn-outline w-6 h-6 rounded border flex items-center justify-center">
                <Icon name="ti-plus" size={13}/>
              </button>
            </div>
            )}
            {!isMedia && isMobile && (
              <div className="flex items-center gap-0.5">
                <button onClick={() => zoomTo((z) => z - 0.1)} className="folio-btn-outline w-6 h-6 rounded border flex items-center justify-center">
                  <Icon name="ti-minus" size={12}/>
                </button>
                <span className="font-ui-mono text-xs w-7 text-center" style={{ color: "var(--ak-text-sub)" }}>{Math.round(zoom * 100)}%</span>
                <button onClick={() => zoomTo((z) => z + 0.1)} className="folio-btn-outline w-6 h-6 rounded border flex items-center justify-center">
                  <Icon name="ti-plus" size={12}/>
                </button>
              </div>
            )}

            <button
              onClick={() => (isMedia ? playerApi?.toggle() : setIsPlaying((p) => !p))}
              className="folio-icon-btn w-7 h-7 rounded flex items-center justify-center"
              title={isMedia ? (playerState.playing ? "Pause" : "Play") : "Listen to this page (audio coming soon)"}
            >
              <Icon name={(isMedia ? playerState.playing : isPlaying) ? "ti-player-pause" : "ti-player-play"} size={15}/>
            </button>

            {/* Generate — the way to spawn a new tool tab, same on every breakpoint. */}
            <div className="relative" ref={genMenuRef}>
              <button
                onClick={() => setGenMenuOpen((o) => !o)}
                className={`folio-icon-btn w-7 h-7 rounded flex items-center justify-center ${genMenuOpen ? "bg-black/10" : ""}`}
                title="Generate a study tool"
              >
                <Icon name="ti-layout-grid" size={15}/>
              </button>
              {genMenuOpen && (
                <div className="sreader-menu absolute right-0 top-full mt-2 w-72 rounded-lg z-50 overflow-hidden" style={{ maxHeight: "70vh", overflowY: "auto" }}>
                  {formTool ? (
                    <div className="p-3">
                      <CreationForm key={formTool} toolId={formTool} initialFocus={prefillFocus} onBack={() => setFormTool(null)} onSubmit={handleFormSubmit} withScope={!folderHome && !!tools && (SERVER_TOOLS.has(formTool) || isServerPodcast(tools, formTool))}
                        pageCount={pages.length} currentPage={currentPage}/>
                    </div>
                  ) : (
                    <GenerateGrid onPick={handleToolPick} discussion={discussion} askEnabled={!!ask} serverOnly={!!folderHome}
                      saved={artifacts ? { items: savedItems, onOpen: openSavedItem, onDelete: deleteSavedItem } : null}/>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-0 relative overflow-hidden">
            {isMedia ? (
              /* The record itself — original bytes, presigned URL, range seeks —
                 with its transcript underneath (click a line, land on the moment). */
              <div className="h-full flex flex-col">
                <div className="flex-shrink-0">
                  <MediaPlayer
                    kind={media.kind}
                    src={media.src}
                    title={media.title || docTitle}
                    startAt={media.startAt}
                    onReady={setPlayerApi}
                    onState={setPlayerState}
                    onPosition={media.onPosition}
                    onTimeUpdate={media.onTimeUpdate}
                    downloadUrl={media.downloadUrl}
                    downloadName={media.downloadName}
                  />
                </div>
                {onTranscribe && !transcript?.segments?.length && (
                  /* No transcript yet — one honest row: what it does, what
                     it costs (a shared job, so at most once per video). */
                  <div className="flex-shrink-0 px-3 md:px-5 py-2.5 border-t" style={{ borderColor: "var(--ak-border)", background: "var(--ak-surface)" }}>
                    <button type="button" onClick={onTranscribe} disabled={transcribeState === "running"}
                      className="w-full text-left rounded-xl px-3.5 py-2.5 border transition-opacity"
                      style={{ borderColor: transcribeState === "failed" ? "#FCA5A5" : "var(--ak-border2)",
                               background: "var(--ak-surface)", opacity: transcribeState === "running" ? 0.7 : 1 }}>
                      <span className="text-xs font-bold" style={{ color: transcribeState === "failed" ? "#DC2626" : "var(--ak-text)" }}>
                        {transcribeState === "running"
                          ? "Transcribing the audio — this runs once for everyone, you can keep watching…"
                          : transcribeState === "failed"
                            ? "Transcription didn't finish — tap to try again"
                            : "Transcribe this video — let your agent hear it too"}
                      </span>
                      {transcribeState !== "running" && (
                        <span className="block text-[11px] font-semibold mt-0.5" style={{ color: "var(--ak-text-sub)" }}>
                          {transcribeState === "failed" ? (transcribeError || "Something interrupted the job.")
                            : "Speech becomes a clickable, searchable, groundable transcript."}
                        </span>
                      )}
                    </button>
                  </div>
                )}
                {transcript?.segments?.length > 0 && (
                  <div className="flex-1 min-h-0 overflow-y-auto px-3 md:px-5 py-3" style={{ background: "var(--ak-bg)" }}>
                    <div className="text-xs font-semibold mb-2" style={{ color: "var(--ak-text-sub)" }}>
                      Transcript · {transcript.segments.length} segment{transcript.segments.length === 1 ? "" : "s"} — tap a line to jump there
                    </div>
                    {transcript.segments.map((s, i) => {
                      const mmss = (ms) => {
                        const t = Math.floor((ms || 0) / 1000);
                        return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
                      };
                      return (
                        <button key={i} type="button"
                          onClick={() => playerApi?.seekTo?.((s.startMs || 0) / 1000)}
                          className="w-full text-left rounded-lg px-3 py-2 mb-1.5 border transition-colors"
                          style={{ borderColor: "var(--ak-border2)", background: "var(--ak-surface)" }}>
                          <span className="font-ui-mono text-[10px] font-bold mr-2" style={{ color: "var(--ak-accent)" }}>{mmss(s.startMs)}</span>
                          {s.speaker && <span className="text-[10px] font-black mr-2" style={{ color: "var(--ak-text-sub)" }}>{s.speaker}</span>}
                          {s.kind === "visual" && <span className="text-[10px] font-black mr-2" style={{ color: "#D97706" }}>SLIDE</span>}
                          <span className="text-xs leading-relaxed" style={{ color: "var(--ak-text)" }}>{s.text}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
            <div ref={viewerRef} onClick={handleViewerClick}
              className={`pdf-scroll h-full overflow-auto flex flex-col items-center ${rawPages ? "px-1.5 md:px-3 pt-2 md:pt-3 pb-8" : "px-3 md:px-6 pt-9 pb-16"}`}
              style={{ background: "var(--ak-bg)", alignItems: zoom > 1 ? "flex-start" : "center" }}>
              {folderHome ? (
                <div className="w-full md:max-w-2xl">{folderHome}</div>
              ) : (<>
              {pages.map((p, i) => (
                <div
                  key={i}
                  data-page-index={i}
                  style={{ width: `${Math.round(zoom * 100)}%` }}
                  className={`doc-page relative w-full shadow-lg ${rawPages
                    // A finished PDF page brings its own margins — render it
                    // flush: no inner padding, no width cap, a tight gap so
                    // the stack reads as one continuous document.
                    ? "mb-1.5"
                    : "md:max-w-2xl mb-5 px-5 py-9 md:px-14 md:py-14"}`}
                >
                  {/* The opener's renderer wins; a page it doesn't draw
                      (returns null) falls back to the page's own HTML.
                      Drawn pages (canvases, images) get their annotations
                      and hidden passages as boxes over the selection. */}
                  {(() => {
                    const drawn = renderPageContent && renderPageContent(i);
                    if (!drawn) return <div data-page-content="" dangerouslySetInnerHTML={{ __html: buildPageHtml(p.html, i) }}/>;
                    return (
                      <div data-page-content="" style={{ position: "relative" }}>
                        {drawn}
                        {annotations.filter((a) => a.page === i && a.rects?.length).flatMap((a) => a.rects.map((r, k) => (
                          <div key={`${a.id}-${k}`} className="folio-annotation folio-mark-box" data-ann-id={a.id} title={a.note}
                            style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}/>
                        )))}
                        {redactions.filter((r) => r.page === i && r.rects?.length).flatMap((r) => r.rects.map((b, k) => (
                          <div key={`${r.id}-${k}`} className={`folio-redaction folio-mark-box${revealedRedactions.has(r.id) ? " revealed" : ""}`} data-red-id={r.id}
                            title={revealedRedactions.has(r.id) ? "Tap to hide again" : "Hidden — tap to reveal"}
                            style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}/>
                        )))}
                      </div>
                    );
                  })()}
                </div>
              ))}
              {/* A gathered content closes with its sources — each row opens
                  the ORIGINAL document; closing it returns here. */}
              {sourceCitations?.list?.length > 0 && (
                <div className="w-full md:max-w-2xl" style={{ borderTop: "1px solid var(--ak-border)", paddingTop: 14, marginTop: 4 }}>
                  <div className="text-xs font-extrabold mb-2" style={{ color: "var(--ak-text-muted)", letterSpacing: ".06em" }}>SOURCES — TAP TO OPEN THE ORIGINAL</div>
                  {sourceCitations.list.map((s) => (
                    <button key={s.marker} type="button" onClick={() => sourceCitations.onOpen?.(Number(s.marker))}
                      className="w-full flex items-center gap-2.5 text-left border rounded-xl px-3 py-2.5 mb-2"
                      style={{ borderColor: "var(--ak-border)", background: "var(--ak-surface)", cursor: "pointer" }}>
                      <span className="ak-src-chip" style={{ pointerEvents: "none" }}>{s.marker}</span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-extrabold truncate" style={{ color: "var(--ak-text)" }}>{s.name}</span>
                        <span className="block text-[11px] font-bold" style={{ color: "var(--ak-text-muted)" }}>{s.ownerName ? `${s.ownerName} · ` : ""}free notes in Discover</span>
                      </span>
                      <Icon name="ti-chevron-right" size={14} color="var(--ak-text-muted)"/>
                    </button>
                  ))}
                </div>
              )}
              </>)}
            </div>
            )}
          </div>

          <div className="sreader-bg hidden md:flex flex-shrink-0 items-center gap-2.5 px-4 py-2.5 border-t overflow-x-auto" style={{ borderColor: "var(--ak-border)", display: isMedia ? "none" : undefined }}>
            {pages.map((_, i) => (
              <button
                key={i}
                onClick={() => goToPage(i)}
                className={`folio-thumb flex-shrink-0 w-11 h-14 rounded border flex items-center justify-center font-ui-mono text-xs ${i === currentPage ? "active" : ""}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
    </>
  );
}
