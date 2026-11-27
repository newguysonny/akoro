/**
 * ConfirmHost — a real confirmation dialog, replacing window.confirm().
 *
 * window.confirm() blocks the whole tab, can't be styled, shows the site's raw
 * hostname above the message, and gives every action the same two grey buttons —
 * so "Delete 32 students" and "Replace this timetable" look identical and
 * equally reversible. Worse, it can't say WHAT is about to happen beyond one
 * line of plain text.
 *
 * This is a promise-based replacement with the same call shape, so a call site
 * changes from
 *     if (!window.confirm(msg)) return;
 * to
 *     if (!(await confirmDialog(msg))) return;
 *
 * It is deliberately NOT a hook. Nearly every call site is inside an event
 * handler in an already-written component; a hook would mean editing each
 * component's body as well as its handler. A module-level function with a
 * single <ConfirmHost/> mounted at the root keeps the change to one line.
 *
 * confirmDialog('Delete this?')
 * confirmDialog({ title, message, confirmLabel, cancelLabel, danger, detail })
 */
import { useState, useEffect, useRef } from 'react';
import { RED } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

let listener = null;

/** Resolves true if confirmed, false if cancelled or dismissed. */
export function confirmDialog(options) {
  const opts = typeof options === 'string' ? { message: options } : (options || {});
  // No host mounted (a stray render tree, a test) — fall back rather than hang
  // forever on a promise nobody will resolve.
  if (!listener) return Promise.resolve(window.confirm(opts.message || 'Are you sure?'));
  return new Promise((resolve) => listener({ ...opts, resolve }));
}

export default function ConfirmHost() {
  const [req, setReq] = useState(null);
  const confirmRef = useRef(null);

  useEffect(() => {
    listener = (r) => setReq(r);
    return () => { listener = null; };
  }, []);

  // Escape cancels, Enter confirms — the keyboard contract people expect from
  // the native dialog this replaces.
  useEffect(() => {
    if (!req) return;
    confirmRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      if (e.key === 'Enter')  { e.preventDefault(); close(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);

  const close = (result) => {
    if (!req) return;
    req.resolve(result);
    setReq(null);
  };

  if (!req) return null;

  const danger = req.danger !== false;   // most confirms guard a destructive act

  return (
    <div
      role="dialog" aria-modal="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 4000,
        background: 'rgba(17,17,27,.45)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, fontFamily: C.font,
      }}
    >
      <div style={{
        width: '100%', maxWidth: 400, background: C.surface, borderRadius: 18,
        padding: '22px 22px 18px', boxShadow: '0 18px 50px rgba(0,0,0,.22)',
        animation: 'ak-confirm-in .16s ease-out',
      }}>
        <style>{'@keyframes ak-confirm-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}'}</style>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{
            width: 38, height: 38, borderRadius: 11, flexShrink: 0, fontSize: 18,
            background: danger ? '#FEE2E2' : tint(9),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{danger ? <Ico ti="ti-alert-triangle" size={18} color="#DC2626" /> : <Ico ti="ti-help-circle" size={18} color="#B45309" />}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, marginBottom: 4 }}>
              {req.title || (danger ? 'Are you sure?' : 'Please confirm')}
            </div>
            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.55, wordBreak: 'break-word' }}>
              {req.message}
            </div>
            {req.detail && (
              <div style={{
                marginTop: 10, padding: '8px 10px', borderRadius: 9,
                background: C.bg, border: `1px solid ${C.border}`,
                fontSize: 11.5, color: C.muted2, lineHeight: 1.5,
              }}>{req.detail}</div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button type="button" onClick={() => close(false)} style={{
            padding: '9px 16px', borderRadius: 10, border: `1.5px solid ${C.border}`,
            background: C.surface, color: C.ink, fontSize: 13, fontWeight: 700,
            cursor: 'pointer', fontFamily: C.font,
          }}>{req.cancelLabel || 'Cancel'}</button>
          <button ref={confirmRef} type="button" onClick={() => close(true)} style={{
            padding: '9px 16px', borderRadius: 10, border: 'none',
            background: danger ? RED : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`,
            color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: C.font,
          }}>{req.confirmLabel || (danger ? 'Delete' : 'Confirm')}</button>
        </div>
      </div>
    </div>
  );
}
