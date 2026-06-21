import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SiteNav, SiteFooter } from '../components/SiteChrome.jsx';
import { Rss, BookOpen, Clock, ArrowRight, Search, ChevronRight } from 'lucide-react';
import { POSTS, CATS } from '../data/blogPosts.js';

const B = '#6C3BFF', B2 = '#4C1DCC', INK = '#0F0A1E', TEXT = '#3F3A52', MUTED = '#7A7588', BORDER = '#ECEAF4', TINT = '#F6F4FF';

export default function BlogPage() {
  const [cat, setCat] = useState('All');
  const [q, setQ] = useState('');
  const navigate = useNavigate();

  const featured = POSTS.find(p => p.featured);
  const visible = POSTS.filter(p => {
    const matchCat = cat === 'All' || p.category === cat;
    const matchQ = !q || p.title.toLowerCase().includes(q.toLowerCase()) || p.excerpt.toLowerCase().includes(q.toLowerCase());
    return matchCat && matchQ && !p.featured;
  });

  return (
    <div style={{ fontFamily: '"DM Sans",sans-serif', color: INK, background: '#fff', minHeight: '100vh' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&family=DM+Sans:wght@400;500;600;700&display=swap');
        .blog-hero-inner { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center; }
        .blog-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 28px; }
        .blog-cat-chips { display: flex; flex-wrap: wrap; gap: 10px; }
        .blog-search { display: flex; align-items: center; gap: 10px; background: ${TINT}; border: 1.5px solid ${BORDER}; border-radius: 10px; padding: 0 14px; }
        .blog-search input { background: none; border: none; outline: none; font-family: "DM Sans",sans-serif; font-size: 15px; color: ${INK}; padding: 12px 0; width: 220px; }
        .blog-newsletter { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center; }
        @media(max-width:860px) {
          .blog-hero-inner { grid-template-columns: 1fr; gap: 32px; }
          .blog-newsletter { grid-template-columns: 1fr; gap: 24px; }
        }
        @media(max-width:560px) {
          .blog-search input { width: 130px; }
        }
      `}</style>

      <SiteNav />

      {/* Hero */}
      <section style={{ background: `linear-gradient(135deg, #1A1040 0%, ${B} 60%, #2D1B6E 100%)`, padding: '80px 24px 64px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 70% 30%, rgba(255,255,255,.06) 0%, transparent 60%)' }} />
        <div style={{ maxWidth: 1120, margin: '0 auto', position: 'relative' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 999, padding: '6px 16px', marginBottom: 20 }}>
            <Rss size={14} color="#fff" />
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>Akoro Blog</span>
          </div>
          <h1 style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 900, fontSize: 'clamp(32px,5vw,54px)', color: '#fff', margin: '0 0 16px', lineHeight: 1.15, maxWidth: 640 }}>
            Insights on learning,<br />education & AI
          </h1>
          <p style={{ color: 'rgba(255,255,255,.78)', fontSize: 18, lineHeight: 1.7, maxWidth: 500, margin: 0 }}>
            Research-backed thinking on how people learn, how schools evolve, and how AI agents are reshaping education across Africa.
          </p>
        </div>
      </section>

      {/* Featured */}
      {featured && (
        <section style={{ maxWidth: 1120, margin: '0 auto', padding: '56px 24px 0' }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: B, textTransform: 'uppercase', marginBottom: 20 }}>Featured</p>
          <div className="blog-hero-inner" onClick={() => navigate(`/blog/${featured.slug}`)} style={{ background: TINT, borderRadius: 20, padding: 40, border: `1.5px solid ${BORDER}`, cursor: 'pointer' }}>
            <div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: featured.color, borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 700, color: INK, marginBottom: 18 }}>
                <featured.Icon size={13} /> {featured.category}
              </span>
              <h2 style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 800, fontSize: 'clamp(22px,3vw,32px)', color: INK, margin: '0 0 14px', lineHeight: 1.25 }}>{featured.title}</h2>
              <p style={{ color: TEXT, fontSize: 16, lineHeight: 1.7, margin: '0 0 24px' }}>{featured.excerpt}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: MUTED }}>
                  <Clock size={14} /> {featured.readMin} min read
                </span>
                <span style={{ fontSize: 14, color: MUTED }}>{featured.date}</span>
              </div>
              <div style={{ marginTop: 28 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: B, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                  Read article <ArrowRight size={16} />
                </span>
              </div>
            </div>
            <div style={{ borderRadius: 16, minHeight: 280, overflow: 'hidden', background: `linear-gradient(135deg, ${B} 0%, ${B2} 100%)` }}>
              <img src={featured.image} alt={featured.title} loading="lazy"
                style={{ width: '100%', height: '100%', minHeight: 280, objectFit: 'cover', display: 'block' }} />
            </div>
          </div>
        </section>
      )}

      {/* Filters + grid */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '48px 24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div className="blog-cat-chips">
            {CATS.map(c => (
              <button key={c} onClick={() => setCat(c)} style={{
                padding: '8px 18px', borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'all .15s',
                background: cat === c ? B : TINT,
                color: cat === c ? '#fff' : TEXT,
                border: cat === c ? `1.5px solid ${B}` : `1.5px solid ${BORDER}`,
              }}>{c}</button>
            ))}
          </div>
          <div className="blog-search">
            <Search size={16} color={MUTED} />
            <input placeholder="Search articles…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
        </div>

        {visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: MUTED }}>
            <BookOpen size={36} style={{ marginBottom: 12 }} />
            <p style={{ fontSize: 16 }}>No articles match your search.</p>
          </div>
        ) : (
          <div className="blog-grid">
            {visible.map(post => (
              <article key={post.id} onClick={() => navigate(`/blog/${post.slug}`)} style={{ background: '#fff', border: `1.5px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden', cursor: 'pointer', transition: 'box-shadow .2s, transform .2s' }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 32px rgba(108,59,255,.12)'; e.currentTarget.style.transform = 'translateY(-3px)'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}>
                <div style={{ height: 180, overflow: 'hidden', background: post.color, position: 'relative' }}>
                  <img src={post.image} alt={post.title} loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
                <div style={{ padding: '20px 22px 24px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: post.color, borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: INK, marginBottom: 12 }}>
                    <post.Icon size={11} /> {post.category}
                  </span>
                  <h3 style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 800, fontSize: 18, color: INK, margin: '0 0 10px', lineHeight: 1.3 }}>{post.title}</h3>
                  <p style={{ color: TEXT, fontSize: 14, lineHeight: 1.65, margin: '0 0 16px' }}>{post.excerpt}</p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: INK }}>{post.author}</p>
                      <p style={{ margin: 0, fontSize: 12, color: MUTED }}>{post.date} · {post.readMin} min</p>
                    </div>
                    <ChevronRight size={18} color={B} />
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Newsletter CTA */}
      <section style={{ background: TINT, borderTop: `1.5px solid ${BORDER}`, padding: '72px 24px' }}>
        <div className="blog-newsletter" style={{ maxWidth: 1120, margin: '0 auto' }}>
          <div>
            <h2 style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 900, fontSize: 'clamp(26px,3vw,38px)', color: INK, margin: '0 0 14px' }}>
              Get the learning edge
            </h2>
            <p style={{ color: TEXT, fontSize: 17, lineHeight: 1.7, margin: '0 0 28px' }}>
              New research, product updates, and education insights delivered to your inbox every two weeks. No spam — unsubscribe anytime.
            </p>
            <form onSubmit={e => e.preventDefault()} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input type="email" placeholder="you@example.com" required
                style={{ flex: '1 1 220px', padding: '13px 16px', borderRadius: 10, border: `1.5px solid ${BORDER}`, fontSize: 15, fontFamily: '"DM Sans",sans-serif', color: INK, outline: 'none', background: '#fff' }} />
              <button type="submit" style={{ padding: '13px 24px', background: B, color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                Subscribe
              </button>
            </form>
          </div>
          <div style={{ background: `linear-gradient(135deg, ${B} 0%, ${B2} 100%)`, borderRadius: 20, padding: '36px 32px', color: '#fff' }}>
            <Rss size={28} style={{ marginBottom: 14 }} />
            <p style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 800, fontSize: 20, margin: '0 0 10px' }}>Prefer RSS?</p>
            <p style={{ fontSize: 15, lineHeight: 1.6, margin: '0 0 18px', opacity: .85 }}>Subscribe to our feed and read in your favourite reader.</p>
            <a href="#" style={{ color: '#fff', fontWeight: 700, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Copy feed URL <ArrowRight size={15} />
            </a>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
