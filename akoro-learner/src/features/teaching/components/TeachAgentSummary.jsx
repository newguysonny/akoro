// Summary screen — the session's mark sheet (own fullscreen container).
import { BRAND, RED, GREEN, GOLD, SUBJECT_COLORS } from '../../../constants.js';
import { XIcon, SparkleIcon, ZapIcon, BrainIcon, Icon } from '../../../components/common/Icons.jsx';

export default function TeachAgentSummary({ reader }) {
  const {
    activeTab, setActiveTab, loading, summary, summaryErr, generateSummary,
    onClose, t, subject, requestReview, review,
  } = reader;
  const sc = SUBJECT_COLORS[subject?.toLowerCase()] || BRAND;
  return (
      <div style={{ position:"fixed",inset:0,zIndex:3000,background:"var(--ak-bg)",
        display:"flex",flexDirection:"column",fontFamily:"'Nunito',sans-serif" }}>
        <div style={{ display:"flex",alignItems:"center",background:"var(--ak-tag-bg)",
          borderBottom:"1px solid var(--ak-border)",paddingTop:"calc(env(safe-area-inset-top, 0px) + 14px)" }}>
          {["chat","summary"].map(tab=>(
            <button key={tab} onClick={()=>setActiveTab(tab)}
              style={{ flex:1,padding:"10px 0",background:"none",border:"none",cursor:"pointer",
                fontSize:12,fontWeight:activeTab===tab?800:600,
                color:activeTab===tab?sc:"var(--ak-text-muted)",
                borderBottom:`2px solid ${activeTab===tab?sc:"transparent"}`,
                fontFamily:"'Nunito',sans-serif",transition:"all .2s" }}>
              {tab==="chat" ? t('teaching.tab_chat') : t('teaching.tab_summary')}
            </button>
          ))}
          <div onClick={onClose} style={{ width:36,height:36,borderRadius:"50%",background:"var(--ak-tag-bg)",
            display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",marginRight:12,flexShrink:0 }}>
            <XIcon size={15} color="var(--ak-text-muted)"/>
          </div>
        </div>
        <div style={{ flex:1,overflowY:"auto",padding:"16px" }}>
          {loading&&!summary?(
            <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"60%",gap:16 }}>
              <div style={{ width:56,height:56,borderRadius:"50%",background:`${sc}22`,border:`2px solid ${sc}`,display:"flex",alignItems:"center",justifyContent:"center",animation:"pulse-dot 1.2s ease-in-out infinite" }}><SparkleIcon size={22} color={sc}/></div>
              <p style={{ fontSize:14,fontWeight:700,color:"var(--ak-text-muted)",margin:0 }}>{t('teaching.generating_summary')}</p>
            </div>
          ):summaryErr?(
            <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"60%",gap:14,padding:"0 24px",textAlign:"center" }}>
              <p style={{ fontSize:14,fontWeight:700,color:"var(--ak-text-sub)",margin:0,lineHeight:1.6 }}>{summaryErr}</p>
              <button onClick={generateSummary} style={{ padding:"11px 22px",borderRadius:12,border:"none",background:`linear-gradient(135deg,${sc},${sc}CC)`,fontSize:13,fontWeight:800,color:"#fff",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>{t('common.retry') || 'Try again'}</button>
            </div>
          ):summary&&(
            <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
              <div style={{ background:`linear-gradient(135deg,${sc}22,${sc}10)`,border:`1.5px solid ${sc}30`,borderRadius:18,padding:"18px 16px" }}>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
                  <div><p style={{ fontSize:11,fontWeight:800,color:sc,margin:"0 0 3px",letterSpacing:.4 }}>{t('teaching.teaching_score')}</p><p style={{ fontSize:38,fontWeight:900,color:"var(--ak-text)",margin:0,fontFamily:"monospace" }}>{summary.teachingScore}<span style={{ fontSize:16,color:"var(--ak-text-muted)" }}>/100</span></p></div>
                  <div style={{ textAlign:"right" }}><p style={{ fontSize:10,fontWeight:700,color:"var(--ak-text-muted)",margin:"0 0 4px" }}>{t('teaching.xp_earned')}</p><div style={{ display:"flex",alignItems:"center",gap:5,justifyContent:"flex-end" }}><ZapIcon size={14} color={GOLD}/><span style={{ fontSize:20,fontWeight:900,color:GOLD }}>{summary.xpEarned}</span></div></div>
                </div>
              </div>
              <div style={{ background:"var(--ak-tag-bg)",border:"1px solid var(--ak-border)",borderRadius:14,padding:"14px" }}>
                <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:8 }}><BrainIcon size={13} color={sc}/><span style={{ fontSize:10.5,fontWeight:800,color:sc,letterSpacing:.3 }}>{t('teaching.agent_feedback')}</span></div>
                <p style={{ fontSize:13,fontWeight:600,color:"var(--ak-text-sec)",margin:0,lineHeight:1.6 }}>{summary.agentFeedback}</p>
              </div>
              {summary.keyConcepts?.length>0&&(
                <div style={{ background:"var(--ak-tag-bg)",border:"1px solid var(--ak-border)",borderRadius:14,padding:"14px" }}>
                  <p style={{ fontSize:10.5,fontWeight:800,color:"var(--ak-text-sub)",margin:"0 0 10px",letterSpacing:.3 }}>{t('teaching.key_concepts')}</p>
                  <div style={{ display:"flex",flexWrap:"wrap",gap:7 }}>{summary.keyConcepts.map((c,i)=><div key={i} style={{ background:`${sc}18`,border:`1px solid ${sc}30`,borderRadius:8,padding:"4px 11px" }}><span style={{ fontSize:11.5,fontWeight:700,color:sc }}>{c}</span></div>)}</div>
                </div>
              )}
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                <div style={{ background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.20)",borderRadius:14,padding:"12px" }}><p style={{ fontSize:10,fontWeight:800,color:GREEN,margin:"0 0 8px",letterSpacing:.3 }}>{t('teaching.strengths')}</p>{summary.strengthAreas?.map((s,i)=><p key={i} style={{ fontSize:11.5,fontWeight:600,color:"var(--ak-success-text)",margin:"0 0 4px",lineHeight:1.4 }}>· {s}</p>)}</div>
                <div style={{ background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.20)",borderRadius:14,padding:"12px" }}><p style={{ fontSize:10,fontWeight:800,color:GOLD,margin:"0 0 8px",letterSpacing:.3 }}>{t('teaching.gaps')}</p>{summary.gapsIdentified?.map((g,i)=><p key={i} style={{ fontSize:11.5,fontWeight:600,color:"var(--ak-warn-text)",margin:"0 0 4px",lineHeight:1.4 }}>· {g}</p>)}</div>
              </div>
              {/* Not a battle: you never battle the guide. It asks, your protégé answers, a mark sheet. */}
              <div style={{ background:`${BRAND}0C`,border:`1px solid ${BRAND}26`,borderRadius:14,padding:"13px 14px",display:"flex",alignItems:"center",gap:12 }}>
                <Icon name="ti-clipboard-check" size={22} color={BRAND}/>
                <div style={{ flex:1,minWidth:0 }}>
                  <p style={{ fontSize:12.5,fontWeight:900,color:"var(--ak-text)",margin:0 }}>Review with your teaching guide</p>
                  <p style={{ fontSize:11.5,fontWeight:600,color:"var(--ak-text-sub)",margin:"2px 0 0",lineHeight:1.45 }}>Your guide asks questions on what you just taught; your protégé answers. A mark sheet, no opponent.</p>
                  {review.msg&&<p style={{ fontSize:11.5,fontWeight:800,color:RED,margin:"6px 0 0" }}>{review.msg}</p>}
                </div>
                <button onClick={requestReview} disabled={review.busy} style={{ padding:"9px 14px",borderRadius:12,border:"none",background:BRAND,color:"#fff",fontSize:12.5,fontWeight:900,cursor:review.busy?"default":"pointer",opacity:review.busy?.6:1,fontFamily:"'Nunito',sans-serif",flexShrink:0 }}>{review.busy?"Starting…":"Request a review"}</button>
              </div>
              <button onClick={onClose} style={{ padding:"13px",borderRadius:14,border:"none",background:`linear-gradient(135deg,${sc},${sc}CC)`,fontSize:13,fontWeight:800,color:"#fff",cursor:"pointer",fontFamily:"'Nunito',sans-serif",marginBottom:8 }}>{t('teaching.save_close')}</button>
            </div>
          )}
        </div>
      </div>
  );
}
