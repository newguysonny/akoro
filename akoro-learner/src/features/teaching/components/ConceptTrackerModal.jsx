import { useEffect, useState } from 'react';
import { apiDelete, apiGet } from '../../../services/api.js';
import { BRAND, RED } from '../../../constants.js';

const STATUS = { not_started:'Not started', introduced:'Introduced', learning:'Learning', confused:'Needs repair', understood:'Understood', mastered:'Mastered' };

/** Read-only learner projection of canonical tracker data; it has no scoring controls. */
export default function ConceptTrackerModal({ onClose }) {
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [clearing, setClearing] = useState(false);
  const load = async () => { try { setError(''); setData(await apiGet('/api/adaptive/chat/concept-tracker', { cache:false })); } catch (err) { setError(err?.message || 'Concept tracker is unavailable.'); } };
  useEffect(()=>{ load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const clearNotes = async () => { setClearing(true); try { await apiDelete('/api/adaptive/chat/concept-tracker/confusion-notes'); await load(); } catch (err) { setError(err?.message || 'Notes could not be cleared.'); } finally { setClearing(false); } };
  return <div className="ak-sheet-overlay" role="dialog" aria-modal="true" aria-label="Learning tracker" style={overlay}><div className="ak-sheet-panel" style={sheet}>
    <div style={header}><div><div style={{fontSize:16,fontWeight:900,color:'var(--ak-text)'}}>Learning tracker</div><div style={caption}>A compact view of reviewed learning evidence</div></div><button onClick={onClose} style={close} aria-label="Close">×</button></div>
    {error&&<div role="alert" style={errorBox}>{error}</div>}
    {!data&&!error&&<p style={body}>Loading tracker…</p>}
    {data?.enabled===false&&<p style={body}>The learning tracker is not enabled for this account yet.</p>}
    {data?.enabled&&<><div style={{display:'grid',gap:9}}>{data.concepts?.length ? data.concepts.map(item=><section key={item.conceptId} style={card}>
      <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'start'}}><div style={{fontSize:13,fontWeight:850,color:'var(--ak-text)'}}>{item.concept?.title || 'Approved concept'}</div><span style={badge(item.status)}>{STATUS[item.status] || 'Learning'}</span></div>
      {item.resumePoint&&<p style={{...body,marginTop:7}}>{item.resumePoint}</p>}
      {item.confusionNotes?.length>0&&<div style={{...caption,marginTop:7}}>Stored note: {item.confusionNotes[0].note}</div>}
    </section>) : <p style={body}>No reviewed concepts have been recorded yet.</p>}</div>
    {data.resumePoints?.length>0&&<section style={{...card,marginTop:12}}><div style={{fontSize:12,fontWeight:850,color:'var(--ak-text)',marginBottom:5}}>Resume points</div>{data.resumePoints.slice(0,3).map(point=><p key={`${point.curriculumKey}-${point.topicKey}`} style={{...body,marginTop:6}}><strong>{point.subject} · {point.topicKey}</strong><br/>{point.resumePoint}</p>)}</section>}
    {data.concepts?.some(item=>item.confusionNotes?.length)&&<button disabled={clearing} onClick={clearNotes} style={clearButton}>{clearing?'Clearing…':'Clear my stored confusion notes'}</button>}
    </>}
  </div></div>;
}
const overlay={position:'fixed',inset:0,zIndex:1600,background:'rgba(15,23,42,.64)',display:'flex',alignItems:'flex-end',justifyContent:'center',padding:'20px 12px',backdropFilter:'blur(3px)'}; const sheet={width:'min(620px,100%)',maxHeight:'calc(100vh - 30px)',overflowY:'auto',background:'var(--ak-surface)',border:'1px solid var(--ak-border2)',borderRadius:20,padding:18,boxShadow:'0 24px 80px rgba(0,0,0,.35)'}; const header={display:'flex',justifyContent:'space-between',gap:12,alignItems:'start',marginBottom:15}; const caption={fontSize:11,color:'var(--ak-text-muted)',fontWeight:650,lineHeight:1.4}; const body={fontSize:12.5,lineHeight:1.5,color:'var(--ak-text-sub)',margin:0}; const close={border:0,background:'var(--ak-surface-hover)',color:'var(--ak-text-sub)',borderRadius:9,width:30,height:30,fontWeight:900,fontSize:20,cursor:'pointer'}; const card={border:'1px solid var(--ak-border)',borderRadius:12,padding:11,background:'var(--ak-surface-hover)'}; const badge=(status)=>({fontSize:10,fontWeight:850,padding:'3px 7px',borderRadius:20,background:status==='confused'?`${RED}16`:`${BRAND}14`,color:status==='confused'?RED:BRAND,whiteSpace:'nowrap'}); const errorBox={padding:'9px 11px',marginBottom:12,borderRadius:10,background:`${RED}12`,color:RED,border:`1px solid ${RED}35`,fontSize:12,fontWeight:700}; const clearButton={marginTop:12,border:`1px solid ${RED}45`,borderRadius:10,padding:'9px 12px',background:`${RED}10`,color:RED,fontWeight:800,fontSize:12,cursor:'pointer'};
