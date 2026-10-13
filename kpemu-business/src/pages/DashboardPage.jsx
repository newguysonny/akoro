/**
 * DashboardPage — the Kpemu Business "Home" dashboard, ported 1:1 from the
 * reference (reference/kpemu home dashboard.md): the sponsored-ads carousel,
 * the range segmented control, the six-cell stats grid, "Integrate in one
 * call", Updates, and the Recommended platforms/services cards.
 *
 * Same UI, no changes — only adopted to this app's layout: the content lives
 * inside PageLayout (permanent sidebar on desktop, the app header on mobile)
 * as a centred column that goes full-width under 768px, and the numbers the
 * platform actually measures (codes issued / redeemed, active API keys,
 * wallet balance) come from the live endpoints. Cells the platform does not
 * measure yet keep the reference's values, and the charts stay the
 * reference's sparklines. Class names are kd-prefixed and scoped under
 * .kdash so nothing leaks into the shell.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '../components/Layout.jsx';
import { useStartup } from '../contexts/StartupContext.jsx';
import { apiGet } from '../services/api.js';

const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

/* The reference's stylesheet, scoped: every class kd-prefixed, variables
   pinned to its light theme (this app has no dark mode), plus one small
   screen refinement so the 146px banner and the grid cells keep their
   proportions on narrow phones. */
