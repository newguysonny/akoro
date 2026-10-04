<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Akoro · Study Agent</title>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@500;700;800;900&display=swap" rel="stylesheet">
<style>
:root{--b:#6C3BFF;--b2:#4C1DCC;--g:#10B981;--y:#F59E0B;--r:#EF4444;--bd:#E5E7EB;--hv:#F3F4F6;--t:#111827;--s:#6B7280;--m:#9CA3AF}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--t);display:flex;flex-direction:column;height:100dvh;overflow:hidden;background:#fff}

.chips{display:flex;gap:6px;padding:9px 14px;overflow-x:auto;border-bottom:1px solid var(--hv);scrollbar-width:none;flex-shrink:0}
.chips::-webkit-scrollbar{display:none}
.chip{flex-shrink:0;padding:5px 12px;border-radius:20px;border:1px solid #6C3BFF30;background:#6C3BFF08;color:var(--b);font:800 11px Nunito;cursor:pointer;white-space:nowrap}
.chip.alt{border-color:#F59E0B50;background:#F59E0B10;color:#B45309}
.chip.rs{border-color:var(--bd);background:#fff;color:var(--s)}

#m{flex:1;overflow-y:auto;padding:16px 14px 12px;display:flex;flex-direction:column;gap:2px}
.in{opacity:0;animation:fi .2s forwards}@keyframes fi{to{opacity:1}}

/* user bubble */
.user-row{display:flex;justify-content:flex-end;margin:8px 0 6px}
.user-bub{max-width:82%;padding:9px 14px;background:linear-gradient(135deg,var(--b),var(--b2));color:#fff;border-radius:16px 16px 4px 16px;font:600 13.5px/1.55 Nunito}

/* activity message */
.act{padding:5px 0 8px;font:500 16px/1.65 -apple-system,BlinkMacSystemFont,sans-serif;color:var(--t);max-width:600px}

/* thinking block */
details.th-blk{margin:1px 0}
details.th-blk>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:5px 0;font:400 13.5px/1 -apple-system,sans-serif;color:var(--s);user-select:none}
details.th-blk>summary::-webkit-details-marker{display:none}
.th-ico{width:18px;height:18px;border-radius:50%;border:1.5px solid var(--m);display:flex;align-items:center;justify-content:center;font:700 9px ui-monospace;color:var(--m);flex-shrink:0}
.th-set{font:800 9px Nunito;letter-spacing:.04em;padding:2px 6px;border-radius:20px;background:#6C3BFF10;color:var(--b);flex-shrink:0;text-transform:uppercase}
.chev{margin-left:auto;font-size:16px;color:var(--m);transition:transform .15s}
details.th-blk[open] .chev,details.tl-blk[open] .chev{transform:rotate(90deg)}
.th-body{padding:8px 12px;margin:2px 0 5px 26px;background:#F9FAFB;border-left:2px solid var(--bd);border-radius:0 6px 6px 0;font:400 11.5px/1.85 ui-monospace,"SF Mono",monospace;color:var(--s);white-space:pre-wrap}
.th-set-line{display:block;color:var(--b);font-weight:700;margin-bottom:6px;opacity:.8}

/* tool block */
details.tl-blk{margin:1px 0}
details.tl-blk>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:5px 0;font:400 13.5px/1 -apple-system,sans-serif;color:var(--s)}
details.tl-blk>summary::-webkit-details-marker{display:none}
.tl-ico{font:700 10px ui-monospace;color:var(--m);background:var(--hv);padding:2px 5px;border-radius:3px;border:1px solid var(--bd);flex-shrink:0}
.t-ok{color:var(--g);font-size:11px;font-weight:700}
.t-fail{color:var(--r);font-size:11px;font-weight:700}
.t-ms{color:var(--m);font-size:11px}

.tl-rows{padding:4px 0 5px 26px;display:flex;flex-direction:column;gap:4px}
.tl-row{display:flex;gap:8px;align-items:flex-start;padding:7px 11px;background:#fff;border:1px solid var(--bd);border-radius:8px}
.pill{flex-shrink:0;font:900 9px Nunito;letter-spacing:.03em;padding:2px 7px;border-radius:20px;margin-top:3px;text-transform:capitalize}
.research{background:#3B82F615;color:#2563EB}.draft{background:#8B5CF615;color:#7C3AED}
.verification{background:#F59E0B18;color:#B45309}.action{background:#10B98115;color:#047857}
.reflection{background:#6C3BFF12;color:var(--b)}.synthesis{background:#EC489915;color:#BE185D}

.rb{flex:1;min-width:0}
.rb .hl{font:700 12px Nunito;color:var(--t);display:block;margin-bottom:2px}
.rb .desc{font:400 11.5px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;color:var(--s);display:block}
.rb .rr{font:700 11px Nunito;margin-top:4px;color:var(--g);display:block}.rb .rr.bad{color:var(--r)}
.who{flex-shrink:0;font:800 9px Nunito;color:var(--m);text-transform:uppercase;letter-spacing:.04em;margin-top:3px;align-self:flex-start}
.who.sys{color:#B45309}

@keyframes pp{50%{opacity:.2}}

/* cards */
.card{border:1px solid var(--bd);border-radius:14px;background:#fff;overflow:hidden;margin:6px 0}
.ch{padding:10px 13px;border-bottom:1px solid var(--hv);display:flex;justify-content:space-between;align-items:baseline}
.ct{font:900 10.5px Nunito;color:var(--s);letter-spacing:.03em}.cs{font:900 13.5px Nunito}
.tr2{display:flex;align-items:center;gap:9px;padding:7px 13px;border-bottom:1px solid var(--hv)}.tr2:last-of-type{border:0}
.dot{width:16px;height:16px;border-radius:50%;border:2px solid var(--bd);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff}
.tr2.active .dot{border-color:var(--b);background:#6C3BFF12;animation:pp 1.2s infinite}
.tr2.done .dot{background:var(--g);border-color:var(--g)}.tr2.def .dot{background:var(--hv);border-color:var(--m);color:var(--m)}.tr2.gap .dot{background:var(--y);border-color:var(--y)}
.tl{flex:1;font:700 12.5px Nunito;color:var(--m)}.tr2.active .tl,.tr2.done .tl{color:var(--t)}
.tg{font:800 10px Nunito;padding:2px 7px;border-radius:20px;background:var(--hv);color:var(--s)}
.tr2.done .tg{background:#10B98114;color:#047857}.tr2.def .tg,.tr2.gap .tg{background:#FEF3C7;color:#B45309}.tg.w{background:#F59E0B14;color:#B45309}
.cf{padding:9px 13px;border-top:1px solid var(--hv);font:700 11.5px Nunito;color:var(--s);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.cf b{color:var(--t)}.warn{padding:8px 13px;background:#FEF3C7;color:#92400E;font:700 11.5px/1.4 Nunito}
.btn{padding:8px 15px;border-radius:20px;border:0;background:linear-gradient(135deg,var(--b),var(--b2));color:#fff;font:900 12px Nunito;cursor:pointer}
.btn.o{background:none;border:1.5px solid var(--b);color:var(--b)}.btn.g{background:none;border:1px solid var(--bd);color:var(--s);font-weight:700}
.btn:disabled{opacity:.45;cursor:default}

.sc-r{display:flex;gap:11px;align-items:center;border:1px solid var(--bd);border-radius:13px;padding:8px 12px;margin:4px 0}
.ring{width:36px;height:36px;border-radius:50%;border:3px solid var(--bd);display:flex;align-items:center;justify-content:center;font:900 11px Nunito;flex-shrink:0}
.ring.p{border-color:var(--g);color:var(--g)}.ring.f{border-color:var(--y);color:#B45309}
.sct{font:700 12.5px/1.4 Nunito;color:var(--s)}.sct small{color:var(--m)}
.fl{padding:9px 13px;font:700 12.5px/1.6 Nunito}.fl div{border-bottom:1px solid var(--hv);padding:3px 0}.fl div:last-child{border:0}

.ov{position:fixed;inset:0;background:#11182780;display:none;align-items:flex-end;justify-content:center;z-index:9}.ov.on{display:flex}
.mc{width:100%;max-width:440px;background:#fff;border-radius:22px 22px 0 0;padding:18px 20px 26px}
.tb{background:var(--hv);border:1px solid var(--bd);border-radius:12px;padding:12px;font:600 12.5px/1.6 Nunito;min-height:90px;white-space:pre-wrap;margin:10px 0 14px}

.ib{padding:9px 14px 12px;border-top:1px solid var(--hv);flex-shrink:0}
.is{display:flex;gap:8px;background:var(--hv);border:1.5px solid var(--bd);border-radius:50px;padding:6px 7px}
.is input{flex:1;border:0;background:none;outline:0;font:600 13.5px Nunito;padding-left:6px}
.sb{width:34px;height:34px;border-radius:50%;border:0;background:var(--bd);color:#fff;cursor:pointer;font-size:15px}.sb.on{background:linear-gradient(135deg,var(--b),var(--b2))}
</style>
</head>
<body>

<div class="chips">
  <button class="chip" data-k="full">Full session</button>
  <button class="chip alt" data-k="reject">Plan rejected</button>
  <button class="chip alt" data-k="budget">Budget ceiling</button>
  <button class="chip alt" data-k="cap">Topic caps out</button>
  <button class="chip rs" id="reset">Reset</button>
</div>

<div id="m"></div>

<div class="ib">
  <div class="is">
    <input id="inp" placeholder="Ask your study agent…">
    <button class="sb" id="go">➤</button>
  </div>
</div>

<div class="ov" id="ov">
  <div class="mc">
    <b style="font:900 15px Nunito">🎓 Teach it back</b>
    <div style="font:600 12.5px Nunito;color:var(--s);margin-top:3px" id="osub"></div>
    <div class="tb" id="otb">Waiting for you to start explaining…</div>
    <div style="display:flex;gap:8px">
      <button class="btn g" id="onot" style="flex:1">Not now</button>
      <button class="btn" id="odone" style="flex:2">I've taught it back</button>
    </div>
  </div>
</div>

<script>
const $=s=>document.querySelector(s),M=$('#m');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const TOPICS={wc:['Water Cycle',42],ph:['Photosynthesis',61],hb:['Human Body',82],ma:['Matter',71],en:['Energy',55],fm:['Force & Motion',76]};
let S,busy=false;
function sc(){M.scrollTop=M.scrollHeight}

function reset(){
  S={wallet:25,spent:0,ceiling:25,wakes:0,card:null};
  M.innerHTML='';busy=false;
  act("Hi Ada! I'm your study agent. Pick a scenario above, or tell me what you'd like to prepare for.");
}

function user(t){
  const r=document.createElement('div');r.className='user-row in';
  r.innerHTML='<div class="user-bub"></div>';
  r.querySelector('.user-bub').textContent=t;M.appendChild(r);sc();
}

function act(t){
  const el=document.createElement('div');el.className='act in';
  el.textContent=t;M.appendChild(el);sc();
}

/* think(seconds, text, setName)
   setName is the manifest.mjs context set loaded for this step.
   Shows as a pill in the summary so the operation→set mapping is visible. */
async function think(seconds,text,setName){
  const d=document.createElement('details');d.className='th-blk in';d.open=true;
  const s=document.createElement('summary');
  const ico=document.createElement('span');ico.className='th-ico';ico.textContent='⚙';
  const lbl=document.createElement('span');lbl.textContent='Thought for '+seconds+' second'+(seconds!==1?'s':'');
  const chev=document.createElement('span');chev.className='chev';chev.textContent='›';
  // Set name pill — shows which manifest.mjs context set was loaded
  if(setName){
    const pill=document.createElement('span');pill.className='th-set';pill.textContent=setName;
    s.append(ico,lbl,pill,chev);
  } else {
    s.append(ico,lbl,chev);
  }
  const b=document.createElement('div');b.className='th-body';
  if(setName){
    const setLine=document.createElement('span');
    setLine.className='th-set-line';
    setLine.textContent='context: '+setName;
    b.appendChild(setLine);
  }
  const textNode=document.createTextNode(text);
  b.appendChild(textNode);
  d.append(s,b);M.appendChild(d);sc();
  await sleep(seconds*110+220);
  d.open=false;
}

function addRow(container,[type,hl,desc,result,who,bad]){
  const row=document.createElement('div');row.className='tl-row';
  const wc=(who==='system')?'sys':'';
  row.innerHTML='<span class="pill '+type+'">'+type+'</span>'
    +'<div class="rb">'
    +'<span class="hl"></span>'
    +(desc?'<span class="desc"></span>':'')
    +(result?'<span class="rr'+(bad?' bad':'')+'"></span>':'')
    +'</div>'
    +'<span class="who '+wc+'">'+(who||'agent')+'</span>';
  row.querySelector('.hl').textContent=hl;
  if(desc)row.querySelector('.desc').textContent=desc;
  if(result)row.querySelector('.rr').textContent=result;
  container.appendChild(row);sc();
}

async function toolGroup(label,rows){
  const d=document.createElement('details');d.className='tl-blk in';d.open=true;
  const s=document.createElement('summary');
  const ico=document.createElement('span');ico.className='tl-ico';ico.textContent='>_';
  const lbl=document.createElement('span');lbl.textContent=label||'Ran commands '+rows.length;
  const chev=document.createElement('span');chev.className='chev';chev.textContent='›';
  s.append(ico,lbl,chev);
  const c=document.createElement('div');c.className='tl-rows';
  d.append(s,c);M.appendChild(d);sc();
  for(const row of rows){await sleep(340);addRow(c,row)}
  await sleep(260);d.open=false;
}

async function toolSingle(label,ms,rows,ok=true){
  const d=document.createElement('details');d.className='tl-blk in';d.open=true;
  const s=document.createElement('summary');
  const ico=document.createElement('span');ico.className='tl-ico';ico.textContent='>_';
  const lbl=document.createElement('span');lbl.textContent=label;
  const tick=document.createElement('span');tick.className=ok?'t-ok':'t-fail';tick.textContent=ok?' ✓':' ✕';
  const tm=document.createElement('span');tm.className='t-ms';tm.textContent=' '+ms+'ms';
  const chev=document.createElement('span');chev.className='chev';chev.textContent='›';
  s.append(ico,lbl,tick,tm,chev);
  const c=document.createElement('div');c.className='tl-rows';
  d.append(s,c);M.appendChild(d);sc();
  if(rows){for(const row of rows){await sleep(300);addRow(c,row)}}
  await sleep(240);d.open=false;
}

function score(l,c,t){
  const p=c/t>=.7,e=document.createElement('div');e.className='sc-r in';
  e.innerHTML='<div class="ring '+(p?'p':'f')+'">'+c+'/'+t+'</div><div class="sct"></div>';
  e.querySelector('.sct').innerHTML=l+'<br><small>'+Math.round(c/t*100)+'% · '+(p?'above':'below')+' the 70% bar</small>';
  M.appendChild(e);sc();
}

function plan(o){
  return new Promise(res=>{
    const e=document.createElement('div');e.className='card in';
    e.innerHTML='<div class="ch"><div><div class="ct">STUDY PLAN</div><div class="cs">Basic Science · JSS1</div></div></div>';
    o.order.forEach((k,i)=>{
      const[l,m]=TOPICS[k],r=document.createElement('div');r.className='tr2';
      r.innerHTML='<div class="dot" style="background:'+(m<70?'var(--y)':'var(--g)')+';border-color:transparent;width:8px;height:8px"></div><div class="tl" style="color:var(--t)">'+(i+1)+'. '+l+'</div><div class="tg '+(m<70?'w':'')+'">'+m+'%</div>';
      e.appendChild(r);
    });
    if(o.warn){const w=document.createElement('div');w.className='warn';w.textContent=o.warn;e.appendChild(w)}
    const f=document.createElement('div');f.className='cf';
    f.innerHTML='Estimate <b>'+o.est+'</b> · Limit <b>'+o.ceil+'</b> coins · Wallet <b>'+S.wallet+'</b><span style="flex:1"></span>';
    const a=document.createElement('button');a.className='btn';a.textContent='Approve & start';
    const n=document.createElement('button');n.className='btn g';n.textContent='Adjust';
    f.append(n,a);e.appendChild(f);M.appendChild(e);sc();
    a.onclick=()=>{a.disabled=n.disabled=true;a.textContent='Approved ✓';S.ceiling=o.ceil;res()};
  });
}

function session(order){
  const e=document.createElement('div');e.className='card in';
  e.innerHTML='<div class="ch"><div class="ct">SESSION · BASIC SCIENCE</div><div class="ct" id="sp" style="color:var(--b)"></div></div>';
  order.forEach(k=>{
    const r=document.createElement('div');r.className='tr2';r.dataset.k=k;
    r.innerHTML='<div class="dot"></div><div class="tl">'+TOPICS[k][0]+'</div><div class="tg" style="display:none"></div>';
    e.appendChild(r);
  });
  const f=document.createElement('div');f.className='cf';f.id='sf';e.appendChild(f);
  S.card=e;M.appendChild(e);sc();foot();
}

function foot(){
  if(!S.card)return;
  const rs=[...S.card.querySelectorAll('.tr2')];
  S.card.querySelector('#sp').textContent=rs.filter(r=>/done|gap/.test(r.className)).length+' / '+rs.length;
  S.card.querySelector('#sf').innerHTML='Spent <b>'+S.spent+'</b> / limit <b>'+S.ceiling+'</b> · wallet <b>'+S.wallet+'</b> · wakes <b>'+S.wakes+'</b>';
}

function setT(k,st,tag){
  const r=S.card.querySelector('[data-k="'+k+'"]');r.className='tr2 '+st;
  const d=r.querySelector('.dot'),g=r.querySelector('.tg');
  d.textContent=st==='done'?'✓':st==='gap'?'!':st==='def'?'…':'';
  g.style.display=tag?'':'none';g.textContent=tag||'';foot();sc();
}

const charge=n=>{S.wallet-=n;S.spent+=n;foot()};
const wake=()=>{S.wakes++;foot()};

function gate(label,kind,topic){
  return new Promise(res=>{
    const b=document.createElement('button');b.className='btn o in';b.textContent=label;
    b.style.margin='6px 0';M.appendChild(b);sc();
    b.onclick=async()=>{b.disabled=true;if(kind==='teach')await teach(topic);res()};
  });
}

function teach(t){
  return new Promise(res=>{
    $('#osub').textContent='Explain '+t+' in your own words.';
    $('#otb').textContent='Waiting for you to start explaining…';
    $('#ov').classList.add('on');
    setTimeout(()=>$('#otb').textContent='You: "Evaporation is water turning to vapour. Transpiration is plants releasing it into the air…"\n\nAgent: And what turns the vapour back into droplets?',800);
    const end=()=>{$('#ov').classList.remove('on');res()};
    $('#odone').onclick=end;$('#onot').onclick=end;
  });
}

function facts(lines){
  const e=document.createElement('div');e.className='card in';
  e.innerHTML='<div class="ch"><div class="cs">Session summary</div></div><div class="fl"></div>';
  lines.forEach(l=>{const d=document.createElement('div');d.textContent=l;e.querySelector('.fl').appendChild(d)});
  M.appendChild(e);sc();
}

const R1=['research','Checking the Basic Science syllabus','Scanning all topics covered in JSS1 Basic Science this term','✓ 6 topics found for the term'];
const R2=['research','Reviewing where Ada stands right now','Looking at mastery levels across all 6 topics to find where to focus','✓ 3 topics are below the 70% threshold'];
const R3=['research','Looking at past mistakes and patterns','Reading through Ada\'s attempt history to spot recurring gaps','✓ Evaporation vs transpiration · potential vs kinetic · cell types'];
const R4=['research','Mapping how topics depend on each other','Checking which topics need to be understood before others can be tackled','✓ Water Cycle before Photosynthesis · Matter before Energy'];
const CONFIRM=['action','Plan confirmed by Ada','Locking in the approved plan and setting the coin limit for the session','✓ Plan locked · session is live','system'];
const ORDER=['wc','ph','ma','en','fm','hb'];

const TOPIC_LABELS={diagnostic:'Starting diagnostic for',retest:'Running retest for','deferred retry':'Deferred retry for'};
async function G(k,kind){
  const label=(TOPIC_LABELS[kind]||'Starting')+' '+TOPICS[k][0];
  await toolSingle(label,140,null);charge(2);
}

const SCEN={
async full(){
  // research set: gathering syllabus + learner state
  await think(2,'Ada wants whole-term Basic Science prep.\nLet me check the JSS1 syllabus, her current mastery levels, what she keeps getting wrong, and the topic dependency order...','research');
  await toolGroup('Ran commands 4',[R1,R2,R3,R4]);

  // planning set: building the ordered plan
  await think(8,'Ada is weakest on Water Cycle (42%), Energy (55%), Photosynthesis (61%).\nWater Cycle is a prerequisite for Photosynthesis. Matter before Energy.\nBest order: Water Cycle → Photosynthesis → Matter → Energy → Force & Motion → Human Body.\nEstimate: 6 diagnostics + ~2 retests = 18 coins.','planning');
  await toolSingle('Drafting the study plan',380,[
    ['draft','Building an ordered study plan','Arranging topics from weakest to strongest, prerequisites respected','Plan ready — awaiting review'],
    ['verification','Checking the plan is safe to run','Verifying syllabus coverage, prerequisite order, and coin estimate','✓ All checks passed · 18 coins estimated · limit 25','system']
  ]);
  wake();
  act("Water Cycle first — your weakest at 42%, and it unlocks Photosynthesis. Estimated 18 coins. Approve to start?");
  await plan({order:ORDER,est:18,ceil:25});
  await toolGroup('Ran commands 1',[CONFIRM]);
  session(ORDER);

  // Water Cycle diagnostic
  setT('wc','active');
  await think(1,'Starting Water Cycle diagnostic. Mastery is 42% — expect gaps around evaporation vs transpiration.','teaching');
  await G('wc','diagnostic');
  score('Water Cycle · diagnostic',3,5);
  await toolGroup('Ran commands 1',[['reflection','Reviewing the Water Cycle result','Score came in at 60% — below the 70% threshold needed to advance. Recording to Ada\'s progress history.','✓ Below threshold · progress recorded','system']]);
  wake();

  // strategies set: choosing what to do after a below-threshold score
  await think(3,'60% — below the bar. She has 2 attempts left.\nHer history shows evaporation/transpiration confusion. Teach-back is the right call — explaining it herself tends to resolve this kind of mix-up.\nI\'ll offer it now.','strategies');
  await toolSingle('Offering a teach-back exercise',95,[
    ['action','Choosing a teach-back strategy','Ada mixed up evaporation and transpiration — explaining the process herself tends to resolve this kind of confusion','✓ Strategy confirmed · 2 attempts remaining']
  ]);
  act("You scored 3/5 on Water Cycle. Try teaching it back to me — explaining it out loud tends to fix the evaporation/transpiration mix-up.");
  await gate('Teach it back','teach','Water Cycle');

  // reflection set: reviewing the teach-back and deciding on retest
  await think(1,'Ada confirmed the teach-back. The retest gate is open. Generating fresh questions now — no model decision needed.','reflection');
  await toolGroup('Ran commands 1',[['action','Ada confirmed she\'s ready','Generating a fresh set of retest questions for Water Cycle','✓ Fresh questions ready · 2 coins charged','system']]);
  charge(2);
  score('Water Cycle · retest',5,5);
  setT('wc','done','understood');
  await toolGroup('Ran commands 1',[['reflection','Water Cycle complete','Scored 100% on the retest. Advancing to Photosynthesis — no model decision needed.','✓ Advancing · 2 coins charged','system']]);
  charge(2);setT('ph','active');

  score('Photosynthesis · diagnostic',4,5);setT('ph','done','understood');
  charge(2);setT('ma','active');
  score('Matter · diagnostic',4,5);setT('ma','done','understood');

  // Energy — needs extra work
  charge(2);setT('en','active');
  score('Energy · diagnostic',2,5);
  wake();

  // reflection → strategies: score arrived, now decide what to do
  await think(2,'40% on Energy. Let me check her history before choosing a strategy.','reflection');
  await toolGroup('Ran commands 2',[
    ['research','Checking Ada\'s history with Energy','Looking for patterns in past Energy attempts to find the root cause','✓ Same potential/kinetic confusion in 2 earlier sessions'],
    ['research','Finding a better explanation approach','Searching approved course material for a clearer angle on potential vs kinetic energy','✓ 2 relevant passages found']
  ]);
  await think(2,'Same confusion survived two previous explanations. The teach-back won\'t fix a wrong mental model — I need a completely different analogy.\nSwitching to different_analogy strategy.','strategies');
  await toolSingle('Recommending a strategy',90,[
    ['draft','Choosing a new teaching strategy','The same explanation has not worked twice — switching to a different analogy to break the pattern','✓ different_analogy confirmed · 2 attempts remaining']
  ]);
  act("Think of kinetic energy as a ball rolling, and potential energy as that same ball held at the top of a ramp — all the action is stored, waiting. Tap when you're ready for a fresh set.");
  await gate('Ready for retest','ready');
  charge(2);setT('en','active');
  score('Energy · retest',4,5);setT('en','done','understood');

  charge(2);setT('fm','active');
  score('Force & Motion · diagnostic',5,5);setT('fm','done','understood');
  charge(2);setT('hb','active');
  score('Human Body · diagnostic',5,5);setT('hb','done','understood');

  wake();
  // reflection set: summarising what was demonstrated
  await think(2,'All 6 topics settled. Assembling the closing summary from recorded evidence only — no inferences.','reflection');
  await toolSingle('Completing the session',120,[
    ['synthesis','Wrapping up and recording final outcomes','All 6 topics worked through. Compiling a summary from demonstrated evidence.','✓ Session complete'],
    ['verification','Confirming final results against Ada\'s progress record','Cross-checking topic outcomes and coin usage','✓ 6 topics understood · 0 flagged · 16 coins spent','system']
  ]);
  act("Done — all 6 topics covered. Water Cycle and Energy needed extra work; both resolved.");
  facts(['Demonstrated on generated practice: 6 of 6 topics','Extra work: Water Cycle (teach-back) · Energy (different analogy)','Confusion cleared: evaporation vs transpiration · potential vs kinetic energy','Coins spent: 16 of 18 estimated · agent wakes: '+S.wakes,'This was generated practice, not a past paper.']);
},

async reject(){
  await think(2,'Whole-term Basic Science prep.\nLet me check the syllabus, Ada\'s state, and the topic dependency map...','research');
  await toolGroup('Ran commands 3',[R1,R2,R4]);

  // planning set: first attempt at a plan
  await think(5,'I\'ll order by mastery: Water Cycle → Energy → Photosynthesis...\nWait — the dependency map shows Matter must come before Energy. My current order violates that.\nI need to revise and resubmit.','planning');
  await toolSingle('Drafting the study plan',290,[
    ['draft','Building an ordered study plan','Ordering topics from weakest to strongest mastery','Plan ready — awaiting review'],
    ['verification','Checking the plan is safe to run','Verifying syllabus, prerequisite order, and coin estimate','✕ Blocked — Energy must come after Matter (dependency violation)','system',true]
  ],false);

  // planning set again: fixing the order
  await think(2,'Rejected. Moving Matter before Energy and resubmitting.','planning');
  await toolSingle('Revising the study plan',315,[
    ['draft','Fixing the topic ordering','Moving Matter ahead of Energy to respect the dependency','Revised plan ready — awaiting review'],
    ['verification','Re-checking the revised plan','Re-verifying all topics with the corrected order','✓ All checks passed · 18 coins estimated · limit 25','system']
  ]);
  wake();
  act("My first ordering put Energy before Matter — the dependency check caught that and I've fixed it. Here's the corrected plan:");
  await plan({order:ORDER,est:18,ceil:25});
  act("The session continues from here as in the full scenario.");
},

async budget(){
  S.wallet=12;S.ceiling=12;
  await think(2,'Wallet is only 12 coins. Let me plan carefully and flag the cost upfront so there are no surprises...','research');
  await toolGroup('Ran commands 4',[R1,R2,R3,R4]);

  // planning set: building against a tight budget
  await think(5,'Ideal session costs ~18 coins but wallet holds 12.\nThe session limit will be capped at 12. I\'ll be transparent about this on the plan card.','planning');
  await toolSingle('Drafting the study plan',360,[
    ['draft','Building a study plan within budget constraints','Ordering topics from weakest to strongest, noting the wallet falls short of the full session','Plan ready — awaiting review'],
    ['verification','Checking plan against wallet balance','Verifying topics and estimating coin cost against Ada\'s current balance of 12','⚠ Estimated 18 coins exceeds wallet of 12 · limit capped at 12','system']
  ]);
  wake();
  act("Your wallet covers about 6 practice sets, not the full 9. I'll go in order and pause before spending past your limit — progress is always saved.");
  await plan({order:ORDER,est:18,ceil:12,warn:'Estimate exceeds wallet. Session will pause at 12 coins.'});
  await toolGroup('Ran commands 1',[CONFIRM]);
  session(ORDER);
  for(const k of ['wc','ph','ma','en']){setT(k,'done','understood');charge(2)}
  setT('fm','active');

  await think(1,'Starting Force & Motion diagnostic...','teaching');
  await toolSingle('Starting diagnostic for Force & Motion',80,[
    ['action','Attempting to start Force & Motion practice','Generating a fresh diagnostic practice set','✕ Paused — coin limit reached (12 of 12 spent)','system',true],
    ['action','Pausing the session to protect Ada\'s balance','Stopping before spending further and saving all completed work','✓ Progress saved · no extra coins charged','system']
  ],false);
  act("Paused — you've hit your 12-coin limit. Your first 4 topics are saved. Top up to continue.");
  await gate('Top up 10 coins · raise limit to 18','topup');
  S.wallet=10;S.ceiling=18;foot();wake();
  await toolGroup('Ran commands 1',[['action','Resuming after wallet top-up','Wallet refreshed and coin limit raised to cover the remaining topics','✓ Limit raised to 18 · resuming at Force & Motion','system']]);
  act("Back on track — resuming with Force & Motion.");
},

async cap(){
  await think(2,'Whole-term prep. Researching before planning...','research');
  const o=['wc','ph','hb','ma','en','fm'];
  await toolGroup('Ran commands 4',[R1,R2,R3,R4]);

  // planning set: building the plan
  await think(3,'Topics ordered. Human Body (82%) is high mastery — good to tackle while Ada is fresh.','planning');
  await toolSingle('Drafting the study plan',350,[
    ['draft','Building an ordered study plan','Arranging topics by mastery with prerequisites respected','Plan ready — awaiting review'],
    ['verification','Checking the plan is safe to run','Verifying syllabus, prerequisite order, and coin estimate','✓ All checks passed · 18 coins estimated · limit 25','system']
  ]);
  wake();
  act("Plan ready — starting with Water Cycle and Photosynthesis, then Human Body while Ada is still fresh.");
  await plan({order:o,est:18,ceil:25});
  await toolGroup('Ran commands 1',[CONFIRM]);
  session(o);
  setT('wc','done','understood');setT('ph','done','understood');charge(6);
  setT('hb','active');
  await G('hb','diagnostic');
  score('Human Body · diagnostic',1,5);
  await gate('Teach it back','teach','Human Body');
  await G('hb','retest');
  score('Human Body · retest',3,5);
  await toolGroup('Ran commands 1',[['reflection','Reviewing the Human Body retest result','Scored 60% on the second attempt — both available attempts used up. Immediate retry not allowed.','✕ Attempt cap reached · no immediate retry','system',true]]);
  wake();

  // reflection → strategies: cap reached, decide what to do
  await think(2,'Attempt cap reached on Human Body after 2 tries at 60%.\nChecking what options are still available...','reflection');
  await toolGroup('Ran commands 1',[['research','Checking what options are still available','Reviewing which topics are still queued and whether a deferral slot is open','✓ 3 topics remaining · one deferral slot available · no instructor assigned']]);
  await think(2,'Deferral slot is free and 3 lighter topics remain.\nBest call: finish Matter, Energy, and Force & Motion first, then bring Human Body back at the end with a fresh run and reset attempts.','strategies');
  await toolSingle('Setting Human Body aside temporarily',110,[
    ['action','Deferring Human Body to end of session','Scheduling a retry after the remaining topics are done, with attempt count reset','✓ Human Body deferred · retry queued · attempts will reset','system']
  ]);
  setT('hb','def','held for later');
  act("Human Body is taking more time — setting it aside to finish the easier topics first. One more attempt at the end with fresh questions.");
  for(const k of ['ma','en','fm']){setT(k,'done','understood');charge(2)}
  await toolGroup('Ran commands 1',[['reflection','Lighter topics all done','Matter, Energy, and Force & Motion all passed. Moving to the deferred Human Body retry.','✓ 3 topics done · Human Body retry starting · attempts reset','system']]);
  await G('hb','deferred retry');
  score('Human Body · deferred retry',4,5);
  setT('hb','done','understood');
  wake();
  act("Human Body passed on the deferred retry. All 6 topics settled.");
  facts(['Demonstrated on generated practice: 6 of 6 topics','Human Body needed a deferred retry after hitting the attempt cap','Coins spent: '+S.spent+' · agent wakes: '+S.wakes,'This was generated practice, not a past paper.']);
}
};

async function run(k){
  if(busy)return;busy=true;
  const prompts={
    full:'I have a test covering the whole term for Basic Science. Can you help me prepare?',
    reject:'Help me plan my whole-term Basic Science prep.',
    budget:'Prepare me for my whole-term test, but my wallet is low.',
    cap:'Prepare me for my whole-term Basic Science test.'
  };
  user(prompts[k]);await sleep(500);
  try{await SCEN[k]()}finally{busy=false}
}

document.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>{if(!busy){reset();run(b.dataset.k)}});
$('#reset').onclick=reset;
const inp=$('#inp'),go=$('#go');
inp.oninput=()=>go.classList.toggle('on',!!inp.value.trim());
function send(){
  const t=inp.value.trim();if(!t||busy)return;
  inp.value='';go.classList.remove('on');
  if(/whole.term|prepare|study session/i.test(t)){reset();run('full')}
  else{user(t);act("I can plan a full study session — tell me to prepare you for your whole-term test.")}
}
go.onclick=send;inp.onkeydown=e=>{if(e.key==='Enter')send()};
reset();
</script>
</body>
</html>
