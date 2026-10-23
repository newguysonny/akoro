import { useEffect, useRef, useState } from 'react';
import { BRAND, RED, GREEN, GOLD, SUBJECTS, SUBJECT_COLORS } from '../../constants.js';
import { XIcon, ChevDownIcon, Icon } from '../common/Icons.jsx';
import { apiGet, apiPost, apiUpload } from '../../services/api.js';
import { useLang } from '../../contexts/LanguageContext.jsx';

// Default objective placeholders for a manually-added subtopic. These are just
// editable prompts the user fills in before starting — the real subtopics and
// AI-generated objectives come from POST /api/adaptive/teaching/configure.
const autoObjectives = (subtopic, topic) => [
  `Define and explain ${subtopic} in the context of ${topic}`,
  `Identify the key causes and effects of ${subtopic}`,
  `Apply knowledge of ${subtopic} to real-world examples`,
];

// The session-reference endpoint reads text from these formats and returns a
// capped text context. Avoid presenting image/Word files as supported when the
// session cannot yet use them truthfully.
const REFERENCE_ACCEPT = 'application/pdf,text/plain,text/markdown,text/csv,.pdf,.txt,.md,.csv';
const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;
const isReferenceFile = (file) => file && (
  file.type === 'application/pdf' || ['text/plain', 'text/markdown', 'text/csv'].includes(file.type) || /\.(pdf|txt|md|csv)$/i.test(file.name)
);
const bytesLabel = (bytes) => bytes < 1024 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024))} KB`
  : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const fileKey = (file) => `${file.name}:${file.size}:${file.lastModified}`;

// A syllabus topic fills the outline: its content points become the subtopics
// and its performance objectives are shared out across them in order (the
// syllabus lists objectives per topic, the session wants them per subtopic).
// A subtopic left without one keeps the editable placeholder prompts.
const MAX_SYLLABUS_SUBTOPICS = 8;
function outlineFromSyllabus(entry) {
  const subtopics = [...new Set((entry.content || []).map((c) => String(c).trim()).filter(Boolean))].slice(0, MAX_SYLLABUS_SUBTOPICS);
  const objectives = (entry.performance_objectives || []).map((o) => String(o).trim()).filter(Boolean);
  const per = subtopics.length ? Math.max(1, Math.ceil(objectives.length / subtopics.length)) : 0;
  const objs = {};
  subtopics.forEach((st, i) => {
    const mine = objectives.slice(i * per, i * per + per);
    objs[st] = mine.length ? mine : autoObjectives(st, entry.title);
  });
  return { subtopics, objs };
}

function ConfigModal({ initial, onStart, onCancel, higherEd = false }) {
  const { t } = useLang();
  const [topic,      setTopic]      = useState(initial?.topic      || "");
  const [subject,    setSubject]    = useState(initial?.subject    || "Science");
  // Topic comes from the class syllabus by default; "Type your own" switches to
  // free text. A topic handed in by another screen starts as free text.
  const [manualTopic, setManualTopic] = useState(!!initial?.topic);
  const [syllabus,   setSyllabus]   = useState({ status: "loading", topics: [], matchedClass: true });
  const [pickedId,   setPickedId]   = useState("");
  const [yearGroup,  setYearGroup]  = useState("");
  const [subtopics,  setSubtopics]  = useState(initial?.subtopics  || []);
  const [draft,      setDraft]      = useState("");
  const [objs,       setObjs]       = useState(initial?.objectives || {});
  const [generating, setGenerating] = useState(false);
  const [referenceFile, setReferenceFile] = useState(null);
  const [reference, setReference]         = useState(null);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [referenceError, setReferenceError] = useState("");
  const fileInputRef = useRef(null);

  const subjects = ["Science","Biology","Chemistry","Physics","Maths","English","History","Geography"];

  useEffect(() => {
    let alive = true;
    apiGet("/api/profiles/me").then((d) => { if (alive) setYearGroup((d?.data ?? d)?.yearGroup || (d?.data ?? d)?.year_group || ""); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // The syllabus topics for the chosen subject (and the learner's class).
  useEffect(() => {
    let alive = true;
    setSyllabus((s) => ({ ...s, status: "loading" }));
    const qs = `subject=${encodeURIComponent(subject)}${yearGroup ? `&class=${encodeURIComponent(yearGroup)}` : ""}`;
    apiGet(`/api/curriculum/topics?${qs}`)
      .then((r) => {
        if (!alive) return;
        const topics = r?.data || [];
        setSyllabus({ status: topics.length ? "ready" : "empty", topics, matchedClass: r?.matchedClass !== false });
        if (!topics.length) setManualTopic(true);
      })
      .catch(() => { if (alive) { setSyllabus({ status: "empty", topics: [], matchedClass: true }); setManualTopic(true); } });
    return () => { alive = false; };
  }, [subject, yearGroup]);

  const changeSubject = (next) => {
    setSubject(next);
    // A topic (and the outline) that came from the old subject's syllabus no longer applies.
    if (pickedId) { setPickedId(""); setTopic(""); setSubtopics([]); setObjs({}); setGenError(""); }
  };
  const pickSyllabusTopic = (id) => {
    setPickedId(id);
    const entry = syllabus.topics.find((x) => x.id === id);
    if (!entry) { setTopic(""); return; }
    const { subtopics: sts, objs: o } = outlineFromSyllabus(entry);
    setTopic(entry.title); setSubtopics(sts); setObjs(o); setGenError("");
  };
  const toggleTopicMode = () => {
    // Back to the syllabus list: a typed topic isn't one of its entries, so don't leave it behind.
    if (manualTopic && !pickedId) setTopic("");
    setManualTopic((m) => !m);
  };

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

  const [genError, setGenError] = useState("");

  const chooseReference = (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = ""; // allow choosing the same file again after removing it
    if (!file) return;
    if (!isReferenceFile(file)) {
      setReferenceError("Use a PDF, TXT, Markdown, or CSV file.");
      return;
    }
    if (file.size > MAX_REFERENCE_BYTES) {
      setReferenceError("That file is too large. Choose one up to 5 MB.");
      return;
    }
    setReferenceFile(file);
    setReference(null);
    setReferenceError("");
  };

  // Upload and extract once; both “Generate structure” and “Start session”
  // reuse this capped text result rather than uploading the document twice.
  const prepareReference = async () => {
    if (!referenceFile) return null;
    if (reference?.fileKey === fileKey(referenceFile)) return reference;

    setReferenceLoading(true);
    setReferenceError("");
    try {
      const form = new FormData();
      form.append("file", referenceFile, referenceFile.name);
      const result = await apiUpload("/api/adaptive/teaching/reference", form);
      const parsed = result?.data;
      if (!parsed?.text) throw new Error("We couldn't read text from that file.");
      const next = { ...parsed, fileKey: fileKey(referenceFile) };
      setReference(next);
      return next;
    } catch (err) {
      const message = err?.message || "Couldn't read that reference file.";
      setReferenceError(message);
      throw err;
    } finally {
      setReferenceLoading(false);
    }
  };

  const generate = async () => {
    if (!topic.trim() || generating || referenceLoading) return;
    setGenerating(true);
    setGenError("");
    try {
      const sessionReference = await prepareReference();
      const data = await apiPost("/api/adaptive/teaching/configure", {
        topic,
        subject,
        reference: sessionReference && {
          name: sessionReference.name,
          text: sessionReference.text,
          truncated: sessionReference.truncated,
        },
      });
      if (data.subtopics?.length) {
        setSubtopics(data.subtopics);
        setObjs(data.objectives || {});
      } else {
        setGenError("No subtopics were generated. Add them manually below.");
      }
    } catch (err) {
      console.warn("[ConfigModal] generate failed:", err.message);
      setGenError(err?.message || "Couldn't auto-generate subtopics. Add them manually below.");
    } finally {
      setGenerating(false);
    }
  };

  const updateObj = (st, idx, val) =>
    setObjs(o => ({ ...o, [st]: o[st].map((v, i) => i === idx ? val : v) }));

  const canStart = topic.trim() && subtopics.length > 0;
  const start = async () => {
    if (!canStart || referenceLoading) return;
    setGenError("");
    try {
      const sessionReference = await prepareReference();
      onStart({
        topic, subject, subtopics, objectives: objs,
        reference: sessionReference && {
          name: sessionReference.name,
          text: sessionReference.text,
          chars: sessionReference.chars,
          truncated: sessionReference.truncated,
        },
      });
    } catch (err) {
      // The field itself carries the actionable file error. Keep a second,
      // visible message near Start for someone who has scrolled past it.
      setGenError(err?.message || "Couldn't prepare that reference file.");
    }
  };

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16,fontFamily:"'Nunito',sans-serif" }}>
      <div style={{ background:"var(--ak-surface)",borderRadius:16,maxWidth:540,width:"100%",maxHeight:"90vh",overflowY:"auto",padding:"24px 22px",boxShadow:"0 20px 60px rgba(0,0,0,.25)",animation:"sheet-up .3s cubic-bezier(.32,1.2,.64,1)" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20 }}>
          <div>
            <h2 style={{ fontSize:16,fontWeight:800,color:"var(--ak-text)",margin:0 }}>{t('config.title')}</h2>
            <p style={{ fontSize:11.5,color:"var(--ak-text-sub)",margin:"3px 0 0" }}>{t('config.subtitle')}</p>
          </div>
          {onCancel && <button onClick={onCancel} style={{ width:30,height:30,borderRadius:"50%",border:"0.5px solid var(--ak-border2)",background:"var(--ak-bg)",cursor:"pointer",fontSize:14,color:"var(--ak-text-sub)" }}><Icon name="ti-x" size={14}/></button>}
        </div>

        {/* 1 · Subject */}
        <div style={{ marginBottom:14 }}>
          <label style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-sec)",display:"block",marginBottom:5,letterSpacing:.3 }}>{t('config.subject')}</label>
          <select value={subject} onChange={e=>changeSubject(e.target.value)} style={{ width:"100%",padding:"10px 13px",borderRadius:8,border:"0.5px solid var(--ak-border2)",fontSize:14,fontWeight:600,color:"var(--ak-text)",outline:"none",fontFamily:"inherit",background:"var(--ak-surface)" }}>
            {subjects.map(s=><option key={s}>{s}</option>)}
          </select>
        </div>

        {/* 2 · Topic — from the class syllabus, or typed (the toggle sits on the right, like Auto-generate below) */}
        <div style={{ marginBottom:14 }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5,gap:8 }}>
            <label style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-sec)",letterSpacing:.3 }}>{t('config.topic')}</label>
            {syllabus.status==="ready"&&(
              <button type="button" onClick={toggleTopicMode} style={{ padding:"4px 11px",borderRadius:6,border:`0.5px solid ${BRAND}`,background:`${BRAND}10`,color:BRAND,fontSize:11,fontWeight:800,cursor:"pointer",display:"flex",alignItems:"center",gap:4,fontFamily:"inherit",whiteSpace:"nowrap" }}>
                {manualTopic?<><Icon name="ti-list-search" size={11}/> {t('config.topic_syllabus')}</>:<><Icon name="ti-pencil" size={11}/> {t('config.topic_manual')}</>}
              </button>
            )}
          </div>
          {manualTopic||syllabus.status!=="ready" ? (
            <>
              <input value={topic} onChange={e=>{ setTopic(e.target.value); setPickedId(""); }} placeholder={t('config.topic_ph')}
                style={{ width:"100%",padding:"10px 13px",borderRadius:8,border:"0.5px solid var(--ak-border2)",fontSize:14,fontWeight:600,color:"var(--ak-text)",outline:"none",fontFamily:"inherit" }}
                onFocus={e=>e.target.style.borderColor=BRAND} onBlur={e=>e.target.style.borderColor="#D1D5DB"}/>
              {syllabus.status==="loading"&&<p style={{ fontSize:10.5,color:"var(--ak-text-muted)",margin:"5px 1px 0" }}>{t('config.syllabus_loading')}</p>}
              {syllabus.status==="empty"&&<p style={{ fontSize:10.5,color:"var(--ak-text-muted)",margin:"5px 1px 0" }}>{t('config.syllabus_empty')}</p>}
            </>
          ) : (
            <select value={pickedId} onChange={e=>pickSyllabusTopic(e.target.value)}
              style={{ width:"100%",padding:"10px 13px",borderRadius:8,border:"0.5px solid var(--ak-border2)",fontSize:14,fontWeight:600,color:pickedId?"var(--ak-text)":"var(--ak-text-muted)",outline:"none",fontFamily:"inherit",background:"var(--ak-surface)" }}>
              <option value="">{t('config.topic_pick')}</option>
              {syllabus.topics.map(x=><option key={x.id} value={x.id}>{x.title}{!syllabus.matchedClass&&x.class_label?` · ${x.class_label}`:""}</option>)}
            </select>
          )}
          {!manualTopic&&syllabus.status==="ready"&&!syllabus.matchedClass&&<p style={{ fontSize:10.5,color:"var(--ak-text-muted)",margin:"5px 1px 0" }}>{t('config.other_class')}</p>}
          {pickedId&&!manualTopic&&<p style={{ fontSize:10.5,fontWeight:700,color:GREEN,margin:"5px 1px 0",display:"flex",alignItems:"center",gap:4 }}><Icon name="ti-circle-check" size={11}/> {t('config.from_syllabus')}</p>}
        </div>

        {/* Higher-ed reference — extracted on demand and used only for this live session. */}
        {higherEd && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--ak-text-sec)", letterSpacing: .3 }}>Reference file <span style={{ color: "var(--ak-text-muted)", fontWeight: 600 }}>(optional)</span></label>
              {reference?.truncated && <span style={{ fontSize: 10, fontWeight: 700, color: GOLD }}>First 12,000 characters used</span>}
            </div>
            <input ref={fileInputRef} type="file" accept={REFERENCE_ACCEPT} onChange={chooseReference} style={{ display: "none" }}/>
            {referenceFile ? (
              <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 11px", border: `1px solid ${reference ? `${GREEN}55` : `${BRAND}45`}`, borderRadius: 9, background: reference ? `${GREEN}08` : `${BRAND}08` }}>
                <Icon name="ti-file-text" size={17} color={reference ? GREEN : BRAND}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ak-text)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{referenceFile.name}</p>
                  <p style={{ fontSize: 10.5, fontWeight: 600, color: reference ? GREEN : "var(--ak-text-muted)", margin: "2px 0 0" }}>
                    {referenceLoading ? "Reading reference…" : reference ? `Ready · ${reference.chars.toLocaleString()} characters` : `${bytesLabel(referenceFile.size)} · read when you generate or start`}
                  </p>
                </div>
                <button type="button" onClick={() => { setReferenceFile(null); setReference(null); setReferenceError(""); }} aria-label="Remove reference file"
                  style={{ width: 27, height: 27, borderRadius: "50%", border: "none", background: "transparent", color: "var(--ak-text-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon name="ti-x" size={14}/>
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => fileInputRef.current?.click()}
                style={{ width: "100%", padding: "11px 12px", borderRadius: 9, border: `1px dashed ${BRAND}88`, background: `${BRAND}06`, cursor: "pointer", color: BRAND, display: "flex", alignItems: "center", gap: 8, textAlign: "left", fontFamily: "inherit" }}>
                <Icon name="ti-paperclip" size={17}/>
                <span style={{ fontSize: 12.5, fontWeight: 800 }}>Upload a PDF, TXT, Markdown, or CSV</span>
              </button>
            )}
            <p style={{ fontSize: 10.5, color: "var(--ak-text-muted)", margin: "5px 1px 0", lineHeight: 1.4 }}>Its text guides this session’s lesson plan and tutor responses. It is not stored after the session.</p>
            {referenceError && <p style={{ fontSize: 11.5, fontWeight: 700, color: RED, margin: "5px 1px 0" }}>{referenceError}</p>}
          </div>
        )}

        {/* Subtopics */}
        <div style={{ marginBottom:14 }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7 }}>
            <label style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-sec)",letterSpacing:.3 }}>{t('config.subtopics')} ({subtopics.length})</label>
            <button onClick={generate} disabled={!topic.trim()||generating} style={{ padding:"4px 11px",borderRadius:6,border:`0.5px solid ${BRAND}`,background:generating?"var(--ak-bg)":`${BRAND}10`,color:!topic.trim()||generating?"var(--ak-text-muted)":BRAND,fontSize:11,fontWeight:700,cursor:topic.trim()&&!generating?"pointer":"default",fontFamily:"inherit" }}>
              {generating?<><Icon name="ti-hourglass" size={11}/> {t('config.generating')}</>:<><Icon name="ti-sparkles" size={11}/> {t('config.autogen')}</>}
            </button>
          </div>
          {genError&&(
            <div style={{ fontSize:11.5,fontWeight:600,color:RED,marginBottom:8 }}>{genError}</div>
          )}
          {subtopics.length>0&&(
            <div style={{ display:"flex",flexWrap:"wrap",gap:6,marginBottom:8 }}>
              {subtopics.map((st,i)=>(
                <div key={st} style={{ display:"flex",alignItems:"center",gap:5,padding:"4px 9px",borderRadius:20,background:`${BRAND}10`,border:`0.5px solid ${BRAND}30`,fontSize:12,fontWeight:700,color:BRAND }}>
                  <span style={{ fontSize:9.5,color:"var(--ak-text-muted)",fontWeight:500 }}>{i+1}</span>{st}
                  <button onClick={()=>removeSubtopic(st)} style={{ background:"none",border:"none",cursor:"pointer",fontSize:11,color:"var(--ak-text-muted)",padding:0,lineHeight:1 }}><Icon name="ti-x" size={11}/></button>
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
          <button onClick={start}
            disabled={!canStart || referenceLoading}
            style={{ flex:2,padding:"12px",borderRadius:10,border:"none",background:canStart&&!referenceLoading?`linear-gradient(135deg,${BRAND},#4C1DCC)`:"var(--ak-border2)",fontSize:13,fontWeight:800,color:canStart&&!referenceLoading?"#fff":"#9CA3AF",cursor:canStart&&!referenceLoading?"pointer":"default",fontFamily:"inherit" }}>
            <Icon name={referenceLoading ? "ti-hourglass" : "ti-player-play"} size={12}/> {referenceLoading ? "Preparing reference…" : t('config.start')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════ */

export default ConfigModal;
