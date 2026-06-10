import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate }    from 'react-router-dom';
import { useAuth }        from '../contexts/AuthContext.jsx';
import {
  getMyProfile,
  patchMyProfile,
  patchNotifications,
  putAgent,
  getTeachingGuides,
  deactivateAccount,
  deleteAccount,
} from '../services/settingsApi.js';

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
const LANGUAGES     = ['English','Yoruba','Igbo','Hausa','Pidgin','French','Arabic'];
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
        background:on?BRAND:'#E5E7EB',transition:'background .25s',
        cursor:'pointer',flexShrink:0 }}>
      <div style={{ position:'absolute',top:2.5,left:on?21:2.5,
        width:18,height:18,borderRadius:'50%',background:'#fff',
        transition:'left .25s',boxShadow:'0 1px 3px rgba(0,0,0,.2)' }}/>
    </div>
  );
}
function ProgressBar({ pct, color }) {
  return (
    <div style={{ height:5,background:'#F3F4F6',borderRadius:99,overflow:'hidden' }}>
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
      <div style={{ background:'#fff',borderRadius:16,
        boxShadow:'0 1px 4px rgba(0,0,0,.05)',overflow:'hidden',
        border:'1px solid #F3F4F6' }}>
        {children}
      </div>
    </div>
  );
}
const rowBase = {
  display:'flex',alignItems:'center',padding:'13px 16px',
  borderBottom:'1px solid #F3F4F6',background:'#fff',
  fontFamily:"'Nunito',sans-serif",
};
function Row({ icon,label,value,sub,danger,onClick,noArrow,children }) {
  return (
    <div style={{ ...rowBase,cursor:onClick?'pointer':'default' }}
      onMouseEnter={e=>onClick&&(e.currentTarget.style.background='#F9FAFB')}
      onMouseLeave={e=>e.currentTarget.style.background='#fff'}
      onClick={onClick}>
      <span style={{ fontSize:17,width:28,flexShrink:0,display:'flex',alignItems:'center' }}>
        <Icon name={icon} size={17} color={danger?RED:'#6B7280'}/>
      </span>
      <div style={{ flex:1,minWidth:0 }}>
        <p style={{ fontSize:13.5,fontWeight:700,margin:0,color:danger?RED:'#111827' }}>{label}</p>
        {sub&&<p style={{ fontSize:11.5,color:'#9CA3AF',marginTop:2,margin:0 }}>{sub}</p>}
      </div>
      {value!==undefined&&<span style={{ fontSize:12.5,fontWeight:600,color:'#6B7280',marginRight:4,flexShrink:0 }}>{value}</span>}
      {children}
      {onClick&&!noArrow&&<span style={{ color:'#D1D5DB',fontSize:16 }}>›</span>}
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
        border:'2px solid #fff',display:'flex',alignItems:'center',
        justifyContent:'center',cursor:'pointer' }}
        onClick={onPhotoClick}>
        <Icon name="ti-pencil" size={9} color="#fff"/>
      </div>
    </div>
  );
}

