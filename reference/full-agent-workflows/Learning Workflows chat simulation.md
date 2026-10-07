<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Akoro · Learning Workflows</title>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@500;700;800;900&display=swap" rel="stylesheet">
<style>
:root{--b:#6C3BFF;--b2:#4C1DCC;--g:#10B981;--y:#F59E0B;--r:#EF4444;--bd:#E5E7EB;--hv:#F3F4F6;--t:#111827;--s:#6B7280;--m:#9CA3AF}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--t);display:flex;flex-direction:column;height:100dvh;overflow:hidden;background:#fff}
.chips{display:flex;gap:5px;padding:8px 12px;overflow-x:auto;border-bottom:1px solid var(--hv);scrollbar-width:none;flex-shrink:0}
.chips::-webkit-scrollbar{display:none}
.chip{flex-shrink:0;padding:4px 10px;border-radius:20px;font:800 10.5px Nunito;cursor:pointer;white-space:nowrap;border:1px solid transparent}
.chip.sp{border-color:#6C3BFF30;background:#6C3BFF08;color:var(--b)}
.chip.tc{border-color:#10B98140;background:#10B98108;color:#047857}
.chip.pr{border-color:#F9731640;background:#F9731608;color:#C2410C}
.chip.alt{border-color:#F59E0B50;background:#F59E0B10;color:#B45309}
.chip.rs{border-color:var(--bd);background:#fff;color:var(--s)}
.wf-div{display:flex;align-items:center;gap:10px;margin:10px 0 5px;opacity:0;animation:fi .3s forwards}
.wf-div::before,.wf-div::after{content:'';flex:1;height:1px;background:var(--bd)}
.wf-lbl{font:900 9px Nunito;letter-spacing:.06em;text-transform:uppercase;color:var(--m);white-space:nowrap}
.wf-lbl.sp{color:var(--b)}.wf-lbl.tc{color:#047857}.wf-lbl.pr{color:#C2410C}
#m{flex:1;overflow-y:auto;padding:14px 14px 10px;display:flex;flex-direction:column;gap:2px}
.in{opacity:0;animation:fi .2s forwards}@keyframes fi{to{opacity:1}}
.user-row{display:flex;justify-content:flex-end;margin:7px 0 5px}
.user-bub{max-width:82%;padding:8px 13px;background:linear-gradient(135deg,var(--b),var(--b2));color:#fff;border-radius:16px 16px 4px 16px;font:600 13.5px/1.5 Nunito}
.user-bub.dark{background:linear-gradient(135deg,#374151,#1F2937)}
.act{padding:4px 0 8px;font:500 15.5px/1.65 -apple-system,sans-serif;color:var(--t);max-width:600px}
details.th-blk{margin:1px 0}
details.th-blk>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:5px 0;font:400 13.5px/1 -apple-system,sans-serif;color:var(--s);user-select:none}
details.th-blk>summary::-webkit-details-marker{display:none}
.th-ico{width:18px;height:18px;border-radius:50%;border:1.5px solid var(--m);display:flex;align-items:center;justify-content:center;font:700 9px ui-monospace;color:var(--m);flex-shrink:0}
.th-set{font:900 9px Nunito;letter-spacing:.04em;padding:2px 6px;border-radius:20px;flex-shrink:0;text-transform:uppercase}
.th-set.sp{background:#6C3BFF10;color:var(--b)}.th-set.tc{background:#10B98112;color:#047857}.th-set.pr{background:#F9731610;color:#C2410C}
.chev{margin-left:auto;font-size:16px;color:var(--m);transition:transform .15s}
details.th-blk[open] .chev,details.tl-blk[open] .chev{transform:rotate(90deg)}
.th-body{padding:8px 12px;margin:2px 0 5px 26px;background:#F9FAFB;border-left:2px solid var(--bd);border-radius:0 6px 6px 0;font:400 11.5px/1.85 ui-monospace,"SF Mono",monospace;color:var(--s);white-space:pre-wrap}
.th-ctx{display:block;font-weight:700;margin-bottom:5px;opacity:.85}
.th-ctx.sp{color:var(--b)}.th-ctx.tc{color:#047857}.th-ctx.pr{color:#C2410C}
details.tl-blk{margin:1px 0}
details.tl-blk>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:5px 0;font:400 13.5px/1 -apple-system,sans-serif;color:var(--s)}
details.tl-blk>summary::-webkit-details-marker{display:none}
.tl-ico{font:700 10px ui-monospace;color:var(--m);background:var(--hv);padding:2px 5px;border-radius:3px;border:1px solid var(--bd);flex-shrink:0}
.tok{color:var(--g);font-size:11px;font-weight:700}.tfail{color:var(--r);font-size:11px;font-weight:700}.tms{color:var(--m);font-size:11px}
.tl-rows{padding:4px 0 5px 26px;display:flex;flex-direction:column;gap:4px}
.tl-row{display:flex;gap:8px;align-items:flex-start;padding:6px 10px;background:#fff;border:1px solid var(--bd);border-radius:8px}
.pill{flex-shrink:0;font:900 9px Nunito;letter-spacing:.03em;padding:2px 7px;border-radius:20px;margin-top:3px;text-transform:capitalize}
.research{background:#3B82F615;color:#2563EB}.draft{background:#8B5CF615;color:#7C3AED}
.verification{background:#F59E0B18;color:#B45309}.action{background:#10B98115;color:#047857}
.reflection{background:#6C3BFF12;color:var(--b)}.synthesis{background:#EC489915;color:#BE185D}
.rb{flex:1;min-width:0}
.rb .hl{font:700 12px Nunito;color:var(--t);display:block;margin-bottom:2px}
.rb .desc{font:400 11.5px/1.5 -apple-system,sans-serif;color:var(--s);display:block}
.rb .rr{font:700 11px Nunito;margin-top:4px;display:block;color:var(--g)}.rb .rr.bad{color:var(--r)}
.who{flex-shrink:0;font:800 9px Nunito;color:var(--m);text-transform:uppercase;letter-spacing:.04em;margin-top:3px;align-self:flex-start}
.who.sys{color:#B45309}
@keyframes pp{50%{opacity:.2}}
.card{border:1px solid var(--bd);border-radius:14px;background:#fff;overflow:hidden;margin:5px 0}
.t-card{border-color:#6C3BFF30;background:#6C3BFF02}
.pr-card{border-color:#F9731630;background:#F9731602}
.ch{padding:9px 13px;border-bottom:1px solid var(--hv);display:flex;justify-content:space-between;align-items:center}
.ct{font:900 10.5px Nunito;color:var(--s);letter-spacing:.03em}.cs{font:900 13.5px Nunito}
.ct.tc{color:#047857}.ct.pr{color:#C2410C}
.tr2{display:flex;align-items:center;gap:9px;padding:6px 13px;border-bottom:1px solid var(--hv)}.tr2:last-of-type{border:0}
.dot{width:15px;height:15px;border-radius:50%;border:2px solid var(--bd);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff}
.tr2.active .dot{border-color:var(--b);background:#6C3BFF12;animation:pp 1.2s infinite}
.tr2.awaiting .dot{border-color:var(--y);background:#FEF3C720;animation:pp 1s infinite}
.tr2.done .dot{background:var(--g);border-color:var(--g)}.tr2.def .dot{background:var(--hv);border-color:var(--m);color:var(--m)}
.tl{flex:1;font:700 12.5px Nunito;color:var(--m)}.tr2.active .tl,.tr2.done .tl,.tr2.awaiting .tl{color:var(--t)}
.tg{font:800 10px Nunito;padding:2px 7px;border-radius:20px;background:var(--hv);color:var(--s)}
.tr2.done .tg{background:#10B98114;color:#047857}.tr2.awaiting .tg{background:#FEF3C7;color:#B45309}
.tr2.def .tg{background:#FEF3C7;color:#B45309}.tg.w{background:#F59E0B14;color:#B45309}
.cf{padding:8px 13px;border-top:1px solid var(--hv);font:700 11.5px Nunito;color:var(--s);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.cf b{color:var(--t)}.warn{padding:8px 13px;background:#FEF3C7;color:#92400E;font:700 11.5px/1.4 Nunito}
.btn{padding:7px 14px;border-radius:20px;border:0;background:linear-gradient(135deg,var(--b),var(--b2));color:#fff;font:900 12px Nunito;cursor:pointer}
.btn.o{background:none;border:1.5px solid var(--b);color:var(--b)}.btn.g{background:none;border:1px solid var(--bd);color:var(--s);font-weight:700}
.btn.teal{background:linear-gradient(135deg,#059669,#047857)}.btn.orange{background:linear-gradient(135deg,#EA580C,#C2410C)}
.btn:disabled{opacity:.45;cursor:default}
.wf-states{display:flex;border-bottom:1px solid var(--hv)}
.wf-state{flex:1;padding:5px 3px;text-align:center;font:800 8.5px Nunito;letter-spacing:.02em;text-transform:uppercase;color:var(--m);border-right:1px solid var(--hv);transition:all .3s}
.wf-state:last-child{border-right:0}
.wf-state.wf-done{background:#10B98108;color:#047857}
.wf-state.wf-cur{background:#6C3BFF10;color:var(--b);animation:pp 1.2s infinite}
.sc-r{display:flex;gap:10px;align-items:center;border:1px solid var(--bd);border-radius:13px;padding:8px 12px;margin:4px 0}
.ring{width:34px;height:34px;border-radius:50%;border:3px solid var(--bd);display:flex;align-items:center;justify-content:center;font:900 10.5px Nunito;flex-shrink:0}
.ring.p{border-color:var(--g);color:var(--g)}.ring.f{border-color:var(--y);color:#B45309}
.sct{font:700 12.5px/1.4 Nunito;color:var(--s)}.sct small{color:var(--m)}
.fl{padding:9px 13px;font:700 12.5px/1.6 Nunito}.fl div{border-bottom:1px solid var(--hv);padding:3px 0}.fl div:last-child{border:0}
.ib{padding:8px 14px 11px;border-top:1px solid var(--hv);flex-shrink:0}
.is{display:flex;gap:8px;background:var(--hv);border:1.5px solid var(--bd);border-radius:50px;padding:5px 7px}
.is input{flex:1;border:0;background:none;outline:0;font:600 13.5px Nunito;padding-left:6px}
.sb{width:34px;height:34px;border-radius:50%;border:0;background:var(--bd);color:#fff;cursor:pointer;font-size:15px}
.sb.on{background:linear-gradient(135deg,var(--b),var(--b2))}
</style>
</head>
<body>
<div class="chips">
  <button class="chip sp" data-k="full">Study Prep</button>
  <button class="chip tc" data-k="teaching">Teaching</button>
  <button class="chip pr" data-k="practice">Practice</button>
  <button class="chip alt" data-k="reject">Plan rejected</button>
  <button class="chip alt" data-k="budget">Budget ceiling</button>
  <button class="chip alt" data-k="cap">Attempt cap</button>
  <button class="chip rs" id="reset">Reset</button>
</div>
<div id="m"></div>
<div class="ib"><div class="is"><input id="inp" placeholder="Ask your study agent…"><button class="sb" id="go">➤</button></div></div>
<script>
const $=s=>document.querySelector(s), M=$('#m');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const TOPICS={wc:['Water Cycle',42],ph:['Photosynthesis',61],hb:['Human Body',82],ma:['Matter',71],en:['Energy',55],fm:['Force & Motion',76]};
let S, busy=false;
function sc(){M.scrollTop=M.scrollHeight}

function reset(){
  S={wallet:25,spent:0,ceiling:25,wakes:0,sessionCard:null,teachCard:null};
  M.innerHTML=''; busy=false;
  act("Pick a workflow to see it in action. Study Prep shows all four workflows together.");
}

function user(t, dark){
  const r=document.createElement('div'); r.className='user-row in';
  r.innerHTML='<div class="user-bub'+(dark?' dark':'')+'"></div>';
  r.querySelector('.user-bub').textContent=t;
  M.appendChild(r); sc();
}

function act(t){
  const el=document.createElement('div'); el.className='act in';
  el.textContent=t; M.appendChild(el); sc();
}

function wfDiv(label, type){
  const el=document.createElement('div'); el.className='wf-div in';
  el.innerHTML='<span class="wf-lbl '+(type||'sp')+'">'+label+'</span>';
  M.appendChild(el); sc();
}

async function think(seconds, text, setName, wf){
  wf = wf||'sp';
  const d=document.createElement('details'); d.className='th-blk in'; d.open=true;
  const s=document.createElement('summary');
  const ico=document.createElement('span'); ico.className='th-ico'; ico.textContent='⚙';
  const lbl=document.createElement('span'); lbl.textContent='Thought for '+seconds+' second'+(seconds!==1?'s':'');
  const pill=document.createElement('span'); pill.className='th-set '+wf; pill.textContent=setName;
  const chev=document.createElement('span'); chev.className='chev'; chev.textContent='›';
  s.append(ico,lbl,pill,chev);
  const b=document.createElement('div'); b.className='th-body';
  const ctx=document.createElement('span'); ctx.className='th-ctx '+wf; ctx.textContent='context: '+setName;
  b.appendChild(ctx); b.appendChild(document.createTextNode(text));
  d.append(s,b); M.appendChild(d); sc();
  await sleep(seconds*110+200); d.open=false;
}

function addRow(container, arr){
  const type=arr[0],hl=arr[1],desc=arr[2],result=arr[3],who=arr[4],bad=arr[5];
  const row=document.createElement('div'); row.className='tl-row';
  const wc=(who==='system')?'sys':'';
  row.innerHTML='<span class="pill '+type+'">'+type+'</span>'
    +'<div class="rb"><span class="hl"></span>'+(desc?'<span class="desc"></span>':'')+(result?'<span class="rr'+(bad?' bad':'')+'"></span>':'')+'</div>'
    +'<span class="who '+wc+'">'+(who||'agent')+'</span>';
  row.querySelector('.hl').textContent=hl;
  if(desc) row.querySelector('.desc').textContent=desc;
  if(result) row.querySelector('.rr').textContent=result;
  container.appendChild(row); sc();
}

async function toolGroup(label, rows){
  const d=document.createElement('details'); d.className='tl-blk in'; d.open=true;
  const s=document.createElement('summary');
  s.innerHTML='<span class="tl-ico">&gt;_</span><span>'+(label||'Ran commands '+rows.length)+'</span><span class="chev">›</span>';
  const c=document.createElement('div'); c.className='tl-rows';
  d.append(s,c); M.appendChild(d); sc();
  for(const row of rows){ await sleep(330); addRow(c,row); }
  await sleep(250); d.open=false;
}

async function toolSingle(label, ms, rows, ok){
  if(ok===undefined) ok=true;
  const d=document.createElement('details'); d.className='tl-blk in'; d.open=true;
  const s=document.createElement('summary');
  s.innerHTML='<span class="tl-ico">&gt;_</span><span>'+label+'</span>'
    +'<span class="'+(ok?'tok':'tfail')+'">'+(ok?' ✓':' ✕')+'</span>'
    +'<span class="tms"> '+ms+'ms</span><span class="chev">›</span>';
  const c=document.createElement('div'); c.className='tl-rows';
  d.append(s,c); M.appendChild(d); sc();
  if(rows){ for(const row of rows){ await sleep(290); addRow(c,row); } }
  await sleep(230); d.open=false;
}

function scoreRing(label, correct, total){
  const p=correct/total>=.7;
  const e=document.createElement('div'); e.className='sc-r in';
  e.innerHTML='<div class="ring '+(p?'p':'f')+'">'+correct+'/'+total+'</div><div class="sct"></div>';
  e.querySelector('.sct').innerHTML=label+'<br><small>'+Math.round(correct/total*100)+'% · '+(p?'above':'below')+' the 70% pass mark</small>';
  M.appendChild(e); sc();
}

function planCard(o){
  return new Promise(res=>{
    const e=document.createElement('div'); e.className='card in';
    e.innerHTML='<div class="ch"><div><div class="ct">STUDY PLAN</div><div class="cs">Basic Science · JSS1</div></div></div>';
    o.order.forEach((k,i)=>{
      const[l,m]=TOPICS[k], r=document.createElement('div'); r.className='tr2';
      r.innerHTML='<div class="dot" style="background:'+(m<70?'var(--y)':'var(--g)')+';border-color:transparent;width:8px;height:8px"></div>'
        +'<div class="tl" style="color:var(--t)">'+(i+1)+'. '+l+'</div>'
        +'<div class="tg '+(m<70?'w':'')+'">'+m+'%</div>';
      e.appendChild(r);
    });
    if(o.warn){const w=document.createElement('div'); w.className='warn'; w.textContent=o.warn; e.appendChild(w);}
    const f=document.createElement('div'); f.className='cf';
    f.innerHTML='Estimate <b>'+o.est+'</b> · Limit <b>'+o.ceil+'</b> coins · Wallet <b>'+S.wallet+'</b><span style="flex:1"></span>';
    const a=document.createElement('button'); a.className='btn'; a.textContent='Approve & start';
    const n=document.createElement('button'); n.className='btn g'; n.textContent='Adjust';
    f.append(n,a); e.appendChild(f); M.appendChild(e); sc();
    a.onclick=()=>{ a.disabled=n.disabled=true; a.textContent='Approved ✓'; S.ceiling=o.ceil; res(); };
  });
}

function sessionCard(order){
  const e=document.createElement('div'); e.className='card in';
  e.innerHTML='<div class="ch"><div class="ct">STUDY PREP · BASIC SCIENCE</div><div class="ct" id="sp-count" style="color:var(--b)"></div></div>';
  order.forEach(k=>{
    const r=document.createElement('div'); r.className='tr2'; r.dataset.k=k;
    r.innerHTML='<div class="dot"></div><div class="tl">'+TOPICS[k][0]+'</div><div class="tg" style="display:none"></div>';
    e.appendChild(r);
  });
  const f=document.createElement('div'); f.className='cf'; f.id='sp-foot'; e.appendChild(f);
  S.sessionCard=e; M.appendChild(e); sc(); updateFoot();
}

function updateFoot(){
  if(!S.sessionCard) return;
  const rs=[...S.sessionCard.querySelectorAll('.tr2')];
  const done=rs.filter(r=>/done/.test(r.className)).length;
  S.sessionCard.querySelector('#sp-count').textContent=done+' / '+rs.length;
  S.sessionCard.querySelector('#sp-foot').innerHTML='Spent <b>'+S.spent+'</b> / limit <b>'+S.ceiling+'</b> · wallet <b>'+S.wallet+'</b> · wakes <b>'+S.wakes+'</b>';
}

function setTopicState(k, state, tag){
  if(!S.sessionCard) return;
  const r=S.sessionCard.querySelector('[data-k="'+k+'"]');
  if(!r) return;
  r.className='tr2 '+state;
  const d=r.querySelector('.dot'), g=r.querySelector('.tg');
  const icons={done:'✓',def:'…',awaiting:'⏳',gap:'!'};
  d.textContent=icons[state]||'';
  d.style.fontSize=(state==='awaiting')?'8px':'';
  g.style.display=tag?'':'none'; g.textContent=tag||'';
  updateFoot(); sc();
}

const charge=n=>{ S.wallet-=n; S.spent+=n; updateFoot(); };
const wake=()=>{ S.wakes++; updateFoot(); };

function gateBtn(label, cls){
  return new Promise(res=>{
    const b=document.createElement('button');
    b.className='btn o in'+(cls?' '+cls:'');
    b.textContent=label; b.style.margin='5px 0';
    M.appendChild(b); sc();
    b.onclick=()=>{ b.disabled=true; res(); };
  });
}

function teachingCard(topic, source){
  return new Promise(res=>{
    const e=document.createElement('div'); e.className='card t-card in';
    const stateNames=['Preparing','Ready','Teaching','Evidence','Assessing'];
    const statesHTML=stateNames.map((n,i)=>'<div class="wf-state'+(i===0?' wf-cur':'')+'">'+n+'</div>').join('');
    e.innerHTML='<div class="ch"><div><div class="ct tc">TEACHING WORKFLOW · TS001</div><div class="cs">'+topic+'</div></div></div>'
      +'<div class="wf-states" id="ts-bar">'+statesHTML+'</div>'
      +(source?'<div style="padding:7px 13px;font:700 11.5px Nunito;color:var(--s)">Created from: '+source+'</div>':'')
      +'<div class="cf"><span style="flex:1"></span></div>';
    const f=e.querySelector('.cf');
    const a=document.createElement('button'); a.className='btn teal'; a.textContent='Continue Teaching';
    f.appendChild(a); S.teachCard=e; M.appendChild(e); sc();
    a.onclick=()=>{ a.disabled=true; a.textContent='In progress…'; res(); };
  });
}

function advanceTeachState(idx){
  if(!S.teachCard) return;
  const states=[...S.teachCard.querySelectorAll('.wf-state')];
  states.forEach((s,i)=>{ s.className='wf-state'+(i<idx?' wf-done':i===idx?' wf-cur':''); });
}

function teachOutcomeCard(topic, lines){
  const e=document.createElement('div'); e.className='card t-card in';
  e.innerHTML='<div class="ch"><div><div class="ct tc">TEACHING OUTCOME · TS001</div><div class="cs">'+topic+'</div></div></div><div class="fl"></div>';
  lines.forEach(l=>{ const d=document.createElement('div'); d.textContent=l; e.querySelector('.fl').appendChild(d); });
  M.appendChild(e); sc();
}

function practiceOutcomeCard(topic, lines){
  const e=document.createElement('div'); e.className='card pr-card in';
  e.innerHTML='<div class="ch"><div><div class="ct pr">PRACTICE OUTCOME · PW001</div><div class="cs">'+topic+'</div></div></div><div class="fl"></div>';
  lines.forEach(l=>{ const d=document.createElement('div'); d.textContent=l; e.querySelector('.fl').appendChild(d); });
  M.appendChild(e); sc();
}

function summaryCard(lines){
  const e=document.createElement('div'); e.className='card in';
  e.innerHTML='<div class="ch"><div class="cs">Session summary</div></div><div class="fl"></div>';
  lines.forEach(l=>{ const d=document.createElement('div'); d.textContent=l; e.querySelector('.fl').appendChild(d); });
  M.appendChild(e); sc();
}

async function startRun(k, kind){
  await toolSingle((kind==='diagnostic'?'Starting diagnostic for':kind==='retest'?'Running retest for':'Deferred retry for')+' '+TOPICS[k][0], 140, null);
  charge(2);
}

const R1=['research','Checking the Basic Science syllabus','Scanning all topics covered in JSS1 Basic Science this term','✓ 6 topics found'];
const R2=['research','Reviewing where Ada stands right now','Checking mastery levels across all 6 topics','✓ 3 topics below the 70% pass mark'];
const R3=['research','Looking at previous mistakes and patterns','Reading Ada\'s attempt history to spot recurring gaps','✓ Evaporation vs transpiration · potential vs kinetic · cell types'];
const R4=['research','Mapping how topics depend on each other','Checking which topics need to come first','✓ Water Cycle before Photosynthesis · Matter before Energy'];
const CONFIRM=['action','Plan confirmed by Ada','Locking in the approved plan and setting the coin limit','✓ Plan locked · session is live','system'];
const ORDER=['wc','ph','ma','en','fm','hb'];

const SCEN = {

async full(){
  wfDiv('Study Prep Workflow · SP001','sp');
  await think(2,"I'm checking the syllabus, prerequisite order, and Ada's current progress before building the plan.",'research','sp');
  await toolGroup('Ran commands 4',[R1,R2,R3,R4]);
  await think(7,'Ada is weakest on Water Cycle (42%), Energy (55%), Photosynthesis (61%).\nWater Cycle → Photosynthesis dependency. Matter → Energy dependency.\nOrder: WC → Ph → Ma → En → F&M → HB. Estimate ~18 coins.','planning','sp');
  await toolSingle('Drafting the study plan',375,[
    ['draft','Building an ordered study plan','Weakest topics first, prerequisites respected','Plan ready'],
    ['verification',"Checked the plan against the syllabus, prerequisite order and coin balance — everything lines up",'','✓ 18 coins estimated · fits current limit','system']
  ]);
  wake();
  act("I've built the plan. Water Cycle first — your weakest topic at 42%, and it unlocks Photosynthesis. Estimated 18 coins.");
  await planCard({order:ORDER, est:18, ceil:25});
  await toolGroup('Ran commands 1',[CONFIRM]);
  sessionCard(ORDER);

  // Water Cycle diagnostic
  setTopicState('wc','active');
  await think(1,'Starting a short diagnostic to see what Ada already knows about Water Cycle before deciding what to teach.','teaching','sp');
  await startRun('wc','diagnostic');
  scoreRing('Water Cycle · diagnostic',3,5);
  await toolGroup('Ran commands 1',[['reflection',"Scored 3 of 5 (60%) — below the 70% pass mark",'Recording to Ada\'s history','✓ below threshold · evidence recorded','system']]);
  wake();
  await think(3,"Ada's result shows a gap — evaporation and transpiration confused in 2 earlier sessions. A teach-back is the most appropriate next intervention.\nUnder the 4-workflow architecture this creates an independent Teaching Workflow, not an inline modal.",'strategies','sp');
  await toolSingle('Creating a teaching session',215,[
    ['action','Opening a dedicated teaching workflow for Water Cycle','Ada needs to explain evaporation and transpiration — teaching it herself resolves the confusion','✓ Teaching Workflow TS001 created · topic set to awaiting teaching','system']
  ]);
  setTopicState('wc','awaiting','awaiting teaching');
  act("I've created a teaching session for Water Cycle. You can continue it from your dashboard.");
  await teachingCard('Water Cycle','Basic Science Study Prep · SP001');

  // Teaching Workflow
  wfDiv('Teaching Workflow · TS001  (created by SP001)','tc');
  advanceTeachState(0); // Preparing
  await think(2,"Loading Water Cycle prior evidence for Ada.\nHistory: evaporation/transpiration confused in sessions 2 and 3.\nI'll ask her to explain both, then probe the specific distinction.",'teaching','tc');
  await toolGroup('Ran commands 2',[
    ['research','Loading Water Cycle learning evidence','Checking prior attempt history and misconception notes','✓ 2 sessions with evaporation/transpiration confusion noted'],
    ['research','Loading teaching context','Preparing to evaluate explanation quality against the evidence model','✓ Teaching context ready']
  ]);
  advanceTeachState(2); // Teaching Active
  act("Let's work on the Water Cycle together. In your own words — what is evaporation, and how is it different from transpiration?");
  await sleep(600);
  user("Evaporation is when water becomes vapour because of heat from the sun. Transpiration is... when plants sweat? They release water somehow.",true);
  await think(3,'Evaporation: correct — heat-driven phase change from a water surface.\nTranspiration: "plants sweat" shows correct intuition but the mechanism is vague. She knows plants release water but hasn\'t named stomata.\nProbe: where does the water leave the plant?','reflection','tc');
  act("Good on evaporation. For transpiration — which part of the plant releases the water, and how does it leave?");
  await sleep(500);
  user("Through tiny holes in the leaves called stomata. The plant takes in water from the roots and some comes out through the leaves.",true);
  advanceTeachState(3); // Evidence Capture
  await think(2,'Strong. Stomata named correctly. Mechanism correct.\nEvaporation: abiotic, solar heat, water surface.\nTranspiration: biotic, stomata, plant leaves.\nEvidence is sufficient. Moving to assessment.','reflection','tc');
  advanceTeachState(4); // Assessing
  await toolSingle('Evaluating teaching evidence',185,[
    ['reflection','Evaluating what was demonstrated','Checking both concepts were explained with correct mechanism','✓ Both concepts demonstrated'],
    ['action',"Recording teaching evidence to Ada's learner model",'Writing evidence of evaporation and transpiration understanding','✓ Evidence recorded · outcome: demonstrated · recommended next: retest','system']
  ]);
  act("Both clear — evaporation from water surfaces driven by solar heat, transpiration through stomata in plant leaves. Sending this back to your study session now.");
  teachOutcomeCard('Water Cycle',[
    '✓ Evaporation: heat-driven phase change from water surfaces',
    '✓ Transpiration: water released through stomata in plant leaves',
    'Strategy: teach-back · turns: 2',
    'Recommended next: retest'
  ]);

  // Study Prep resumes
  wfDiv('Study Prep Workflow · SP001 resumed','sp');
  await think(1,"Ada confirmed the teach-back for Water Cycle. A fresh retest is unlocked — same standard, new questions.",'reflection','sp');
  await toolGroup('Ran commands 1',[['action','Teaching outcome received from TS001','Water Cycle topic unblocked — generating fresh retest','✓ Topic: retest_ready · 2 coins charged','system']]);
  charge(2); setTopicState('wc','active');
  act("You confirmed the teach-back for Water Cycle. A fresh retest is ready — same standard, new questions.");
  await startRun('wc','retest');
  scoreRing('Water Cycle · retest',5,5); setTopicState('wc','done','understood');
  await toolGroup('Ran commands 1',[['reflection','Water Cycle passed (100%) — advancing','Moving to Photosynthesis','✓ Advanced · 2 coins charged','system']]);

  // Fast path
  charge(2); setTopicState('ph','active');
  scoreRing('Photosynthesis · diagnostic',4,5); setTopicState('ph','done','understood');
  charge(2); setTopicState('ma','active');
  scoreRing('Matter · diagnostic',4,5); setTopicState('ma','done','understood');

  // Energy — different strategy
  charge(2); setTopicState('en','active');
  scoreRing('Energy · diagnostic',2,5); wake();
  await think(2,"Scored 2/5 (40%) on Energy. Checking history before selecting a strategy.",'reflection','sp');
  await toolGroup('Ran commands 2',[
    ['research',"Checking Ada's history with Energy",'Looking for the root cause of the potential/kinetic confusion','✓ Same confusion in 2 earlier sessions'],
    ['research','Finding a better explanation approach','Searching approved material for a clearer angle','✓ 2 relevant passages found']
  ]);
  await think(2,"The previous explanation didn't resolve the confusion, so I'm trying a different approach — a concrete physical analogy.",'strategies','sp');
  act("The previous explanation didn't resolve the confusion, so I'm trying a different approach. Think of kinetic energy as a ball rolling, and potential energy as that same ball held at the top of a ramp — all the action is stored, waiting. Ready for a fresh set?");
  await gateBtn('Ready for retest');
  charge(2); setTopicState('en','active');
  scoreRing('Energy · retest',4,5); setTopicState('en','done','understood');
  charge(2); setTopicState('fm','active');
  scoreRing('Force & Motion · diagnostic',5,5); setTopicState('fm','done','understood');
  charge(2); setTopicState('hb','active');
  scoreRing('Human Body · diagnostic',5,5); setTopicState('hb','done','understood');
  wake();
  await think(2,"All six topics have been worked through. I'm compiling the summary from the recorded results.",'reflection','sp');
  await toolSingle('Completing the session',115,[
    ['synthesis','All six topics have been worked through','Compiling summary from recorded evidence only','✓ Session complete'],
    ['verification','Confirming final results','Cross-checking outcomes, coins, and evidence','✓ 6 topics understood · '+S.spent+' coins spent','system']
  ]);
  act("All six topics have been worked through. Water Cycle needed a teaching session, Energy needed a different approach — both resolved.");
  summaryCard([
    'Demonstrated on generated practice: 6 of 6 topics',
    'Water Cycle: Teaching Workflow TS001 (teach-back) · 2 turns',
    'Energy: different analogy strategy (potential vs kinetic)',
    'Workflows used: SP001 (Study Prep) · TS001 (Teaching)',
    'Coins spent: '+S.spent+' of 18 estimated · wakes: '+S.wakes,
    'This was generated practice, not a past paper.'
  ]);
},

async teaching(){
  wfDiv('Teaching Workflow · TS002 (direct — Dashboard)','tc');
  user("I want to teach my agent about Photosynthesis.");
  await sleep(400);
  await think(2,"Direct teaching session — no Study Prep parent.\nAda's Photosynthesis mastery is 61%. Notes: understands inputs/outputs but unclear on chlorophyll's causal role.\nI'll let her explain what she knows, then probe the specific gap.",'teaching','tc');
  await toolGroup('Ran commands 3',[
    ['research','Loading Photosynthesis learning evidence','Checking mastery and misconception notes','✓ 61% mastery · confusion on chlorophyll\'s role noted'],
    ['research','Checking related concept state','Reviewing chloroplasts and energy transfer connections','✓ Chloroplasts: intermediate · Energy transfer: weak'],
    ['research','Loading teaching context','Preparing to evaluate explanation quality','✓ Teaching context ready']
  ]);
  act("Let's start with what you already know about Photosynthesis. What goes in, what comes out, and what drives it?");
  await sleep(600);
  user("Plants take in CO2 from the air and water from the roots. Sunlight gives them energy to make glucose and oxygen.",true);
  await think(3,'Inputs, outputs, and energy source all correct.\nWeakness: she hasn\'t mentioned chlorophyll or where the energy capture happens. That\'s the noted gap. Probe the mechanism.','reflection','tc');
  act("Solid — you have the inputs, outputs, and energy source. What inside the plant actually captures that sunlight?");
  await sleep(500);
  user("Is it the green stuff — chlorophyll? I know it makes plants green but I'm not sure exactly what it does with the light.",true);
  await think(2,'She knows chlorophyll by name and that it\'s connected to light, but can\'t articulate the causal role.\nGuide her: chlorophyll → absorbs sunlight → powers the chemical conversion. One step away.','reflection','tc');
  act("Exactly — chlorophyll. It's a pigment that absorbs sunlight. Can you say what it does with that absorbed energy?");
  await sleep(500);
  user("Oh! The chlorophyll captures the light energy and uses it to power the reaction that converts CO2 and water into glucose? Like it's what runs the whole thing.",true);
  await think(2,'Complete. Full causal chain articulated.\nInputs → chlorophyll captures sunlight → energy powers conversion → glucose + oxygen outputs.\nObjective met. Recording evidence.','reflection','tc');
  await toolSingle('Evaluating teaching evidence',195,[
    ['reflection','Evaluating the full explanation','Inputs, outputs, energy capture, and mechanism all demonstrated','✓ Complete explanation demonstrated'],
    ['action',"Recording teaching evidence to Ada's learner model",'Writing photosynthesis understanding including chlorophyll\'s causal role','✓ Evidence recorded · outcome: demonstrated','system']
  ]);
  act("That's the full picture — chlorophyll absorbs sunlight, that energy powers the conversion of CO2 and water into glucose and oxygen.");
  teachOutcomeCard('Photosynthesis',[
    '✓ Inputs: CO2 (air) + water (roots)',
    '✓ Outputs: glucose + oxygen',
    '✓ Energy source: sunlight absorbed by chlorophyll',
    '✓ Mechanism: chlorophyll powers the chemical conversion',
    'Strategy: guided explanation · turns: 3 · entry: direct dashboard',
    'Evidence written directly to learner model — no parent workflow'
  ]);
  act("Teaching session complete. Photosynthesis evidence has been recorded. Your study agent will see this when it next checks your mastery.");
},

async practice(){
  wfDiv('Practice Workflow · PW001 (standalone)','pr');
  user("I want to practice Energy questions.");
  await sleep(400);
  await think(2,"Standalone Practice Workflow — no Study Prep parent.\nAda's Energy mastery is 55% with recurring potential/kinetic confusion. Selecting questions that target that specific gap.",'research','pr');
  await toolGroup('Ran commands 2',[
    ['research',"Checking Ada's Energy learning state",'Loading mastery level and recent attempt history for Energy','✓ 55% mastery · potential/kinetic confusion in 2 recent attempts'],
    ['research','Selecting question strategy','Using the adaptive engine to target the specific gap rather than sampling broadly','✓ Target: potential vs kinetic distinction · 5 questions selected']
  ]);
  await think(2,'Questions ready. Selecting from the approved question bank with a bias toward potential vs kinetic energy scenarios — the documented gap area.','assessment','pr');
  await toolSingle('Generating adaptive practice set',160,[
    ['action','Generating a fresh adaptive practice set','5 questions focused on the area Ada keeps getting wrong — answer key stays server-side','✓ 5 questions generated · adaptive selection','system']
  ]);
  act("Here's a set of 5 questions focused on potential and kinetic energy — the area your history shows needs the most work.");
  const pc=document.createElement('div'); pc.className='card pr-card in';
  pc.innerHTML='<div class="ch"><div><div class="ct pr">PRACTICE WORKFLOW · PW001</div><div class="cs">Energy</div></div></div>'
    +'<div style="padding:9px 13px;font:700 12px/1.7 Nunito;color:var(--s)">5 questions generated · adaptive selection based on known gaps<br><span style="color:var(--m);font-weight:500">Answers submitted automatically in this simulation</span></div>';
  M.appendChild(pc); sc();
  await sleep(700);
  scoreRing('Energy Practice · PW001',4,5);
  await think(2,'4/5 (80%) — above the pass mark. Recording evidence to Ada\'s learner model. This improves her Energy mastery estimate.','reflection','pr');
  await toolGroup('Ran commands 2',[
    ['reflection','Scoring the practice attempt','Education Engine evaluated 5 answers against the server-held key','✓ 4 of 5 correct (80%) · above 70% pass mark'],
    ['action',"Recording evidence to Ada's learner model",'Updating Energy concept state with this practice result','✓ Evidence recorded · mastery estimate updated','system']
  ]);
  act("4/5 — solid improvement on potential vs kinetic energy. This result has been recorded to your learning history.");
  practiceOutcomeCard('Energy',[
    '✓ Score: 4 of 5 (80%) · above 70% pass mark',
    '✓ Focused on potential vs kinetic energy distinction',
    "✓ Evidence recorded to Ada's learner model",
    'Strategy: adaptive gap targeting · entry: direct dashboard',
    'No parent workflow — standalone practice session',
    'Study Prep and future planning steps will see this result'
  ]);
},

async reject(){
  wfDiv('Study Prep Workflow · SP002','sp');
  await think(2,"I'm checking the syllabus, prerequisite order, and Ada's current progress before building the plan.",'research','sp');
  await toolGroup('Ran commands 3',[R1,R2,R4]);
  await think(5,'Ordering by mastery: Water Cycle → Energy → Photosynthesis...\nDependency check: Matter must come before Energy — my current order violates that.\nRevising and resubmitting.','planning','sp');
  await toolSingle('Drafting the study plan',285,[
    ['draft','Building an ordered study plan','Lowest mastery first','Plan ready'],
    ['verification','Checked the plan against the syllabus and prerequisite order','✕ Energy must come after Matter (dependency violation)','','system',true]
  ],false);
  await think(2,'The dependency check caught an ordering problem. Correcting it before showing the plan.','planning','sp');
  await toolSingle('Revising the study plan',310,[
    ['draft','Fixing the topic ordering — Matter before Energy','Correcting the prerequisite violation','Revised plan ready'],
    ['verification',"Checked the revised plan — everything lines up",'','✓ 18 coins · limit 25','system']
  ]);
  wake();
  act("The dependency check caught an ordering problem. I've corrected it — Matter now comes before Energy. Here's the updated plan:");
  await planCard({order:ORDER, est:18, ceil:25});
  act("The session continues from here as in the full Study Prep scenario.");
},

async budget(){
  S.wallet=12; S.ceiling=12;
  wfDiv('Study Prep Workflow · SP003','sp');
  await think(2,"I'm checking the syllabus, prerequisite order, and Ada's progress — noting that her wallet is limited to 12 coins.",'research','sp');
  await toolGroup('Ran commands 4',[R1,R2,R3,R4]);
  await think(4,'Full session costs ~18 coins but wallet holds 12.\nHarness will cap the session limit at 12. Being transparent on the plan card — no surprises mid-session.','planning','sp');
  await toolSingle('Drafting the study plan',355,[
    ['draft','Building a study plan within budget constraints','Ordering by mastery, noting the wallet falls short of the full session','Plan ready'],
    ['verification','Checked the plan against the wallet balance','⚠ 18 coins estimated exceeds wallet of 12 · session limit capped at 12','','system']
  ]);
  wake();
  act("I've checked the plan — your wallet covers about 6 practice sets, not the full 9. I'll go in order and pause before spending past your limit. Your progress is always saved.");
  await planCard({order:ORDER, est:18, ceil:12, warn:'Estimate exceeds wallet. Session will pause at 12 coins.'});
  await toolGroup('Ran commands 1',[CONFIRM]);
  sessionCard(ORDER);
  for(const k of ['wc','ph','ma','en']){ setTopicState(k,'done','understood'); charge(2); }
  setTopicState('fm','active');
  await think(1,'Starting Force & Motion diagnostic...','teaching','sp');
  await toolSingle('Starting diagnostic for Force & Motion',80,[
    ['action','Attempting to generate a Force & Motion practice set','Checking balance before generating','✕ Session paused — coin limit reached (12 of 12 spent)','system',true],
    ['action','Pausing the session cleanly','Saving all progress before any additional coins are spent','✓ Progress saved · no extra coins charged','system']
  ],false);
  act("Study paused — you've reached your 12-coin limit. Your first 4 topics are saved. Top up to continue.");
  await gateBtn('Top up 10 coins · raise limit to 18');
  S.wallet=10; S.ceiling=18; updateFoot(); wake();
  await toolGroup('Ran commands 1',[['action','Resuming after wallet top-up','Wallet refreshed and session limit raised to cover remaining topics','✓ Limit raised to 18 · resuming at Force & Motion','system']]);
  act("Resuming with Force & Motion.");
},

async cap(){
  wfDiv('Study Prep Workflow · SP004','sp');
  await think(2,'Whole-term prep. Researching before planning.\nNote: if Human Body hits the attempt cap, it gets deferred — NOT a teach-back. Cap ≠ teach-back.','research','sp');
  const o=['wc','ph','hb','ma','en','fm'];
  await toolGroup('Ran commands 4',[R1,R2,R3,R4]);
  await toolSingle('Drafting the study plan',345,[
    ['draft','Building an ordered study plan','By mastery with prerequisites respected','Plan ready'],
    ['verification','Checked the plan','Syllabus, prerequisites, coin estimate','✓ 18 coins · limit 25','system']
  ]);
  wake();
  await planCard({order:o, est:18, ceil:25});
  await toolGroup('Ran commands 1',[CONFIRM]);
  sessionCard(o);
  setTopicState('wc','done','understood'); setTopicState('ph','done','understood'); charge(6);
  setTopicState('hb','active');
  await startRun('hb','diagnostic'); scoreRing('Human Body · diagnostic',1,5);
  await startRun('hb','retest'); scoreRing('Human Body · retest',3,5);
  await toolGroup('Ran commands 1',[['reflection','Scored 3/5 (60%) on the retest — below pass mark. Both attempts are now used up.','No immediate retry allowed per policy.','✕ Attempt cap reached · immediate retry blocked','system',true]]);
  wake();
  await think(2,'Attempt cap reached on Human Body — 60% after 2 tries.\nThis is a cap, not a misconception requiring teach-back. Deferral is the right call.\nDeferral resets attempts. No Teaching Workflow is created here.','strategies','sp');
  await toolSingle('Setting Human Body aside temporarily',105,[
    ['research','Checking what options are still available','3 topics remaining · deferral slot free · no instructor assigned','✓ Deferral confirmed'],
    ['action','Deferring Human Body — NOT creating a Teaching Workflow','Scheduling a retry at the end, attempt count will reset','✓ Deferred · retry queued · cap ≠ teach-back','system']
  ]);
  setTopicState('hb','def','held for later');
  act("Human Body is taking more time — setting it aside to finish the easier topics first. One more attempt at the end with fresh questions.");
  for(const k of ['ma','en','fm']){ setTopicState(k,'done','understood'); charge(2); }
  await toolGroup('Ran commands 1',[['reflection','Matter, Energy, Force & Motion all passed. Moving to deferred Human Body retry.','Attempt count reset.','✓ 3 done · retry starting · attempts reset','system']]);
  await startRun('hb','deferred retry'); scoreRing('Human Body · deferred retry',4,5);
  setTopicState('hb','done','understood'); wake();
  act("Human Body passed on the deferred retry. All six topics have been worked through.");
  summaryCard([
    'Demonstrated on generated practice: 6 of 6 topics',
    'Human Body: deferred retry (attempt cap — NO teaching session created)',
    'Cap ≠ teach-back: deferral resets attempts, Teaching Workflow resolves misconceptions',
    'Coins spent: '+S.spent+' · wakes: '+S.wakes,
    'This was generated practice, not a past paper.'
  ]);
}
};

async function run(k){
  if(busy) return;
  busy=true;
  const prompts={
    full:'Prepare me for my whole-term Basic Science test.',
    teaching:'I want to teach my agent about Photosynthesis.',
    practice:'I want to practice Energy questions.',
    reject:'Help me plan my whole-term Basic Science prep.',
    budget:'Prepare me for my whole-term test, but my wallet is low.',
    cap:'Prepare me for my whole-term Basic Science test.'
  };
  user(prompts[k]); await sleep(500);
  try{ await SCEN[k](); } finally{ busy=false; }
}

document.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>{ if(!busy){ reset(); run(b.dataset.k); } });
$('#reset').onclick=reset;
const inp=$('#inp'), go=$('#go');
inp.oninput=()=>go.classList.toggle('on',!!inp.value.trim());
function send(){
  const t=inp.value.trim(); if(!t||busy) return;
  inp.value=''; go.classList.remove('on');
  if(/whole.term|prepare|study/i.test(t)) run('full');
  else if(/teach|photosyn/i.test(t)) run('teaching');
  else if(/practice|energy|question/i.test(t)) run('practice');
  else{ user(t); act("Try one of the chips above — Study Prep shows all four workflows together."); }
}
go.onclick=send; inp.onkeydown=e=>{ if(e.key==='Enter') send(); };
reset();
</script>
</body>
</html>
