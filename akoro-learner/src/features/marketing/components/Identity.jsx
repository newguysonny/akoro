/** The identity block on the home page: who Akoro is, in the site's exact words, with descriptive links to the pages that explain it. */
import { Link } from 'react-router-dom';
import { TITLE, ENTITY, CONCEPT, DIFFERENCE } from '../../../seo/site.js';
import { pageFor } from '../../../seo/pages.js';
import { B } from './shared.jsx';

export default function Identity() {
  const links = pageFor('/').links;
  return (
    <section aria-labelledby="akoro-identity" style={{ maxWidth: 860, margin: '0 auto', padding: 'clamp(40px,6vw,72px) 20px', textAlign: 'center' }}>
      <h2 id="akoro-identity" style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 900, fontSize: 'clamp(24px,4vw,38px)', lineHeight: 1.2, color: '#0F0A1E', margin: '0 0 16px' }}>{TITLE}</h2>
      <p style={{ fontSize: 17, lineHeight: 1.75, color: '#3F3A52', margin: '0 0 12px' }}>{ENTITY} {CONCEPT}</p>
      <p style={{ fontSize: 17, lineHeight: 1.75, color: '#0F0A1E', fontWeight: 700, margin: '0 0 24px' }}>{DIFFERENCE}</p>
      <nav aria-label="Explore Akoro">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '10px 22px', justifyContent: 'center' }}>
          {links.map(([t, h]) => <li key={h}><Link to={h} style={{ color: B, fontWeight: 700, textDecoration: 'none' }}>{t}</Link></li>)}
        </ul>
      </nav>
    </section>
  );
}
