import { useState } from 'react';
import { BRAND, RED, GREEN, GOLD, SUBJECTS, SUBJECT_COLORS } from '../../constants.js';
import { XIcon, ChevDownIcon } from '../common/Icons.jsx';
import { apiPost } from '../../services/api.js';
import { useLang } from '../../contexts/LanguageContext.jsx';

function ConfigModal({ initial, onStart, onCancel }) {
  const { t } = useLang();
  const [topic,      setTopic]      = useState(initial?.topic      || "");
  const [subject,    setSubject]    = useState(initial?.subject    || "Science");
  const [subtopics,  setSubtopics]  = useState(initial?.subtopics  || []);
  const [draft,      setDraft]      = useState("");
  const [objs,       setObjs]       = useState(initial?.objectives || {});
  const [generating, setGenerating] = useState(false);

  const subjects = ["Science","Biology","Chemistry","Physics","Maths","English","History","Geography"];

  const addSubtopic = (val) => {
    const v = val.trim();
    if (!v || subtopics.includes(v)) return;
    const next = [...subtopics, v];
    setSubtopics(next);
    if (!objs[v]) setObjs(o => ({ ...o, [v]: autoObjectives(v, topic || "this topic") }));
    setDraft("");
  };
  const removeSubtopic = (st) => {
    setSubtopics(s => s.filter(x => x !== st));
    setObjs(o => { const n={...o}; delete n[st]; return n; });
  };

  const generate = async () => {
    if (!topic.trim()) return;
    setGenerating(true);
    try {
      // Try real API first
      const data = await apiPost("/api/adaptive/teaching/configure", { topic, subject });
      if (data.subtopics?.length) {
        setSubtopics(data.subtopics);
        setObjs(data.objectives || {});
        setGenerating(false);
        return;
      }
    } catch { /* fall through to mock */ }
    // Mock fallback
    const generated = autoSubtopics(topic, subject);
    setSubtopics(generated);
    const newObjs = {};
    generated.forEach(st => { newObjs[st] = autoObjectives(st, topic); });
    setObjs(newObjs);
    setGenerating(false);
  };

  const updateObj = (st, idx, val) =>
    setObjs(o => ({ ...o, [st]: o[st].map((v, i) => i === idx ? val : v) }));

  const canStart = topic.trim() && subtopics.length > 0;

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16,fontFamily:"'Nunito',sans-serif" }}>
      <div style={{ background:"var(--ak-surface)",borderRadius:16,maxWidth:540,width:"100%",maxHeight:"90vh",overflowY:"auto",padding:"24px 22px",boxShadow:"0 20px 60px rgba(0,0,0,.25)",animation:"sheet-up .3s cubic-bezier(.32,1.2,.64,1)" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20 }}>
          <div>
            <h2 style={{ fontSize:16,fontWeight:800,color:"var(--ak-text)",margin:0 }}>{t('config.title')}</h2>
            <p style={{ fontSize:11.5,color:"var(--ak-text-sub)",margin:"3px 0 0" }}>{t('config.subtitle')}</p>
          </div>
          {onCancel && <button onClick={onCancel} style={{ width:30,height:30,borderRadius:"50%",border:"0.5px solid var(--ak-border2)",background:"var(--ak-bg)",cursor:"pointer",fontSize:14,color:"var(--ak-text-sub)" }}>✕</button>}
        </div>

        {/* Topic */}
        <div style={{ marginBottom:14 }}>
          <label style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-sec)",display:"block",marginBottom:5,letterSpacing:.3 }}>{t('config.topic')}</label>
          <input value={topic} onChange={e=>setTopic(e.target.value)} placeholder={t('config.topic_ph')}
            style={{ width:"100%",padding:"10px 13px",borderRadius:8,border:"0.5px solid var(--ak-border2)",fontSize:14,fontWeight:600,color:"var(--ak-text)",outline:"none",fontFamily:"inherit" }}
            onFocus={e=>e.target.style.borderColor=BRAND} onBlur={e=>e.target.style.borderColor="#D1D5DB"}/>
        </div>

        {/* Subject */}
        <div style={{ marginBottom:14 }}>
          <label style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-sec)",display:"block",marginBottom:5,letterSpacing:.3 }}>{t('config.subject')}</label>
          <select value={subject} onChange={e=>setSubject(e.target.value)} style={{ width:"100%",padding:"10px 13px",borderRadius:8,border:"0.5px solid var(--ak-border2)",fontSize:14,fontWeight:600,color:"var(--ak-text)",outline:"none",fontFamily:"inherit",background:"var(--ak-surface)" }}>
            {subjects.map(s=><option key={s}>{s}</option>)}
          </select>
        </div>

        {/* Subtopics */}
        <div style={{ marginBottom:14 }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7 }}>
            <label style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-sec)",letterSpacing:.3 }}>{t('config.subtopics')} ({subtopics.length})</label>
            <button onClick={generate} disabled={!topic.trim()||generating} style={{ padding:"4px 11px",borderRadius:6,border:`0.5px solid ${BRAND}`,background:generating?"var(--ak-bg)":`${BRAND}10`,color:!topic.trim()||generating?"var(--ak-text-muted)":BRAND,fontSize:11,fontWeight:700,cursor:topic.trim()&&!generating?"pointer":"default",fontFamily:"inherit" }}>
              {generating?`⏳ ${t('config.generating')}`:`✨ ${t('config.autogen')}`}
            </button>
          </div>
          {subtopics.length>0&&(
            <div style={{ display:"flex",flexWrap:"wrap",gap:6,marginBottom:8 }}>
              {subtopics.map((st,i)=>(
                <div key={st} style={{ display:"flex",alignItems:"center",gap:5,padding:"4px 9px",borderRadius:20,background:`${BRAND}10`,border:`0.5px solid ${BRAND}30`,fontSize:12,fontWeight:700,color:BRAND }}>
                  <span style={{ fontSize:9.5,color:"var(--ak-text-muted)",fontWeight:500 }}>{i+1}</span>{st}
                  <button onClick={()=>removeSubtopic(st)} style={{ background:"none",border:"none",cursor:"pointer",fontSize:11,color:"var(--ak-text-muted)",padding:0,lineHeight:1 }}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display:"flex",gap:8 }}>
            <input value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addSubtopic(draft);}}} placeholder={t('config.subtopic_ph')}
              style={{ flex:1,padding:"9px 12px",borderRadius:8,border:"0.5px solid var(--ak-border2)",fontSize:13,color:"var(--ak-text)",outline:"none",fontFamily:"inherit" }}
              onFocus={e=>e.target.style.borderColor=BRAND} onBlur={e=>e.target.style.borderColor="#D1D5DB"}/>
            <button onClick={()=>addSubtopic(draft)} style={{ padding:"9px 14px",borderRadius:8,border:"none",background:BRAND,color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer" }}>+</button>
          </div>
        </div>

        {/* Objectives */}
        {subtopics.length>0&&(
          <div style={{ marginBottom:20 }}>
            <label style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-sec)",display:"block",marginBottom:8,letterSpacing:.3 }}>{t('config.objectives')}</label>
            {subtopics.map(st=>(
              <div key={st} style={{ background:"var(--ak-bg)",border:"0.5px solid var(--ak-border2)",borderRadius:8,padding:"10px 12px",marginBottom:8 }}>
                <div style={{ fontSize:11.5,fontWeight:700,color:BRAND,marginBottom:6 }}>{st}</div>
                {(objs[st]||autoObjectives(st,topic)).map((obj,i)=>(
                  <input key={i} value={obj} onChange={e=>updateObj(st,i,e.target.value)}
                    style={{ width:"100%",padding:"5px 9px",borderRadius:6,border:"0.5px solid var(--ak-border2)",fontSize:12,color:"var(--ak-text-sec)",marginBottom:4,outline:"none",fontFamily:"inherit",background:"var(--ak-surface)" }}
                    onFocus={e=>e.target.style.borderColor=BRAND} onBlur={e=>e.target.style.borderColor="var(--ak-border2)"}/>
                ))}
              </div>
            ))}
          </div>
        )}

        <div style={{ display:"flex",gap:10 }}>
          {onCancel&&<button onClick={onCancel} style={{ flex:1,padding:"12px",borderRadius:10,border:"0.5px solid var(--ak-border2)",background:"var(--ak-bg)",fontSize:13,fontWeight:700,color:"var(--ak-text-sub)",cursor:"pointer",fontFamily:"inherit" }}>{t('common.cancel')}</button>}
          <button onClick={()=>{ if(!canStart) return; onStart({ topic, subject, subtopics, objectives:objs }); }}
            disabled={!canStart}
            style={{ flex:2,padding:"12px",borderRadius:10,border:"none",background:canStart?`linear-gradient(135deg,${BRAND},#4C1DCC)`:"var(--ak-border2)",fontSize:13,fontWeight:800,color:canStart?"#fff":"#9CA3AF",cursor:canStart?"pointer":"default",fontFamily:"inherit" }}>
            ▶ {t('config.start')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════ */

export default ConfigModal;
