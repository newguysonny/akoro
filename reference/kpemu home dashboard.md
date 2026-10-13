<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Home Dashboard v1</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#fff;--text:#0d0d0d;--muted:#6e6e6e;--border:#e8e8e8;--pill:#f3f3f3;--pillon:#fff;--icon:#eaf3ff;--iconfg:#2563c9;--btn:#fff;--track:#f1f1f1;
box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141414;--text:#f2f2f2;--muted:#9a9a9a;--border:#2c2c2c;--pill:#222;--pillon:#3a3a3a;--icon:#1d2a3d;--iconfg:#7fb0ff;--btn:#1c1c1c;--track:#262626}}
:root[data-theme="dark"]{--bg:#141414;--text:#f2f2f2;--muted:#9a9a9a;--border:#2c2c2c;--pill:#222;--pillon:#3a3a3a;--icon:#1d2a3d;--iconfg:#7fb0ff;--btn:#1c1c1c;--track:#262626}
html{scroll-padding-top:env(safe-area-inset-top,0px)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13px;line-height:1.5}
main{max-width:520px;margin:0 auto;padding:32px 36px 64px}
h1{margin:0 0 28px;font-size:24px;font-weight:500;letter-spacing:-.01em}
h2{margin:0 0 20px;font-size:15px;font-weight:600}
button{font-family:inherit;color:inherit}
.pager{display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-bottom:10px;font-size:11px;color:var(--muted)}
.pager button{background:none;border:0;padding:4px;cursor:pointer;color:var(--muted);font-size:14px;line-height:1}
.banner{position:relative;height:146px;border-radius:12px;overflow:hidden;color:#fff;touch-action:pan-y}
.track{display:flex;height:100%;transition:transform .6s cubic-bezier(.65,0,.35,1)}
.ad{flex:0 0 100%;min-width:0;position:relative;padding:36px 24px 0}
.ad.a1{background:radial-gradient(circle at 74% 50%,#fff8e0 0 7px,#f3d58a 11px,rgba(243,213,138,.35) 26px,transparent 62px),radial-gradient(circle 1.5px at 12% 20%,#fff 98%,transparent),radial-gradient(circle 1px at 30% 80%,#fff 98%,transparent),radial-gradient(circle 1.5px at 52% 18%,#fff 98%,transparent),radial-gradient(circle 1px at 88% 24%,#fff 98%,transparent),radial-gradient(circle 2px at 84% 62%,#6fa8ff 98%,transparent),radial-gradient(circle 1.5px at 62% 78%,#ff9a4a 98%,transparent),linear-gradient(120deg,#05070f,#0b1020 60%,#0a0a14)}
.ad.a2{background:radial-gradient(circle at 88% 20%,rgba(255,255,255,.16) 0 40px,transparent 41px),linear-gradient(130deg,#0f6b34,#08331a)}
.ad.a3{background:radial-gradient(circle at 80% 90%,rgba(255,255,255,.14) 0 50px,transparent 51px),linear-gradient(130deg,#3b4bd6,#1b1f5e)}
.ad.a4{background:radial-gradient(circle at 90% 15%,rgba(255,255,255,.2) 0 36px,transparent 37px),linear-gradient(130deg,#d9822b,#7a3a0c)}
.ad .c{opacity:0;transform:translateY(8px);transition:opacity .5s .25s,transform .5s .25s}
.ad.on .c{opacity:1;transform:none}
.spons{position:absolute;top:12px;left:24px;font-size:9.5px;letter-spacing:.03em;padding:2px 8px;border-radius:99px;background:rgba(255,255,255,.18);color:rgba(255,255,255,.9)}
.banner h3{margin:0 0 4px;font-size:15px;font-weight:600}
.banner p{margin:0 0 14px;max-width:62%;font-size:11px;line-height:1.5;color:rgba(255,255,255,.78)}
.banner .try{background:#fff;color:#111;border:0;border-radius:6px;padding:6px 12px;font-size:11px;font-weight:500;cursor:pointer}
.banner .x{position:absolute;z-index:2;top:8px;right:8px;width:20px;height:20px;border-radius:50%;border:0;background:rgba(255,255,255,.18);color:#fff;font-size:12px;line-height:1;cursor:pointer}
.prog{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.15)}
.prog i{display:block;height:100%;background:rgba(255,255,255,.85);transform:scaleX(0);transform-origin:left;animation:pg 5s linear forwards}
.banner:hover .prog i,.banner:focus-within .prog i{animation-play-state:paused}
@keyframes pg{to{transform:scaleX(1)}}
.nav{display:flex;align-items:center;gap:10px}
.sa{margin-right:auto;background:none;border:0;padding:4px 0;font-size:11px;font-weight:500;color:var(--iconfg);cursor:pointer}
[hidden]{display:none!important}
@media (prefers-reduced-motion:reduce){.track,.ad .c{transition:none}.prog{display:none}}
.range{display:flex;justify-content:flex-end;margin:30px 0 14px}
.seg{display:flex;background:var(--pill);border-radius:8px;padding:3px}
.seg button{border:0;background:none;padding:4px 10px;border-radius:6px;font-size:11px;color:var(--muted);cursor:pointer}
.seg button.on{background:var(--pillon);color:var(--text);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--border);border-radius:12px;overflow:hidden}
.cell{padding:16px 14px 14px;border-right:1px solid var(--border);border-bottom:1px solid var(--border);min-height:110px}
.cell:nth-child(2n){border-right:0}
.cell:nth-last-child(-n+2){border-bottom:0}
.lbl{font-size:11px;color:var(--muted);display:flex;justify-content:space-between;align-items:center}
.val{margin:6px 0 10px;font-size:15px;font-weight:600}
.chart{display:block;width:100%;height:38px}
.spend .row{margin:14px 0 4px;display:flex;justify-content:space-between;font-size:11px}
.spend .row span:first-child{color:var(--muted)}
.meter{position:relative;height:12px;border-radius:2px;background:var(--track);margin-bottom:14px}
.meter i{position:absolute;top:2px;bottom:2px;width:2px;background:#6b6b6b;opacity:.7}
.meter i.g{background:#16a34a;opacity:1;left:3px}
.add{display:inline-flex;align-items:center;gap:6px;margin-top:8px;padding:6px 12px;border:1px solid var(--border);border-radius:6px;background:var(--btn);font-size:11px;font-weight:500;cursor:pointer}
.add svg,.info svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.info{color:var(--muted);display:inline-flex}
.upd{margin-top:46px}
.item{display:flex;gap:16px;margin-bottom:26px}
.ico{flex:none;width:30px;height:30px;border-radius:50%;background:var(--icon);display:grid;place-items:center}
.ico svg{width:15px;height:15px;stroke:var(--iconfg);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.item small{display:block;font-size:11px;color:var(--muted)}
.item b{display:block;font-size:11.5px;font-weight:600;margin:2px 0 3px}
.item p{margin:0;font-size:11.5px;color:var(--muted);line-height:1.55}
.rec{margin-top:40px}
.sub-h{margin:26px 0 14px;font-size:14px;font-weight:600}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.card{display:flex;flex-direction:column;min-height:120px;padding:16px;border:1px solid var(--border);border-radius:10px;color:inherit;text-decoration:none;background:var(--bg);transition:transform .25s}
.card:hover{transform:translateY(-2px)}
.card:focus-visible{outline:2px solid #2563c9;outline-offset:2px}
.ci{width:34px;height:34px;border-radius:8px;background:var(--pill);display:grid;place-items:center;margin-bottom:12px}
.ci svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.card b{font-size:12px;font-weight:600;line-height:1.4;margin-bottom:4px}
.card .d{font-size:11px;line-height:1.5;color:var(--muted)}
.card.dark{border-color:#05070f;color:#fff;background:radial-gradient(circle 1.5px at 20% 22%,#fff 98%,transparent),radial-gradient(circle 1px at 70% 15%,#fff 98%,transparent),radial-gradient(circle 2px at 86% 62%,#6fa8ff 98%,transparent),radial-gradient(circle 1.5px at 62% 82%,#ff9a4a 98%,transparent),linear-gradient(130deg,#05070f,#0b1020 60%,#0a0a14)}
.card.dark .d{color:rgba(255,255,255,.75)}
.card.dark .ci{background:rgba(255,255,255,.14)}
.integ{margin-top:46px}
.integ p{margin:0 0 14px;font-size:12px;line-height:1.6;color:var(--muted)}
.integ p code{background:var(--pill);color:var(--text);padding:1px 6px;border-radius:4px;font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.integ a{color:var(--iconfg)}
.code{background:#0f1117;border-radius:12px;overflow:hidden}
.code .bar{display:flex;justify-content:space-between;align-items:center;padding:8px 8px 8px 16px;border-bottom:1px solid rgba(255,255,255,.08);font-size:11px;color:#8b93a7}
.code .bar button{background:rgba(255,255,255,.08);border:0;border-radius:6px;padding:4px 10px;font-size:11px;color:#d6deeb;cursor:pointer}
.code pre{margin:0;padding:14px 16px 16px;overflow-x:auto;font:11.5px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#d6deeb}
.code .k{color:#7fdbca}.code .s{color:#ecc48d}.code .u{color:#82aaff}
button:focus-visible{outline:2px solid #2563c9;outline-offset:2px}
</style>
</head>
<body>
<main>
<h1>Home</h1>

<div class="pager"><button class="sa" id="sa" type="button" hidden>Show ads</button><span class="nav" id="nav"><span id="pg">1 of 4</span><button id="pp" aria-label="Previous ad">&lsaquo;</button><button id="pn" aria-label="Next ad">&rsaquo;</button></span></div>
<section class="banner" id="banner" aria-roledescription="carousel" aria-label="Sponsored ads">
<button class="x" id="bx" aria-label="Hide ads">&times;</button>
<div class="track" id="track">
<div class="ad a1 on"><span class="spons">Sponsored</span><div class="c"><h3>Introducing GPT-6.1 Sol &amp; Ultrafast</h3><p>GPT-6.1 Sol brings near-Astra performance to Sol pricing for cost-efficient API workloads&mdash;now with Ultrafast.</p><button class="try" type="button">Try GPT-6.1 Sol &amp; Ultrafast</button></div></div>
<div class="ad a2"><span class="spons">Sponsored</span><div class="c"><h3>Accept vouchers in one call</h3><p>Validate customer codes with a single API request. We stay the source of truth.</p><button class="try" type="button">Read the docs</button></div></div>
<div class="ad a3"><span class="spons">Sponsored</span><div class="c"><h3>Get paid faster</h3><p>Withdraw your wallet balance to your bank account in minutes.</p><button class="try" type="button">Withdraw now</button></div></div>
<div class="ad a4"><span class="spons">Ad</span><div class="c"><h3>Advertise on this dashboard</h3><p>Put your product in front of thousands of developers and businesses.</p><button class="try" type="button">Advertise with us</button></div></div>
</div>
<div class="prog"><i id="pi"></i></div>
</section>

<div class="range"><div class="seg" id="seg"><button>24h</button><button class="on">7d</button><button>14d</button><button>30d</button></div></div>

<div class="grid">
<div class="cell"><div class="lbl">Codes redeemed &rsaquo;</div><div class="val">1,682,492</div>
<svg class="chart" viewBox="0 0 200 40" preserveAspectRatio="none"><path d="M0 30C30 29 50 23 80 19S130 14 160 21 190 30 198 32" fill="none" stroke="#e8894a" stroke-width="1.6" vector-effect="non-scaling-stroke"/><path d="M0 28 198 31" fill="none" stroke="#d6336c" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg></div>

<div class="cell"><div class="lbl">Active API keys &rsaquo;</div><div class="val">994</div>
<svg class="chart" viewBox="0 0 200 40" preserveAspectRatio="none" fill="#6d5ae6"><rect x="0" y="22" width="20" height="18"/><rect x="26" y="8" width="22" height="32"/><rect x="54" y="4" width="22" height="36"/><rect x="82" y="36" width="22" height="4"/><rect x="110" y="10" width="22" height="30"/><rect x="138" y="6" width="22" height="34"/><rect x="166" y="22" width="22" height="18"/><rect x="192" y="38" width="8" height="2"/></svg></div>

<div class="cell"><div class="lbl">Prompt caching: Hit rate &rsaquo;<span class="info"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg></span></div><div class="val">27.1%</div>
<svg class="chart" viewBox="0 0 200 40" preserveAspectRatio="none"><path d="M0 34C25 20 40 14 60 24S95 34 120 28 160 12 186 10 196 12 198 12" fill="none" stroke="#7c6ae8" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg></div>

<div class="cell spend"><div class="lbl">Gross sales<span class="info"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.500 2 3.400 2.300-.9a7 7 0 0 0 2 1.200l.4 2.600h4l.4-2.600a7 7 0 0 0 2-1.200l2.300.9 2-3.400-2-1.500c.1-.4.1-.8.1-1.200z"/></svg></span></div>
<div class="row"><span>Personal</span><span>$0.02 / $2.00</span></div><div class="meter"><i class="g"></i><i style="left:50%"></i><i style="left:80%"></i></div>
<div class="row"><span>Default project</span><span>$0.02 / $2.00</span></div><div class="meter" style="margin-bottom:0"><i class="g"></i><i style="left:50%"></i><i style="left:80%"></i></div></div>

<div class="cell"><div class="lbl">Wallet balance</div><div class="val">$4.64</div>
<button class="add" type="button"><svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>Withdraw</button></div>

<div class="cell"><div class="lbl">Codes issued &rsaquo;</div><div class="val">994</div>
<svg class="chart" viewBox="0 0 200 40" preserveAspectRatio="none"><path d="M0 30C25 28 40 16 60 18S90 34 110 30 150 10 170 16 190 28 196 32" fill="none" stroke="#14b8a6" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg></div>
</div>

<section class="integ">
<h2>Integrate in one call</h2>
<p>Your backend calls <code>POST /api/vouchers/v1/validate</code> with an API key (see <a href="#">API Keys</a>) and a voucher code. We're the source of truth — you never store or trust a code as valid on your own.</p>
<div class="code"><div class="bar"><span>bash</span><button type="button" id="cp">Copy</button></div>
<pre><code id="cu"><span class="k">curl</span> -X POST <span class="u">https://api.akoro.name.ng/api/vouchers/v1/validate</span> \
  -H <span class="s">"Authorization: Bearer sk_live_..."</span> \
  -H <span class="s">"Content-Type: application/json"</span> \
  -d <span class="s">'{"voucher_code":"X9K7-MQPL-3R9T","customer_id":"cust_123"}'</span></code></pre></div>
</section>

<section class="upd">
<h2>Updates</h2>
<div class="item"><div class="ico"><svg viewBox="0 0 24 24"><path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/></svg></div><div><small>5 days ago</small><b>Decisions API</b><p>Turn text and images into decisions your application can use, 10x faster than the Responses API.</p></div></div>
<div class="item"><div class="ico"><svg viewBox="0 0 24 24"><path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/></svg></div><div><small>13 days ago</small><b>GPT-6.1 Sol</b><p>GPT-6.1 Sol brings near-Astra intelligence to Sol pricing for cost-efficient API workloads.</p></div></div>
<div class="item"><div class="ico"><svg viewBox="0 0 24 24"><path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/></svg></div><div><small>20 days ago</small><b>GPT-6 Astra, Sol, and Luna</b><p>Following the release of GPT Astra, meet GPT-6 Sol for complex coding and agentic workflows, and GPT-6 Luna for efficient, high-volume tasks.</p></div></div>
<div class="item"><div class="ico"><svg viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 7V3M9 12h.01M15 12h.01M9 16h6M2 12v3M22 12v3"/></svg></div><div><small>last month</small><b>Agents API</b><p>Build durable cloud agents with a managed Codex harness with the Agents API.</p></div></div>
<div class="item"><div class="ico"><svg viewBox="0 0 24 24"><path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/></svg></div><div><small>last month</small><b>GPT-Live</b><p>Build voice agents with GPT-Live, it handles a spoken conversation while a backend agent looks up information, uses tools, and completes tasks.</p></div></div>
<div class="item"><div class="ico"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.500"/><path d="m21 15-5-5L5 21"/></svg></div><div><small>last month</small><b>GPT Image 2.5</b><p>GPT-Image-2.5 Flare and GPT-Image-2.5 Sunburst launched in the API with faster generation and more precise editing.</p></div></div>
</section>

<section class="rec">
<h2>Recommended platforms and services</h2>
<h3 class="sub-h">Platforms</h3>
<div class="cards">
<a class="card dark" href="#"><span class="ci"><svg viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 7V3M9 12h.01M15 12h.01M9 16h6M2 12v3M22 12v3"/></svg></span><b>Agent</b><span class="d">Automate tasks and handle conversations with smart assistants.</span></a>
<a class="card" href="#"><span class="ci"><svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg></span><b>Business</b><span class="d">Tools to launch, manage and grow your business.</span></a>
<a class="card" href="#"><span class="ci"><svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg></span><b>Crowdfunding</b><span class="d">Raise capital from backers who believe in your idea.</span></a>
<a class="card" href="#"><span class="ci"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.900M16 3.100a4 4 0 0 1 0 7.800"/></svg></span><b>Co-working matching</b><span class="d">Find the right partners, talent and workspaces.</span></a>
</div>
<h3 class="sub-h" style="margin-top:34px">Services</h3>
<div class="cards">
<a class="card" href="#"><span class="ci"><svg viewBox="0 0 24 24"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.700c.6.500 1 1.300 1 2.300h6c0-1 .4-1.800 1-2.300A7 7 0 0 0 12 2z"/></svg></span><b>Product Development &amp; Innovation</b><span class="d">Turn ideas into market-ready products.</span></a>
<a class="card" href="#"><span class="ci"><svg viewBox="0 0 24 24"><path d="M23 6l-9.500 9.500-5-5L1 18M17 6h6v6"/></svg></span><b>Sales &amp; Marketing</b><span class="d">Reach customers and grow revenue.</span></a>
<a class="card" href="#"><span class="ci"><svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg></span><b>Professional Talent &amp; Co-working Pool</b><span class="d">Access vetted experts and shared workspaces.</span></a>
<a class="card" href="#"><span class="ci"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M15 9.500a3 3 0 0 0-3-1.500c-1.700 0-3 .9-3 2.200s1.300 2 3 2.300 3 .9 3 2.300-1.300 2.200-3 2.200a3 3 0 0 1-3-1.500"/></svg></span><b>Crowdfunding &amp; Startup Financing</b><span class="d">Funding routes for early-stage ventures.</span></a>
<a class="card" href="#"><span class="ci"><svg viewBox="0 0 24 24"><path d="M12 20V10M18 20V4M6 20v-4"/></svg></span><b>Business Growth &amp; Venture Support</b><span class="d">Guidance and resources to scale with confidence.</span></a>
</div>
</section>
</main>
<script>
(function(){
var seg=document.getElementById('seg').children;
for(var i=0;i<seg.length;i++)seg[i].onclick=function(){for(var k=0;k<seg.length;k++)seg[k].classList.remove('on');this.classList.add('on')};
var N=4,c=0,track=document.getElementById('track'),ads=track.children,pi=document.getElementById('pi'),ban=document.getElementById('banner');
function show(i){c=(i+N)%N;track.style.transform='translateX(-'+c*100+'%)';for(var k=0;k<N;k++){ads[k].classList.toggle('on',k===c);ads[k].setAttribute('aria-hidden',k!==c)}
document.getElementById('pg').textContent=(c+1)+' of '+N;pi.style.animation='none';void pi.offsetWidth;pi.style.animation=''}
pi.addEventListener('animationend',function(){show(c+1)});
document.getElementById('pn').onclick=function(){show(c+1)};
document.getElementById('pp').onclick=function(){show(c-1)};
var sx=null;ban.addEventListener('pointerdown',function(e){sx=e.clientX});
ban.addEventListener('pointerup',function(e){if(sx===null)return;var d=e.clientX-sx;sx=null;if(Math.abs(d)>40)show(c+(d<0?1:-1))});
document.getElementById('bx').onclick=function(){ban.style.display='none';document.getElementById('nav').hidden=true;document.getElementById('sa').hidden=false};
document.getElementById('sa').onclick=function(){ban.style.display='';document.getElementById('nav').hidden=false;this.hidden=true;show(0)};
show(0);
var cp=document.getElementById('cp');cp.onclick=function(){var t=document.getElementById('cu').textContent;function done(){cp.textContent='Copied';setTimeout(function(){cp.textContent='Copy'},1500)}
try{navigator.clipboard.writeText(t).then(done,fb)}catch(e){fb()}
function fb(){var a=document.createElement('textarea');a.value=t;a.style.position='fixed';a.style.opacity='0';document.body.appendChild(a);a.select();try{document.execCommand('copy');done()}catch(e){}document.body.removeChild(a)}};
})();
</script>
</body>
</html>
