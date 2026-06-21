import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { SiteNav, SiteFooter } from '../components/SiteChrome.jsx';
import { Clock, ArrowLeft, ArrowRight, ChevronRight, Link2, Share2, Mail } from 'lucide-react';
import { POSTS, getPostBySlug } from '../data/blogPosts.js';

const B = '#6C3BFF', B2 = '#4C1DCC', INK = '#0F0A1E', TEXT = '#3F3A52', MUTED = '#7A7588', BORDER = '#ECEAF4', TINT = '#F6F4FF';

function Block({ block }) {
  switch (block.type) {
    case 'h':
      return <h2 style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 800, fontSize: 'clamp(22px,3vw,28px)', color: INK, margin: '40px 0 14px', lineHeight: 1.3 }}>{block.text}</h2>;
    case 'quote':
      return (
        <blockquote style={{ margin: '32px 0', padding: '20px 28px', background: TINT, borderLeft: `4px solid ${B}`, borderRadius: '0 12px 12px 0' }}>
          <p style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 700, fontSize: 'clamp(18px,2.4vw,22px)', color: INK, margin: 0, lineHeight: 1.5, fontStyle: 'italic' }}>{block.text}</p>
        </blockquote>
      );
    case 'list':
      return (
        <ul style={{ margin: '20px 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {block.items.map((it, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 17, lineHeight: 1.7, color: TEXT }}>
              <ChevronRight size={18} color={B} style={{ marginTop: 5, flexShrink: 0 }} />
              <span>{it}</span>
            </li>
          ))}
        </ul>
      );
    case 'p':
    default:
      return <p style={{ fontSize: 17, lineHeight: 1.85, color: TEXT, margin: '0 0 20px' }}>{block.text}</p>;
  }
}

export default function BlogPostPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const post = getPostBySlug(slug);

  useEffect(() => { window.scrollTo(0, 0); }, [slug]);

  if (!post) {
    return (
      <div style={{ fontFamily: '"DM Sans",sans-serif', color: INK, background: '#fff', minHeight: '100vh' }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&family=DM+Sans:wght@400;500;600;700&display=swap');`}</style>
        <SiteNav />
        <section style={{ maxWidth: 640, margin: '0 auto', padding: '120px 24px', textAlign: 'center' }}>
          <BookIconFallback />
          <h1 style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 900, fontSize: 32, color: INK, margin: '0 0 14px' }}>Article not found</h1>
          <p style={{ color: TEXT, fontSize: 17, lineHeight: 1.7, margin: '0 0 28px' }}>The article you’re looking for doesn’t exist or may have been moved.</p>
          <button onClick={() => navigate('/blog')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: B, color: '#fff', border: 'none', borderRadius: 12, padding: '13px 24px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
            <ArrowLeft size={17} /> Back to blog
          </button>
        </section>
        <SiteFooter />
      </div>
    );
  }

  const related = POSTS.filter(p => p.slug !== post.slug && p.category === post.category).slice(0, 2);
  const fill = related.length < 2 ? [...related, ...POSTS.filter(p => p.slug !== post.slug && !related.includes(p))].slice(0, 2) : related;

  return (
    <div style={{ fontFamily: '"DM Sans",sans-serif', color: INK, background: '#fff', minHeight: '100vh' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&family=DM+Sans:wght@400;500;600;700&display=swap');
        .post-related { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
        @media(max-width:680px) { .post-related { grid-template-columns: 1fr; } }
      `}</style>

      <SiteNav />

      {/* Hero */}
      <section style={{ background: `linear-gradient(135deg, #1A1040 0%, ${B} 60%, #2D1B6E 100%)`, padding: '56px 24px 64px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 75% 25%, rgba(255,255,255,.07) 0%, transparent 60%)' }} />
        <div style={{ maxWidth: 760, margin: '0 auto', position: 'relative' }}>
          <button onClick={() => navigate('/blog')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.2)', color: '#fff', borderRadius: 999, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: 24 }}>
            <ArrowLeft size={14} /> All articles
          </button>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: post.color, borderRadius: 999, padding: '4px 14px', fontSize: 12, fontWeight: 700, color: INK, marginBottom: 18 }}>
            <post.Icon size={13} /> {post.category}
          </div>
          <h1 style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 900, fontSize: 'clamp(28px,4.5vw,46px)', color: '#fff', margin: '0 0 22px', lineHeight: 1.18 }}>{post.title}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Nunito,sans-serif', fontWeight: 800, color: '#fff', fontSize: 16 }}>
                {post.author.split(' ').map(w => w[0]).slice(0, 2).join('')}
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#fff' }}>{post.author}</p>
                {post.authorRole && <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,.7)' }}>{post.authorRole}</p>}
              </div>
            </div>
            <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(255,255,255,.4)' }} />
            <span style={{ fontSize: 14, color: 'rgba(255,255,255,.8)' }}>{post.date}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'rgba(255,255,255,.8)' }}>
              <Clock size={14} /> {post.readMin} min read
            </span>
          </div>
        </div>
      </section>

      {/* Body */}
      <article style={{ maxWidth: 760, margin: '0 auto', padding: '56px 24px 24px' }}>
        <p style={{ fontSize: 20, lineHeight: 1.7, color: INK, fontWeight: 500, margin: '0 0 36px', paddingBottom: 32, borderBottom: `1.5px solid ${BORDER}` }}>{post.excerpt}</p>
        {post.body.map((block, i) => <Block key={i} block={block} />)}
      </article>

      {/* Share */}
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px', borderTop: `1.5px solid ${BORDER}`, marginTop: 24, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: MUTED }}>Share this article</span>
        {[Share2, Mail, Link2].map((Ic, i) => (
          <button key={i} style={{ width: 38, height: 38, borderRadius: 10, border: `1.5px solid ${BORDER}`, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.background = TINT; e.currentTarget.style.borderColor = B; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = BORDER; }}>
            <Ic size={17} color={B} />
          </button>
        ))}
      </div>

      {/* Related */}
      <section style={{ background: TINT, borderTop: `1.5px solid ${BORDER}`, padding: '64px 24px', marginTop: 48 }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          <h2 style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 900, fontSize: 'clamp(22px,3vw,30px)', color: INK, margin: '0 0 28px' }}>Keep reading</h2>
          <div className="post-related">
            {fill.map(rp => (
              <article key={rp.id} onClick={() => navigate(`/blog/${rp.slug}`)} style={{ background: '#fff', border: `1.5px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden', cursor: 'pointer', transition: 'box-shadow .2s, transform .2s' }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 32px rgba(108,59,255,.12)'; e.currentTarget.style.transform = 'translateY(-3px)'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}>
                <div style={{ background: `linear-gradient(135deg, ${rp.color} 0%, ${rp.color}88 100%)`, height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <rp.Icon size={34} color={B} />
                </div>
                <div style={{ padding: '18px 22px 22px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: rp.color, borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: INK, marginBottom: 10 }}>
                    <rp.Icon size={11} /> {rp.category}
                  </span>
                  <h3 style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 800, fontSize: 17, color: INK, margin: '0 0 10px', lineHeight: 1.3 }}>{rp.title}</h3>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: B, fontWeight: 700, fontSize: 14 }}>
                    Read article <ArrowRight size={15} />
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

function BookIconFallback() {
  return <div style={{ width: 64, height: 64, borderRadius: 18, background: TINT, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
    <ArrowLeft size={28} color={B} />
  </div>;
}
