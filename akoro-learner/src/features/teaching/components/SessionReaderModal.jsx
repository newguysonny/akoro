// SessionReaderModal — the Fortizo reader, adopted into the higher-ed
// learning session (same architecture as reference/FortizoApp.jsx, rebranded
// to Akoro).
//
// Phase 19 split: state, effects and handlers live in useSessionReader; the
// markup is unchanged and lives in four view pieces (chrome, document, tool
// panes, overlays). The exported component and its props are identical.
import { useIsMobileView } from '../../../hooks/useIsMobileView.js';
import { useSessionReader } from '../hooks/useSessionReader.js';
import { READER_CSS } from './sessionReaderModel.js';
import SessionReaderChrome from './SessionReaderChrome.jsx';
import SessionReaderDocument from './SessionReaderDocument.jsx';
import SessionReaderResult from './SessionReaderResult.jsx';
import SessionReaderOverlays from './SessionReaderOverlays.jsx';
import ReaderAsk from './ReaderAsk.jsx';

export { buildSessionReaderPages, deriveToolContent } from './sessionReaderModel.js';
export { useIsMobileView };

export default function SessionReaderModal(props) {
  const reader = useSessionReader(props);
  const { split, sideAsk, chatNode, ask, citeJump, askPin, setAskPin } = reader;

  return (
    <div
      className="sreader fixed inset-0 flex overflow-hidden"
      style={{ zIndex: 3100, background: "var(--ak-bg)", animation: "sheet-up .32s cubic-bezier(.32,1.1,.64,1)" }}
    >
      <style>{READER_CSS}</style>

      {/* ============ READER + TOOLS column — one merged column on every
           breakpoint, exactly Fortizo's structure. ============ */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <SessionReaderChrome reader={reader}/>
        <SessionReaderDocument reader={reader}/>
        <SessionReaderResult reader={reader}/>
      </div>

      {/* ============ CHAT — on desktop/tablet the Fortizo split: the live
           learning session is the right column. On mobile the reader is a
           full-screen modal and the session keeps running underneath. ============ */}
      {split && (
        <section className="flex flex-col flex-shrink-0 min-h-0 border-l" style={{ width: 400, maxWidth: "44vw", borderColor: "var(--ak-border3)" }}>
          {sideAsk ? (
            <div className="flex-1 min-h-0 px-4 py-4" style={{ background: "var(--ak-bg)", display: "flex", flexDirection: "column" }}>
              <ReaderAsk ask={ask} onCite={citeJump} pin={askPin} onPinClear={() => setAskPin(null)}/>
            </div>
          ) : chatNode}
        </section>
      )}

      <SessionReaderOverlays reader={reader}/>
    </div>
  );
}