const KD_CSS = `
.kdash{--bg:#fff;--text:#0d0d0d;--muted:#6e6e6e;--border:#e8e8e8;--pill:#f3f3f3;--pillon:#fff;--icon:#eaf3ff;--iconfg:#2563c9;--btn:#fff;--track:#f1f1f1;
color:var(--text);font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13px;line-height:1.5;max-width:520px;margin:0 auto}
.kdash *{box-sizing:border-box}
.kdash button{font-family:inherit;color:inherit}
.kdash button:focus-visible{outline:2px solid #2563c9;outline-offset:2px}
.kd-pager{display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-bottom:10px;font-size:11px;color:var(--muted)}
.kd-pager button{background:none;border:0;padding:4px;cursor:pointer;color:var(--muted);font-size:14px;line-height:1}
.kd-nav{display:flex;align-items:center;gap:10px}
.kd-sa{margin-right:auto;background:none;border:0;padding:4px 0;font-size:11px;font-weight:500;color:var(--iconfg);cursor:pointer}
.kd-banner{position:relative;height:146px;border-radius:12px;overflow:hidden;color:#fff;touch-action:pan-y}
.kd-track{display:flex;height:100%;transition:transform .6s cubic-bezier(.65,0,.35,1)}
.kd-ad{flex:0 0 100%;min-width:0;position:relative;padding:36px 24px 0}
.kd-ad.a1{background:radial-gradient(circle at 74% 50%,#fff8e0 0 7px,#f3d58a 11px,rgba(243,213,138,.35) 26px,transparent 62px),radial-gradient(circle 1.5px at 12% 20%,#fff 98%,transparent),radial-gradient(circle 1px at 30% 80%,#fff 98%,transparent),radial-gradient(circle 1.5px at 52% 18%,#fff 98%,transparent),radial-gradient(circle 1px at 88% 24%,#fff 98%,transparent),radial-gradient(circle 2px at 84% 62%,#6fa8ff 98%,transparent),radial-gradient(circle 1.5px at 62% 78%,#ff9a4a 98%,transparent),linear-gradient(120deg,#05070f,#0b1020 60%,#0a0a14)}
.kd-ad.a2{background:radial-gradient(circle at 88% 20%,rgba(255,255,255,.16) 0 40px,transparent 41px),linear-gradient(130deg,#0f6b34,#08331a)}
.kd-ad.a3{background:radial-gradient(circle at 80% 90%,rgba(255,255,255,.14) 0 50px,transparent 51px),linear-gradient(130deg,#3b4bd6,#1b1f5e)}
.kd-ad.a4{background:radial-gradient(circle at 90% 15%,rgba(255,255,255,.2) 0 36px,transparent 37px),linear-gradient(130deg,#d9822b,#7a3a0c)}
.kd-ad .c{opacity:0;transform:translateY(8px);transition:opacity .5s .25s,transform .5s .25s}
.kd-ad.on .c{opacity:1;transform:none}
.kd-spons{position:absolute;top:12px;left:24px;font-size:9.5px;letter-spacing:.03em;padding:2px 8px;border-radius:99px;background:rgba(255,255,255,.18);color:rgba(255,255,255,.9)}
.kd-banner h3{margin:0 0 4px;font-size:15px;font-weight:600}
.kd-banner p{margin:0 0 14px;max-width:62%;font-size:11px;line-height:1.5;color:rgba(255,255,255,.78)}
.kd-banner .try{background:#fff;color:#111;border:0;border-radius:6px;padding:6px 12px;font-size:11px;font-weight:500;cursor:pointer}
.kd-banner .x{position:absolute;z-index:2;top:8px;right:8px;width:20px;height:20px;border-radius:50%;border:0;background:rgba(255,255,255,.18);color:#fff;font-size:12px;line-height:1;cursor:pointer}
.kd-prog{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.15)}
.kd-prog i{display:block;height:100%;background:rgba(255,255,255,.85);transform:scaleX(0);transform-origin:left;animation:kdpg 5s linear forwards}
.kd-banner:hover .kd-prog i,.kd-banner:focus-within .kd-prog i{animation-play-state:paused}
@keyframes kdpg{to{transform:scaleX(1)}}
@media (prefers-reduced-motion:reduce){.kd-track,.kd-ad .c{transition:none}.kd-prog{display:none}}
.kd-range{display:flex;justify-content:flex-end;margin:30px 0 14px}
.kd-seg{display:flex;background:var(--pill);border-radius:8px;padding:3px}
.kd-seg button{border:0;background:none;padding:4px 10px;border-radius:6px;font-size:11px;color:var(--muted);cursor:pointer}
.kd-seg button.on{background:var(--pillon);color:var(--text);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.kd-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--border);border-radius:12px;overflow:hidden}
.kd-cell{padding:16px 14px 14px;border-right:1px solid var(--border);border-bottom:1px solid var(--border);min-height:110px;background:var(--bg)}
.kd-cell:nth-child(2n){border-right:0}
.kd-cell:nth-last-child(-n+2){border-bottom:0}
.kd-lbl{font-size:11px;color:var(--muted);display:flex;justify-content:space-between;align-items:center}
button.kd-lbl{width:100%;text-align:left;background:none;border:0;padding:0;font:inherit;letter-spacing:inherit;cursor:pointer}
.kd-lblbtn{width:100%;background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer}
.kd-val{margin:6px 0 10px;font-size:15px;font-weight:600}
.kd-chart{display:block;width:100%;height:38px}
.kd-info{color:var(--muted);display:inline-flex}
.kd-info svg,.kd-add svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.kd-spend .row{margin:14px 0 4px;display:flex;justify-content:space-between;font-size:11px}
.kd-spend .row span:first-child{color:var(--muted)}
.kd-meter{position:relative;height:12px;border-radius:2px;background:var(--track);margin-bottom:14px}
.kd-meter i{position:absolute;top:2px;bottom:2px;width:2px;background:#6b6b6b;opacity:.7}
.kd-meter i.g{background:#16a34a;opacity:1;left:3px}
.kd-add{display:inline-flex;align-items:center;gap:6px;margin-top:8px;padding:6px 12px;border:1px solid var(--border);border-radius:6px;background:var(--btn);font-size:11px;font-weight:500;cursor:pointer}
.kd-upd{margin-top:46px}
.kd-item{display:flex;gap:16px;margin-bottom:26px}
.kd-ico{flex:none;width:30px;height:30px;border-radius:50%;background:var(--icon);display:grid;place-items:center}
.kd-ico svg{width:15px;height:15px;stroke:var(--iconfg);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.kd-item small{display:block;font-size:11px;color:var(--muted)}
.kd-item b{display:block;font-size:11.5px;font-weight:600;margin:2px 0 3px}
.kd-item p{margin:0;font-size:11.5px;color:var(--muted);line-height:1.55}
.kd-rec{margin-top:40px}
.kd-sub-h{margin:26px 0 14px;font-size:14px;font-weight:600}
.kdash h2{margin:0 0 20px;font-size:15px;font-weight:600}
.kd-cards{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.kd-card{display:flex;flex-direction:column;min-height:120px;padding:16px;border:1px solid var(--border);border-radius:10px;color:inherit;text-decoration:none;background:var(--bg);transition:transform .25s}
.kd-card:hover{transform:translateY(-2px)}
.kd-card:focus-visible{outline:2px solid #2563c9;outline-offset:2px}
.kd-ci{width:34px;height:34px;border-radius:8px;background:var(--pill);display:grid;place-items:center;margin-bottom:12px}
.kd-ci svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.kd-card b{font-size:12px;font-weight:600;line-height:1.4;margin-bottom:4px}
.kd-card .d{font-size:11px;line-height:1.5;color:var(--muted)}
.kd-card.dark{border-color:#05070f;color:#fff;background:radial-gradient(circle 1.5px at 20% 22%,#fff 98%,transparent),radial-gradient(circle 1px at 70% 15%,#fff 98%,transparent),radial-gradient(circle 2px at 86% 62%,#6fa8ff 98%,transparent),radial-gradient(circle 1.5px at 62% 82%,#ff9a4a 98%,transparent),linear-gradient(130deg,#05070f,#0b1020 60%,#0a0a14)}
.kd-card.dark .d{color:rgba(255,255,255,.75)}
.kd-card.dark .kd-ci{background:rgba(255,255,255,.14)}
.kd-integ{margin-top:46px}
.kd-integ p{margin:0 0 14px;font-size:12px;line-height:1.6;color:var(--muted)}
.kd-integ p code{background:var(--pill);color:var(--text);padding:1px 6px;border-radius:4px;font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.kd-integ a{color:var(--iconfg)}
.kd-code{background:#0f1117;border-radius:12px;overflow:hidden}
.kd-code .bar{display:flex;justify-content:space-between;align-items:center;padding:8px 8px 8px 16px;border-bottom:1px solid rgba(255,255,255,.08);font-size:11px;color:#8b93a7}
.kd-code .bar button{background:rgba(255,255,255,.08);border:0;border-radius:6px;padding:4px 10px;font-size:11px;color:#d6deeb;cursor:pointer}
.kd-code pre{margin:0;padding:14px 16px 16px;overflow-x:auto;font:11.5px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#d6deeb}
.kd-code .k{color:#7fdbca}.kd-code .s{color:#ecc48d}.kd-code .u{color:#82aaff}
@media (max-width:480px){
.kd-ad{padding:30px 18px 0}
.kd-spons{left:18px}
.kd-banner p{max-width:72%}
.kd-cell{padding:13px 11px 12px}
.kd-item{gap:12px}
}`;

