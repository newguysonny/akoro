// Mid-session teacher switching — the bottom sheet.
import { BRAND } from '../../../constants.js';

export default function TeachAgentSwitcher({ reader }) {
  const { switchOpen, setSwitchOpen, switching, agentChoices, currentPair, performSwitch, t } = reader;

  return (
        <div className="ak-sheet-overlay" onClick={() => !switching && setSwitchOpen(false)}
          style={{ position:"fixed",inset:0,zIndex:3200,background:"rgba(6,6,18,.6)",
            backdropFilter:"blur(5px)",display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
          <div className="ak-sheet-panel" onClick={e => e.stopPropagation()}
            style={{ background:"var(--ak-surface)",width:"100%",maxWidth:540,maxHeight:"78vh",overflowY:"auto",
              borderRadius:"22px 22px 0 0",fontFamily:"'Nunito',sans-serif",
              animation:"sheet-up .28s cubic-bezier(.34,1.4,.6,1)",border:"1px solid var(--ak-border)" }}>
            <div style={{ padding:"12px 0 4px",display:"flex",justifyContent:"center" }}>
              <div style={{ width:38,height:4,borderRadius:4,background:"var(--ak-border3)" }}/>
            </div>
            <div style={{ padding:"6px 18px 26px" }}>
              <p style={{ fontSize:16,fontWeight:900,color:"var(--ak-text)",margin:"4px 0 3px" }}>{t('teaching.switch_teacher')}</p>
              <p style={{ fontSize:12,fontWeight:600,color:"var(--ak-text-muted)",margin:"0 0 16px",lineHeight:1.5 }}>
                {t('teaching.switch_sub')}
              </p>
              {!agentChoices ? (
                [0,1].map(i => <div key={i} style={{ height:64,borderRadius:14,background:"var(--ak-tag-bg)",marginBottom:9 }}/>)
              ) : (
                <div style={{ display:"flex",flexDirection:"column",gap:9 }}>
                  {agentChoices.map(a => {
                    const active = a.id === currentPair;
                    return (
                      <button key={a.id} onClick={() => performSwitch(a.id)} disabled={switching || active}
                        style={{ display:"flex",alignItems:"center",gap:12,textAlign:"left",
                          background:active?"rgba(108,59,255,.16)":"var(--ak-tag-bg)",
                          border:`1.5px solid ${active?BRAND:"var(--ak-border)"}`,borderRadius:14,
                          padding:"12px 14px",cursor:(switching||active)?"default":"pointer",width:"100%" }}>
                        <div style={{ width:42,height:42,borderRadius:12,flexShrink:0,display:"flex",
                          alignItems:"center",justifyContent:"center",fontSize:22,background:"var(--ak-tag-bg)" }}>{a.avatar}</div>
                        <div style={{ flex:1,minWidth:0 }}>
                          <div style={{ fontSize:13.5,fontWeight:800,color:"var(--ak-text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{a.name}</div>
                          <div style={{ fontSize:11,fontWeight:600,color:"var(--ak-text-muted)",marginTop:2 }}>
                            {a.kind === "platform" ? t('teaching.platform_default') : (a.teacher ? `by ${a.teacher}` : t('teaching.trained_agent'))}{a.subject ? ` · ${a.subject}` : ""}
                          </div>
                        </div>
                        {active && <span style={{ fontSize:10,fontWeight:900,color:BRAND,background:`${BRAND}22`,padding:"3px 9px",borderRadius:20,flexShrink:0 }}>{t('teaching.current')}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
  );
}
