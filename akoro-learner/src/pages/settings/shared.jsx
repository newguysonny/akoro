/**
 * Settings — shared colors, reference data, and presentational atoms.
 */

import { useLang } from '../../contexts/LanguageContext.jsx';

const BRAND  = '#6C3BFF';
const RED    = '#EF4444';
const ORANGE = '#E8884A';

/* ─── Reference data ──────────────────────────────────────────── */
const ALL_SUBJECTS = [
  'Mathematics','Further Mathematics','English Language','English Literature',
  'Physics','Chemistry','Biology','Computer Science','Economics','Accounting',
  'Government / Civics','History','Geography','French','Arabic','Yoruba',
  'Igbo','Hausa','Fine Art','Music','Physical Education','Technical Drawing',
  'Agricultural Science','Food & Nutrition','Business Studies','Commerce',
  'Civic Education','Data Processing','Health Science','Religious Studies',
];
const SUBJ_ICON = {
  'Mathematics':'ti-math-function','Further Mathematics':'ti-math-symbols',
  'English Language':'ti-letter-a','English Literature':'ti-book-2',
  'Physics':'ti-atom','Chemistry':'ti-flask','Biology':'ti-plant-2',
  'Computer Science':'ti-device-laptop','Economics':'ti-trending-up',
  'Accounting':'ti-calculator','Government / Civics':'ti-building-community',
  'History':'ti-clock-history','Geography':'ti-map','French':'ti-flag',
  'Fine Art':'ti-palette','Music':'ti-music','Physical Education':'ti-run',
  'Technical Drawing':'ti-ruler','Agricultural Science':'ti-plant',
  'Food & Nutrition':'ti-salad','Business Studies':'ti-briefcase',
  'Commerce':'ti-shopping-cart','Civic Education':'ti-school',
  'Data Processing':'ti-database','Health Science':'ti-heart',
  'Religious Studies':'ti-star',
};
const subjIcon = (s) => SUBJ_ICON[s] || 'ti-book';

const STUDY_LEVELS  = ['Primary School','Junior Secondary','Senior Secondary','Sixth Form / A-Level','University','Professional'];
const EXAM_BOARDS   = ['WAEC','NECO','JAMB','Cambridge IGCSE','Edexcel','AQA','IB','Other'];
const SCHOOL_TYPES  = ['Primary School','Junior Secondary School','Senior Secondary School','Sixth Form','College','University','Other'];
const YEARS         = ['Year 7','Year 8','Year 9','Year 10','Year 11','Year 12','Year 13','First Year','Second Year','Final Year'];
const LANGUAGES     = ['English','Spanish','Portuguese','French','Yoruba','Igbo','Hausa','Pidgin','Arabic'];
const COUNTRIES     = ['Nigeria','Ghana','Kenya','South Africa','Uganda','Tanzania','UK','USA','Canada','Australia','Other'];
const GOALS         = ['Exam Preparation','Concept Mastery','Catch-up Learning','Enrichment / Going Ahead','Revision','General Curiosity'];
const GUIDES        = ['NaNa Esumai 🧠','Akobi 🧑🏫 (Strict)','Sade 🌸 (Warm)','Emeka ⚡ (Fast-track)'];
const EMOJI_LIST    = ['🤖','🧠','👾','🦉','🎓','⚡','🌟','🔮','🦋','🎯','🚀','💡','🦁','🐺','🦊','🎭','🏆','💎'];
const AVATAR_LIST   = ['👨🏾‍🎓','👩🏾‍🎓','🧑🏾‍🎓','👨🏿‍💻','👩🏿‍💻','🧑🏿‍🔬','🦸‍♂️','🦸‍♀️','🧙‍♂️','🧙‍♀️','👨‍🏫','👩‍🏫'];
const ACCENTS       = [BRAND,'#3B82F6','#10B981','#E8884A','#EC4899','#F59E0B','#EF4444','#8B5CF6'];

