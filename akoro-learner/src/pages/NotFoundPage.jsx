import { useState } from 'react';
import { Link } from 'react-router-dom';
import AkoroLogo from '../components/common/AkoroLogo.jsx';

const BRAND = '#6C3BFF';

const suggestions = [
  { emoji:'📚', title:'My Sessions',      desc:'Live classes and agent sessions',  to:'/' },
  { emoji:'⚔️', title:'Battles',           desc:'Challenge other students, earn XP', to:'/' },
  { emoji:'🏆', title:'Rankings',          desc:'See where you stand on the board',  to:'/' },
  { emoji:'🤖', title:'My Agent',          desc:'Chat with your AI learning agent',  to:'/' },
];

export default function NotFoundPage() {
  const [query, setQuery] = useState('');
  const filtered = suggestions.filter(s =>
    s.title.toLowerCase().includes(query.toLowerCase()) ||
    s.desc.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div style={{ minHeight:'100vh', background:'var(--ak-surface)', fontFamily:"'Nunito',sans-serif",
      color:'var(--ak-text)', overflowX:'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
        @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes float  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
        .fade-1{animation:fadeUp .6s ease .1s both}
        .fade-2{animation:fadeUp .6s ease .2s both}
        .fade-3{animation:fadeUp .6s ease .3s both}
        .fade-4{animation:fadeUp .6s ease .4s both}
        .float {animation:float 4s ease-in-out infinite}
        .card:hover{transform:translateY(-3px);box-shadow:0 8px 28px rgba(108,59,255,.12)}
        .card{transition:transform .2s,box-shadow .2s}
      `}</style>

      {/* Header */}
      <header style={{ position:'fixed', top:0, left:0, right:0, zIndex:40,
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'0 20px', height:60, background:'rgba(255,255,255,.95)',
        backdropFilter:'blur(12px)', borderBottom:'1px solid var(--ak-border)' }}>
        <Link to="/" style={{ display:'flex', alignItems:'center', gap:10, textDecoration:'none' }}>
          <AkoroLogo size={34} radius={10}/>
          <span style={{ fontSize:18, fontWeight:900, color:'var(--ak-text)' }}>Akoro</span>
        </Link>
        <Link to="/" style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px',
          borderRadius:20, border:'1.5px solid var(--ak-border2)', fontSize:13, fontWeight:700,
          color:'var(--ak-text-sec)', textDecoration:'none', background:'var(--ak-surface)' }}>
          ← Back
        </Link>
      </header>

      <main style={{ paddingTop:80, paddingBottom:60 }}>
        {/* Hero */}
        <section style={{ minHeight:'60vh', display:'flex', flexDirection:'column',
          alignItems:'center', justifyContent:'center', padding:'0 20px', textAlign:'center',
          position:'relative', overflow:'hidden' }}>
          <div style={{ position:'absolute', top:'20%', left:'50%', transform:'translateX(-50%)',
            width:500, height:400, borderRadius:'50%',
            background:`radial-gradient(circle,${BRAND}18 0%,transparent 70%)`,
            filter:'blur(60px)', pointerEvents:'none' }}/>

          <div className="fade-1 float" style={{ marginBottom:24 }}>
            <div style={{ display:'inline-flex', alignItems:'center', gap:10,
              background:'var(--ak-surface)', border:'1.5px solid var(--ak-border2)', borderRadius:20,
              padding:'12px 24px', boxShadow:'0 4px 20px rgba(0,0,0,.06)' }}>
              <span style={{ fontSize:28 }}>🔍</span>
              <span style={{ fontFamily:'monospace', fontSize:52, fontWeight:900,
                color:'var(--ak-text)', letterSpacing:-2 }}>404</span>
            </div>
          </div>

          <h1 className="fade-2" style={{ fontSize:'clamp(28px,5vw,48px)', fontWeight:900,
            color:'var(--ak-text)', margin:'0 0 14px', letterSpacing:-1 }}>
            Page not <span style={{ color:BRAND }}>found</span>
          </h1>

          <p className="fade-3" style={{ fontSize:15, color:'var(--ak-text-sub)', maxWidth:440,
            lineHeight:1.7, margin:'0 0 28px' }}>
            Looks like your AI agent couldn't locate this page. It may have moved or never existed.
          </p>

          <div className="fade-4" style={{ display:'flex', flexWrap:'wrap',
            alignItems:'center', justifyContent:'center', gap:10, marginBottom:36 }}>
            <Link to="/" style={{ display:'flex', alignItems:'center', gap:7, padding:'12px 22px',
              borderRadius:14, background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,
              color:'#fff', fontSize:14, fontWeight:800, textDecoration:'none',
              boxShadow:`0 4px 14px ${BRAND}44` }}>
              🏠 Go to Dashboard
            </Link>
            <Link to="/signin" style={{ display:'flex', alignItems:'center', gap:7, padding:'12px 22px',
              borderRadius:14, background:'var(--ak-surface)', border:'1.5px solid var(--ak-border2)',
              color:'var(--ak-text-sec)', fontSize:14, fontWeight:700, textDecoration:'none' }}>
              🔑 Sign in
            </Link>
          </div>

          {/* Search */}
          <div style={{ width:'100%', maxWidth:380, position:'relative' }}>
            <span style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)',
              fontSize:16, pointerEvents:'none' }}>🔍</span>
            <input value={query} onChange={e=>setQuery(e.target.value)}
              placeholder="Search sessions, battles, rankings…"
              style={{ width:'100%', padding:'11px 14px 11px 42px', borderRadius:20,
                border:'1.5px solid var(--ak-border2)', outline:'none', fontSize:13,
                fontFamily:"'Nunito',sans-serif", color:'var(--ak-text)', boxSizing:'border-box' }}/>
          </div>
        </section>

        {/* Suggestions */}
        <section style={{ padding:'32px 20px', background:'var(--ak-bg)' }}>
          <div style={{ maxWidth:640, margin:'0 auto' }}>
            <p style={{ fontSize:11, fontWeight:800, color:BRAND, letterSpacing:2,
              textTransform:'uppercase', marginBottom:8 }}>You might be looking for</p>
            <h2 style={{ fontSize:22, fontWeight:900, color:'var(--ak-text)', margin:'0 0 20px' }}>
              Popular <span style={{ color:BRAND }}>destinations</span>
            </h2>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:12 }}>
              {filtered.map((s,i) => (
                <Link key={i} to={s.to} className="card"
                  style={{ display:'flex', alignItems:'center', gap:14, padding:'16px',
                    background:'var(--ak-surface)', border:'1.5px solid var(--ak-border)', borderRadius:16,
                    textDecoration:'none' }}>
                  <div style={{ width:42, height:42, borderRadius:12, fontSize:20,
                    background:`${BRAND}10`, display:'flex', alignItems:'center',
                    justifyContent:'center', flexShrink:0 }}>{s.emoji}</div>
                  <div>
                    <p style={{ fontSize:14, fontWeight:800, color:'var(--ak-text)', margin:'0 0 2px' }}>{s.title}</p>
                    <p style={{ fontSize:12, color:'var(--ak-text-sub)', margin:0 }}>{s.desc}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer style={{ background:'var(--ak-bg)', borderTop:'1px solid var(--ak-border)',
        padding:'16px 20px', textAlign:'center',
        fontSize:12, color:'var(--ak-text-muted)' }}>
        © 2025 Akoro — Adaptive Learning
      </footer>
    </div>
  );
}
