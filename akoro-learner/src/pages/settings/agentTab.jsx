/**
 * Settings — Agent tab (the learner's AI agent identity & subjects).
 */
import { useState, useCallback } from 'react';
import {
  BRAND, RED, ORANGE, ALL_SUBJECTS, SUBJ_ICON,
  STUDY_LEVELS, YEARS, EXAM_BOARDS, GOALS,
  Icon, Toggle, ProgressBar, SubjectChip, Section, Row, AvatarCircle, SubjectsRow,
} from './shared.jsx';
import { AvatarPickerSheet, SubjectsSheet, GenericSheet } from './sheets.jsx';
import { useLang } from '../../contexts/LanguageContext.jsx';

/* ─── Agent tab ───────────────────────────────────────────────── */
function AgentTab({ agent, setAgent, onSaveAgent }) {
  const { t } = useLang();
  const [sheet,        setSheet]        = useState(null);
  const [subjectSheet, setSubjectSheet] = useState(false);
  const [avatarSheet,  setAvatarSheet]  = useState(false);
  const [toast,        setToast]        = useState('');

  const showToast = m => { setToast(m); setTimeout(()=>setToast(''),2200); };
  const openSheet = (f,l,t,o) => setSheet({field:f,label:l,type:t,options:o});

  const saveField = useCallback(async (field, val) => {
    const updated = { ...agent, [field]: val };
    setAgent(updated);
    try { await onSaveAgent({ [field]: val }); showToast('Saved ✓'); }
    catch { showToast('Saved locally ✓'); }
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
            try { await onSaveAgent({ photoUrl:url }); showToast('Photo updated ✓'); }
            catch { showToast('Failed to update photo'); }
          }}
          onSaveEmoji={async em=>{
            setAgent(a=>({...a,emoji:em,photoUrl:null}));
            try { await onSaveAgent({ emoji:em }); showToast('Saved ✓'); }
            catch { showToast('Failed to save'); }
          }}/>
      )}
      {subjectSheet&&(
        <SubjectsSheet current={agent.subjects||[]} accentColor={color}
          onClose={()=>setSubjectSheet(false)}
          onSave={async s=>{
            setAgent(a=>({...a,subjects:s}));
            try { await onSaveAgent({ subjects:s }); showToast('Subjects saved ✓'); }
            catch { showToast('Saved locally ✓'); }
          }}/>
      )}
      {sheet&&(
        <GenericSheet {...sheet} value={agent[sheet.field]}
          onClose={()=>setSheet(null)}
          onSave={(f,v)=>{ saveField(f,v); setSheet(null); }}/>
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


export { AgentTab };