/* ─── Avatar picker sheet ─────────────────────────────────────── */
function AvatarPickerSheet({ type, current, onClose, onSavePhoto, onSaveEmoji, color }) {
  const fileRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [tab,     setTab]     = useState('photo');
  const [selEmoji,setSelEmoji]= useState(current.emoji || '🤖');
  const emojiList = type === 'user' ? AVATAR_LIST : EMOJI_LIST;

  const handleFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => setPreview(ev.target.result);
    reader.readAsDataURL(f);
  };

  return (
    <>
      <div onClick={onClose}
        style={{ position:'fixed',inset:0,zIndex:3000,
          background:'rgba(0,0,0,.45)',backdropFilter:'blur(4px)' }}/>
      <div style={{ position:'fixed',bottom:0,left:0,right:0,zIndex:3100,
        background:'#fff',borderRadius:'22px 22px 0 0',
        padding:'0 18px 40px',boxShadow:'0 -8px 40px rgba(0,0,0,.12)',
        animation:'sheet-up .3s ease',fontFamily:"'Nunito',sans-serif",
        maxHeight:'88vh',overflowY:'auto' }}>
        <div style={{ width:36,height:4,borderRadius:2,background:'#D1D5DB',
          margin:'14px auto 18px' }}/>
        <p style={{ fontSize:16,fontWeight:900,color:'#111827',margin:'0 0 16px' }}>
          Change {type==='user'?'Profile':'Agent'} Photo
        </p>
        <div style={{ display:'flex',background:'#F3F4F6',borderRadius:12,
          padding:3,marginBottom:20,gap:3 }}>
          {['photo','emoji'].map(t=>(
            <button key={t} onClick={()=>setTab(t)}
              style={{ flex:1,padding:'8px 0',borderRadius:10,border:'none',
                background:tab===t?'#fff':'transparent',cursor:'pointer',
                fontSize:12.5,fontWeight:800,fontFamily:"'Nunito',sans-serif",
                color:tab===t?'#111827':'#6B7280',
                boxShadow:tab===t?'0 1px 4px rgba(0,0,0,.08)':'none' }}>
              {t==='photo'?'📷 Upload Photo':'🎭 Choose Emoji'}
            </button>
          ))}
        </div>

        {tab==='photo'&&(
          <div>
            <input ref={fileRef} type="file" accept="image/*"
              style={{ display:'none' }} onChange={handleFile}/>
            {preview
              ? <div style={{ display:'flex',flexDirection:'column',
                  alignItems:'center',gap:14,marginBottom:20 }}>
                  <div style={{ width:100,height:100,borderRadius:'50%',
                    overflow:'hidden',border:`3px solid ${color}` }}>
                    <img src={preview} style={{ width:'100%',height:'100%',objectFit:'cover' }}/>
                  </div>
                  <button onClick={()=>setPreview(null)}
                    style={{ fontSize:12.5,fontWeight:700,color:RED,
                      background:'none',border:'none',cursor:'pointer',
                      fontFamily:"'Nunito',sans-serif" }}>Remove photo</button>
                </div>
              : <div onClick={()=>fileRef.current?.click()}
                  style={{ border:'2px dashed #E5E7EB',borderRadius:16,
                    padding:'32px 20px',textAlign:'center',cursor:'pointer',marginBottom:20 }}
                  onMouseEnter={e=>e.currentTarget.style.borderColor=color}
                  onMouseLeave={e=>e.currentTarget.style.borderColor='#E5E7EB'}>
                  <Icon name="ti-upload" size={28} color="#9CA3AF"
                    style={{ display:'block',margin:'0 auto 10px' }}/>
                  <p style={{ fontSize:14,fontWeight:800,color:'#374151',margin:'0 0 4px' }}>
                    Tap to upload photo</p>
                  <p style={{ fontSize:12,color:'#9CA3AF',margin:0 }}>JPG, PNG or WebP · Max 5MB</p>
                </div>
            }
            <div style={{ display:'flex',gap:10 }}>
              <button onClick={onClose} style={{ flex:1,padding:'13px',borderRadius:14,
                border:'1.5px solid #E5E7EB',background:'#F9FAFB',
                fontSize:13,fontWeight:800,color:'#6B7280',cursor:'pointer',
                fontFamily:"'Nunito',sans-serif" }}>Cancel</button>
              <button onClick={()=>{ if(preview){onSavePhoto(preview);onClose();} }}
                disabled={!preview}
                style={{ flex:1.5,padding:'13px',borderRadius:14,border:'none',
                  background:preview?`linear-gradient(135deg,${color},#4C1DCC)`:'#E5E7EB',
                  color:preview?'#fff':'#9CA3AF',fontSize:13,fontWeight:800,
                  cursor:preview?'pointer':'not-allowed',fontFamily:"'Nunito',sans-serif" }}>
                Save Photo</button>
            </div>
          </div>
        )}

        {tab==='emoji'&&(
          <div>
            <div style={{ display:'flex',flexWrap:'wrap',gap:8,marginBottom:20 }}>
              {emojiList.map(em=>(
                <div key={em} onClick={()=>setSelEmoji(em)}
                  style={{ width:46,height:46,borderRadius:12,display:'flex',
                    alignItems:'center',justifyContent:'center',fontSize:22,cursor:'pointer',
                    background:selEmoji===em?`${color}15`:'#F9FAFB',
                    border:`1.5px solid ${selEmoji===em?color:'#E5E7EB'}` }}>
                  {em}
                </div>
              ))}
            </div>
            <div style={{ display:'flex',gap:10 }}>
              <button onClick={onClose} style={{ flex:1,padding:'13px',borderRadius:14,
                border:'1.5px solid #E5E7EB',background:'#F9FAFB',
                fontSize:13,fontWeight:800,color:'#6B7280',cursor:'pointer',
                fontFamily:"'Nunito',sans-serif" }}>Cancel</button>
              <button onClick={()=>{onSaveEmoji(selEmoji);onClose();}}
                style={{ flex:1.5,padding:'13px',borderRadius:14,border:'none',
                  background:`linear-gradient(135deg,${color},#4C1DCC)`,
                  color:'#fff',fontSize:13,fontWeight:800,cursor:'pointer',
                  fontFamily:"'Nunito',sans-serif" }}>Save Emoji</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ─── Subjects sheet ──────────────────────────────────────────── */
function SubjectsSheet({ current, onClose, onSave, accentColor=BRAND }) {
  const [selected,setSelected]=useState([...current]);
  const [search,  setSearch]  =useState('');
  const [custom,  setCustom]  =useState('');
  const available = ALL_SUBJECTS.filter(s=>!selected.includes(s)&&
    s.toLowerCase().includes(search.toLowerCase()));
  const addSubject    = s => { setSelected(p=>[...p,s]); setSearch(''); };
  const removeSubject = s => setSelected(p=>p.filter(x=>x!==s));
  const addCustom     = () => {
    const c=custom.trim(); if(!c||selected.includes(c)) return;
    setSelected(p=>[...p,c]); setCustom('');
  };
  return (
    <>
      <div onClick={onClose} style={{ position:'fixed',inset:0,zIndex:3000,
        background:'rgba(0,0,0,.45)',backdropFilter:'blur(4px)' }}/>
      <div style={{ position:'fixed',bottom:0,left:0,right:0,zIndex:3100,
        background:'#fff',borderRadius:'22px 22px 0 0',padding:'0 18px 40px',
        boxShadow:'0 -8px 40px rgba(0,0,0,.12)',animation:'sheet-up .3s ease',
        fontFamily:"'Nunito',sans-serif",maxHeight:'88vh',overflowY:'auto' }}>
        <div style={{ width:36,height:4,borderRadius:2,background:'#D1D5DB',margin:'14px auto 18px' }}/>
        <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16 }}>
          <p style={{ fontSize:16,fontWeight:900,color:'#111827',margin:0 }}>Manage Subjects</p>
          <span style={{ fontSize:12,color:'#6B7280',fontWeight:600 }}>{selected.length} selected</span>
        </div>
        {selected.length>0&&(
          <div style={{ marginBottom:20 }}>
            <p style={{ fontSize:11,fontWeight:900,color:accentColor,letterSpacing:1.2,
              textTransform:'uppercase',marginBottom:10 }}>Your subjects</p>
            <div style={{ display:'flex',flexWrap:'wrap',gap:8 }}>
              {selected.map(s=><SubjectChip key={s} label={s} color={accentColor} onRemove={removeSubject}/>)}
            </div>
          </div>
        )}
        <div style={{ marginBottom:14 }}>
          <p style={{ fontSize:11,fontWeight:900,color:'#6B7280',letterSpacing:1.2,
            textTransform:'uppercase',marginBottom:10 }}>Add subjects</p>
          <div style={{ position:'relative',marginBottom:10 }}>
            <Icon name="ti-search" size={14} style={{ position:'absolute',left:12,
              top:'50%',transform:'translateY(-50%)',color:'#9CA3AF' }}/>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search subjects…"
              style={{ width:'100%',padding:'10px 13px 10px 34px',borderRadius:12,
                border:'1.5px solid #E5E7EB',outline:'none',fontSize:13,
                fontFamily:"'Nunito',sans-serif",color:'#111827',boxSizing:'border-box' }}/>
          </div>
          <div style={{ display:'flex',flexWrap:'wrap',gap:7,maxHeight:160,overflowY:'auto' }}>
            {available.map(s=>(
              <div key={s} onClick={()=>addSubject(s)}
                style={{ display:'inline-flex',alignItems:'center',gap:5,padding:'6px 12px',
                  borderRadius:20,border:'1px solid #E5E7EB',background:'#F9FAFB',
                  fontSize:12,fontWeight:700,color:'#374151',cursor:'pointer' }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=accentColor;e.currentTarget.style.color=accentColor;}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor='#E5E7EB';e.currentTarget.style.color='#374151';}}>
                <Icon name={subjIcon(s)} size={12} color="#9CA3AF"/>{s}
                <span style={{ color:'#9CA3AF' }}>+</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginBottom:20 }}>
          <p style={{ fontSize:11,fontWeight:900,color:'#6B7280',letterSpacing:1.2,
            textTransform:'uppercase',marginBottom:8 }}>Custom subject</p>
          <div style={{ display:'flex',gap:8 }}>
            <input value={custom} onChange={e=>setCustom(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&addCustom()}
              placeholder="e.g. Accounting, Arabic…"
              style={{ flex:1,padding:'11px 14px',borderRadius:12,border:'1.5px solid #E5E7EB',
                outline:'none',fontSize:13,fontFamily:"'Nunito',sans-serif",color:'#111827' }}/>
            <button onClick={addCustom}
              style={{ padding:'11px 16px',borderRadius:12,border:'none',
                background:custom.trim()?`linear-gradient(135deg,${accentColor},#4C1DCC)`:'#E5E7EB',
                color:custom.trim()?'#fff':'#9CA3AF',fontSize:13,fontWeight:800,
                cursor:custom.trim()?'pointer':'default',fontFamily:"'Nunito',sans-serif",
                flexShrink:0 }}>Add</button>
          </div>
        </div>
        <div style={{ display:'flex',gap:10 }}>
          <button onClick={onClose} style={{ flex:1,padding:'13px',borderRadius:14,
            border:'1.5px solid #E5E7EB',background:'#F9FAFB',
            fontSize:13,fontWeight:800,color:'#6B7280',cursor:'pointer',
            fontFamily:"'Nunito',sans-serif" }}>Cancel</button>
          <button onClick={()=>{onSave(selected);onClose();}}
            style={{ flex:1.5,padding:'13px',borderRadius:14,border:'none',
              background:`linear-gradient(135deg,${accentColor},#4C1DCC)`,
              color:'#fff',fontSize:13,fontWeight:800,cursor:'pointer',
              fontFamily:"'Nunito',sans-serif",
              boxShadow:`0 4px 14px ${accentColor}44` }}>Save Subjects</button>
        </div>
      </div>
    </>
  );
}

/* ─── Generic field sheet ─────────────────────────────────────── */
function GenericSheet({ field,label,type,options,value,onClose,onSave }) {
  const [val,setVal]=useState(value??'');
  const [pw, setPw] =useState({ current:'',next:'',confirm:'' });
  const [del,setDel]=useState('');
  const inp = { width:'100%',padding:'11px 14px',borderRadius:12,
    border:'1.5px solid #E5E7EB',outline:'none',fontSize:14,
    fontFamily:"'Nunito',sans-serif",color:'#111827',boxSizing:'border-box',marginTop:6 };
  const handle = () => {
    if(type==='change-password'){
      if(!pw.current){alert('Enter current password');return;}
      if(pw.next.length<8){alert('Need 8+ characters');return;}
      if(pw.next!==pw.confirm){alert("Passwords don't match");return;}
    }
    if(type==='delete-confirm'&&del!=='DELETE') return;
    onSave(field, type==='change-password'?pw:val);
    onClose();
  };
  return (
    <>
      <div onClick={onClose} style={{ position:'fixed',inset:0,zIndex:3000,
        background:'rgba(0,0,0,.45)',backdropFilter:'blur(4px)' }}/>
      <div style={{ position:'fixed',bottom:0,left:0,right:0,zIndex:3100,
        background:'#fff',borderRadius:'22px 22px 0 0',padding:'0 18px 40px',
        boxShadow:'0 -8px 40px rgba(0,0,0,.12)',animation:'sheet-up .3s ease',
        fontFamily:"'Nunito',sans-serif",maxHeight:'85vh',overflowY:'auto' }}>
        <div style={{ width:36,height:4,borderRadius:2,background:'#D1D5DB',margin:'14px auto 18px' }}/>
        <p style={{ fontSize:16,fontWeight:900,color:'#111827',margin:'0 0 16px' }}>{label}</p>

        {type==='text'&&<input autoFocus value={val} onChange={e=>setVal(e.target.value)}
          placeholder={`Enter ${label.toLowerCase()}`} style={inp}/>}
        {type==='textarea'&&<textarea autoFocus value={val} onChange={e=>setVal(e.target.value)}
          placeholder={`Enter ${label.toLowerCase()}`} rows={3}
          style={{ ...inp,resize:'vertical',lineHeight:1.6 }}/>}
        {type==='select'&&(
          <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
            {options.map(o=>(
              <div key={o} onClick={()=>setVal(o)}
                style={{ display:'flex',alignItems:'center',gap:10,padding:'11px 14px',
                  borderRadius:12,cursor:'pointer',
                  border:`1.5px solid ${val===o?BRAND:'#E5E7EB'}`,
                  background:val===o?`${BRAND}08`:'#fff' }}>
                <div style={{ width:18,height:18,borderRadius:'50%',flexShrink:0,
                  border:`2px solid ${val===o?BRAND:'#D1D5DB'}`,
                  background:val===o?BRAND:'#fff',
                  display:'flex',alignItems:'center',justifyContent:'center' }}>
                  {val===o&&<div style={{ width:6,height:6,borderRadius:'50%',background:'#fff' }}/>}
                </div>
                <span style={{ fontSize:13.5,fontWeight:700,color:val===o?BRAND:'#374151' }}>{o}</span>
              </div>
            ))}
          </div>
        )}
        {type==='display-mode'&&(
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8 }}>
            {['light','dark','system'].map(m=>(
              <div key={m} onClick={()=>setVal(m)}
                style={{ padding:'14px 8px',borderRadius:12,textAlign:'center',cursor:'pointer',
                  border:`1.5px solid ${val===m?BRAND:'#E5E7EB'}`,
                  background:val===m?`${BRAND}08`:'#F9FAFB' }}>
                <div style={{ fontSize:22,marginBottom:5 }}>{m==='light'?'☀️':m==='dark'?'🌙':'⚙️'}</div>
                <p style={{ margin:0,fontSize:11.5,fontWeight:800,
                  color:val===m?BRAND:'#374151',textTransform:'capitalize' }}>{m}</p>
              </div>
            ))}
          </div>
        )}
        {(type==='accent'||type==='bg')&&(
          <div style={{ display:'flex',flexWrap:'wrap',gap:10 }}>
            {[...ACCENTS,'#F3F4F6','#FEF0E6','#E6F4FE','#F0FDF4','#FEF2F2','#FFF7ED'].map(c=>(
              <div key={c} onClick={()=>setVal(c)}
                style={{ width:40,height:40,borderRadius:'50%',background:c,cursor:'pointer',
                  border:`2px solid ${c==='#F3F4F6'?'#D1D5DB':c}`,
                  outline:val===c?'3px solid #111827':'3px solid transparent',
                  outlineOffset:2,transition:'all .2s' }}/>
            ))}
          </div>
        )}
        {type==='change-password'&&(
          <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
            {[['current','Current password'],['next','New password'],['confirm','Confirm new']].map(([k,l])=>(
              <div key={k}>
                <label style={{ fontSize:12,fontWeight:800,color:'#374151' }}>{l}</label>
                <input type="password" value={pw[k]}
                  onChange={e=>setPw(p=>({...p,[k]:e.target.value}))}
                  placeholder="••••••••" style={inp}/>
              </div>
            ))}
          </div>
        )}
        {type==='deactivate'&&(
          <div style={{ background:'#FFF7ED',border:'1px solid #FED7AA',
            borderRadius:14,padding:'14px 16px',marginBottom:12 }}>
            <p style={{ margin:'0 0 8px',fontSize:14,fontWeight:800,color:'#92400E' }}>
              ⚠️ Deactivate your account?</p>
            <p style={{ margin:0,fontSize:13,color:'#78350F',lineHeight:1.6 }}>
              Your account will be suspended. You can reactivate within 30 days by signing back in.</p>
          </div>
        )}
        {type==='delete-confirm'&&(
          <>
            <div style={{ background:'#FEF2F2',border:'1px solid #FECACA',
              borderRadius:14,padding:'14px 16px',marginBottom:14 }}>
              <p style={{ margin:'0 0 8px',fontSize:14,fontWeight:800,color:'#7F1D1D' }}>
                🗑️ Permanently delete your account?</p>
              <p style={{ margin:0,fontSize:13,color:'#991B1B',lineHeight:1.6 }}>
                All data — sessions, agent progress, XP, and history — will be permanently deleted.</p>
            </div>
            <label style={{ fontSize:12,fontWeight:800,color:'#374151' }}>Type DELETE to confirm</label>
            <input value={del} onChange={e=>setDel(e.target.value.toUpperCase())}
              placeholder="DELETE"
              style={{ ...inp,borderColor:del==='DELETE'?RED:'#E5E7EB',
                color:del==='DELETE'?RED:'#111827',letterSpacing:1 }}/>
          </>
        )}
        <div style={{ display:'flex',gap:10,marginTop:20 }}>
          <button onClick={onClose} style={{ flex:1,padding:'13px',borderRadius:14,
            border:'1.5px solid #E5E7EB',background:'#F9FAFB',
            fontSize:13,fontWeight:800,color:'#6B7280',cursor:'pointer',
            fontFamily:"'Nunito',sans-serif" }}>Cancel</button>
          <button onClick={handle}
            disabled={type==='delete-confirm'&&del!=='DELETE'}
            style={{ flex:1.5,padding:'13px',borderRadius:14,border:'none',
              background:type==='delete-confirm'?(del==='DELETE'?RED:'#E5E7EB')
                :type==='deactivate'?ORANGE
                :`linear-gradient(135deg,${BRAND},#4C1DCC)`,
              color:(type==='delete-confirm'&&del!=='DELETE')?'#9CA3AF':'#fff',
              fontSize:13,fontWeight:800,
              cursor:(type==='delete-confirm'&&del!=='DELETE')?'not-allowed':'pointer',
              fontFamily:"'Nunito',sans-serif" }}>
            {type==='change-password'?'Update Password'
              :type==='deactivate'?'Deactivate Account'
              :type==='delete-confirm'?'Delete My Account':'Save Changes'}
          </button>
        </div>
      </div>
    </>
  );
}

