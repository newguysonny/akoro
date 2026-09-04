/**
 * ConfirmHost — a real confirmation sheet, replacing window.confirm().
 *
 * On a phone the native dialog is the worst offender: it blocks the tab, shows
 * the raw hostname above the message, and gives a destructive action the same
 * two grey buttons as a harmless one. This is the app's own bottom sheet, with
 * the same call shape so a call site changes one line:
 *     if (!window.confirm(msg)) return;   →   if (!(await confirmDialog(msg))) return;
 *
 * Deliberately a module-level function rather than a hook: every call site is
 * inside an already-written handler, and a hook would mean editing the
 * component body too.
 */
import { useState, useEffect } from 'react';
import { BRAND, RED } from '../../constants.js';

let listener = null;

export function confirmDialog(options) {
  const opts = typeof options === 'string' ? { message: options } : (options || {});
  // No host mounted — fall back rather than hang on a promise nobody resolves.
  if (!listener) return Promise.resolve(window.confirm(opts.message || 'Are you sure?'));
  return new Promise((resolve) => listener({ ...opts, resolve }));
}

export default function ConfirmHost() {
  const [req, setReq] = useState(null);

  useEffect(() => {
    listener = (r) => setReq(r);
    return () => { listener = null; };
  }, []);

  useEffect(() => {
    if (!req) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);

  const close = (result) => { if (req) { req.resolve(result); setReq(null); } };
  if (!req) return null;

  const danger = req.danger !== false;

  return (
    <>
      <div onClick={() => close(false)} style={{
        position: 'fixed', inset: 0, zIndex: 3000,
        background: 'rgba(6,6,18,.6)', backdropFilter: 'blur(5px)',
      }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 3100,
        background: 'var(--ak-surface)', borderRadius: '22px 22px 0 0',
        padding: '0 20px 44px', boxShadow: '0 -8px 40px rgba(0,0,0,.16)',
        animation: 'sheet-up .28s cubic-bezier(.32,1.2,.64,1)',
        fontFamily: "'Nunito',sans-serif", maxHeight: '80vh', overflowY: 'auto',
      }}>
        <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--ak-border3)', margin: '14px auto 18px' }} />
        <div style={{ fontSize: 34, textAlign: 'center', marginBottom: 8 }}>{danger ? '⚠️' : '❓'}</div>
        <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 6px', textAlign: 'center' }}>
          {req.title || (danger ? 'Are you sure?' : 'Please confirm')}
        </p>
        <p style={{ fontSize: 13, color: 'var(--ak-text-muted)', margin: '0 0 22px', textAlign: 'center', lineHeight: 1.55 }}>
          {req.message}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => close(false)} style={{
            flex: 1, padding: '13px', borderRadius: 14, border: '1.5px solid var(--ak-border2)',
            background: 'var(--ak-surface-hover)', fontSize: 13, fontWeight: 800,
            color: 'var(--ak-text-sub)', cursor: 'pointer', fontFamily: "'Nunito',sans-serif",
          }}>{req.cancelLabel || 'Cancel'}</button>
          <button onClick={() => close(true)} style={{
            flex: 1.4, padding: '13px', borderRadius: 14, border: 'none',
            background: danger ? RED : `linear-gradient(135deg,${BRAND},#4C1DCC)`,
            color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer',
            fontFamily: "'Nunito',sans-serif",
          }}>{req.confirmLabel || (danger ? 'Delete' : 'Confirm')}</button>
        </div>
      </div>
    </>
  );
}
