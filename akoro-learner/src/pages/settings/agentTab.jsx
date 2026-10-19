/**
 * Settings — Agent tab (the learner's AI agent identity & subjects).
 */
import { useState, useEffect, useCallback } from 'react';
import {
  BRAND, RED, ORANGE, ALL_SUBJECTS, SUBJ_ICON,
  STUDY_LEVELS, YEARS, EXAM_BOARDS, GOALS,
  Icon, Toggle, ProgressBar, SubjectChip, Section, Row, AvatarCircle, SubjectsRow,
} from './shared.jsx';
import { AvatarPickerSheet, SubjectsSheet, GenericSheet } from './sheets.jsx';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../services/api.js';
import Spinner from '../../components/common/Spinner.jsx';
import AgentNetworkSection from './networkSection.jsx';
import MyToolsSection from './myToolsSection.jsx';
import MemorySection from './memorySection.jsx';
import AutonomySection from './autonomySection.jsx';
import { useInFlight } from '../../hooks/useInFlight.js';
import { confirmDialog } from '../../components/common/ConfirmHost.jsx';

/* "47 days left" for a goal with a date still ahead. */
const daysLeft = (d) => { const n = d ? Math.ceil((new Date(d).getTime() - Date.now()) / 864e5) : null; return n != null && n >= 0 ? `${n} day${n === 1 ? '' : 's'} left` : ''; };

