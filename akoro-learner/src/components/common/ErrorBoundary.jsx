import { Component } from 'react';
import { isChunkError, recoverFromStaleChunk } from '../../utils/chunkRetry.js';

const BRAND = '#6C3BFF';
const RED   = '#EF4444';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError:false, error:null, errorInfo:null, recovering:false };
  }

  static getDerivedStateFromError(error) {
    // A stale-chunk error after a deploy isn't a real crash — recover silently
    // (reload onto the fresh shell) instead of showing the error page.
    return { hasError:true, error, recovering: isChunkError(error) };
  }

  componentDidCatch(error, errorInfo) {
    if (isChunkError(error)) { recoverFromStaleChunk(); return; }
    console.error('[Akoro ErrorBoundary]', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.recovering) {
      return (
        <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16, background:'var(--ak-bg,#0B0818)', fontFamily:"'Nunito',sans-serif" }}>
          <div style={{ width:34, height:34, borderRadius:'50%', border:`3px solid ${BRAND}40`, borderTopColor:BRAND, animation:'ak-eb-spin .7s linear infinite' }} />
          <div style={{ fontSize:14, fontWeight:800, color:'var(--ak-text,#fff)' }}>Updating to the latest version…</div>
          <style>{'@keyframes ak-eb-spin{to{transform:rotate(360deg)}}'}</style>
        </div>
      );
    }
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{ minHeight:'100vh', background:'#fff',
        fontFamily:"'Nunito',sans-serif", color:'#111827', overflowX:'hidden' }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
        `}</style>

        {/* Header */}
        <header style={{ position:'fixed', top:0, left:0, right:0, zIndex:40,
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'0 20px', height:60, background:'rgba(255,255,255,.95)',
          backdropFilter:'blur(12px)', borderBottom:'1px solid #F3F4F6' }}>
          <a href="/" style={{ display:'flex', alignItems:'center', gap:10, textDecoration:'none' }}>
            <img src="/logo/akoro-mark-transparent.svg" alt="Akoro" width={34} height={34} style={{ borderRadius:10, display:'block' }}/>
            <span style={{ fontSize:18, fontWeight:900, color:'#111827' }}>Akoro</span>
          </a>
          <button onClick={() => window.location.reload()}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px',
              borderRadius:20, border:'1.5px solid #E5E7EB', fontSize:13, fontWeight:700,
              color:'#374151', background:'#fff', cursor:'pointer',
              fontFamily:"'Nunito',sans-serif" }}>
            🔄 Refresh
          </button>
        </header>

        <main style={{ paddingTop:100, paddingBottom:60, padding:'100px 20px 60px' }}>
          <div style={{ maxWidth:480, margin:'0 auto', textAlign:'center' }}>

            {/* Icon */}
            <div style={{ display:'flex', justifyContent:'center', marginBottom:28 }}>
              <div style={{ width:80, height:80, borderRadius:'50%',
                background:`${RED}12`, border:`1.5px solid ${RED}30`,
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:36 }}>
                ⚠️
              </div>
            </div>

            <h1 style={{ fontSize:'clamp(24px,5vw,40px)', fontWeight:900,
              color:'#111827', margin:'0 0 12px', letterSpacing:-0.5 }}>
              Something went <span style={{ color:RED }}>wrong</span>
            </h1>

            <p style={{ fontSize:14, color:'#6B7280', lineHeight:1.7,
              margin:'0 0 28px', maxWidth:380, marginLeft:'auto', marginRight:'auto' }}>
              Your AI agent hit an unexpected error. Don't worry — your progress is safe.
              Try refreshing the page.
            </p>

            {/* Actions */}
            <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center',
              justifyContent:'center', gap:10, marginBottom:36 }}>
              <button onClick={() => window.location.reload()}
                style={{ display:'flex', alignItems:'center', gap:7, padding:'12px 22px',
                  borderRadius:14, background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,
                  color:'#fff', fontSize:14, fontWeight:800, border:'none', cursor:'pointer',
                  fontFamily:"'Nunito',sans-serif", boxShadow:`0 4px 14px ${BRAND}44` }}>
                🔄 Refresh page
              </button>
              <button onClick={() => { window.location.href = '/'; }}
                style={{ display:'flex', alignItems:'center', gap:7, padding:'12px 22px',
                  borderRadius:14, background:'#fff', border:'1.5px solid #E5E7EB',
                  color:'#374151', fontSize:14, fontWeight:700, cursor:'pointer',
                  fontFamily:"'Nunito',sans-serif" }}>
                🏠 Go home
              </button>
              <button onClick={() => window.history.back()}
                style={{ display:'flex', alignItems:'center', gap:7, padding:'12px 22px',
                  borderRadius:14, background:'transparent', border:'none',
                  color:'#9CA3AF', fontSize:14, fontWeight:700, cursor:'pointer',
                  fontFamily:"'Nunito',sans-serif" }}>
                ← Go back
              </button>
            </div>

            {/* Technical details */}
            <details style={{ background:'#F9FAFB', border:'1px solid #F3F4F6',
              borderRadius:16, padding:'14px 16px', textAlign:'left' }}>
              <summary style={{ cursor:'pointer', fontSize:12, fontWeight:700,
                color:'#6B7280', userSelect:'none' }}>
                Technical details (for developers)
              </summary>
              <div style={{ marginTop:12, padding:12, background:'#fff',
                border:'1px solid #F3F4F6', borderRadius:10, overflow:'auto' }}>
                <p style={{ fontSize:11, fontFamily:'monospace', color:RED, margin:'0 0 8px' }}>
                  <strong style={{ color:'#111827' }}>Error:</strong>{' '}
                  {this.state.error?.toString()}
                </p>
                {this.state.errorInfo && (
                  <details>
                    <summary style={{ cursor:'pointer', fontSize:11, color:'#9CA3AF' }}>
                      Stack trace
                    </summary>
                    <pre style={{ marginTop:8, fontSize:10, fontFamily:'monospace',
                      color:'#6B7280', whiteSpace:'pre-wrap', overflowY:'auto',
                      maxHeight:200 }}>
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </div>
            </details>

            <p style={{ fontSize:12, color:'#9CA3AF', marginTop:20 }}>
              If this keeps happening, contact{' '}
              <a href="mailto:support@akoro.app"
                style={{ color:BRAND, textDecoration:'none', fontWeight:700 }}>
                support@akoro.app
              </a>
            </p>
          </div>
        </main>

        <footer style={{ background:'#F9FAFB', borderTop:'1px solid #F3F4F6',
          padding:'16px 20px', textAlign:'center', fontSize:12, color:'#9CA3AF' }}>
          © 2025 Akoro — Adaptive Learning
        </footer>
      </div>
    );
  }
}

export default ErrorBoundary;
