/**
 * Settings — bottom-sheet / modal components (avatar, subjects, generic field,
 * logout, two-factor auth).
 */
import { useState, useRef, useEffect } from 'react';
import QRCode from 'qrcode';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { setup2FA, enable2FA, disable2FA } from '../../services/settingsApi.js';
import {
  BRAND, RED, ORANGE, ALL_SUBJECTS, SUBJ_ICON,
  Icon, Toggle, ProgressBar, SubjectChip, Section, Row, AvatarCircle, SubjectsRow,
} from './shared.jsx';

/* ─── Avatar picker sheet ─────────────────────────────────────── */
function AvatarPickerSheet({ type, current, onClose, onSavePhoto, onSaveEmoji, color }) {
  const { t } = useLang();
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
          background:'rgba(0,0,0,.55)',backdropFilter:'blur(4px)' }}/>
      <div style={{ position:'fixed',bottom:0,left:0,right:0,zIndex:3100,
        background:'var(--ak-surface)',borderRadius:'22px 22px 0 0',
        padding:'0 18px 40px',boxShadow:'0 -8px 40px rgba(0,0,0,.2)',
        animation:'sheet-up .3s ease',fontFamily:"'Nunito',sans-serif",
        maxHeight:'88vh',overflowY:'auto' }}>
        <div style={{ width:36,height:4,borderRadius:2,background:'var(--ak-border3)',
          margin:'14px auto 18px' }}/>
        <p style={{ fontSize:16,fontWeight:900,color:'var(--ak-text)',margin:'0 0 16px' }}>
          {type==='user'?t('settings.change_profile_photo'):t('settings.change_agent_photo')}
        </p>
        <div style={{ display:'flex',background:'var(--ak-tag-bg)',borderRadius:12,
          padding:3,marginBottom:20,gap:3 }}>
          {['photo','emoji'].map(tk=>(
            <button key={tk} onClick={()=>setTab(tk)}
              style={{ flex:1,padding:'8px 0',borderRadius:10,border:'none',
                background:tab===tk?'var(--ak-surface)':'transparent',cursor:'pointer',
                fontSize:12.5,fontWeight:800,fontFamily:"'Nunito',sans-serif",
                color:tab===tk?'var(--ak-text)':'var(--ak-text-sub)',
                boxShadow:tab===tk?'0 1px 4px rgba(0,0,0,.12)':'none' }}>
              {tk==='photo'?t('settings.upload_photo'):t('settings.choose_emoji')}
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
                      fontFamily:"'Nunito',sans-serif" }}>{t('settings.remove_photo')}</button>
                </div>
              : <div onClick={()=>fileRef.current?.click()}
                  style={{ border:'2px dashed var(--ak-border2)',borderRadius:16,
                    padding:'32px 20px',textAlign:'center',cursor:'pointer',marginBottom:20 }}
                  onMouseEnter={e=>e.currentTarget.style.borderColor=color}
                  onMouseLeave={e=>e.currentTarget.style.borderColor='var(--ak-border2)'}>
                  <Icon name="ti-upload" size={28} color="var(--ak-text-muted)"
                    style={{ display:'block',margin:'0 auto 10px' }}/>
                  <p style={{ fontSize:14,fontWeight:800,color:'var(--ak-text)',margin:'0 0 4px' }}>
                    {t('settings.tap_upload')}</p>
                  <p style={{ fontSize:12,color:'var(--ak-text-muted)',margin:0 }}>{t('settings.photo_formats')}</p>
                </div>
            }
            <div style={{ display:'flex',gap:10 }}>
              <button onClick={onClose} style={{ flex:1,padding:'13px',borderRadius:14,
                border:'1.5px solid var(--ak-border2)',background:'var(--ak-surface-hover)',
                fontSize:13,fontWeight:800,color:'var(--ak-text-sub)',cursor:'pointer',
                fontFamily:"'Nunito',sans-serif" }}>{t('common.cancel')}</button>
              <button onClick={()=>{ if(preview){onSavePhoto(preview);onClose();} }}
                disabled={!preview}
                style={{ flex:1.5,padding:'13px',borderRadius:14,border:'none',
                  background:preview?`linear-gradient(135deg,${color},#4C1DCC)`:'var(--ak-tag-bg)',
                  color:preview?'#fff':'var(--ak-text-muted)',fontSize:13,fontWeight:800,
                  cursor:preview?'pointer':'not-allowed',fontFamily:"'Nunito',sans-serif" }}>
                {t('settings.save_photo')}</button>
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
                    background:selEmoji===em?`${color}15`:'var(--ak-tag-bg)',
                    border:`1.5px solid ${selEmoji===em?color:'var(--ak-border2)'}` }}>
                  {em}
                </div>
              ))}
            </div>
            <div style={{ display:'flex',gap:10 }}>
              <button onClick={onClose} style={{ flex:1,padding:'13px',borderRadius:14,
                border:'1.5px solid var(--ak-border2)',background:'var(--ak-surface-hover)',
                fontSize:13,fontWeight:800,color:'var(--ak-text-sub)',cursor:'pointer',
                fontFamily:"'Nunito',sans-serif" }}>{t('common.cancel')}</button>
              <button onClick={()=>{onSaveEmoji(selEmoji);onClose();}}
                style={{ flex:1.5,padding:'13px',borderRadius:14,border:'none',
                  background:`linear-gradient(135deg,${color},#4C1DCC)`,
                  color:'#fff',fontSize:13,fontWeight:800,cursor:'pointer',
                  fontFamily:"'Nunito',sans-serif" }}>{t('settings.save_emoji')}</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ─── Subjects sheet ──────────────────────────────────────────── */