/* ── Sponsored ads — the reference's four slides, verbatim ───────────────── */
const ADS = [
  { cls: 'a1', tag: 'Sponsored', h: 'Introducing GPT-6.1 Sol & Ultrafast', p: 'GPT-6.1 Sol brings near-Astra performance to Sol pricing for cost-efficient API workloads—now with Ultrafast.', cta: 'Try GPT-6.1 Sol & Ultrafast' },
  { cls: 'a2', tag: 'Sponsored', h: 'Accept vouchers in one call', p: 'Validate customer codes with a single API request. We stay the source of truth.', cta: 'Read the docs', to: '/docs' },
  { cls: 'a3', tag: 'Sponsored', h: 'Get paid faster', p: 'Withdraw your wallet balance to your bank account in minutes.', cta: 'Withdraw now', to: '/wallet' },
  { cls: 'a4', tag: 'Ad', h: 'Advertise on this dashboard', p: 'Put your product in front of thousands of developers and businesses.', cta: 'Advertise with us' },
];

/* ── Updates — the Kpemu Business changelog, in the reference's layout:
      circular icon, small recency label, bold title, one-line description.
      Every entry is a real platform feature (the same surface this app
      ships), newest first. ── */
const UPDATES = [
  { ago: '5 days ago', t: 'Voucher validation API', d: 'One call to validate any code. Your backend sends the voucher code with an API key — Kpemu stays the source of truth.', icon: <><path d="M12 3l7 3v5c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" /></> },
  { ago: '13 days ago', t: 'Webhook deliveries', d: 'Voucher events now reach your endpoint automatically — signed deliveries with retries, secret rotation, and one-click test from the dashboard.', icon: <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" /> },
  { ago: '20 days ago', t: 'Withdraw to your bank', d: 'Move your wallet balance to your bank account in minutes, and track every transfer under Balance & Withdraw.', icon: <><path d="M3 9.5 12 4l9 5.5" /><path d="M5 10v8M9.7 10v8M14.3 10v8M19 10v8M3 21h18" /></> },
  { ago: 'last month', t: 'Per-key request logs', d: 'Every API key keeps its own log — status, latency and payload for each validate call, right next to the key that made it.', icon: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></> },
  { ago: 'last month', t: 'Discount tiers', d: 'Offer volume pricing on any product — define the tiers once, and every redemption is charged the right amount automatically.', icon: <><path d="M19 5 5 19" /><circle cx="7" cy="7" r="2.5" /><circle cx="17" cy="17" r="2.5" /></> },
  { ago: 'last month', t: 'Batch generation', d: 'Generate vouchers in batches with cover art and expiry, then hand them out or sell them on the Kpemu marketplace.', icon: <><path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8z" /><path d="M13 7v10" strokeDasharray="2.5 2.5" /></> },
];

/* ── Recommended platforms and services — verbatim from the reference ────── */
const PLATFORMS = [
  { dark: true, t: 'Agent', d: 'Automate tasks and handle conversations with smart assistants.', icon: <><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M12 7V3M9 12h.01M15 12h.01M9 16h6M2 12v3M22 12v3" /></> },
  { t: 'Business', d: 'Tools to launch, manage and grow your business.', icon: <><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></> },
  { t: 'Crowdfunding', d: 'Raise capital from backers who believe in your idea.', icon: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" /> },
  { t: 'Co-working matching', d: 'Find the right partners, talent and workspaces.', icon: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></> },
];
const SERVICES = [
  { t: 'Product Development & Innovation', d: 'Turn ideas into market-ready products.', icon: <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z" /> },
  { t: 'Sales & Marketing', d: 'Reach customers and grow revenue.', icon: <path d="M23 6l-9.5 9.5-5-5L1 18M17 6h6v6" /> },
  { t: 'Professional Talent & Co-working Pool', d: 'Access vetted experts and shared workspaces.', icon: <><circle cx="12" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /></> },
  { t: 'Crowdfunding & Startup Financing', d: 'Funding routes for early-stage ventures.', icon: <><circle cx="12" cy="12" r="10" /><path d="M12 6v12M15 9.5a3 3 0 0 0-3-1.5c-1.7 0-3 .9-3 2.2s1.3 2 3 2.3 3 .9 3 2.3-1.3 2.2-3 2.2a3 3 0 0 1-3-1.5" /></> },
  { t: 'Business Growth & Venture Support', d: 'Guidance and resources to scale with confidence.', icon: <path d="M12 20V10M18 20V4M6 20v-4" /> },
];

const Meter = ({ last = false }) => (
  <div className="kd-meter" style={last ? { marginBottom: 0 } : undefined}>
    <i className="g" /><i style={{ left: '50%' }} /><i style={{ left: '80%' }} />
  </div>
);

export default function DashboardPage() {
  const navigate = useNavigate();
  const { current } = useStartup();
  const [stats, setStats] = useState(null);
  const [wallet, setWallet] = useState(null);

  useEffect(() => {
    if (!current) return;
    apiGet(`/api/vouchers/startups/${current.id}/analytics`).then((r) => setStats(r.analytics)).catch(() => setStats({}));
    apiGet(`/api/vouchers/startups/${current.id}/wallet`).then(setWallet).catch(() => {});
  }, [current]);

  // Ads carousel state — index, visibility, and the swipe start point.
  const [ad, setAd] = useState(0);
  const [adsOn, setAdsOn] = useState(true);
  const swipeX = useRef(null);
  const N = ADS.length;
  const show = (i) => setAd(((i % N) + N) % N);

  const [range, setRange] = useState('7d');

  // Copy button — clipboard API with the reference's textarea fallback.
  const [copied, setCopied] = useState(false);
  const copySnippet = () => {
    const t = document.getElementById('kd-cu')?.textContent || '';
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    const fb = () => {
      const a = document.createElement('textarea');
      a.value = t; a.style.position = 'fixed'; a.style.opacity = '0';
      document.body.appendChild(a); a.select();
      try { document.execCommand('copy'); done(); } catch { /* noop */ }
      document.body.removeChild(a);
    };
    try { navigator.clipboard.writeText(t).then(done, fb); } catch { fb(); }
  };

  if (!current) return <PageLayout title="Home">Loading…</PageLayout>;

  const lblBtn = (label, to, info = null) => (
    <button className="kd-lbl kd-lblbtn" onClick={() => navigate(to)}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{label} &rsaquo;</span>
      {info}
    </button>
  );

  return (
    <PageLayout title="Home">
      <style>{KD_CSS}</style>
      <div className="kdash">

        {/* Pager + hide/show ads — reference row, above the banner */}
        <div className="kd-pager">
          {!adsOn && <button className="kd-sa" onClick={() => { setAdsOn(true); show(0); }}>Show ads</button>}
          {adsOn && (
            <span className="kd-nav">
              <span>{ad + 1} of {N}</span>
              <button aria-label="Previous ad" onClick={() => show(ad - 1)}>&lsaquo;</button>
              <button aria-label="Next ad" onClick={() => show(ad + 1)}>&rsaquo;</button>
            </span>
          )}
        </div>

        {/* Sponsored ads carousel — autoplay via the progress bar's
            animationend, pauses on hover/focus, swipes with a pointer. */}
        {adsOn && (
          <section
            className="kd-banner"
            aria-roledescription="carousel"
            aria-label="Sponsored ads"
            onPointerDown={(e) => { swipeX.current = e.clientX; }}
            onPointerUp={(e) => {
              if (swipeX.current == null) return;
              const d = e.clientX - swipeX.current;
              swipeX.current = null;
              if (Math.abs(d) > 40) show(ad + (d < 0 ? 1 : -1));
            }}
          >
            <button className="x" aria-label="Hide ads" onClick={() => setAdsOn(false)}>&times;</button>
            <div className="kd-track" style={{ transform: `translateX(-${ad * 100}%)` }}>
              {ADS.map((a, i) => (
                <div key={a.cls} className={`kd-ad ${a.cls}${i === ad ? ' on' : ''}`} aria-hidden={i !== ad}>
                  <span className="kd-spons">{a.tag}</span>
                  <div className="c">
                    <h3>{a.h}</h3>
                    <p>{a.p}</p>
                    <button className="try" onClick={a.to ? () => navigate(a.to) : undefined}>{a.cta}</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="kd-prog">
              <i key={ad} onAnimationEnd={() => show(ad + 1)} />
            </div>
          </section>
        )}

        {/* Range segmented control */}
        <div className="kd-range">
          <div className="kd-seg">
            {['24h', '7d', '14d', '30d'].map((r) => (
              <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>
            ))}
          </div>
        </div>

        {/* The stats grid — live numbers where the platform measures them */}
        <div className="kd-grid">
          <div className="kd-cell">
            {lblBtn('Codes redeemed', '/redemptions')}
            <div className="kd-val">{num(stats?.usedCodes)}</div>
            <svg className="kd-chart" viewBox="0 0 200 40" preserveAspectRatio="none">
              <path d="M0 30C30 29 50 23 80 19S130 14 160 21 190 30 198 32" fill="none" stroke="#e8894a" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
              <path d="M0 28 198 31" fill="none" stroke="#d6336c" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>

          <div className="kd-cell">
            {lblBtn('Active API keys', '/api-keys')}
            <div className="kd-val">{num(stats?.activeApiKeys)}</div>
            <svg className="kd-chart" viewBox="0 0 200 40" preserveAspectRatio="none" fill="#6d5ae6">
              <rect x="0" y="22" width="20" height="18" /><rect x="26" y="8" width="22" height="32" />
              <rect x="54" y="4" width="22" height="36" /><rect x="82" y="36" width="22" height="4" />
              <rect x="110" y="10" width="22" height="30" /><rect x="138" y="6" width="22" height="34" />
              <rect x="166" y="22" width="22" height="18" /><rect x="192" y="38" width="8" height="2" />
            </svg>
          </div>

          <div className="kd-cell">
            <div className="kd-lbl">Prompt caching: Hit rate &rsaquo;
              <span className="kd-info"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg></span>
            </div>
            <div className="kd-val">27.1%</div>
            <svg className="kd-chart" viewBox="0 0 200 40" preserveAspectRatio="none">
              <path d="M0 34C25 20 40 14 60 24S95 34 120 28 160 12 186 10 196 12 198 12" fill="none" stroke="#7c6ae8" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>

          <div className="kd-cell kd-spend">
            <div className="kd-lbl">Gross sales
              <span className="kd-info"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" /></svg></span>
            </div>
            <div className="row"><span>Personal</span><span>$0.02 / $2.00</span></div>
            <Meter />
            <div className="row"><span>Default project</span><span>$0.02 / $2.00</span></div>
            <Meter last />
          </div>

          <div className="kd-cell">
            <div className="kd-lbl">Wallet balance</div>
            <div className="kd-val">{wallet?.balance != null ? usd(wallet.balance) : '—'}</div>
            <button className="kd-add" onClick={() => navigate('/wallet')}>
              <svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>
              Withdraw
            </button>
          </div>

          <div className="kd-cell">
            {lblBtn('Codes issued', '/generated')}
            <div className="kd-val">{num(stats?.totalCodes)}</div>
            <svg className="kd-chart" viewBox="0 0 200 40" preserveAspectRatio="none">
              <path d="M0 30C25 28 40 16 60 18S90 34 110 30 150 10 170 16 190 28 196 32" fill="none" stroke="#14b8a6" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
        </div>

        {/* Integrate in one call */}
        <section className="kd-integ">
          <h2>Integrate in one call</h2>
          <p>
            Your backend calls <code>POST /api/vouchers/v1/validate</code> with an API key (see <a href="#" onClick={(e) => { e.preventDefault(); navigate('/api-keys'); }}>API Keys</a>) and a voucher code. We're the source of truth — you never store or trust a code as valid on your own.
          </p>
          <div className="kd-code">
            <div className="bar">
              <span>bash</span>
              <button onClick={copySnippet}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
            <pre><code id="kd-cu"><span className="k">curl</span> -X POST <span className="u">https://api.akoro.name.ng/api/vouchers/v1/validate</span>{' \\\n  -H '}<span className="s">"Authorization: Bearer sk_live_..."</span>{' \\\n  -H '}<span className="s">"Content-Type: application/json"</span>{' \\\n  -d '} <span className="s">{"{"}"voucher_code":"X9K7-MQPL-3R9T","customer_id":"cust_123"{"}"}</span>'</code></pre>
          </div>
        </section>

        {/* Updates */}
        <section className="kd-upd">
          <h2>Updates</h2>
          {UPDATES.map((u) => (
            <div className="kd-item" key={u.t}>
              <div className="kd-ico"><svg viewBox="0 0 24 24">{u.icon}</svg></div>
              <div>
                <small>{u.ago}</small>
                <b>{u.t}</b>
                <p>{u.d}</p>
              </div>
            </div>
          ))}
        </section>

        {/* Recommended platforms and services */}
        <section className="kd-rec">
          <h2>Recommended platforms and services</h2>
          <h3 className="kd-sub-h">Platforms</h3>
          <div className="kd-cards">
            {PLATFORMS.map((c) => (
              <a key={c.t} className={`kd-card${c.dark ? ' dark' : ''}`} href="#" onClick={(e) => e.preventDefault()}>
                <span className="kd-ci"><svg viewBox="0 0 24 24">{c.icon}</svg></span>
                <b>{c.t}</b>
                <span className="d">{c.d}</span>
              </a>
            ))}
          </div>
          <h3 className="kd-sub-h" style={{ marginTop: 34 }}>Services</h3>
          <div className="kd-cards">
            {SERVICES.map((c) => (
              <a key={c.t} className="kd-card" href="#" onClick={(e) => e.preventDefault()}>
                <span className="kd-ci"><svg viewBox="0 0 24 24">{c.icon}</svg></span>
                <b>{c.t}</b>
                <span className="d">{c.d}</span>
              </a>
            ))}
          </div>
        </section>
      </div>
    </PageLayout>
  );
}
