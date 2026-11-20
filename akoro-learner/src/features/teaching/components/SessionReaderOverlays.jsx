// Selection popover and the annotation compose/view popovers.
import { GOLD, RED } from '../../../constants.js';
import { Icon } from '../../../components/common/Icons.jsx';

export default function SessionReaderOverlays({ reader }) {
  const {
    selection, selMenuRef, selPos, ask, handleSelectionAction,
    annotateDraft, annotateText, setAnnotateDraft, setAnnotateText, saveAnnotation,
    openAnnotation, setOpenAnnotation, annotations, setAnnotations, artifacts,
  } = reader;

  return (
    <>
      {/* ============ SELECTION POPOVER ============ */}
      {selection && (
        <div
          ref={selMenuRef}
          className="flex items-center gap-0.5 rounded-lg p-1 shadow-xl z-50 overflow-x-auto"
          style={{
            position: "fixed",
            left: selPos ? selPos.left : -9999,
            top: selPos ? selPos.top : -9999,
            maxWidth: "calc(100vw - 16px)",
            background: "var(--ak-surface)",
            border: "1px solid var(--ak-border2)",
          }}
        >
          {ask && (
            <button onClick={() => handleSelectionAction("ask")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs hover:bg-black/10 whitespace-nowrap flex-shrink-0" style={{ color: "var(--ak-text)" }}>
              <Icon name="ti-message-question" size={13} color="var(--ak-accent)"/> Ask about this
            </button>
          )}
          <button onClick={() => handleSelectionAction("explain")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs hover:bg-black/10 whitespace-nowrap flex-shrink-0" style={{ color: "var(--ak-text)" }}>
            <Icon name="ti-bulb" size={13} color="var(--ak-accent)"/> Ask the tutor
          </button>
          <div className="w-px h-6 mx-0.5 flex-shrink-0" style={{ background: "var(--ak-tag-bg)" }}/>
          <button onClick={() => handleSelectionAction("quiz")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs hover:bg-black/10 whitespace-nowrap flex-shrink-0" style={{ color: "var(--ak-text)" }}>
            <Icon name="ti-circle-check" size={13} color="var(--ak-accent)"/> Quiz me
          </button>
          <button onClick={() => handleSelectionAction("flashcards")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs hover:bg-black/10 whitespace-nowrap flex-shrink-0" style={{ color: "var(--ak-text)" }}>
            <Icon name="ti-stack" size={13} color="var(--ak-accent)"/> Flashcards
          </button>
          <button onClick={() => handleSelectionAction("notes")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs hover:bg-black/10 whitespace-nowrap flex-shrink-0" style={{ color: "var(--ak-text)" }}>
            <Icon name="ti-pencil" size={13} color="var(--ak-accent)"/> Note
          </button>
          <div className="w-px h-6 mx-0.5 flex-shrink-0" style={{ background: "var(--ak-tag-bg)" }}/>
          <button onClick={() => handleSelectionAction("annotate")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs hover:bg-black/10 whitespace-nowrap flex-shrink-0" style={{ color: "var(--ak-text)" }}>
            <Icon name="ti-highlight" size={13} color={GOLD}/> Annotate
          </button>
          <button onClick={() => handleSelectionAction("redact")} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs hover:bg-black/10 whitespace-nowrap flex-shrink-0" style={{ color: "var(--ak-text)" }}>
            <Icon name="ti-eye-off" size={13} color="var(--ak-danger-text)"/> Hide
          </button>
        </div>
      )}

      {/* ============ ANNOTATION: compose a new note ============ */}
      {annotateDraft && (
        <div
          data-annotation-popover
          className="rounded-lg shadow-xl p-3 z-50"
          style={{
            position: "fixed",
            left: Math.max(8, Math.min(annotateDraft.rect.left, window.innerWidth - 296)),
            top: Math.min(annotateDraft.rect.bottom + 10, window.innerHeight - 180),
            width: 288,
            background: "var(--ak-surface)",
            border: "1px solid var(--ak-border2)",
          }}
        >
          <div className="text-xs mb-1.5 truncate" style={{ color: "var(--ak-text-sub)" }}>
            Annotate: "{annotateDraft.text.length > 40 ? annotateDraft.text.slice(0, 40) + "…" : annotateDraft.text}"
          </div>
          <textarea
            autoFocus
            rows={2}
            value={annotateText}
            onChange={(e) => setAnnotateText(e.target.value)}
            placeholder="Add a note…"
            className="folio-form-field w-full border rounded-lg p-2 text-sm resize-none focus:outline-none mb-2"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setAnnotateDraft(null); setAnnotateText(""); }}
              className="folio-btn-outline px-3 py-1.5 rounded-lg border text-xs"
            >
              Cancel
            </button>
            <button type="button" onClick={saveAnnotation} className="folio-primary-btn px-3 py-1.5 rounded-lg text-xs font-bold">
              Save
            </button>
          </div>
        </div>
      )}

      {/* ============ ANNOTATION: view an existing note ============ */}
      {openAnnotation && (
        <div
          data-annotation-popover
          style={{
            position: "fixed",
            left: Math.max(8, Math.min(openAnnotation.left, window.innerWidth - 248)),
            top: Math.min(openAnnotation.top, window.innerHeight - 120),
            width: 240,
            background: "var(--ak-surface)",
            border: "1px solid var(--ak-border2)",
          }}
          className="rounded-lg shadow-xl p-3 z-50"
        >
          <div className="text-xs leading-relaxed mb-2.5" style={{ color: "var(--ak-text)" }}>{openAnnotation.note}</div>
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                const gone = annotations.find((x) => x.id === openAnnotation.id);
                if (gone?.artifactId) artifacts?.remove(gone.artifactId).catch(() => {});
                setAnnotations((a) => a.filter((x) => x.id !== openAnnotation.id));
                setOpenAnnotation(null);
              }}
              className="flex items-center gap-1 text-xs hover:opacity-80"
              style={{ color: RED }}
            >
              <Icon name="ti-trash" size={12}/> Remove
            </button>
            <button type="button" onClick={() => setOpenAnnotation(null)} className="text-xs hover:opacity-80" style={{ color: "var(--ak-text-sub)" }}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