function SubjectsSheet({ current, onClose, onSave, accentColor=BRAND }) {
  const { t } = useLang();
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
        background:'rgba(0,0,0,.55)',backdropFilter:'blur(4px)' }}/>
      <div style={{ position:'fixed',bottom:0,left:0,right:0,zIndex:3100,
        background:'var(--ak-surface)',borderRadius:'22px 22px 0 0',padding:'0 18px 40px',
        boxShadow:'0 -8px 40px rgba(0,0,0,.2)',animation:'sheet-up .3s ease',
        fontFamily:"'Nunito',sans-serif",maxHeight:'88vh',overflowY:'auto' }}>
        <div style={{ width:36,height:4,borderRadius:2,background:'var(--ak-border3)',margin:'14px auto 18px' }}/>
        <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16 }}>
          <p style={{ fontSize:16,fontWeight:900,color:'var(--ak-text)',margin:0 }}>{t('settings.manage_subjects')}</p>
          <span style={{ fontSize:12,color:'var(--ak-text-sub)',fontWeight:600 }}>{selected.length} {t('settings.selected')}</span>
        </div>
        {selected.length>0&&(
          <div style={{ marginBottom:20 }}>
            <p style={{ fontSize:11,fontWeight:900,color:accentColor,letterSpacing:1.2,
              textTransform:'uppercase',marginBottom:10 }}>{t('settings.your_subjects')}</p>
            <div style={{ display:'flex',flexWrap:'wrap',gap:8 }}>
              {selected.map(s=><SubjectChip key={s} label={s} color={accentColor} onRemove={removeSubject}/>)}
            </div>
          </div>
        )}
        <div style={{ marginBottom:14 }}>
          <p style={{ fontSize:11,fontWeight:900,color:'var(--ak-text-sub)',letterSpacing:1.2,
            textTransform:'uppercase',marginBottom:10 }}>{t('settings.add_subjects')}</p>
          <div style={{ position:'relative',marginBottom:10 }}>
            <Icon name="ti-search" size={14} style={{ position:'absolute',left:12,
              top:'50%',transform:'translateY(-50%)',color:'var(--ak-text-muted)' }}/>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder={t('settings.search_subjects')}
              style={{ width:'100%',padding:'10px 13px 10px 34px',borderRadius:12,
                border:'1.5px solid var(--ak-border2)',outline:'none',fontSize:13,
                fontFamily:"'Nunito',sans-serif",color:'var(--ak-text)',
                background:'var(--ak-surface)',boxSizing:'border-box' }}/>
          </div>
          <div style={{ display:'flex',flexWrap:'wrap',gap:7,maxHeight:160,overflowY:'auto' }}>
            {available.map(s=>(
              <div key={s} onClick={()=>addSubject(s)}
                style={{ display:'inline-flex',alignItems:'center',gap:5,padding:'6px 12px',
                  borderRadius:20,border:'1px solid var(--ak-border2)',background:'var(--ak-tag-bg)',
                  fontSize:12,fontWeight:700,color:'var(--ak-text-sec)',cursor:'pointer' }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=accentColor;e.currentTarget.style.color=accentColor;}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--ak-border2)';e.currentTarget.style.color='var(--ak-text-sec)';}}>
                <Icon name={subjIcon(s)} size={12} color="var(--ak-text-muted)"/>{s}
                <span style={{ color:'var(--ak-text-muted)' }}>+</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginBottom:20 }}>
          <p style={{ fontSize:11,fontWeight:900,color:'var(--ak-text-sub)',letterSpacing:1.2,
            textTransform:'uppercase',marginBottom:8 }}>{t('settings.custom_subject')}</p>
          <div style={{ display:'flex',gap:8 }}>
            <input value={custom} onChange={e=>setCustom(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&addCustom()}
              placeholder={t('settings.custom_subject_ph')}
              style={{ flex:1,padding:'11px 14px',borderRadius:12,border:'1.5px solid var(--ak-border2)',
                outline:'none',fontSize:13,fontFamily:"'Nunito',sans-serif",color:'var(--ak-text)',
                background:'var(--ak-surface)' }}/>
            <button onClick={addCustom}
              style={{ padding:'11px 16px',borderRadius:12,border:'none',
                background:custom.trim()?`linear-gradient(135deg,${accentColor},#4C1DCC)`:'var(--ak-tag-bg)',
                color:custom.trim()?'#fff':'var(--ak-text-muted)',fontSize:13,fontWeight:800,
                cursor:custom.trim()?'pointer':'default',fontFamily:"'Nunito',sans-serif",
                flexShrink:0 }}>{t('common.add')}</button>
          </div>
        </div>
        <div style={{ display:'flex',gap:10 }}>
          <button onClick={onClose} style={{ flex:1,padding:'13px',borderRadius:14,
            border:'1.5px solid var(--ak-border2)',background:'var(--ak-surface-hover)',
            fontSize:13,fontWeight:800,color:'var(--ak-text-sub)',cursor:'pointer',
            fontFamily:"'Nunito',sans-serif" }}>{t('common.cancel')}</button>
          <button onClick={()=>{onSave(selected);onClose();}}
            style={{ flex:1.5,padding:'13px',borderRadius:14,border:'none',
              background:`linear-gradient(135deg,${accentColor},#4C1DCC)`,
              color:'#fff',fontSize:13,fontWeight:800,cursor:'pointer',
              fontFamily:"'Nunito',sans-serif",
              boxShadow:`0 4px 14px ${accentColor}44` }}>{t('settings.save_subjects')}</button>
        </div>
      </div>
    </>
  );
}