/* ─── Logout modal ────────────────────────────────────────────── */
function LogoutModal({ onClose, onConfirm }) {
  return (
    <>
      <div onClick={onClose} style={{ position:'fixed',inset:0,zIndex:3000,
        background:'rgba(0,0,0,.45)',backdropFilter:'blur(4px)' }}/>
      <div style={{ position:'fixed',bottom:0,left:0,right:0,zIndex:3100,
        background:'#fff',borderRadius:'22px 22px 0 0',
        padding:'28px 18px 40px',animation:'sheet-up .3s ease',
        fontFamily:"'Nunito',sans-serif",textAlign:'center' }}>
        <div style={{ width:36,height:4,borderRadius:2,background:'#D1D5DB',margin:'0 auto 22px' }}/>
        <div style={{ width:52,height:52,borderRadius:'50%',background:`${RED}12`,
          border:`1.5px solid ${RED}30`,display:'flex',alignItems:'center',
          justifyContent:'center',margin:'0 auto 14px' }}>
          <Icon name="ti-logout" size={22} color={RED}/>
        </div>
        <p style={{ fontSize:17,fontWeight:900,color:'#111827',margin:'0 0 8px' }}>Log out of Akoro?</p>
        <p style={{ fontSize:13,color:'#6B7280',margin:'0 0 24px',lineHeight:1.6 }}>
          You'll need to sign back in to continue learning with your AI agent.
        </p>
        <div style={{ display:'flex',gap:10 }}>
          <button onClick={onClose} style={{ flex:1,padding:'13px',borderRadius:14,
            border:'1.5px solid #E5E7EB',background:'#F9FAFB',
            fontSize:13,fontWeight:800,color:'#6B7280',cursor:'pointer',
            fontFamily:"'Nunito',sans-serif" }}>Cancel</button>
          <button onClick={onConfirm}
            style={{ flex:1.5,padding:'13px',borderRadius:14,border:'none',
              background:`linear-gradient(135deg,${RED},#DC2626)`,color:'#fff',
              fontSize:13,fontWeight:800,cursor:'pointer',fontFamily:"'Nunito',sans-serif",
              boxShadow:`0 4px 14px ${RED}44` }}>Log out</button>
        </div>
      </div>
    </>
  );
}

