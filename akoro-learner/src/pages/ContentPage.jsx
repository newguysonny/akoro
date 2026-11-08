/**
 * ContentPage — the marketing pages whose words live in src/seo/pages.js (/ai-protege, /how-it-works, /exam-prep).
 * The build writes those same words into the page's HTML for crawlers; this renders them for people.
 */
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { SiteNav, SiteFooter } from '../components/SiteChrome.jsx';
import { pageFor } from '../seo/pages.js';

const B = '#6C3BFF', B2 = '#4C1DCC', INK = '#0F0A1E', TEXT = '#3F3A52', BORDER = '#ECEAF4', TINT = '#F6F4FF';
const HEAD = { fontFamily: "'Nunito',sans-serif", fontWeight: 900, color: INK, letterSpacing: '-0.01em' };

export default function ContentPage({ path }) {
  const page = pageFor(path);
  const navigate = useNavigate();
  if (!page) return null;
  return (
    <div style={{ minHeight: '100vh', background: '#fff', fontFamily: "'DM Sans',sans-serif" }}>
      <SiteNav />
      <header style={{ background: `linear-gradient(135deg, ${B} 0%, ${B2} 100%)`, padding: 'clamp(48px,7vw,88px) 20px', textAlign: 'center' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <h1 style={{ ...HEAD, color: '#fff', fontSize: 'clamp(28px,5vw,50px)', lineHeight: 1.15, margin: '0 0 18px' }}>{page.h1}</h1>
          <p style={{ color: 'rgba(255,255,255,.9)', fontSize: 'clamp(15px,2vw,18px)', lineHeight: 1.7, margin: '0 auto', maxWidth: 620 }}>{page.lead[0]}</p>
        </div>
      </header>
      <main style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(36px,5vw,64px) 20px' }}>
        {page.lead.slice(1).map((t) => <p key={t} style={{ fontSize: 17, color: TEXT, lineHeight: 1.8, margin: '0 0 20px', fontWeight: 600 }}>{t}</p>)}
        {page.sections.map((s) => (
          <section key={s.h2} style={{ marginTop: 36 }}>
            <h2 style={{ ...HEAD, fontSize: 'clamp(22px,3vw,28px)', margin: '0 0 12px' }}>{s.h2}</h2>
            {s.p.map((t) => <p key={t} style={{ fontSize: 16, color: TEXT, lineHeight: 1.8, margin: '0 0 14px' }}>{t}</p>)}
            {s.list && (
              <ul style={{ margin: '4px 0 0', paddingLeft: 22, color: TEXT, fontSize: 16, lineHeight: 1.8 }}>
                {s.list.map((i) => <li key={i} style={{ marginBottom: 6 }}>{i}</li>)}
              </ul>
            )}
          </section>
        ))}
        <nav aria-label="Related pages" style={{ marginTop: 48, padding: 24, background: TINT, border: `1px solid ${BORDER}`, borderRadius: 16 }}>
          <div style={{ ...HEAD, fontSize: 16, marginBottom: 12 }}>Keep exploring</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
            {page.links.map(([t, h]) => <li key={h}><Link to={h} style={{ color: B, fontWeight: 700, textDecoration: 'none' }}>{t}</Link></li>)}
          </ul>
        </nav>
        <div style={{ marginTop: 32, textAlign: 'center' }}>
          <button onClick={() => navigate('/signup')} style={{ background: B, color: '#fff', border: 0, borderRadius: 12, padding: '14px 28px', fontWeight: 800, fontSize: 15, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            Start free <ArrowRight size={16} />
          </button>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
