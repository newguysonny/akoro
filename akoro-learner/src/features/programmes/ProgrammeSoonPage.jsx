/**
 * ProgrammeSoonPage — the programme page for a discipline whose materials are
 * not loaded yet. Same chrome and card language as the Pharm.D programme page
 * (back bar → hero card → panels), with a coming-soon panel instead of the
 * course folder. Static: no fetching.
 */
import { useEffect } from 'react';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { Icon } from '../../components/common/Icons.jsx';

const FONT = "'Nunito', sans-serif";

export default function ProgrammeSoonPage({ programme, onBack, onMoreProgrammes }) {
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

      {/* Hero — the same gradient card the hub and the programme grid use. */}
      <div style={{ margin: '4px 16px 14px', position: 'relative', borderRadius: 20, padding: '18px 16px',
        background: programme?.grad || 'linear-gradient(140deg,#7C5CE6,#5B3FD1)', color: '#fff', overflow: 'hidden' }}>
        <span aria-hidden="true" style={{ position: 'absolute', right: -30, bottom: -40, width: 140, height: 140,
          borderRadius: '50%', border: '1.5px solid rgba(255,255,255,.16)' }} />
        <p style={{ margin: 0, fontSize: 20, fontWeight: 900, lineHeight: 1.2, maxWidth: '74%' }}>{programme?.name || 'Programme'}</p>
        <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.82)', maxWidth: '78%' }}>
          {programme?.desc || 'Program materials'}
        </p>
      </div>

      <div style={{ margin: '0 16px', background: 'var(--ak-surface)', border: '1px solid var(--ak-border)',
        borderRadius: 16, padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 36, height: 36, borderRadius: 11, background: 'rgba(124,92,230,.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="ti-hourglass" size={18} color="#7C5CE6"/>
          </span>
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: 'var(--ak-text)' }}>Coming soon</p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--ak-text-muted)' }}>
              {programme?.name || 'This programme'} materials are being prepared.
            </p>
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: 'var(--ak-text-sub)' }}>
          The folder, topics and teaching sessions will appear here exactly like the pharmacy
          programme, as soon as this discipline's materials are published.
        </p>
        <button type="button" onClick={onMoreProgrammes}
          style={{ alignSelf: 'flex-start', marginTop: 2, padding: '9px 14px', borderRadius: 10, border: 'none',
            cursor: 'pointer', background: 'linear-gradient(135deg,var(--ak-accent, #6C3BFF),#4C1DCC)',
            color: '#fff', fontFamily: FONT, fontSize: 12.5, fontWeight: 800 }}>
          See other programmes
        </button>
      </div>
    </div>
  );
}
