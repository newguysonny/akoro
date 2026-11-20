/*
 * SheetFrame — the challenge sheet's frame: a bottom sheet on phones and
 * tablets, a centred dialog on desktop (wider than 1024px). Escape and the
 * scrim close it. The content is the caller's.
 */
import { useEffect, useState } from 'react';
import { Icon } from '../../../components/common/Icons.jsx';

const DESKTOP = '(min-width: 1025px)';

export function useDesktop() {
  const [desk, setDesk] = useState(() => { try { return window.matchMedia(DESKTOP).matches; } catch { return false; } });
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia(DESKTOP); } catch { return undefined; }
    const on = (e) => setDesk(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return desk;
}

export default function SheetFrame({ onClose, children, label = 'Challenge' }) {
  const desk = useDesktop();
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <style>{`@keyframes ak-sheet-up{from{transform:translateY(100%)}to{transform:translateY(0)}}@keyframes ak-dialog-in{from{opacity:0;transform:translate(-50%,-48%) scale(.98)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}`}</style>
      <div onClick={onClose} aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(6,6,18,.62)', backdropFilter: 'blur(6px)' }} />
      <div role="dialog" aria-modal="true" aria-label={label} style={desk ? {
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: 2100, width: 'min(500px, 92vw)', maxHeight: '86vh', overflowY: 'auto',
        background: 'var(--ak-surface)', borderRadius: 20, boxShadow: '0 24px 60px rgba(0,0,0,.28)', animation: 'ak-dialog-in .2s ease-out', fontFamily: "'Nunito',sans-serif", padding: '6px 0 22px',
      } : {
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 2100, maxHeight: '88vh', overflowY: 'auto',
        background: 'var(--ak-surface)', borderRadius: '24px 24px 0 0', boxShadow: '0 -8px 40px rgba(0,0,0,.18)', animation: 'ak-sheet-up .32s cubic-bezier(.32,1.2,.64,1)', fontFamily: "'Nunito',sans-serif", padding: '0 0 calc(28px + env(safe-area-inset-bottom))',
      }}>
        {!desk && <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--ak-border2)', margin: '14px auto 0' }} />}
        {desk && (
          <button type="button" onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 10, right: 12, width: 32, height: 32, borderRadius: 10, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ak-text-muted)', fontSize: 18 }}>
            <Icon name="ti-x" size={18} />
          </button>
        )}
        {children}
      </div>
    </>
  );
}