/* ─── Generic field sheet ─────────────────────────────────────── */
function GenericSheet({ field,label,type,options,value,onClose,onSave }) {
  const { t } = useLang();
  const [val,setVal]=useState(value??'');
  const [pw, setPw] =useState({ current:'',next:'',confirm:'' });
  const [del,setDel]=useState('');
  const inp = { width:'100%',padding:'11px 14px',borderRadius:12,
    border:'1.5px solid var(--ak-border2)',outline:'none',fontSize:14,
    fontFamily:"'Nunito',sans-serif",color:'var(--ak-text)',
    background:'var(--ak-surface)',boxSizing:'border-box',marginTop:6 };
  const handle = () => {
    if(type==='change-password'){
      if(!pw.current){alert(t('settings.enter_current_pw'));return;}
      if(pw.next.length<8){alert(t('settings.pw_too_short'));return;}
      if(pw.next!==pw.confirm){alert(t('settings.pw_no_match'));return;}
    }
    if(type==='delete-confirm'&&del!=='DELETE') return;
    onSave(field, type==='change-password'?pw:val);
    onClose();
  };
  return (
    <>
      <div onClick={onClose} style={{ position:'fixed',inset:0,zIndex:3000,
        background:'rgba(0,0,0,.55)',backdropFilter:'blur(4px)' }}/>
      <div style={{ position:'fixed',bottom:0,left:0,right:0,zIndex:3100,
        background:'var(--ak-surface)',borderRadius:'22px 22px 0 0',padding:'0 18px 40px',
        boxShadow:'0 -8px 40px rgba(0,0,0,.2)',animation:'sheet-up .3s ease',
        fontFamily:"'Nunito',sans-serif",maxHeight:'85vh',overflowY:'auto' }}>
        <div style={{ width:36,height:4,borderRadius:2,background:'var(--ak-border3)',margin:'14px auto 18px' }}/>
        <p style={{ fontSize:16,fontWeight:900,color:'var(--ak-text)',margin:'0 0 16px' }}>{label}</p>

        {type==='text'&&<input autoFocus value={val} onChange={e=>setVal(e.target.value)}
          placeholder={t('settings.enter_field').replace('{field}', label.toLowerCase())} style={inp}/>}
        {type==='textarea'&&<textarea autoFocus value={val} onChange={e=>setVal(e.target.value)}
          placeholder={t('settings.enter_field').replace('{field}', label.toLowerCase())} rows={3}
          style={{ ...inp,resize:'vertical',lineHeight:1.6 }}/>}
        {type==='select'&&(
          <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
            {options.map(o=>(
              <div key={o} onClick={()=>setVal(o)}
                style={{ display:'flex',alignItems:'center',gap:10,padding:'11px 14px',
                  borderRadius:12,cursor:'pointer',
                  border:`1.5px solid ${val===o?BRAND:'var(--ak-border2)'}`,
                  background:val===o?`${BRAND}08`:'var(--ak-surface)' }}>
                <div style={{ width:18,height:18,borderRadius:'50%',flexShrink:0,
                  border:`2px solid ${val===o?BRAND:'var(--ak-border3)'}`,
                  background:val===o?BRAND:'var(--ak-surface)',
                  display:'flex',alignItems:'center',justifyContent:'center' }}>
                  {val===o&&<div style={{ width:6,height:6,borderRadius:'50%',background:'#fff' }}/>}
                </div>
                <span style={{ fontSize:13.5,fontWeight:700,color:val===o?BRAND:'var(--ak-text)' }}>{o}</span>
              </div>
            ))}
          </div>
        )}
        {type==='display-mode'&&(
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8 }}>
            {['light','dark','system'].map(m=>(
              <div key={m} onClick={()=>setVal(m)}
                style={{ padding:'14px 8px',borderRadius:12,textAlign:'center',cursor:'pointer',
                  border:`1.5px solid ${val===m?BRAND:'var(--ak-border2)'}`,
                  background:val===m?`${BRAND}08`:'var(--ak-select-bg)' }}>
                <div style={{ fontSize:22,marginBottom:5 }}>{m==='light'?'☀️':m==='dark'?'🌙':'⚙️'}</div>
                <p style={{ margin:0,fontSize:11.5,fontWeight:800,
                  color:val===m?BRAND:'var(--ak-text-sec)',textTransform:'capitalize' }}>{m}</p>
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
                  outline:val===c?'3px solid var(--ak-text)':'3px solid transparent',
                  outlineOffset:2,transition:'all .2s' }}/>
            ))}
          </div>
        )}
        {type==='change-password'&&(
          <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
            {[['current',t('settings.current_pw')],['next',t('settings.new_pw')],['confirm',t('settings.confirm_pw')]].map(([k,l])=>(
              <div key={k}>
                <label style={{ fontSize:12,fontWeight:800,color:'var(--ak-text-sec)' }}>{l}</label>
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
              ⚠️ {t('settings.deactivate_q')}</p>
            <p style={{ margin:0,fontSize:13,color:'#78350F',lineHeight:1.6 }}>
              {t('settings.deactivate_warn')}</p>
          </div>
        )}
        {type==='delete-confirm'&&(
          <>
            <div style={{ background:'#FEF2F2',border:'1px solid #FECACA',
              borderRadius:14,padding:'14px 16px',marginBottom:14 }}>
              <p style={{ margin:'0 0 8px',fontSize:14,fontWeight:800,color:'#7F1D1D' }}>
                🗑️ {t('settings.delete_q')}</p>
              <p style={{ margin:0,fontSize:13,color:'#991B1B',lineHeight:1.6 }}>
                {t('settings.delete_warn')}</p>
            </div>
            <label style={{ fontSize:12,fontWeight:800,color:'var(--ak-text-sec)' }}>{t('settings.type_delete')}</label>
            <input value={del} onChange={e=>setDel(e.target.value.toUpperCase())}
              placeholder="DELETE"
              style={{ ...inp,borderColor:del==='DELETE'?RED:'var(--ak-border2)',
                color:del==='DELETE'?RED:'var(--ak-text)',letterSpacing:1 }}/>
          </>
        )}
        <div style={{ display:'flex',gap:10,marginTop:20 }}>
          <button onClick={onClose} style={{ flex:1,padding:'13px',borderRadius:14,
            border:'1.5px solid var(--ak-border2)',background:'var(--ak-surface-hover)',
            fontSize:13,fontWeight:800,color:'var(--ak-text-sub)',cursor:'pointer',
            fontFamily:"'Nunito',sans-serif" }}>{t('common.cancel')}</button>
          <button onClick={handle}
            disabled={type==='delete-confirm'&&del!=='DELETE'}
            style={{ flex:1.5,padding:'13px',borderRadius:14,border:'none',
              background:type==='delete-confirm'?(del==='DELETE'?RED:'var(--ak-tag-bg)')
                :type==='deactivate'?ORANGE
                :`linear-gradient(135deg,${BRAND},#4C1DCC)`,
              color:(type==='delete-confirm'&&del!=='DELETE')?'var(--ak-text-muted)':'#fff',
              fontSize:13,fontWeight:800,
              cursor:(type==='delete-confirm'&&del!=='DELETE')?'not-allowed':'pointer',
              fontFamily:"'Nunito',sans-serif" }}>
            {type==='change-password'?t('settings.update_password')
              :type==='deactivate'?t('settings.deactivate')
              :type==='delete-confirm'?t('settings.delete_my_account'):t('settings.save_changes')}
          </button>
        </div>
      </div>
    </>
  );
}

/* ─── Logout modal ────────────────────────────────────────────── */
function LogoutModal({ onClose, onConfirm }) {
  const { t } = useLang();
  return (
    <>
      <div onClick={onClose} style={{ position:'fixed',inset:0,zIndex:3000,
        background:'rgba(0,0,0,.55)',backdropFilter:'blur(4px)' }}/>
      <div style={{ position:'fixed',bottom:0,left:0,right:0,zIndex:3100,
        background:'var(--ak-surface)',borderRadius:'22px 22px 0 0',
        padding:'28px 18px 40px',animation:'sheet-up .3s ease',
        fontFamily:"'Nunito',sans-serif",textAlign:'center' }}>
        <div style={{ width:36,height:4,borderRadius:2,background:'var(--ak-border3)',margin:'0 auto 22px' }}/>
        <div style={{ width:52,height:52,borderRadius:'50%',background:`${RED}12`,
          border:`1.5px solid ${RED}30`,display:'flex',alignItems:'center',
          justifyContent:'center',margin:'0 auto 14px' }}>
          <Icon name="ti-logout" size={22} color={RED}/>
        </div>
        <p style={{ fontSize:17,fontWeight:900,color:'var(--ak-text)',margin:'0 0 8px' }}>{t('settings.logout')}</p>
        <p style={{ fontSize:13,color:'var(--ak-text-sub)',margin:'0 0 24px',lineHeight:1.6 }}>
          {t('settings.logout_sub')}
        </p>
        <div style={{ display:'flex',gap:10 }}>
          <button onClick={onClose} style={{ flex:1,padding:'13px',borderRadius:14,
            border:'1.5px solid var(--ak-border2)',background:'var(--ak-surface-hover)',
            fontSize:13,fontWeight:800,color:'var(--ak-text-sub)',cursor:'pointer',
            fontFamily:"'Nunito',sans-serif" }}>{t('common.cancel')}</button>
          <button onClick={onConfirm}
            style={{ flex:1.5,padding:'13px',borderRadius:14,border:'none',
              background:`linear-gradient(135deg,${RED},#DC2626)`,color:'#fff',
              fontSize:13,fontWeight:800,cursor:'pointer',fontFamily:"'Nunito',sans-serif",
              boxShadow:`0 4px 14px ${RED}44` }}>{t('settings.log_out')}</button>
        </div>
      </div>
    </>
  );
}

/* ─── Two-Factor Auth sheet ───────────────────────────────────── */
function TwoFactorSheet({ mode, onClose, onDone }) {
  const { t } = useLang();
  const [step,     setStep]     = useState(mode === 'enable' ? 'setup' : 'confirm');
  const [qrUrl,    setQrUrl]    = useState(null);
  const [secret,   setSecret]   = useState('');
  const [code,     setCode]     = useState('');
  const [loading,  setLoading]  = useState(mode === 'enable');
  const [error,    setError]    = useState('');

  useEffect(() => {
    if (mode !== 'enable') return;
    setup2FA()
      .then(async ({ data }) => {
        if (!data?.otpauthUrl) throw new Error('Setup failed');
        setSecret(data.secret);
        const url = await QRCode.toDataURL(data.otpauthUrl, { width: 200, margin: 2 });
        setQrUrl(url);
        setStep('scan');
      })
      .catch(() => setError('Failed to start 2FA setup. Try again.'))
      .finally(() => setLoading(false));
  }, [mode]);

  const handleConfirm = async () => {
    if (!/^\d{6}$/.test(code)) { setError('Enter a 6-digit code'); return; }
    setLoading(true); setError('');
    try {
      const fn = mode === 'enable' ? enable2FA : disable2FA;
      const { success, message } = await fn(code);
      if (!success) { setError(message || 'Invalid code'); return; }
      onDone(mode === 'enable');
      onClose();
    } catch {
      setError('Network error. Try again.');
    } finally { setLoading(false); }
  };

  return (
    <>
      <div onClick={onClose} style={{ position:'fixed',inset:0,zIndex:3000,
        background:'rgba(0,0,0,.55)',backdropFilter:'blur(4px)' }}/>
      <div style={{ position:'fixed',bottom:0,left:0,right:0,zIndex:3100,
        background:'var(--ak-surface)',borderRadius:'22px 22px 0 0',
        padding:'0 18px 40px',boxShadow:'0 -8px 40px rgba(0,0,0,.2)',
        animation:'sheet-up .3s ease',fontFamily:"'Nunito',sans-serif",
        maxHeight:'90vh',overflowY:'auto' }}>
        <div style={{ width:36,height:4,borderRadius:2,background:'var(--ak-border3)',
          margin:'14px auto 18px' }}/>

        <p style={{ fontSize:16,fontWeight:900,color:'var(--ak-text)',margin:'0 0 4px' }}>
          {mode === 'enable' ? t('settings.twofa_setup_title') : t('settings.twofa_disable_title')}
        </p>
        <p style={{ fontSize:13,color:'var(--ak-text-sub)',margin:'0 0 20px',lineHeight:1.6 }}>
          {mode === 'enable'
            ? t('settings.twofa_setup_sub')
            : t('settings.twofa_disable_sub')}
        </p>

        {loading && (
          <div style={{ textAlign:'center',padding:'30px 0',color:'var(--ak-text-muted)',fontSize:13 }}>
            {t('settings.setting_up')}
          </div>
        )}

        {!loading && mode === 'enable' && step === 'scan' && (
          <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:16,marginBottom:20 }}>
            {qrUrl && (
              <div style={{ padding:12,background:'#fff',borderRadius:14,
                border:'1px solid var(--ak-border2)',display:'inline-block' }}>
                <img src={qrUrl} width={180} height={180} alt="2FA QR code"/>
              </div>
            )}
            <div style={{ background:'var(--ak-tag-bg)',borderRadius:10,padding:'10px 14px',
              display:'flex',alignItems:'center',gap:10,width:'100%' }}>
              <Icon name="ti-key" size={15} color="var(--ak-text-sub)"/>
              <div style={{ flex:1,minWidth:0 }}>
                <p style={{ fontSize:10,fontWeight:900,color:'var(--ak-text-muted)',
                  textTransform:'uppercase',letterSpacing:1,margin:'0 0 2px' }}>{t('settings.manual_key')}</p>
                <p style={{ fontSize:12,fontWeight:700,color:'var(--ak-text)',margin:0,
                  wordBreak:'break-all',fontFamily:'monospace' }}>{secret}</p>
              </div>
              <button onClick={()=>navigator.clipboard?.writeText(secret)}
                style={{ background:'none',border:'none',cursor:'pointer',
                  color:'var(--ak-text-sub)',fontSize:12,fontWeight:700,
                  fontFamily:"'Nunito',sans-serif",flexShrink:0 }}>{t('common.copy')}</button>
            </div>
          </div>
        )}

        {!loading && (
          <>
            <div style={{ position:'relative',marginBottom:error?10:20 }}>
              <input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))}
                placeholder="000000" maxLength={6} inputMode="numeric" autoFocus
                style={{ width:'100%',padding:'14px',borderRadius:12,textAlign:'center',
                  border:`1.5px solid ${error?'#EF4444':'var(--ak-border2)'}`,
                  outline:'none',fontSize:24,fontWeight:900,letterSpacing:8,
                  color:'var(--ak-text)',background:'var(--ak-surface)',
                  fontFamily:'monospace',boxSizing:'border-box' }}/>
            </div>
            {error && (
              <p style={{ fontSize:12.5,color:'#EF4444',fontWeight:700,
                margin:'0 0 14px',textAlign:'center' }}>{error}</p>
            )}
            <div style={{ display:'flex',gap:10 }}>
              <button onClick={onClose}
                style={{ flex:1,padding:'13px',borderRadius:14,
                  border:'1.5px solid var(--ak-border2)',background:'var(--ak-surface-hover)',
                  fontSize:13,fontWeight:800,color:'var(--ak-text-sub)',cursor:'pointer',
                  fontFamily:"'Nunito',sans-serif" }}>{t('common.cancel')}</button>
              <button onClick={handleConfirm} disabled={loading||code.length!==6}
                style={{ flex:1.5,padding:'13px',borderRadius:14,border:'none',
                  background:code.length===6
                    ? (mode==='enable'?`linear-gradient(135deg,${BRAND},#4C1DCC)`:`linear-gradient(135deg,#EF4444,#DC2626)`)
                    : 'var(--ak-tag-bg)',
                  color:code.length===6?'#fff':'var(--ak-text-muted)',
                  fontSize:13,fontWeight:800,cursor:code.length===6?'pointer':'not-allowed',
                  fontFamily:"'Nunito',sans-serif" }}>
                {loading ? '…' : mode==='enable' ? t('settings.activate_2fa') : t('settings.disable_2fa')}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}


export { AvatarPickerSheet, SubjectsSheet, GenericSheet, LogoutModal, TwoFactorSheet };
