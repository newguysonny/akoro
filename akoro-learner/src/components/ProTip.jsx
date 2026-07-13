import { ArrowRight } from 'lucide-react';

/**
 * Pro-Tip callout — the exact section used on the landing page's "How it
 * works". Self-contained (inline styles, Poppins which every page loads) so it
 * renders identically wherever it's used (landing + Student Info page).
 */
const B = '#6C3BFF';
const POPPINS = "'Poppins',sans-serif";

export default function ProTip({ onCta }) {
  return (
    <div style={{ borderRadius: 24, padding: '32px 36px', border: `1px solid ${B}25`, background: `linear-gradient(140deg,${B}08,${B}03)`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontFamily: POPPINS, fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: B, marginBottom: 8 }}>Pro tip</div>
        <h3 style={{ fontFamily: POPPINS, fontWeight: 700, letterSpacing: '-0.02em', fontSize: 22, color: '#1A1A2E', margin: '0 0 8px' }}>Start with a free skill assessment</h3>
        <p style={{ fontSize: 14, color: '#6B6B80', lineHeight: 1.65, margin: 0 }}>5 minutes. Personalises your journey and boosts completion by up to 50%.</p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
        {[['50%', 'completion lift'], ['5 min', 'to personalise']].map(([v, l]) => (
          <div key={l} style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: POPPINS, fontSize: 26, fontWeight: 800, color: B }}>{v}</div>
            <div style={{ fontSize: 12, color: '#9490A0', marginTop: 2 }}>{l}</div>
          </div>
        ))}
        <button onClick={onCta} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 14, padding: '11px 22px', borderRadius: 99, background: B, color: '#fff', border: `1.5px solid ${B}`, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          Take free assessment <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
