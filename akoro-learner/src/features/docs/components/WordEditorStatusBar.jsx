import { Icon } from '../../../components/common/Icons.jsx';
import { WORD_BLUE, RIBBON_BG, LINE, TXT, SUB, ZOOMS } from './wordEditorTokens.js';

export default function WordEditorStatusBar({ wd }) {
  const { at, pages, words, chars, view, setView, zoom, setZoom } = wd;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '4px 12px calc(env(safe-area-inset-bottom, 0px) + 4px)', background: RIBBON_BG, borderTop: `1px solid ${LINE}`, fontSize: 11.5, color: SUB, flexShrink: 0, whiteSpace: 'nowrap', overflowX: 'auto' }}>
      <span>Page {at} of {pages}</span>
      <span>{words.toLocaleString()} word{words === 1 ? '' : 's'}</span>
      <span>{chars.toLocaleString()} characters</span>
      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 2 }}>
        <button type="button" title="Print layout" aria-label="Print layout" aria-pressed={view === 'print'} onClick={() => setView('print')}
          style={{ border: 'none', background: view === 'print' ? '#DADADA' : 'transparent', borderRadius: 2, padding: '2px 5px', cursor: 'pointer', color: TXT }}><Icon name="ti-file-description" size={14}/></button>
        <button type="button" title="Mobile view" aria-label="Mobile view" aria-pressed={view === 'mobile'} onClick={() => setView('mobile')}
          style={{ border: 'none', background: view === 'mobile' ? '#DADADA' : 'transparent', borderRadius: 2, padding: '2px 5px', cursor: 'pointer', color: TXT }}><Icon name="ti-device-mobile" size={14}/></button>
      </span>
      {view === 'print' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(50, z - 10))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: TXT, fontSize: 14, padding: 0 }}>−</button>
          <input type="range" min={50} max={200} step={5} value={zoom} aria-label="Zoom" onChange={(e) => setZoom(Number(e.target.value))} style={{ width: 90, accentColor: WORD_BLUE }}/>
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(200, z + 10))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: TXT, fontSize: 14, padding: 0 }}>+</button>
          <select aria-label="Zoom level" value={ZOOMS.includes(zoom) ? zoom : ''} onChange={(e) => setZoom(Number(e.target.value))} style={{ border: 'none', background: 'transparent', fontSize: 11.5, color: SUB }}>
            {!ZOOMS.includes(zoom) && <option value="">{zoom}%</option>}
            {ZOOMS.map((z) => <option key={z} value={z}>{z}%</option>)}
          </select>
        </span>
      )}
    </div>
  );
}
