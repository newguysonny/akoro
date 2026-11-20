import { Icon } from '../../../components/common/Icons.jsx';
import { WORD_BLUE, LINE, TXT, SUB, UI_FONT } from './wordEditorTokens.js';

/* ── Ribbon pieces ──────────────────────────────────────────────────────── */

export function Btn({ icon, label, onClick, active = false, disabled = false, big = false, text = null, wide = false, caret = false, title, bar = null }) {
  return (
    <button type="button" title={title || label} aria-label={label} aria-pressed={active || undefined} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      style={{
        display: 'inline-flex', flexDirection: big ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: big ? 3 : 4,
        minWidth: big ? 52 : 28, height: big ? 62 : 28, padding: big ? '4px 6px' : wide ? '0 8px' : '0 5px', borderRadius: 4, flexShrink: 0,
        border: `1px solid ${active ? '#C5C5C5' : 'transparent'}`, background: active ? '#DADADA' : 'transparent',
        color: disabled ? '#B5B5B5' : TXT, cursor: disabled ? 'default' : 'pointer', fontFamily: UI_FONT, fontSize: big ? 11.5 : 12, whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => { if (!disabled && !active) e.currentTarget.style.background = '#E5E5E5'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
      {icon && !bar && <Icon name={icon} size={big ? 24 : 16} color={disabled ? '#B5B5B5' : big ? WORD_BLUE : TXT}/>}
      {icon && bar && (
        <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
          <Icon name={icon} size={15} color={TXT}/>
          <span style={{ width: 16, height: 3, background: bar, border: '0.5px solid rgba(0,0,0,.15)' }}/>
        </span>
      )}
      {text != null && <span style={{ lineHeight: 1.15 }}>{text}</span>}
      {caret && <Icon name="ti-chevron-down" size={10}/>}
    </button>
  );
}

export function Group({ label, children, last = false }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', padding: '0 8px', borderRight: last ? 'none' : `1px solid ${LINE}`, flexShrink: 0 }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 2 }}>{children}</div>
      <div style={{ fontSize: 10.5, color: SUB, textAlign: 'center', marginTop: 2, fontFamily: UI_FONT }}>{label}</div>
    </div>
  );
}

export const CARET_BTN = { width: 14, height: 28, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', color: TXT, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 3 };
export const Col = ({ children }) => <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</div>;
export const Row = ({ children }) => <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>{children}</div>;

/** A ribbon button that opens a panel under it. */
export function Drop({ open, setOpen, id, button, children, width = 'auto', align = 'left' }) {
  const on = open === id;
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {button(() => setOpen(on ? null : id), on)}
      {on && (
        <div onMouseDown={(e) => e.preventDefault()}
          style={{ position: 'fixed', zIndex: 3700, marginTop: 2, minWidth: 140, width, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 4, boxShadow: '0 6px 18px rgba(0,0,0,.16)', padding: 6, fontFamily: UI_FONT, ...(align === 'right' ? { transform: 'translateX(-60%)' } : {}) }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, label, note, onClick, checked = false, disabled = false }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '6px 9px', border: 'none', background: 'transparent', borderRadius: 3, cursor: disabled ? 'default' : 'pointer', color: disabled ? '#B5B5B5' : TXT, fontFamily: UI_FONT, fontSize: 12.5, textAlign: 'left' }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = '#EFEFEF'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
      <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}>{checked ? <Icon name="ti-check" size={14}/> : icon ? <Icon name={icon} size={15}/> : null}</span>
      <span style={{ flex: 1 }}>{label}{note && <span style={{ display: 'block', fontSize: 11, color: SUB }}>{note}</span>}</span>
    </button>
  );
}

export function Swatches({ colors, onPick, onClear, clearLabel }) {
  return (
    <div style={{ width: 196 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 22px)', gap: 5, padding: 4 }}>
        {colors.map((c) => (
          <button key={c} type="button" title={c} aria-label={`Colour ${c}`} onClick={() => onPick(c)}
            style={{ width: 22, height: 22, borderRadius: 3, border: '1px solid #C8C8C8', background: c, cursor: 'pointer', padding: 0 }}/>
        ))}
      </div>
      <MenuItem icon="ti-x" label={clearLabel} onClick={onClear}/>
    </div>
  );
}

/* The ruler across the top of the page — centimetres from the left margin. */
export function Ruler({ box, zoom }) {
  const cm = 96 / 2.54;
  const ticks = [];
  for (let x = -Math.floor(box.left / cm * 4) / 4; x * cm <= box.width - box.left + 0.1; x += 0.25) ticks.push(Math.round(x * 4) / 4);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', background: '#F7F7F7', borderBottom: `1px solid ${LINE}`, padding: '3px 0', overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ zoom: zoom / 100, position: 'relative', width: box.width, height: 18, background: '#fff', border: '1px solid #CFCFCF' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: box.left, background: '#DCDCDC' }}/>
        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: box.right, background: '#DCDCDC' }}/>
        {ticks.map((t) => {
          const left = box.left + t * cm;
          const whole = Number.isInteger(t);
          return whole && t !== 0
            ? <span key={t} style={{ position: 'absolute', left, top: 2, transform: 'translateX(-50%)', fontSize: 9, color: '#555', fontFamily: UI_FONT }}>{Math.abs(t)}</span>
            : <span key={t} style={{ position: 'absolute', left, top: t % 0.5 === 0 ? 6 : 8, width: 1, height: t % 0.5 === 0 ? 6 : 3, background: '#888' }}/>;
        })}
        <span style={{ position: 'absolute', left: box.left - 5, top: -1, width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '6px solid #7A7A7A' }}/>
        <span style={{ position: 'absolute', left: box.width - box.right - 5, bottom: -1, width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: '6px solid #7A7A7A' }}/>
      </div>
    </div>
  );
}