/* ─── Micro-components ────────────────────────────────────────── */
function Icon({ name, size=16, color, style={} }) {
  return <i className={`ti ${name}`}
    style={{ fontSize:size, color:color||'inherit', lineHeight:1, ...style }}/>;
}
function Toggle({ on, onChange }) {
  return (
    <div onClick={onChange}
      style={{ width:42,height:23,borderRadius:12,position:'relative',
        background:on?BRAND:'var(--ak-toggle-off)',transition:'background .25s',
        cursor:'pointer',flexShrink:0 }}>
      <div style={{ position:'absolute',top:2.5,left:on?21:2.5,
        width:18,height:18,borderRadius:'50%',background:'#fff',
        transition:'left .25s',boxShadow:'0 1px 3px rgba(0,0,0,.2)' }}/>
    </div>
  );
}
function ProgressBar({ pct, color }) {
  return (
    <div style={{ height:5,background:'var(--ak-tag-bg)',borderRadius:99,overflow:'hidden' }}>
      <div style={{ height:'100%',width:`${pct}%`,borderRadius:99,
        background:`linear-gradient(90deg,${color},${color}CC)` }}/>
    </div>
  );
}
function SubjectChip({ label, onRemove, color=BRAND }) {
  return (
    <div style={{ display:'inline-flex',alignItems:'center',gap:5,
      padding:'5px 10px 5px 8px',borderRadius:20,
      background:`${color}10`,border:`1px solid ${color}25`,
      fontSize:12,fontWeight:700,color }}>
      <Icon name={subjIcon(label)} size={12} color={color}/>
      {label}
      {onRemove&&<span onClick={e=>{e.stopPropagation();onRemove(label);}}
        style={{ width:14,height:14,borderRadius:'50%',
          background:`${color}25`,display:'inline-flex',
          alignItems:'center',justifyContent:'center',
          cursor:'pointer',marginLeft:1,fontSize:9 }}>✕</span>}
    </div>
  );
}
function Section({ title, children }) {
  return (
    <div style={{ marginBottom:20 }}>
      <p style={{ fontSize:11,fontWeight:900,color:BRAND,letterSpacing:1.5,
        textTransform:'uppercase',padding:'0 16px',margin:'0 0 8px',
        fontFamily:"'Nunito',sans-serif" }}>{title}</p>
      <div style={{ background:'var(--ak-surface)',borderRadius:16,
        boxShadow:'0 1px 4px rgba(0,0,0,.08)',overflow:'hidden',
        border:'1px solid var(--ak-border)' }}>
        {children}
      </div>
    </div>
  );
}
export const rowBase = {
  display:'flex',alignItems:'center',padding:'13px 16px',
  borderBottom:'1px solid var(--ak-border)',background:'var(--ak-surface)',
  fontFamily:"'Nunito',sans-serif",
};
function Row({ icon,label,value,sub,danger,onClick,noArrow,children }) {
  return (
    <div style={{ ...rowBase,cursor:onClick?'pointer':'default' }}
      onMouseEnter={e=>onClick&&(e.currentTarget.style.background='var(--ak-surface-hover)')}
      onMouseLeave={e=>e.currentTarget.style.background='var(--ak-surface)'}
      onClick={onClick}>
      <span style={{ fontSize:17,width:28,flexShrink:0,display:'flex',alignItems:'center' }}>
        <Icon name={icon} size={17} color={danger?RED:'var(--ak-text-sub)'}/>
      </span>
      <div style={{ flex:1,minWidth:0 }}>
        <p style={{ fontSize:13.5,fontWeight:700,margin:0,color:danger?RED:'var(--ak-text)' }}>{label}</p>
        {sub&&<p style={{ fontSize:11.5,color:'var(--ak-text-muted)',marginTop:2,margin:0 }}>{sub}</p>}
      </div>
      {value!==undefined&&<span style={{ fontSize:12.5,fontWeight:600,color:'var(--ak-text-sub)',marginRight:4,flexShrink:0 }}>{value}</span>}
      {children}
      {onClick&&!noArrow&&<span style={{ color:'var(--ak-border3)',fontSize:16 }}>›</span>}
    </div>
  );
}

/* ─── Avatar circle ───────────────────────────────────────────── */
function AvatarCircle({ photoUrl, emoji, color, size=60, onPhotoClick }) {
  return (
    <div style={{ position:'relative',flexShrink:0 }}>
      <div style={{ width:size,height:size,borderRadius:'50%',
        background:`${color}18`,border:`2px solid ${color}40`,
        display:'flex',alignItems:'center',justifyContent:'center',
        overflow:'hidden',cursor:'pointer' }}
        onClick={onPhotoClick}>
        {photoUrl
          ? <img src={photoUrl} style={{ width:'100%',height:'100%',objectFit:'cover' }}/>
          : <span style={{ fontSize:size*0.43 }}>{emoji}</span>}
      </div>
      <div style={{ position:'absolute',bottom:0,right:0,
        width:20,height:20,borderRadius:'50%',background:color,
        border:'2px solid var(--ak-surface)',display:'flex',alignItems:'center',
        justifyContent:'center',cursor:'pointer' }}
        onClick={onPhotoClick}>
        <Icon name="ti-pencil" size={9} color="#fff"/>
      </div>
    </div>
  );
}


/* ─── Subjects row ────────────────────────────────────────────── */
function SubjectsRow({ subjects,onClick,color=BRAND }) {
  const { t } = useLang();
  return (
    <div style={{ ...rowBase,flexDirection:'column',alignItems:'stretch',cursor:'pointer' }}
      onMouseEnter={e=>e.currentTarget.style.background='var(--ak-surface-hover)'}
      onMouseLeave={e=>e.currentTarget.style.background='var(--ak-surface)'}
      onClick={onClick}>
      <div style={{ display:'flex',alignItems:'center',width:'100%' }}>
        <span style={{ fontSize:17,width:28,flexShrink:0,display:'flex',alignItems:'center' }}>
          <Icon name="ti-book-2" size={17} color="var(--ak-text-sub)"/>
        </span>
        <div style={{ flex:1 }}>
          <p style={{ fontSize:13.5,fontWeight:700,margin:0,color:'var(--ak-text)' }}>{t('settings.subjects')}</p>
        </div>
        <span style={{ fontSize:12.5,fontWeight:600,color:'var(--ak-text-sub)',marginRight:4 }}>
          {subjects.length} {t('settings.subjects_added')}</span>
        <span style={{ color:'var(--ak-border3)',fontSize:16 }}>›</span>
      </div>
      {subjects.length>0&&(
        <div style={{ paddingLeft:28,paddingTop:8,paddingBottom:2,
          display:'flex',flexWrap:'wrap',gap:6 }}>
          {subjects.map(s=><SubjectChip key={s} label={s} color={color}/>)}
        </div>
      )}
    </div>
  );
}


export {
  BRAND, RED, ORANGE, ALL_SUBJECTS, SUBJ_ICON,
  Icon, Toggle, ProgressBar, SubjectChip, Section, Row, AvatarCircle, SubjectsRow,
};
