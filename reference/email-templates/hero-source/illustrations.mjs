import fs from 'fs';
const W=520,H=210;
const defs=`<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C55FF"/><stop offset=".55" stop-color="#5A2FE0"/><stop offset="1" stop-color="#3A168F"/></linearGradient>
<radialGradient id="l1" cx=".85" cy=".05" r=".75"><stop offset="0" stop-color="#C4B2FF" stop-opacity=".7"/><stop offset="1" stop-color="#C4B2FF" stop-opacity="0"/></radialGradient>
<radialGradient id="l2" cx=".05" cy="1" r=".7"><stop offset="0" stop-color="#E879F9" stop-opacity=".45"/><stop offset="1" stop-color="#E879F9" stop-opacity="0"/></radialGradient>
<linearGradient id="step" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#E9E2FF"/></linearGradient>
<linearGradient id="acc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8B66FF"/><stop offset="1" stop-color="#5A2FE0"/></linearGradient>
<filter id="sh" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#1B0A5C" flood-opacity=".35"/></filter>
<pattern id="dots" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1" fill="#fff" fill-opacity=".14"/></pattern>
</defs>`;
const bg=`<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#l1)"/><rect width="${W}" height="${H}" fill="url(#l2)"/><rect x="250" width="270" height="${H}" fill="url(#dots)"/>
<circle cx="455" cy="30" r="110" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="1.5"/><circle cx="455" cy="30" r="78" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="1.5"/><circle cx="60" cy="190" r="70" fill="none" stroke="#fff" stroke-opacity=".07" stroke-width="1.5"/>`;
const svg=(inner)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${W*2}" height="${H*2}" viewBox="0 0 ${W} ${H}">${defs}${bg}${inner}</svg>`;
const txt=(x,y,s,t,o={})=>`<text x="${x}" y="${y}" font-family="Inter,Helvetica,Arial,sans-serif" font-size="${s}" font-weight="${o.w||700}" fill="${o.f||'#16122B'}" letter-spacing="${o.ls||0}">${t}</text>`;
const bar=(x,y,w,c,o=1,h=5)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h/2}" fill="${c}" fill-opacity="${o}"/>`;
const card=(x,y,w,h,inner,fill='#fff')=>`<g transform="translate(${x} ${y})" filter="url(#sh)"><rect width="${w}" height="${h}" rx="12" fill="${fill}"/>${inner}</g>`;
const stairs=(x,y,n=4,sw=34,sh=18,gap=6,rise=22)=>Array.from({length:n},(_,i)=>`<rect x="${x}" y="${y-i*(sh+gap)}" width="${sw+i*34}" height="${sh}" rx="5" fill="url(#step)" fill-opacity="${1-i*.0}" ${i==0?'':''}/>`).join('');
const phone=(x,y,inner)=>`<g transform="translate(${x} ${y})" filter="url(#sh)"><rect width="92" height="176" rx="16" fill="#0B0818"/><rect x="4" y="4" width="84" height="168" rx="13" fill="#F6F3FF"/><rect x="32" y="8" width="28" height="6" rx="3" fill="#0B0818"/>${inner}</g>`;
const check=(cx,cy,r,col='#fff')=>`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${col}"/><path d="M${cx-r*.42} ${cy+r*.02} L${cx-r*.1} ${cy+r*.34} L${cx+r*.46} ${cy-r*.3}" fill="none" stroke="#5A2FE0" stroke-width="${r*.22}" stroke-linecap="round" stroke-linejoin="round"/>`;
const out={};
// welcome: phone with tutor chat + rising steps + badges
out.welcome=svg(`
${[0,1,2,3].map(i=>`<rect x="${30+i*36}" y="${168-i*26}" width="${132-i*36}" height="20" rx="5" fill="url(#step)" fill-opacity="${1-i*.08}"/>`).join('')}
<g transform="translate(139 52)" filter="url(#sh)"><circle cx="12" cy="12" r="14" fill="#fff"/><path d="M12 3 l2.6 5.6 6 .7 -4.5 4.1 1.2 6 -5.3 -3 -5.3 3 1.2 -6 -4.5 -4.1 6 -.7z" fill="url(#acc)"/></g>
<g transform="translate(40 36)"><path d="M0 0 l0 0" /></g>
${phone(196,18,`
 <circle cx="18" cy="30" r="8" fill="#EFEAFF"/>${bar(32,26,36,'#16122B',.8)}${bar(32,35,22,'#7A7692',.5,4)}
 <rect x="10" y="50" width="60" height="26" rx="8" fill="#6C3BFF"/>${bar(17,58,44,'#fff',.9,4)}${bar(17,67,28,'#fff',.6,4)}
 <rect x="18" y="84" width="58" height="34" rx="8" fill="#fff"/>${bar(25,92,42,'#6C3BFF',.8,4)}${bar(25,101,34,'#6C3BFF',.4,4)}${bar(25,109,40,'#6C3BFF',.4,4)}
 <rect x="10" y="140" width="64" height="20" rx="10" fill="#fff"/>${bar(18,148,30,'#7A7692',.4,4)}<circle cx="64" cy="150" r="6" fill="#6C3BFF"/>`)}
${card(310,26,162,64,`${txt(14,24,9,'LIVE BATTLE',{f:'#7C55FF',ls:.8})}${bar(14,34,134,'#EFEAFF',1,7)}${bar(14,34,98,'#6C3BFF',1,7)}${bar(14,47,134,'#EFEAFF',1,7)}${bar(14,47,60,'#B6A3FF',1,7)}`)}
${card(330,108,128,56,`<circle cx="26" cy="28" r="14" fill="url(#acc)"/>${txt(20.5,32,12,'A+',{f:'#fff',w:800})}${txt(48,25,10,'Mock exam',{})}${txt(48,38,9,'Score 86%',{f:'#7A7692',w:600})}`)}
<g transform="translate(300 168)" filter="url(#sh)"><rect width="86" height="26" rx="13" fill="#fff"/>${txt(14,17,10,'7-day streak',{f:'#5A2FE0',w:800})}</g>
`);
// security: shield + device alert
out.security=svg(`
${card(60,40,150,110,`<rect x="14" y="14" width="122" height="14" rx="7" fill="#EFEAFF"/>${bar(14,40,90,'#16122B',.8,6)}${bar(14,54,120,'#7A7692',.4,5)}${bar(14,66,100,'#7A7692',.4,5)}<rect x="14" y="82" width="70" height="18" rx="9" fill="#6C3BFF"/>`)}
<g transform="translate(250 22)" filter="url(#sh)"><path d="M70 0 L134 20 V82 C134 122 104 148 70 164 C36 148 6 122 6 82 V20 Z" fill="#fff"/><path d="M70 14 L120 30 V82 C120 114 97 134 70 148 C43 134 20 114 20 82 V30 Z" fill="url(#acc)"/>
<rect x="52" y="70" width="36" height="30" rx="6" fill="#fff"/><path d="M58 70 v-10 a12 12 0 0 1 24 0 v10" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/><circle cx="70" cy="85" r="4" fill="#5A2FE0"/><rect x="68" y="86" width="4" height="9" rx="2" fill="#5A2FE0"/></g>
${card(398,48,92,52,`<circle cx="22" cy="26" r="11" fill="#DCFCE7"/>${check(22,26,9,'#16A34A').replace('stroke="#5A2FE0"','stroke="#fff"')}${bar(40,20,40,'#16122B',.8,5)}${bar(40,31,28,'#7A7692',.4,4)}`)}
${card(380,120,106,44,`<circle cx="20" cy="22" r="9" fill="#FEF3C7"/>${txt(17,26,11,'!',{f:'#B45309',w:800})}${bar(36,16,52,'#16122B',.8,5)}${bar(36,27,38,'#7A7692',.4,4)}`)}
`);
// reset: key + password field
out.reset=svg(`
${card(70,52,230,106,`${txt(18,28,10,'NEW PASSWORD',{f:'#7C55FF',ls:.8})}<rect x="18" y="38" width="194" height="26" rx="8" fill="#F4F1FF" stroke="#E0D8FF"/>${[0,1,2,3,4,5,6,7].map(i=>`<circle cx="${32+i*14}" cy="51" r="3.5" fill="#16122B"/>`).join('')}${bar(18,76,194,'#EFEAFF',1,6)}${bar(18,76,150,'#16A34A',1,6)}${txt(18,98,9,'Strong password',{f:'#16A34A',w:700})}`)}
<g transform="translate(330 40)" filter="url(#sh)"><circle cx="46" cy="50" r="42" fill="#fff"/><circle cx="46" cy="50" r="26" fill="none" stroke="url(#acc)" stroke-width="12"/><rect x="44" y="70" width="14" height="70" rx="4" fill="url(#acc)" transform="rotate(-0 0 0)"/><rect x="58" y="104" width="22" height="9" rx="3" fill="url(#acc)"/><rect x="58" y="120" width="16" height="9" rx="3" fill="url(#acc)"/></g>
`);
// code: phone showing digits
out.code=svg(`
${phone(70,18,`${txt(14,34,8,'VERIFY',{f:'#7C55FF',ls:.8})}${txt(14,50,11,'Enter code',{})}${[0,1,2,3,4,5].map(i=>`<rect x="${10+(i%3)*25}" y="${66+Math.floor(i/3)*30}" width="22" height="26" rx="7" fill="#fff" stroke="#E0D8FF"/>${txt(17+(i%3)*25,84+Math.floor(i/3)*30,13,'482916'[i],{w:800})}`).join('')}<rect x="10" y="132" width="64" height="24" rx="12" fill="#6C3BFF"/>${bar(28,141,28,'#fff',.9,5)}`)}
${card(240,40,220,56,`${txt(16,24,9,'YOUR CODE',{f:'#7C55FF',ls:.8})}${[0,1,2,3,4,5].map(i=>`<rect x="${16+i*32}" y="30" width="26" height="18" rx="5" fill="#F4F1FF"/>${txt(24+i*32,44,13,'482916'[i],{w:800})}`).join('')}`)}
${card(262,116,176,46,`<circle cx="24" cy="23" r="12" fill="#EFEAFF"/><circle cx="24" cy="23" r="6" fill="none" stroke="#6C3BFF" stroke-width="2.5"/><path d="M24 17v6l4 3" stroke="#6C3BFF" stroke-width="2.5" fill="none" stroke-linecap="round"/>${txt(46,20,10,'Expires in 10 min',{})}${txt(46,34,9,'Never share this code',{f:'#7A7692',w:600})}`)}
`);
// receipt: check + confetti + course card
const confetti=[[60,40,'#fff'],[110,28,'#E879F9'],[150,60,'#B6A3FF'],[430,34,'#fff'],[480,70,'#E879F9'],[400,176,'#B6A3FF'],[90,170,'#fff'],[30,100,'#B6A3FF'],[250,16,'#fff']].map(([x,y,c],i)=>i%2?`<rect x="${x}" y="${y}" width="9" height="4" rx="2" fill="${c}" transform="rotate(${i*35} ${x} ${y})"/>`:`<circle cx="${x}" cy="${y}" r="3.5" fill="${c}" fill-opacity=".9"/>`).join('');
out.receipt=svg(`${confetti}
<g transform="translate(70 40)" filter="url(#sh)"><circle cx="55" cy="55" r="55" fill="#fff"/><circle cx="55" cy="55" r="40" fill="url(#acc)"/>${check(55,55,40,'#fff').replace(/<circle[^>]*fill="#fff"\/>/,'')}</g>
${card(220,44,236,108,`<rect x="14" y="14" width="44" height="44" rx="11" fill="url(#acc)"/>${txt(28,44,20,'M',{f:'#fff',w:800})}${txt(68,28,11,'JAMB Mathematics',{})}${txt(68,42,9,'12 lessons · lifetime access',{f:'#7A7692',w:600})}${txt(68,54,9,'Unlocked',{f:'#16A34A',w:800})}<line x1="14" y1="72" x2="222" y2="72" stroke="#EFEAFF"/>${txt(14,92,9,'Total paid',{f:'#7A7692',w:600})}${txt(180,92,11,'₦8,500',{w:800})}`)}
`);
for(const [k,v] of Object.entries(out)) fs.writeFileSync(`hero-${k}.svg`,v);
