/**
 * MoreProgrammesPage — every discipline's programme card, static by design.
 *
 * Reached from the Discover hub's "More programmes" card. No fetching: the
 * list is the same fixed catalogue the hub uses, and each card opens that
 * discipline's programme page (pharmacy has real content, the rest say
 * coming soon).
 */
import { useEffect } from 'react';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { Icon } from '../../components/common/Icons.jsx';
import { ALL_PROGRAMMES } from '../../lib/disciplineProgrammes.js';

const FONT = "'Nunito', sans-serif";

export default function MoreProgrammesPage({ currentSlug, onBack, onOpen }) {
  const { t } = useLang();
  useEffect(() => { window.scrollTo?.(0, 0); }, []);

  return (
    <div style={{ fontFamily: FONT, paddingBottom: 90 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 6px' }}>
        <button type="button" onClick={onBack} aria-label={t('common.back')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ak-text)', fontFamily: FONT, fontSize: 13, fontWeight: 800 }}>
          <Icon name="ti-arrow-left" size={16}/> {t('common.back')}
        </button>
      </header>

      <div style={{ padding: '0 16px' }}>
        <h1 style={{ margin: '6px 0 2px', fontSize: 21, fontWeight: 900, color: 'var(--ak-text)' }}>More programmes</h1>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ak-text-muted)' }}>
          Program materials by discipline. Yours is marked; the rest arrive as they are ready.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, padding: '14px 16px 0' }}>
        {ALL_PROGRAMMES.map((p) => {
          const mine = p.slug === currentSlug;
          return (
            <div key={p.slug} onClick={() => onOpen?.(p.slug)} role="button" aria-label={p.name}
              style={{ position: 'relative', cursor: 'pointer', borderRadius: 20, padding: '13px 14px',
                background: p.grad, color: '#fff', overflow: 'hidden', minHeight: 122,
                boxShadow: '0 4px 14px rgba(15,23,42,.16)', display: 'flex', flexDirection: 'column' }}>
              <span aria-hidden="true" style={{ position: 'absolute', right: -26, bottom: -32, width: 112, height: 112,
                borderRadius: '50%', border: '1.5px solid rgba(255,255,255,.16)', pointerEvents: 'none' }} />
              <span aria-hidden="true" style={{ position: 'absolute', right: -9, bottom: -11, width: 60, height: 60,
                borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.28)', transform: 'rotate(-8deg)' }}>
                <Icon name={p.icon} size={26} color="rgba(255,255,255,.92)"/>
              </span>
              {mine && (
                <span style={{ position: 'absolute', top: 10, right: 10, fontSize: 8.5, fontWeight: 900, letterSpacing: .4,
                  padding: '3px 8px', borderRadius: 99, background: 'rgba(0,0,0,.28)', color: '#fff', textTransform: 'uppercase' }}>
                  Yours
                </span>
              )}
              <p style={{ fontSize: 14.5, fontWeight: 900, margin: 0, lineHeight: 1.2, maxWidth: '76%',
                textShadow: '0 1px 2px rgba(0,0,0,.12)' }}>{p.name}</p>
              <p style={{ fontSize: 10.5, fontWeight: 700, margin: '4px 0 0', lineHeight: 1.35,
                color: 'rgba(255,255,255,.78)', maxWidth: '82%' }}>{p.desc}</p>
              {!p.live && (
                <span style={{ marginTop: 'auto', display: 'inline-flex', alignSelf: 'flex-start', fontSize: 9,
                  fontWeight: 900, letterSpacing: .4, padding: '4px 10px', borderRadius: 99,
                  background: 'rgba(0,0,0,.24)', color: 'rgba(255,255,255,.92)', textTransform: 'uppercase' }}>
                  Coming soon
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