/* ─── Agent tab ───────────────────────────────────────────────── */
function AgentTab({ agent, setAgent, onSaveAgent }) {
  const { t } = useLang();
  const [sheet,        setSheet]        = useState(null);
  const [subjectSheet, setSubjectSheet] = useState(false);
  const [avatarSheet,  setAvatarSheet]  = useState(false);
  const [toast,        setToast]        = useState('');

  const showToast = m => { setToast(m); setTimeout(()=>setToast(''),2200); };
  const openSheet = (f,l,t,o) => setSheet({field:f,label:l,type:t,options:o});

  // -- Goals (Full Autonomy spine) -- real educational goals, not just the
  // legacy single category. The agent reads these for every suggestion.
  const [goals, setGoals]           = useState([]);
  const [goalsLoaded, setGoalsLoaded] = useState(false);
  const [goalSheet, setGoalSheet]   = useState(false);
  const [gTitle, setGTitle]         = useState('');
  const [gCat, setGCat]             = useState('');
  const [gDate, setGDate]           = useState('');
  const [gErr, setGErr]             = useState('');
  const { busy: goalBusy, run: runGoalSave } = useInFlight();

  const loadGoals = useCallback(() => {
    apiGet('/api/goals').then(d => setGoals(d?.data ?? [])).catch(() => {}).finally(() => setGoalsLoaded(true));
  }, []);
  useEffect(() => { loadGoals(); }, [loadGoals]);

  const addGoal = () => runGoalSave(async () => {
    if (!gTitle.trim()) return;
    setGErr('');
    try {
      const d = await apiPost('/api/goals', {
        title: gTitle.trim(),
        category: gCat || undefined,
        target_date: gDate || undefined,
      });
      setGoals(prev => [d?.data, ...prev].filter(Boolean));
      setGTitle(''); setGCat(''); setGDate(''); setGoalSheet(false);
      showToast('Goal added');
    } catch (e) { setGErr(e?.message || 'Could not save the goal. Try again.'); }
  });

  const toggleAchieved = async (g) => {
    const next = g.status === 'achieved' ? 'active' : 'achieved';
    try {
      const d = await apiPatch(`/api/goals/${g.id}`, { status: next });
      setGoals(prev => prev.map(x => x.id === g.id ? (d?.data ?? { ...g, status: next }) : x));
      showToast(next === 'achieved' ? 'Goal achieved - well done!' : 'Goal reopened');
    } catch { showToast('Could not update the goal'); }
  };

  const removeGoal = async (g) => {
    if (!(await confirmDialog({ title: 'Remove goal', message: `Remove "${g.title}"? This cannot be undone.`, confirmLabel: 'Remove' }))) return;
    try {
      await apiDelete(`/api/goals/${g.id}`);
      setGoals(prev => prev.filter(x => x.id !== g.id));
    } catch { showToast('Could not remove the goal'); }
  };

  const saveField = useCallback(async (field, val) => {
    const updated = { ...agent, [field]: val };
    setAgent(updated);
    try { await onSaveAgent({ [field]: val }); showToast('Saved'); }
    catch { showToast('Saved locally'); }
  }, [agent, onSaveAgent, setAgent]);

  const stats = [
    { icon:'ti-book',          label:t('settings.topics_taught'),  value:(agent.totalSessions||0)*4 },
    { icon:'ti-bulb',          label:t('settings.avg_confidence'), value:`${agent.knowledgeScore||0}%` },
    { icon:'ti-circle-check',  label:t('agent.sessions_done'),  value:agent.totalSessions||0 },
    { icon:'ti-message-circle',label:t('agent.total_turns'),    value:agent.totalTurns||0 },
    { icon:'ti-bolt',          label:t('settings.xp_earned'),      value:(agent.xpEarned||0).toLocaleString() },
    { icon:'ti-star',          label:t('settings.agent_level'),    value:`${t('agent.level')} ${agent.level||1}` },
  ];
  const color    = agent.color || ORANGE;
  const levelPct = Math.min(100,((agent.level||1)/10)*100);

  return (
    <div style={{ padding:'20px 0 0' }}>
      {/* Agent hero */}
      <div style={{ background:'var(--ak-surface)',margin:'0 16px 16px',borderRadius:18,
        padding:'18px 16px',border:`1.5px solid ${color}25`,
        boxShadow:'0 1px 6px rgba(0,0,0,.06)',
        display:'flex',alignItems:'center',gap:14 }}>
        <AvatarCircle photoUrl={agent.photoUrl} emoji={agent.emoji||'🤖'}
          color={color} size={64} onPhotoClick={()=>setAvatarSheet(true)}/>
        <div style={{ flex:1 }}>
          <p style={{ margin:'0 0 2px',fontSize:17,fontWeight:900,
            color:'var(--ak-text)',fontFamily:"'Nunito',sans-serif" }}>{agent.name||t('agent.my_agent')}</p>
          <p style={{ margin:'0 0 8px',fontSize:12.5,color:'var(--ak-text-sub)',
            fontFamily:"'Nunito',sans-serif" }}>{t('settings.your_ai_agent')}</p>
          <div style={{ display:'flex',gap:6,flexWrap:'wrap' }}>
            <span style={{ fontSize:11,fontWeight:800,padding:'3px 10px',borderRadius:8,
              background:`${color}15`,color }}>
              {agent.studyLevel||t('settings.student')}</span>
            <span style={{ fontSize:11,fontWeight:800,padding:'3px 10px',borderRadius:8,
              background:'var(--ak-tag-bg)',color:'var(--ak-text-sub)' }}>
              Lv.{agent.level||1}</span>
          </div>
        </div>
      </div>

      {/* Level progress */}
      <div style={{ margin:'0 16px 16px',background:'var(--ak-surface)',borderRadius:14,
        padding:'14px 16px',border:'1px solid var(--ak-border)',boxShadow:'0 1px 4px rgba(0,0,0,.04)' }}>
        <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8 }}>
          <span style={{ fontSize:12,fontWeight:800,color:'var(--ak-text-sec)',fontFamily:"'Nunito',sans-serif" }}>
            <Icon name="ti-star" size={13} color={color} style={{ marginRight:5 }}/>
            {t('settings.agent_level')} {agent.level||1}
          </span>
          <span style={{ fontSize:11.5,fontWeight:600,color:'var(--ak-text-muted)',fontFamily:"'Nunito',sans-serif" }}>
            {agent.totalTurns||0} {t('settings.turns')} · {(agent.xpEarned||0).toLocaleString()} XP
          </span>
        </div>
        <ProgressBar pct={levelPct} color={color}/>
        <p style={{ fontSize:11,color:'var(--ak-text-muted)',margin:'6px 0 0',fontFamily:"'Nunito',sans-serif" }}>
          {t('agent.level')} {agent.level||1} → {(agent.level||1)+1} · {Math.round(100-levelPct)}% {t('settings.remaining')}
        </p>
      </div>

      {/* Stats grid */}
      <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,margin:'0 16px 20px' }}>
        {stats.map(({icon,label,value})=>(
          <div key={label} style={{ background:'var(--ak-surface)',borderRadius:13,
            padding:'13px 14px',border:'1px solid var(--ak-border)',boxShadow:'0 1px 4px rgba(0,0,0,.04)' }}>
            <Icon name={icon} size={19} color={color} style={{ marginBottom:5,display:'block' }}/>
            <p style={{ margin:'0 0 1px',fontSize:18,fontWeight:900,
              color:'var(--ak-text)',fontFamily:"'Nunito',sans-serif" }}>{value}</p>
            <p style={{ margin:0,fontSize:11,color:'var(--ak-text-muted)',fontFamily:"'Nunito',sans-serif" }}>{label}</p>
          </div>
        ))}
      </div>

      <Section title={t('settings.agent_profile')}>
        <Row icon="ti-tag" label={t('settings.agent_name')} value={agent.name}
          onClick={()=>openSheet('name',t('settings.agent_name'),'text')}/>
        <Row icon="ti-writing" label={t('settings.personality')}
          sub={(agent.personality||t('settings.not_set')).slice(0,40)+(agent.personality?.length>40?'…':'')}
          onClick={()=>openSheet('personality',t('settings.agent_personality'),'textarea')}/>
        <Row icon="ti-palette" label={t('settings.agent_colour')}
          onClick={()=>openSheet('color',t('settings.agent_colour'),'accent')}>
          <div style={{ width:18,height:18,borderRadius:'50%',background:color,marginRight:6,flexShrink:0 }}/>
        </Row>
        <Row icon="ti-droplet" label={t('settings.card_bg')}
          onClick={()=>openSheet('bg',t('settings.card_bg'),'bg')}>
          <div style={{ width:18,height:18,borderRadius:'50%',
            background:agent.bg||'#FEF0E6',border:'1px solid var(--ak-border2)',
            marginRight:6,flexShrink:0 }}/>
        </Row>
      </Section>

      <Section title={t('settings.study_profile')}>
        <Row icon="ti-school"      label={t('settings.study_level')}  value={agent.studyLevel||t('settings.not_set')}
          onClick={()=>openSheet('studyLevel',t('settings.study_level'),'select',STUDY_LEVELS)}/>
        <Row icon="ti-calendar"    label={t('settings.year_grade')} value={agent.yearGroup||t('settings.not_set')}
          onClick={()=>openSheet('yearGroup',t('settings.year_grade'),'select',YEARS)}/>
        <Row icon="ti-certificate" label={t('settings.exam_board')}   value={agent.examBoard||t('settings.not_set')}
          onClick={()=>openSheet('examBoard',t('settings.exam_board'),'select',EXAM_BOARDS)}/>
        <SubjectsRow subjects={agent.subjects||[]}
          onClick={()=>setSubjectSheet(true)} color={color}/>
      </Section>

      <Section title={t('settings.goals')}>
        {!goalsLoaded ? (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 4px', fontSize:12, color:'var(--ak-text-muted)', fontFamily:"'Nunito',sans-serif" }}>
            <Spinner size={12} color="var(--ak-text-muted)"/> Loading goals…
          </div>
        ) : goals.length === 0 ? (
          <p style={{ fontSize:12, color:'var(--ak-text-muted)', margin:'2px 0 10px', fontFamily:"'Nunito',sans-serif" }}>{t('settings.goals_empty')}</p>
        ) : goals.map(g => (
          <div key={g.id} style={{ display:'flex', alignItems:'center', gap:9, padding:'9px 4px', borderBottom:'1px solid var(--ak-border)' }}>
            <button onClick={()=>toggleAchieved(g)} title={g.status==='achieved'?'Reopen goal':'Mark achieved'}
              style={{ width:22,height:22,borderRadius:6,border:`2px solid ${g.status==='achieved'?'var(--ak-green, #10B981)':'var(--ak-border3, #D6D3E0)'}`,background:g.status==='achieved'?'var(--ak-green, #10B981)':'transparent',cursor:'pointer',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:11,fontWeight:900 }}>
              {g.status==='achieved'?'✓':''}
            </button>
            <div style={{ flex:1,minWidth:0 }}>
              <p style={{ fontSize:12.5,fontWeight:g.status==='achieved'?600:800,color:g.status==='achieved'?'var(--ak-text-muted)':'var(--ak-text)',margin:0,textDecoration:g.status==='achieved'?'line-through':'none',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',fontFamily:"'Nunito',sans-serif" }}>{g.title}</p>
              {(g.category||g.target_date)&&<p style={{ fontSize:10.5,color:'var(--ak-text-muted)',margin:'2px 0 0',fontFamily:"'Nunito',sans-serif" }}>{[g.category,g.target_date?`by ${g.target_date}`:'',daysLeft(g.target_date)].filter(Boolean).join(' · ')}</p>}
              {/* The agent's weekly line, from real numbers only (§7.16.5). */}
              {g.progress_note&&g.status!=='achieved'&&<p data-goal-progress="" style={{ fontSize:10.5,color:'var(--ak-text-sub)',margin:'2px 0 0',fontWeight:700,fontFamily:"'Nunito',sans-serif" }}>{g.progress_note}</p>}
            </div>
            <button onClick={()=>removeGoal(g)} title="Remove" style={{ width:26,height:26,borderRadius:8,border:'1px solid var(--ak-border2, #E3E0EE)',background:'transparent',color:'var(--ak-text-muted)',cursor:'pointer',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center' }}>×</button>
          </div>
        ))}
        <button onClick={()=>{ setGErr(''); setGoalSheet(true); }} style={{ display:'flex',alignItems:'center',justifyContent:'center',gap:6,width:'100%',marginTop:10,padding:'10px',borderRadius:12,border:`1.5px dashed ${BRAND}`,background:'transparent',color:BRAND,fontSize:12,fontWeight:800,cursor:'pointer',fontFamily:"'Nunito',sans-serif" }}>
          + {t('settings.goals_add')}
        </button>
      </Section>

      <Section title={t('settings.learning_goal')}>
        <Row icon="ti-target" label={t('settings.primary_goal')} value={agent.goal||t('settings.not_set')}
          onClick={()=>openSheet('goal',t('settings.primary_goal'),'select',GOALS)}/>
      </Section>
      <div style={{ height:40 }}/>

      {avatarSheet&&(
        <AvatarPickerSheet type="agent"
          current={{ emoji:agent.emoji, photoUrl:agent.photoUrl }}
          color={color}
          onClose={()=>setAvatarSheet(false)}
          onSavePhoto={async url=>{
            setAgent(a=>({...a,photoUrl:url}));
            try { await onSaveAgent({ photoUrl:url }); showToast('Photo updated'); }
            catch { showToast('Failed to update photo'); }
          }}
          onSaveEmoji={async em=>{
            setAgent(a=>({...a,emoji:em,photoUrl:null}));
            try { await onSaveAgent({ emoji:em }); showToast('Saved'); }
            catch { showToast('Failed to save'); }
          }}/>
      )}
      <AgentNetworkSection/>
      <AutonomySection/>
      <MemorySection/>
      <MyToolsSection/>
      {subjectSheet&&(
        <SubjectsSheet current={agent.subjects||[]} accentColor={color}
          onClose={()=>setSubjectSheet(false)}
          onSave={async s=>{
            setAgent(a=>({...a,subjects:s}));
            try { await onSaveAgent({ subjects:s }); showToast('Subjects saved'); }
            catch { showToast('Saved locally'); }
          }}/>
      )}
      {sheet&&(
        <GenericSheet {...sheet} value={agent[sheet.field]}
          onClose={()=>setSheet(null)}
          onSave={(f,v)=>{ saveField(f,v); setSheet(null); }}/>
      )}
      {goalSheet&&(
        <GoalsSheet title={gTitle} setTitle={setGTitle} cat={gCat} setCat={setGCat} date={gDate} setDate={setGDate} err={gErr} busy={goalBusy} onSave={addGoal} onClose={()=>setGoalSheet(false)}/>
      )}
      {toast&&(
        <div style={{ position:'fixed',bottom:28,left:'50%',transform:'translateX(-50%)',
          background:'#111827',color:'#fff',padding:'9px 20px',borderRadius:20,
          fontSize:12.5,fontWeight:700,zIndex:9999,whiteSpace:'nowrap',
          boxShadow:'0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </div>
  );
}



/* Goals sheet — title (free text), a category preset, optional target date. */
function GoalsSheet({ title, setTitle, cat, setCat, date, setDate, err, busy, onSave, onClose }) {
  const { t } = useLang();
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:2500, background:'rgba(17,12,40,.55)', backdropFilter:'blur(3px)', display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'var(--ak-surface, #fff)', width:'100%', maxWidth:540, maxHeight:'88vh', overflowY:'auto', borderRadius:'22px 22px 0 0', fontFamily:"'Nunito',sans-serif", animation:'sheet-up .28s cubic-bezier(.34,1.4,.6,1)' }}>
        <style>{'@keyframes sheet-up{from{transform:translateY(40px);opacity:.4}to{transform:translateY(0);opacity:1}}'}</style>
        <div style={{ padding:'10px 0 4px', display:'flex', justifyContent:'center' }}>
          <div style={{ width:38, height:4, borderRadius:4, background:'#E5E0F5' }}/>
        </div>
        <div style={{ padding:'6px 18px 24px' }}>
          <h2 style={{ fontSize:17, fontWeight:900, color:'var(--ak-text, #171717)', margin:'4px 0 14px' }}>{t('settings.goals_add')}</h2>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder={t('settings.goals_title_ph')} maxLength={120} autoFocus
            style={{ width:'100%', boxSizing:'border-box', borderRadius:12, padding:'11px 13px', border:'1px solid var(--ak-border, #E3E0EE)', background:'var(--ak-bg, #F7F5FB)', color:'var(--ak-text, #171717)', fontSize:13.5, outline:'none', marginBottom:10 }}/>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
            {GOALS.map(c => (
              <button key={c} type="button" onClick={()=>setCat(cat===c?'':c)}
                style={{ padding:'6px 11px', borderRadius:20, border:`1.5px solid ${cat===c?BRAND:'var(--ak-border, #E3E0EE)'}`, background:cat===c?`${BRAND}12`:'transparent', color:cat===c?BRAND:'var(--ak-text-muted, #8B87A0)', fontSize:11, fontWeight:800, cursor:'pointer', fontFamily:"'Nunito',sans-serif" }}>
                {c}
              </button>
            ))}
          </div>
          <label style={{ fontSize:11, fontWeight:700, color:'var(--ak-text-muted, #8B87A0)', display:'block', marginBottom:5 }}>{t('settings.goal_target')}</label>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)}
            style={{ width:'100%', boxSizing:'border-box', borderRadius:12, padding:'11px 13px', border:'1px solid var(--ak-border, #E3E0EE)', background:'var(--ak-bg, #F7F5FB)', color:'var(--ak-text, #171717)', fontSize:13.5, outline:'none', marginBottom:10 }}/>
          {err && <div style={{ fontSize:12, fontWeight:700, color:RED, marginBottom:10 }}>{err}</div>}
          <button onClick={onSave} disabled={busy || !title.trim()}
            style={{ width:'100%', padding:'13px', borderRadius:14, border:'none', background:(title.trim()&&!busy)?BRAND:'#C9BCF7', color:'#fff', fontSize:14, fontWeight:900, cursor:(title.trim()&&!busy)?'pointer':'default', display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
            {busy ? <Spinner size={13}/> : t('settings.goal_save')}
          </button>
        </div>
      </div>
    </div>
  );
}

export { AgentTab };
