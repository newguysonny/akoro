/**
 * Academics (Levels → Classes → Sections) — shared primitives:
 * modal shell, breadcrumb, status pill, table styling, export/print helpers.
 */
import React from 'react';
import { X, ChevronRight } from 'lucide-react';
import { inputStyle } from '../../../components/mgmt/ResourcePage.jsx';
import { INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, FONT } from '../../../constants.js';

export const BASE = '/api/school/mgmt';
export const GENERIC_STATUS_OPTS = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }];
export const STUDENT_STATUS_OPTS = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'alumni', label: 'Alumni' }];

export const STATUS_PILL = (v, map) => {
  const m = map[v] || { c: MUTED2 };
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: `${m.c}15`, color: m.c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{v}</span>;
};

export function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function openPrintTable(title, headers, rows) {
  const w = window.open('', '_blank');
  if (!w) return;
  const html = `<!doctype html><html><head><title>${title}</title><style>
    body{font-family:Arial,sans-serif;padding:20px} h1{font-size:18px}
    table{width:100%;border-collapse:collapse;font-size:12px} th,td{border:1px solid #999;padding:6px 8px;text-align:left}
    th{background:#f1f1f4}</style></head><body>
    <h1>${title}</h1>
    <table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <script>window.onload=()=>window.print()</script></body></html>`;
  w.document.write(html); w.document.close();
}

export function ModalShell({ title, onClose, width = 460, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: width, maxHeight: '86vh', overflowY: 'auto', background: WHITE, borderRadius: 16, padding: '20px 22px', fontFamily: FONT }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: INK }}>{title}</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: MUTED2 }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Breadcrumb({ items }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 && <ChevronRight size={13} color={MUTED2} />}
          {it.onClick ? (
            <button onClick={it.onClick} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: BLUE }}>{it.label}</button>
          ) : (
            <span style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: MUTED2 }}>{it.label}</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

export const th = { textAlign: 'left', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .4, whiteSpace: 'nowrap' };
export const td = { padding: '11px 14px', fontSize: 13, color: INK, borderTop: `1px solid ${BORDER}`, whiteSpace: 'nowrap' };
export const iconBtn = (color) => ({ width: 30, height: 30, borderRadius: 7, border: 'none', background: `${color}15`, color, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' });
export const selStyle = { ...inputStyle, width: 'auto', minWidth: 150, cursor: 'pointer' };
export const toolBtn = (color, disabled) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: `1px solid ${color}44`, background: disabled ? LIGHT : `${color}0C`, color: disabled ? MUTED2 : color, fontSize: 12, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: FONT, opacity: disabled ? 0.6 : 1 });
export const toastEl = (toast) => toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, maxWidth: '80vw' }}>{toast}</div>;