/* ─── Subjects row ────────────────────────────────────────────── */
function SubjectsRow({ subjects,onClick,color=BRAND }) {
  return (
    <div style={{ ...rowBase,flexDirection:'column',alignItems:'stretch',cursor:'pointer' }}
      onMouseEnter={e=>e.currentTarget.style.background='#F9FAFB'}
      onMouseLeave={e=>e.currentTarget.style.background='#fff'}
      onClick={onClick}>
      <div style={{ display:'flex',alignItems:'center',width:'100%' }}>
        <span style={{ fontSize:17,width:28,flexShrink:0,display:'flex',alignItems:'center' }}>
          <Icon name="ti-book-2" size={17} color="#6B7280"/>
        </span>
        <div style={{ flex:1 }}>
          <p style={{ fontSize:13.5,fontWeight:700,margin:0,color:'#111827' }}>Subjects</p>
        </div>
        <span style={{ fontSize:12.5,fontWeight:600,color:'#6B7280',marginRight:4 }}>
          {subjects.length} added</span>
        <span style={{ color:'#D1D5DB',fontSize:16 }}>›</span>
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

/* ─── Notification section ────────────────────────────────────── */
function NotifSection({ notif, setNotif, onSaveNotif }) {
  const toggle = (key) => {
    const updated = { ...notif, [key]: !notif[key] };
    setNotif(updated);
    onSaveNotif(updated);
  };
  const NotifRow = ({ icon,label,sub,field }) => (
    <div style={{ ...rowBase }}>
      <span style={{ fontSize:17,width:28,flexShrink:0,display:'flex',alignItems:'center' }}>
        <Icon name={icon} size={17} color="#6B7280"/>
      </span>
      <div style={{ flex:1 }}>
        <p style={{ fontSize:13.5,fontWeight:700,margin:0,color:'#111827' }}>{label}</p>
        {sub&&<p style={{ fontSize:11.5,color:'#9CA3AF',marginTop:2,margin:0 }}>{sub}</p>}
      </div>
      <Toggle on={notif[field]} onChange={()=>toggle(field)}/>
    </div>
  );
  return (
    <>
      <Section title="Notification Channels">
        <NotifRow icon="ti-mail"   label="Email Notifications" sub="Class updates and reminders"     field="email"/>
        <NotifRow icon="ti-phone"  label="SMS Notifications"   sub="Text message alerts"             field="sms"/>
        <NotifRow icon="ti-bell"   label="Push Notifications"  sub="In-app and device alerts"        field="push"/>
        <NotifRow icon="ti-brand-whatsapp" label="WhatsApp"    sub="WhatsApp messages"               field="whatsapp"/>
        {notif.whatsapp&&(
          <div style={{ ...rowBase }}>
            <span style={{ fontSize:17,width:28,flexShrink:0,display:'flex',alignItems:'center' }}>
              <Icon name="ti-device-mobile" size={17} color="#6B7280"/>
            </span>
            <div style={{ flex:1 }}>
              <p style={{ fontSize:13.5,fontWeight:700,margin:0,color:'#111827' }}>WhatsApp Number</p>
            </div>
            <input value={notif.whatsappNumber||''}
              onChange={e=>{
                const updated={...notif,whatsappNumber:e.target.value};
                setNotif(updated);
              }}
              onBlur={()=>onSaveNotif(notif)}
              placeholder="+234..."
              style={{ width:130,padding:'7px 10px',borderRadius:10,
                border:'1.5px solid #E5E7EB',outline:'none',fontSize:12.5,
                fontFamily:"'Nunito',sans-serif",color:'#111827',textAlign:'right' }}/>
          </div>
        )}
      </Section>
      <Section title="Notification Events">
        <NotifRow icon="ti-clock"          label="Session Reminders"  sub="Reminded before class starts"  field="sessionReminders"/>
        <NotifRow icon="ti-player-play"    label="Session Started"    sub="When your live class begins"    field="sessionStarted"/>
        <NotifRow icon="ti-player-stop"    label="Session Cancelled"  sub="If a class is cancelled"        field="sessionCancelled"/>
        <NotifRow icon="ti-speakerphone"   label="Announcements"      sub="New posts from instructors"     field="announcements"/>
        <NotifRow icon="ti-message-circle" label="Q&A Replies"        sub="When someone replies to you"    field="qaReplies"/>
      </Section>
    </>
  );
}

/* ─── User tab ────────────────────────────────────────────────── */
function UserTab({ profile, setProfile, onSaveProfile, onSaveNotif, onSaveAgent, guides = [], onLogout }) {
  const [sheet,        setSheet]        = useState(null);
  const [subjectSheet, setSubjectSheet] = useState(false);
  const [avatarSheet,  setAvatarSheet]  = useState(false);
  const [toast,        setToast]        = useState('');

  const color   = profile.accentColor || BRAND;
  const xpPct   = profile.sessionsLimit
    ? Math.round((profile.sessionsUsed/profile.sessionsLimit)*100)
    : 0;

  const showToast = m => { setToast(m); setTimeout(()=>setToast(''),2200); };

  const openSheet = (f,l,t,o) => setSheet({field:f,label:l,type:t,options:o});

  const saveField = useCallback(async (field, val) => {
    // Special handling for account deactivation / deletion
    if (field === 'deactivate') {
      try {
        await deactivateAccount();
        showToast('Account deactivated');
        setTimeout(() => onLogout && onLogout(), 1000);
      } catch { showToast('Failed to deactivate'); }
      return;
    }
    if (field === 'deleteAccount') {
      try {
        await deleteAccount();
        showToast('Account deleted');
        setTimeout(() => onLogout && onLogout(), 1000);
      } catch { showToast('Failed to delete account'); }
      return;
    }
    const patch = {};
    const fieldMap = {
      fullName:'fullName', username:'username', phone:'phone',
      country:'country', school:'schoolName', schoolType:'schoolType',
      year:'yearGroup', teachingGuide:'teachingGuide',
      language:'language', displayMode:'displayMode',
      accentColor:'accentColor', twoFactor:'twoFactorEnabled',
    };
    const apiKey = fieldMap[field] || field;
    patch[apiKey] = val;
    setProfile(p => ({ ...p, [field]: val }));
    try {
      await onSaveProfile(patch);
      showToast('Saved ✓');
    } catch {
      showToast('Failed to save');
    }
  }, [onSaveProfile, setProfile, onLogout]);

  return (
    <div style={{ padding:'20px 0 0' }}>
      {/* Profile hero */}
      <div style={{ display:'flex',alignItems:'center',gap:14,background:'#fff',
        margin:'0 16px 20px',borderRadius:18,padding:'18px 16px',
        border:'1px solid #F3F4F6',boxShadow:'0 1px 6px rgba(0,0,0,.05)' }}>
        <AvatarCircle photoUrl={profile.avatarUrl} emoji={profile.avatarEmoji||'👨🏾‍🎓'}
          color={color} size={60} onPhotoClick={()=>setAvatarSheet(true)}/>
        <div style={{ flex:1 }}>
          <p style={{ margin:'0 0 2px',fontSize:15,fontWeight:900,
            color:'#111827',fontFamily:"'Nunito',sans-serif" }}>{profile.fullName||'—'}</p>
          <p style={{ margin:'0 0 6px',fontSize:12.5,color:'#6B7280',
            fontFamily:"'Nunito',sans-serif" }}>@{profile.username}</p>
          <div style={{ display:'inline-flex',alignItems:'center',gap:5,
            background:`${color}12`,borderRadius:8,padding:'3px 10px' }}>
            <Icon name="ti-bolt" size={11} color={color}/>
            <span style={{ fontSize:11,fontWeight:800,color }}>
              {profile.plan||'Free'} · {(profile.xpBalance||0).toLocaleString()} XP
            </span>
          </div>
        </div>
      </div>

      <Section title="Profile">
        <Row icon="ti-user"  label="Full Name"    value={profile.fullName}
          onClick={()=>openSheet('fullName','Full Name','text')}/>
        <Row icon="ti-at"    label="Username"     value={`@${profile.username}`}
          onClick={()=>openSheet('username','Username','text')}/>
        <Row icon="ti-mail"  label="Email"        value={profile.email}
          sub={profile.googleLinked?'Linked via Google':undefined}/>
        <Row icon="ti-phone" label="Phone Number" value={profile.phone||'Not set'}
          onClick={()=>openSheet('phone','Phone Number','text')}/>
        <Row icon="ti-map-pin" label="Country"    value={profile.country||'Not set'}
          onClick={()=>openSheet('country','Country','select',COUNTRIES)}/>
      </Section>

      <Section title="Learn & Study">
        <Row icon="ti-chalkboard" label="Teaching Guide"
          value={`${profile.guideEmoji||'🧠'} ${profile.teachingGuide||'NaNa Esumai'}`}
          onClick={()=>openSheet('teachingGuide','Teaching Guide','select',guides.length ? guides : GUIDES)}/>
        <Row icon="ti-building" label="School Name" value={profile.school||'Not set'}
          onClick={()=>openSheet('school','School Name','text')}/>
        <Row icon="ti-school" label="School Type" value={profile.schoolType||'Not set'}
          onClick={()=>openSheet('schoolType','School Type','select',SCHOOL_TYPES)}/>
        <Row icon="ti-calendar" label="Year / Class" value={profile.year||'Not set'}
          onClick={()=>openSheet('year','Year / Class','select',YEARS)}/>
        <SubjectsRow subjects={profile.subjects||[]}
          onClick={()=>setSubjectSheet(true)} color={color}/>
      </Section>

      <Section title="Account">
        <Row icon="ti-calendar-event" label="Member Since" value={profile.memberSince}/>
        <Row icon="ti-id" label="Account ID" sub="Tap to copy" value={profile.memberId} noArrow
          onClick={()=>{navigator.clipboard?.writeText(profile.memberId);showToast('Copied ✓');}}/>
        <Row icon="ti-link" label="Linked Accounts"
          value={profile.googleLinked?'Google ✓':'None'}
          sub={profile.googleLinked?'Google account connected':undefined}/>
      </Section>

      <Section title="Plan & Usage">
        <Row icon="ti-star" label="Current Plan" value={profile.plan||'Free'}/>
        <div style={rowBase}>
          <span style={{ fontSize:17,width:28,flexShrink:0,display:'flex',alignItems:'center' }}>
            <Icon name="ti-chart-bar" size={17} color="#6B7280"/>
          </span>
          <div style={{ flex:1 }}>
            <p style={{ fontSize:13.5,fontWeight:700,margin:0,color:'#111827' }}>Sessions Used</p>
            <div style={{ marginTop:6 }}><ProgressBar pct={xpPct} color={color}/></div>
          </div>
          <span style={{ fontSize:12.5,fontWeight:600,color:'#6B7280',marginLeft:10 }}>
            {profile.sessionsUsed||0}/{profile.sessionsLimit||30}</span>
        </div>
        <Row icon="ti-clock" label="Teaching Hours" value={profile.teachingHours||'0h'}/>
        <Row icon="ti-bolt"  label="XP Balance"     value={`${(profile.xpBalance||0).toLocaleString()} XP`}/>
        <Row icon="ti-arrow-up" label="Upgrade Plan" sub="Get unlimited sessions"
          onClick={()=>showToast('Upgrade flow coming soon!')}>
          <span style={{ fontSize:12.5,fontWeight:800,color,marginRight:4 }}>Pro</span>
        </Row>
      </Section>

      <Section title="Personalization & Appearance">
        <Row icon="ti-language" label="Language"
          value={profile.language||'English'}
          onClick={()=>openSheet('language','Language','select',LANGUAGES)}/>
        <Row icon="ti-moon" label="Display Mode"
          value={(profile.displayMode||'system').charAt(0).toUpperCase()+(profile.displayMode||'system').slice(1)}
          onClick={()=>openSheet('displayMode','Display Mode','display-mode')}/>
        <Row icon="ti-palette" label="Theme Accent"
          onClick={()=>openSheet('accentColor','Accent Colour','accent')}>
          <div style={{ width:18,height:18,borderRadius:'50%',background:color,marginRight:6,flexShrink:0 }}/>
        </Row>
      </Section>

      <NotifSection
        notif={profile.notif||{}}
        setNotif={n=>setProfile(p=>({...p,notif:n}))}
        onSaveNotif={onSaveNotif}/>

      <Section title="Help & Support">
        <Row icon="ti-message-circle" label="Contact Support"  onClick={()=>showToast('Opening support...')}/>
        <Row icon="ti-help-circle"    label="Help Centre"      onClick={()=>showToast('Opening help centre...')}/>
        <Row icon="ti-bug"            label="Report a Bug"     onClick={()=>showToast('Opening bug report...')}/>
        <Row icon="ti-star"           label="Rate the App"     onClick={()=>showToast('Thanks for rating! ⭐')}/>
      </Section>

      <Section title="About & Version">
        <Row icon="ti-info-circle" label="App Version" value="v1.0.0"/>
        <Row icon="ti-file-text"   label="Terms of Service"     onClick={()=>showToast('Opening terms...')}/>
        <Row icon="ti-shield"      label="Privacy Policy"       onClick={()=>showToast('Opening privacy policy...')}/>
        <Row icon="ti-license"     label="Open Source Licences" onClick={()=>showToast('Opening licences...')}/>
      </Section>

      <Section title="Privacy & Security">
        <Row icon="ti-key" label="Change Password"
          onClick={()=>openSheet('password','Change Password','change-password')}/>
        <div style={rowBase}>
          <span style={{ fontSize:17,width:28,flexShrink:0,display:'flex',alignItems:'center' }}>
            <Icon name="ti-lock" size={17} color="#6B7280"/>
          </span>
          <div style={{ flex:1 }}>
            <p style={{ fontSize:13.5,fontWeight:700,margin:0,color:'#111827' }}>Two-Factor Auth</p>
            <p style={{ fontSize:11.5,color:'#9CA3AF',marginTop:2,margin:0 }}>Extra security for your account</p>
          </div>
          <Toggle on={!!profile.twoFactor}
            onChange={()=>saveField('twoFactor', !profile.twoFactor)}/>
        </div>
        <Row icon="ti-player-pause" label="Deactivate Account" danger
          sub="Suspend your account temporarily"
          onClick={()=>openSheet('deactivate','Deactivate Account','deactivate')}/>
        <Row icon="ti-trash" label="Delete Account" danger
          sub="Permanently delete all data"
          onClick={()=>openSheet('deleteAccount','Delete Account','delete-confirm')}/>
      </Section>
      <div style={{ height:40 }}/>

      {avatarSheet&&(
        <AvatarPickerSheet type="user"
          current={{ emoji:profile.avatarEmoji, photoUrl:profile.avatarUrl }}
          color={color}
          onClose={()=>setAvatarSheet(false)}
          onSavePhoto={async url=>{
            setProfile(p=>({...p,avatarUrl:url}));
            showToast('Photo updated ✓');
          }}
          onSaveEmoji={em=>{
            setProfile(p=>({...p,avatarEmoji:em,avatarUrl:null}));
            showToast('Saved ✓');
          }}/>
      )}
      {subjectSheet&&(
        <SubjectsSheet current={profile.subjects||[]} accentColor={color}
          onClose={()=>setSubjectSheet(false)}
          onSave={async s=>{
            setProfile(p=>({...p,subjects:s}));
            try { await onSaveProfile({ subjects:s }); showToast('Subjects saved ✓'); }
            catch { showToast('Failed to save subjects'); }
          }}/>
      )}
      {sheet&&(
        <GenericSheet {...sheet} value={profile[sheet.field]}
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

/* ─── Agent tab ───────────────────────────────────────────────── */
function AgentTab({ agent, setAgent, onSaveAgent }) {
  const [sheet,        setSheet]        = useState(null);
  const [subjectSheet, setSubjectSheet] = useState(false);
  const [avatarSheet,  setAvatarSheet]  = useState(false);
  const [toast,        setToast]        = useState('');

  const showToast = m => { setToast(m); setTimeout(()=>setToast(''),2200); };
  const openSheet = (f,l,t,o) => setSheet({field:f,label:l,type:t,options:o});

  const saveField = useCallback(async (field, val) => {
    const updated = { ...agent, [field]: val };
    setAgent(updated);
    try {
      await onSaveAgent({ [field]: val });
      showToast('Saved ✓');
    } catch {
      showToast('Failed to save');
    }
  }, [agent, onSaveAgent, setAgent]);

  const stats = [
    { icon:'ti-book',          label:'Topics Taught',  value:(agent.totalSessions||0)*4 },
    { icon:'ti-bulb',          label:'Avg Confidence', value:`${agent.knowledgeScore||0}%` },
    { icon:'ti-circle-check',  label:'Sessions Done',  value:agent.totalSessions||0 },
    { icon:'ti-message-circle',label:'Total Turns',    value:agent.totalTurns||0 },
    { icon:'ti-bolt',          label:'XP Earned',      value:(agent.xpEarned||0).toLocaleString() },
    { icon:'ti-star',          label:'Agent Level',    value:`Level ${agent.level||1}` },
  ];
  const color    = agent.color || ORANGE;
  const levelPct = Math.min(100,((agent.level||1)/10)*100);

  return (
    <div style={{ padding:'20px 0 0' }}>
      {/* Agent hero */}
      <div style={{ background:'#fff',margin:'0 16px 16px',borderRadius:18,
        padding:'18px 16px',border:`1.5px solid ${color}25`,
        boxShadow:'0 1px 6px rgba(0,0,0,.04)',
        display:'flex',alignItems:'center',gap:14 }}>
        <AvatarCircle photoUrl={agent.photoUrl} emoji={agent.emoji||'🤖'}
          color={color} size={64} onPhotoClick={()=>setAvatarSheet(true)}/>
        <div style={{ flex:1 }}>
          <p style={{ margin:'0 0 2px',fontSize:17,fontWeight:900,
            color:'#111827',fontFamily:"'Nunito',sans-serif" }}>{agent.name||'My Agent'}</p>
          <p style={{ margin:'0 0 8px',fontSize:12.5,color:'#6B7280',
            fontFamily:"'Nunito',sans-serif" }}>Your AI learning agent</p>
          <div style={{ display:'flex',gap:6,flexWrap:'wrap' }}>
            <span style={{ fontSize:11,fontWeight:800,padding:'3px 10px',borderRadius:8,
              background:`${color}15`,color }}>
              {agent.studyLevel||'Student'}</span>
            <span style={{ fontSize:11,fontWeight:800,padding:'3px 10px',borderRadius:8,
              background:'#F3F4F6',color:'#6B7280' }}>
              Lv.{agent.level||1}</span>
          </div>
        </div>
      </div>

      {/* Level progress */}
      <div style={{ margin:'0 16px 16px',background:'#fff',borderRadius:14,
        padding:'14px 16px',border:'1px solid #F3F4F6',boxShadow:'0 1px 4px rgba(0,0,0,.04)' }}>
        <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8 }}>
          <span style={{ fontSize:12,fontWeight:800,color:'#374151',fontFamily:"'Nunito',sans-serif" }}>
            <Icon name="ti-star" size={13} color={color} style={{ marginRight:5 }}/>
            Agent Level {agent.level||1}
          </span>
          <span style={{ fontSize:11.5,fontWeight:600,color:'#9CA3AF',fontFamily:"'Nunito',sans-serif" }}>
            {agent.totalTurns||0} turns · {(agent.xpEarned||0).toLocaleString()} XP
          </span>
        </div>
        <ProgressBar pct={levelPct} color={color}/>
        <p style={{ fontSize:11,color:'#9CA3AF',margin:'6px 0 0',fontFamily:"'Nunito',sans-serif" }}>
          Level {agent.level||1} → {(agent.level||1)+1} · {Math.round(100-levelPct)}% remaining
        </p>
      </div>

      {/* Stats grid */}
      <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,margin:'0 16px 20px' }}>
        {stats.map(({icon,label,value})=>(
          <div key={label} style={{ background:'#fff',borderRadius:13,
            padding:'13px 14px',border:'1px solid #F3F4F6',boxShadow:'0 1px 4px rgba(0,0,0,.04)' }}>
            <Icon name={icon} size={19} color={color} style={{ marginBottom:5,display:'block' }}/>
            <p style={{ margin:'0 0 1px',fontSize:18,fontWeight:900,
              color:'#111827',fontFamily:"'Nunito',sans-serif" }}>{value}</p>
            <p style={{ margin:0,fontSize:11,color:'#9CA3AF',fontFamily:"'Nunito',sans-serif" }}>{label}</p>
          </div>
        ))}
      </div>

      <Section title="Agent Profile">
        <Row icon="ti-tag" label="Agent Name" value={agent.name}
          onClick={()=>openSheet('name','Agent Name','text')}/>
        <Row icon="ti-writing" label="Personality"
          sub={(agent.personality||'Not set').slice(0,40)+(agent.personality?.length>40?'…':'')}
          onClick={()=>openSheet('personality','Agent Personality','textarea')}/>
        <Row icon="ti-palette" label="Agent Colour"
          onClick={()=>openSheet('color','Agent Colour','accent')}>
          <div style={{ width:18,height:18,borderRadius:'50%',background:color,marginRight:6,flexShrink:0 }}/>
        </Row>
        <Row icon="ti-droplet" label="Card Background"
          onClick={()=>openSheet('bg','Card Background','bg')}>
          <div style={{ width:18,height:18,borderRadius:'50%',
            background:agent.bg||'#FEF0E6',border:'1px solid #E5E7EB',
            marginRight:6,flexShrink:0 }}/>
        </Row>
      </Section>

      <Section title="Study Profile">
        <Row icon="ti-school"      label="Study Level"  value={agent.studyLevel||'Not set'}
          onClick={()=>openSheet('studyLevel','Study Level','select',STUDY_LEVELS)}/>
        <Row icon="ti-calendar"    label="Year / Grade" value={agent.yearGroup||'Not set'}
          onClick={()=>openSheet('yearGroup','Year / Grade','select',YEARS)}/>
        <Row icon="ti-certificate" label="Exam Board"   value={agent.examBoard||'Not set'}
          onClick={()=>openSheet('examBoard','Exam Board','select',EXAM_BOARDS)}/>
        <SubjectsRow subjects={agent.subjects||[]}
          onClick={()=>setSubjectSheet(true)} color={color}/>
      </Section>

      <Section title="Learning Goal">
        <Row icon="ti-target" label="Primary Goal" value={agent.goal||'Not set'}
          onClick={()=>openSheet('goal','Primary Goal','select',GOALS)}/>
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
            catch { showToast('Failed to save subjects'); }
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

/* ─── Loading skeleton ────────────────────────────────────────── */
function LoadingSkeleton() {
  return (
    <div style={{ padding:'20px 16px' }}>
      {[80,60,120,100,90].map((w,i)=>(
        <div key={i} style={{ height:16,width:`${w}%`,background:'#F3F4F6',
          borderRadius:8,marginBottom:16,animation:'pulse 1.5s ease-in-out infinite' }}/>
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}

/* ─── Main SettingsPage ───────────────────────────────────────── */
export default function SettingsPage() {
  const navigate           = useNavigate();
  const { user, logout }   = useAuth();

  const [tab,         setTab]         = useState('user');
  const [profile,     setProfile]     = useState(null);
  const [agent,       setAgent]       = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [showLogout,  setShowLogout]  = useState(false);
  const [guides,      setGuides]      = useState([]);

  /* ── Load profile on mount ─────────────────────────────────── */
  useEffect(() => {
    getTeachingGuides().then(d => {
      if (d.data?.guides) setGuides(d.data.guides.map(g => `${g.name} ${g.emoji}`));
    }).catch(() => {});
    getMyProfile()
      .then(({ data }) => {
        setProfile({
          id:            data.id,
          email:         data.email,
          username:      data.username,
          fullName:      data.fullName,
          avatarUrl:     data.avatarUrl,
          avatarEmoji:   '👨🏾‍🎓',
          phone:         data.phone,
          country:       data.country,
          school:        data.schoolName,
          schoolType:    data.schoolType,
          year:          data.yearGroup,
          teachingGuide: data.teachingGuide || 'NaNa Esumai',
          guideEmoji:    data.guideEmoji    || '🧠',
          subjects:      data.subjects      || [],
          language:      data.language      || 'English',
          displayMode:   data.displayMode   || 'system',
          accentColor:   data.accentColor   || BRAND,
          twoFactor:     data.twoFactorEnabled || false,
          googleLinked:  !!data.email,
          plan:          'Free',
          sessionsUsed:  0,
          sessionsLimit: 30,
          teachingHours: '0h',
          xpBalance:     data.agent?.xpEarned || 0,
          memberId:      data.id,
          memberSince:   data.memberSince,
          notif: data.notif || {
            email:true,sms:false,push:true,whatsapp:false,whatsappNumber:'',
            sessionReminders:true,sessionStarted:true,sessionCancelled:true,
            announcements:true,qaReplies:true,
          },
        });
        if (data.agent) {
          setAgent({
            name:          data.agent.name,
            emoji:         data.agent.emoji,
            photoUrl:      data.agent.photoUrl,
            color:         data.agent.color    || ORANGE,
            bg:            data.agent.bg       || '#FEF0E6',
            personality:   data.agent.personality,
            studyLevel:    data.agent.studyLevel,
            yearGroup:     data.agent.yearGroup,
            examBoard:     data.agent.examBoard,
            subjects:      data.agent.subjects || [],
            goal:          data.agent.goal,
            level:         data.agent.level          || 1,
            totalSessions: data.agent.totalSessions  || 0,
            totalTurns:    data.agent.totalTurns     || 0,
            knowledgeScore:data.agent.knowledgeScore || 0,
            xpEarned:      data.agent.xpEarned       || 0,
          });
        } else {
          setAgent({
            name:'My Agent',emoji:'🤖',photoUrl:null,
            color:ORANGE,bg:'#FEF0E6',personality:'',
            studyLevel:'',yearGroup:'',examBoard:'',subjects:[],goal:'',
            level:1,totalSessions:0,totalTurns:0,knowledgeScore:0,xpEarned:0,
          });
        }
      })
      .catch(() => {
        // Fallback to auth context data
        if (user) {
          setProfile({
            id:user.id,email:user.email,username:user.username,
            fullName:user.fullName,avatarUrl:user.avatarUrl,avatarEmoji:'👨🏾‍🎓',
            subjects:[],language:'English',displayMode:'system',accentColor:BRAND,
            twoFactor:false,googleLinked:false,plan:'Free',sessionsUsed:0,
            sessionsLimit:30,teachingHours:'0h',xpBalance:0,
            memberId:user.id,memberSince:'—',
            notif:{ email:true,sms:false,push:true,whatsapp:false,whatsappNumber:'',
              sessionReminders:true,sessionStarted:true,sessionCancelled:true,
              announcements:true,qaReplies:true },
          });
          setAgent({ name:'My Agent',emoji:'🤖',photoUrl:null,color:ORANGE,bg:'#FEF0E6',
            personality:'',studyLevel:'',yearGroup:'',examBoard:'',subjects:[],goal:'',
            level:1,totalSessions:0,totalTurns:0,knowledgeScore:0,xpEarned:0 });
        }
      })
      .finally(() => setLoading(false));
  }, [user]);

  /* ── Apply dark mode and accent color to document ─────────── */
  useEffect(() => {
    if (!profile) return;
    const root = document.documentElement;
    const mode = profile.displayMode || 'system';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = mode === 'dark' || (mode === 'system' && prefersDark);
    root.setAttribute('data-theme', isDark ? 'dark' : 'light');
    if (profile.accentColor) root.style.setProperty('--accent', profile.accentColor);
  }, [profile?.displayMode, profile?.accentColor]);

  const handleSaveProfile     = useCallback(p => patchMyProfile(p), []);
  const handleSaveNotif       = useCallback(n => patchNotifications(n), []);
  const handleSaveAgent       = useCallback(a => putAgent(a), []);
  const handleLogoutConfirm   = useCallback(() => { setShowLogout(false); logout(); }, [logout]);

  const color = profile?.accentColor || BRAND;

  return (
    <div style={{ minHeight:'100vh',background:'#F9FAFB',
      fontFamily:"'Nunito',sans-serif",maxWidth:480,margin:'0 auto' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
        @keyframes sheet-up{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
        *{box-sizing:border-box}
      `}</style>

      {/* Header */}
      <header style={{ position:'sticky',top:0,zIndex:100,
        background:'#fff',borderBottom:'1px solid #F3F4F6',
        boxShadow:'0 1px 6px rgba(0,0,0,.06)',
        height:54,display:'flex',alignItems:'center',
        padding:'0 16px',gap:12 }}>
        <button onClick={()=>navigate('/')}
          style={{ background:'none',border:'none',cursor:'pointer',
            padding:4,display:'flex',alignItems:'center',flexShrink:0 }}>
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none"
            stroke="#111827" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div style={{ width:34,height:34,borderRadius:'50%',overflow:'hidden',
          border:`2px solid ${color}`,flexShrink:0,
          display:'flex',alignItems:'center',justifyContent:'center',
          background:`${color}18`,fontSize:16 }}>
          {profile?.avatarUrl
            ? <img src={profile.avatarUrl} style={{ width:'100%',height:'100%',objectFit:'cover' }}/>
            : profile?.avatarEmoji || user?.avatarUrl
              ? <img src={user.avatarUrl} style={{ width:'100%',height:'100%',objectFit:'cover' }}/>
              : '👤'
          }
        </div>
        <div style={{ flex:1,minWidth:0 }}>
          <p style={{ fontSize:14,fontWeight:800,color:'#111827',margin:0,lineHeight:1.2,
            overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
            {profile?.fullName || user?.fullName || '…'}
          </p>
          <p style={{ fontSize:11,color:'#9CA3AF',margin:0 }}>@{profile?.username || user?.username || '…'}</p>
        </div>
        <button onClick={()=>setShowLogout(true)}
          style={{ display:'flex',alignItems:'center',gap:6,background:'#F9FAFB',
            border:'1px solid #E5E7EB',borderRadius:8,padding:'6px 12px',
            cursor:'pointer',fontFamily:"'Nunito',sans-serif",
            fontSize:12,fontWeight:700,color:'#6B7280',flexShrink:0 }}>
          <Icon name="ti-logout" size={15} color="#6B7280"/> Sign Out
        </button>
      </header>

      {/* Tabs */}
      <div style={{ display:'flex',background:'#fff',borderBottom:'1px solid #F3F4F6',padding:'0 16px' }}>
        {['user','agent'].map(t=>(
          <button key={t} onClick={()=>setTab(t)}
            style={{ flex:1,padding:'11px 0',background:'none',border:'none',
              cursor:'pointer',fontSize:13,fontWeight:tab===t?900:600,
              color:tab===t?BRAND:'#9CA3AF',
              borderBottom:`2.5px solid ${tab===t?BRAND:'transparent'}`,
              transition:'all .2s',fontFamily:"'Nunito',sans-serif",
              display:'flex',alignItems:'center',justifyContent:'center',gap:6 }}>
            {t==='user'
              ? <><Icon name="ti-user" size={14}/> Account</>
              : <><span>{agent?.photoUrl
                  ? <img src={agent.photoUrl} style={{ width:16,height:16,borderRadius:'50%',objectFit:'cover' }}/>
                  : agent?.emoji||'🤖'
                }</span> {agent?.name||'Agent'}</>
            }
          </button>
        ))}
      </div>

      {loading ? <LoadingSkeleton /> : (
        tab==='user'
          ? <UserTab
              profile={profile} setProfile={setProfile}
              onSaveProfile={handleSaveProfile}
              onSaveNotif={handleSaveNotif}
              onSaveAgent={handleSaveAgent}
              guides={guides}
              onLogout={handleLogoutConfirm}/>
          : <AgentTab
              agent={agent} setAgent={setAgent}
              onSaveAgent={handleSaveAgent}/>
      )}

      {showLogout&&(
        <LogoutModal onClose={()=>setShowLogout(false)} onConfirm={handleLogoutConfirm}/>
      )}
    </div>
  );
}
