const {chromium}=require('playwright');const fs=require('fs');
const b64=f=>'data:image/jpeg;base64,'+fs.readFileSync(f).toString('base64');
const card=fs.readFileSync('hero-welcome.svg','utf8');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1040,height:420}});
const html=(img,pos,extra,W=1040)=>`<body style="margin:0"><div style="position:relative;width:1040px;height:420px;overflow:hidden;background:#4C1DCC">
<img src="${b64(img)}" style="position:absolute;width:${W}px;height:auto;left:${1040-W}px;top:${pos}px">
<div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(76,29,204,1) 0%,rgba(84,38,214,1) 34%,rgba(108,59,255,.35) 56%,rgba(108,59,255,.08) 100%)"></div>
${extra}</div></body>`;
const cards=`<svg style="position:absolute;left:0;top:0" width="1040" height="420" viewBox="0 0 520 210" xmlns="http://www.w3.org/2000/svg"><defs><filter id="sh" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#1B0A5C" flood-opacity=".35"/></filter><linearGradient id="acc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8B66FF"/><stop offset="1" stop-color="#5A2FE0"/></linearGradient><linearGradient id="step" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#E9E2FF"/></linearGradient></defs>
${[0,1,2,3].map(i=>`<rect x="${26+i*34}" y="${170-i*26}" width="${126-i*34}" height="20" rx="5" fill="url(#step)" fill-opacity="${1-i*.1}"/>`).join('')}
<g transform="translate(127 54)" filter="url(#sh)"><circle cx="12" cy="12" r="14" fill="#fff"/><path d="M12 3 l2.6 5.6 6 .7 -4.5 4.1 1.2 6 -5.3 -3 -5.3 3 1.2 -6 -4.5 -4.1 6 -.7z" fill="url(#acc)"/></g>
<g transform="translate(176 26)" filter="url(#sh)"><rect width="150" height="58" rx="12" fill="#fff"/><text x="14" y="22" font-family="Inter,Arial" font-size="9" font-weight="700" fill="#7C55FF" letter-spacing=".8">LIVE BATTLE</text><rect x="14" y="31" width="122" height="7" rx="3.5" fill="#EFEAFF"/><rect x="14" y="31" width="88" height="7" rx="3.5" fill="#6C3BFF"/><rect x="14" y="43" width="122" height="7" rx="3.5" fill="#EFEAFF"/><rect x="14" y="43" width="54" height="7" rx="3.5" fill="#B6A3FF"/></g>
<g transform="translate(196 132)" filter="url(#sh)"><rect width="128" height="52" rx="12" fill="#fff"/><circle cx="26" cy="26" r="14" fill="url(#acc)"/><text x="19" y="30.5" font-family="Inter,Arial" font-size="12" font-weight="800" fill="#fff">A+</text><text x="48" y="23" font-family="Inter,Arial" font-size="10" font-weight="700" fill="#16122B">Mock exam</text><text x="48" y="36" font-family="Inter,Arial" font-size="9" font-weight="600" fill="#7A7692">Score 86%</text></g></svg>`;
for(const [name,img,pos,W] of [['A','../photos/5896921.jpg',-150,700],['B','../photos/6238121.jpg',-90,700],['C','../photos/5940713.jpg',-20,760]]){
 await p.setContent(html(img,pos,cards,W));await p.waitForTimeout(300);await p.screenshot({path:`photo-hero-${name}.png`});}
await b.close()})();
