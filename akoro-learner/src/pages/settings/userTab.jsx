/**
 * Settings — User tab (profile, notifications, security, preferences).
 */
import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../../hooks/useWallet.js';
import { pushSupported, getPushStatus, enablePush, disablePush } from '../../services/pushApi.js';
import { useLang, LS_LANGUAGE } from '../../contexts/LanguageContext.jsx';
import { LS_DISPLAY } from '../../contexts/ThemeContext.jsx';
import { changePassword, deactivateAccount, deleteAccount, setDefaultAgent, uploadAvatar } from '../../services/settingsApi.js';
import {
  BRAND, RED, ORANGE, ALL_SUBJECTS, SUBJ_ICON, rowBase,
  COUNTRIES, GUIDES, SCHOOL_TYPES, STUDY_LEVELS, YEARS, LANGUAGES,
  Icon, Toggle, ProgressBar, SubjectChip, Section, Row, AvatarCircle, SubjectsRow,
} from './shared.jsx';
import { AvatarPickerSheet, SubjectsSheet, GenericSheet, TwoFactorSheet } from './sheets.jsx';

/* ─── Notification section ────────────────────────────────────── */
/* ─── Notification section ────────────────────────────────────── */
function NotifSection({ notif, setNotif, onSaveNotif }) {
  const { t } = useLang();

  // Real Web Push (PWA) state — the "push" row drives an actual browser
  // subscription, not just a saved flag.
  const [pushState, setPushState] = useState({ supported: false, subscribed: false, permission: 'default' });
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState('');
  useEffect(() => { if (pushSupported()) getPushStatus().then(setPushState); }, []);

  const togglePush = async () => {
    if (pushBusy) return;
    setPushBusy(true); setPushError('');
    try {
      if (pushState.subscribed) { await disablePush(); }
      else { await enablePush(); }
      const s = await getPushStatus();
      setPushState(s);
      const updated = { ...notif, push: s.subscribed };
      setNotif(updated); onSaveNotif(updated);
    } catch (e) {
      // Inline, beside the control that failed — a blocking alert here forced
      // the user to dismiss a box just to see which switch didn't move.
      setPushError(e?.message || 'Could not update push notifications.');
    } finally { setPushBusy(false); }
  };

  const toggle = (key) => {
    if (key === 'push') return togglePush();
    const updated = { ...notif, [key]: !notif[key] };
    setNotif(updated);
    onSaveNotif(updated);
  };
  const NotifRow = ({ icon,label,sub,field }) => {
    const isPush = field === 'push';
    const on = isPush ? pushState.subscribed : notif[field];
    const pushSub = isPush && pushState.supported && pushState.permission === 'denied'
      ? 'Blocked in your browser settings' : sub;
    return (
    <div style={{ ...rowBase, opacity: isPush && !pushState.supported ? 0.5 : 1 }}>
      <span style={{ fontSize:17,width:28,flexShrink:0,display:'flex',alignItems:'center' }}>
        <Icon name={icon} size={17} color="var(--ak-text-sub)"/>
      </span>
      <div style={{ flex:1 }}>
        <p style={{ fontSize:13.5,fontWeight:700,margin:0,color:'var(--ak-text)' }}>{label}</p>
        {pushSub&&<p style={{ fontSize:11.5,color:'var(--ak-text-muted)',marginTop:2,margin:0 }}>{pushSub}</p>}
      </div>
      <Toggle on={on} onChange={()=>toggle(field)}
        disabled={isPush && (!pushState.supported || pushBusy || pushState.permission === 'denied')}/>
    </div>
    );
  };
  return (
    <>
      <Section title={t('settings.notif_channels')}>
        <NotifRow icon="ti-mail"   label={t('settings.notif_email')} sub={t('settings.notif_email_sub')}     field="email"/>
        <NotifRow icon="ti-phone"  label={t('settings.notif_sms')}   sub={t('settings.notif_sms_sub')}             field="sms"/>
        <NotifRow icon="ti-bell"   label={t('settings.notif_push')}  sub={t('settings.notif_push_sub')}        field="push"/>
        {pushError && (
          <div style={{ margin: '0 0 6px', padding: '9px 12px', background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 12, fontSize: 11.5, color: '#991B1B', fontWeight: 700, lineHeight: 1.45 }}>
            {pushError}
          </div>
        )}
        <NotifRow icon="ti-brand-whatsapp" label="WhatsApp"    sub={t('settings.notif_whatsapp_sub')}               field="whatsapp"/>
        {notif.whatsapp&&(
          <div style={{ ...rowBase }}>
            <span style={{ fontSize:17,width:28,flexShrink:0,display:'flex',alignItems:'center' }}>
              <Icon name="ti-device-mobile" size={17} color="var(--ak-text-sub)"/>
            </span>
            <div style={{ flex:1 }}>
              <p style={{ fontSize:13.5,fontWeight:700,margin:0,color:'var(--ak-text)' }}>{t('settings.whatsapp_number')}</p>
            </div>
            <input value={notif.whatsappNumber||''}
              onChange={e=>{
                const updated={...notif,whatsappNumber:e.target.value};
                setNotif(updated);
              }}
              onBlur={()=>onSaveNotif(notif)}
              placeholder="+234..."
              style={{ width:130,padding:'7px 10px',borderRadius:10,
                border:'1.5px solid var(--ak-border2)',outline:'none',fontSize:12.5,
                fontFamily:"'Nunito',sans-serif",color:'var(--ak-text)',
                background:'var(--ak-surface)',textAlign:'right' }}/>
          </div>
        )}
      </Section>
      <Section title={t('settings.notif_events')}>
        <NotifRow icon="ti-clock"          label={t('settings.notif_reminders')}  sub={t('settings.notif_reminders_sub')}  field="sessionReminders"/>
        <NotifRow icon="ti-player-play"    label={t('settings.notif_started')}    sub={t('settings.notif_started_sub')}    field="sessionStarted"/>
        <NotifRow icon="ti-player-stop"    label={t('settings.notif_cancelled')}  sub={t('settings.notif_cancelled_sub')}        field="sessionCancelled"/>
        <NotifRow icon="ti-speakerphone"   label={t('settings.notif_announcements')}      sub={t('settings.notif_announcements_sub')}     field="announcements"/>
        <NotifRow icon="ti-message-circle" label={t('settings.notif_qa')}        sub={t('settings.notif_qa_sub')}    field="qaReplies"/>
      </Section>
    </>
  );
}


/* ─── User tab ────────────────────────────────────────────────── */
function UserTab({ profile, setProfile, onSaveProfile, onSaveNotif, onSaveAgent, guides = [], guideMap = {}, onLogout, accentColor, onSetMode, onSetAccent, onSetLanguage }) {
  const { t } = useLang();
  const navigate = useNavigate();
  const { balance: coinBalance } = useWallet();
  const [sheet,        setSheet]        = useState(null);
  const [subjectSheet, setSubjectSheet] = useState(false);
  const [avatarSheet,  setAvatarSheet]  = useState(false);
  const [twoFaSheet,   setTwoFaSheet]   = useState(null); // 'enable' | 'disable' | null
  const [toast,        setToast]        = useState('');

  const color   = accentColor || profile.accentColor || BRAND;
  const xpPct   = profile.sessionsLimit
    ? Math.round((profile.sessionsUsed/profile.sessionsLimit)*100)
    : 0;

  const showToast = m => { setToast(m); setTimeout(()=>setToast(''),2200); };
  const openSheet = (f,l,t,o) => setSheet({field:f,label:l,type:t,options:o});

  const saveField = useCallback(async (field, val) => {
    if (field === 'deactivate') {
      try { await deactivateAccount(); showToast('Account deactivated'); setTimeout(() => onLogout?.(), 1000); }
      catch { showToast('Failed to deactivate'); }
      return;
    }
    if (field === 'deleteAccount') {
      try { await deleteAccount(); showToast('Account deleted'); setTimeout(() => onLogout?.(), 1000); }
      catch { showToast('Failed to delete account'); }
      return;
    }

    /* Delegate to ThemeContext / LanguageContext so all pages react */
    if (field === 'displayMode') { onSetMode(val); }
    if (field === 'accentColor') { onSetAccent(val); }
    if (field === 'language')    { onSetLanguage(val); }

    /* Teaching guide — set the default agent in the marketplace, then
       mirror the name+emoji onto the users row for display. */
    if (field === 'teachingGuide') {
      const opt = guideMap[val] || { name: val, emoji: profile.guideEmoji || '🧠', pairId: null };
      setProfile(p => ({ ...p, teachingGuide: opt.name, guideEmoji: opt.emoji }));
      if (opt.pairId && profile.id) {
        try { await setDefaultAgent({ userId: profile.id, agentPairId: opt.pairId }); }
        catch { /* ownership/network — fall through to mirror */ }
      }
      try {
        await onSaveProfile({ teachingGuide: opt.name, guideEmoji: opt.emoji });
        showToast('Saved');
      } catch { showToast('Saved locally'); }
      return;
    }

    /* Change password — separate API endpoint */
    if (field === 'password') {
      try {
        const res = await changePassword({ currentPassword: val.current, newPassword: val.next });
        if (!res.success) { showToast(res.message || 'Failed to change password'); return; }
        showToast('Password changed — please sign in again');
        setTimeout(() => onLogout?.(), 1800);
      } catch { showToast('Failed to change password'); }
      return;
    }

    const fieldMap = {
      fullName:'fullName', username:'username', phone:'phone',
      country:'country', school:'schoolName', schoolType:'schoolType',
      year:'yearGroup', teachingGuide:'teachingGuide',
      language:'language', displayMode:'displayMode',
      accentColor:'accentColor', twoFactor:'twoFactorEnabled',
    };
    const apiKey = fieldMap[field] || field;
    setProfile(p => ({ ...p, [field]: val }));
    try {
      await onSaveProfile({ [apiKey]: val });
      showToast('Saved');
    } catch {
      showToast('Saved locally');
    }

    /* Level, language and theme switches all re-derive the whole app (the
       school ↔ higher-ed tier reads studyLevel/schoolType; language and
       theme come from storage at boot), so a plain state update isn't
       enough — stage the branded boot splash and hard-reload so every
       screen re-renders from the new setting. Runs on the saved-locally
       path too: the queued write replays after the reload. */
    if (['studyLevel', 'schoolType', 'language', 'displayMode', 'accentColor'].includes(field)
        && val && val !== profile[field]) {
      try { localStorage.setItem('akoro_boot_splash', String(Date.now())); } catch { /* private mode */ }
      setTimeout(() => window.location.reload(), 650);   // let the toast breathe
    }
  }, [onSaveProfile, setProfile, onLogout, profile, onSetMode, onSetAccent, onSetLanguage, guideMap]);

  return (
    <div style={{ padding:'20px 0 0' }}>
      {/* Quick-link cards — one design (same as the original Order history
          card): tinted icon chip, title + sub, chevron. Order history,
          Activities and Library are live. */}
      {[
        { icon:'ti-receipt',  title:'settings.order_history', sub:'settings.order_history_sub', go:()=>navigate('/orders') },
        { icon:'ti-activity', title:'settings.activities',    sub:'settings.activities_sub',    go:()=>navigate('/activities') },
        { icon:'ti-books',    title:'settings.library',       sub:'settings.library_sub',       go:()=>navigate('/library') },
      ].map(card => (
        <button key={card.title} onClick={card.go}
          style={{ display:'flex',alignItems:'center',gap:12,width:'calc(100% - 32px)',
            margin:'0 16px 14px',borderRadius:16,padding:'14px 16px',cursor:'pointer',
            background:'var(--ak-surface)',border:'1px solid var(--ak-border)',
            boxShadow:'0 1px 6px rgba(0,0,0,.06)',fontFamily:"'Nunito',sans-serif",textAlign:'left' }}>
          <span style={{ width:38,height:38,borderRadius:11,flexShrink:0,background:`${color}18`,
            display:'flex',alignItems:'center',justifyContent:'center' }}>
            <Icon name={card.icon} size={19} color={color}/>
          </span>
          <span style={{ flex:1,minWidth:0 }}>
            <span style={{ display:'block',fontSize:14,fontWeight:800,color:'var(--ak-text)' }}>{t(card.title)}</span>
            <span style={{ display:'block',fontSize:12,color:'var(--ak-text-muted)' }}>{t(card.sub)}</span>
          </span>
          <Icon name="ti-chevron-right" size={18} color="var(--ak-text-muted)"/>
        </button>
      ))}

      {/* Profile hero */}
      <div style={{ display:'flex',alignItems:'center',gap:14,background:'var(--ak-surface)',
        margin:'0 16px 20px',borderRadius:18,padding:'18px 16px',
        border:'1px solid var(--ak-border)',boxShadow:'0 1px 6px rgba(0,0,0,.06)' }}>
        <AvatarCircle photoUrl={profile.avatarUrl} emoji={profile.avatarEmoji||'👨🏾‍🎓'}
          color={color} size={60} onPhotoClick={()=>setAvatarSheet(true)}/>
        <div style={{ flex:1 }}>
          <p style={{ margin:'0 0 2px',fontSize:15,fontWeight:900,
            color:'var(--ak-text)',fontFamily:"'Nunito',sans-serif" }}>{profile.fullName||'—'}</p>
          <p style={{ margin:'0 0 6px',fontSize:12.5,color:'var(--ak-text-sub)',
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

      <Section title={t('settings.profile')}>
        <Row icon="ti-user"  label={t('settings.full_name')}    value={profile.fullName}
          onClick={()=>openSheet('fullName',t('settings.full_name'),'text')}/>
        <Row icon="ti-at"    label={t('settings.username')}     value={`@${profile.username}`}
          onClick={()=>openSheet('username',t('settings.username'),'text')}/>
        <Row icon="ti-mail"  label={t('settings.email')}        value={profile.email}
          sub={profile.googleLinked?t('settings.linked_via_google'):undefined}/>
        <Row icon="ti-phone" label={t('settings.phone')} value={profile.phone||t('settings.not_set')}
          onClick={()=>openSheet('phone',t('settings.phone'),'text')}/>
        <Row icon="ti-map-pin" label={t('settings.country')}    value={profile.country||t('settings.not_set')}
          onClick={()=>openSheet('country',t('settings.country'),'select',COUNTRIES)}/>
      </Section>

      <Section title={t('settings.learn_study')}>
        <Row icon="ti-school" label={t('settings.study_level')} value={profile.studyLevel||t('settings.not_set')}
          onClick={()=>openSheet('studyLevel',t('settings.study_level'),'select',STUDY_LEVELS)}/>
        <Row icon="ti-chalkboard" label={t('settings.teaching_guide')}
          value={`${profile.guideEmoji||'🧠'} ${profile.teachingGuide||'NaNa Esumai'}`}
          onClick={()=>openSheet('teachingGuide',t('settings.teaching_guide'),'select',guides.length ? guides : GUIDES)}/>
        <Row icon="ti-building" label={t('settings.school_name')} value={profile.school||t('settings.not_set')}
          onClick={()=>openSheet('school',t('settings.school_name'),'text')}/>
        <Row icon="ti-school" label={t('settings.school_type')} value={profile.schoolType||t('settings.not_set')}
          onClick={()=>openSheet('schoolType',t('settings.school_type'),'select',SCHOOL_TYPES)}/>
        <Row icon="ti-calendar" label={t('settings.year_class')} value={profile.year||t('settings.not_set')}
          onClick={()=>openSheet('year',t('settings.year_class'),'select',YEARS)}/>
        <SubjectsRow subjects={profile.subjects||[]}
          onClick={()=>setSubjectSheet(true)} color={color}/>
      </Section>

      <Section title={t('settings.account')}>
        <Row icon="ti-calendar-event" label={t('settings.member_since')} value={profile.memberSince}/>
        <Row icon="ti-id" label={t('settings.account_id')} sub={t('settings.tap_to_copy')} value={profile.memberId} noArrow
          onClick={()=>{navigator.clipboard?.writeText(profile.memberId);showToast(t('settings.copied'));}}/>
        <Row icon="ti-link" label={t('settings.linked_accounts')}
          value={profile.googleLinked?'Google':t('settings.none')}
          sub={profile.googleLinked?t('settings.google_connected'):undefined}/>
      </Section>

      <Section title={t('settings.plan_usage')}>
        <Row icon="ti-coin" label="Credit Balance" value={`${(coinBalance||0).toLocaleString()} coins`}
          sub="Top up & view AI usage" onClick={()=>navigate('/wallet')}/>
        <Row icon="ti-star" label={t('settings.current_plan')} value={profile.plan||'Free'}/>
        <div style={rowBase}>
          <span style={{ fontSize:17,width:28,flexShrink:0,display:'flex',alignItems:'center' }}>
            <Icon name="ti-chart-bar" size={17} color="var(--ak-text-sub)"/>
          </span>
          <div style={{ flex:1 }}>
            <p style={{ fontSize:13.5,fontWeight:700,margin:0,color:'var(--ak-text)' }}>{t('settings.sessions_used')}</p>
            <div style={{ marginTop:6 }}><ProgressBar pct={xpPct} color={color}/></div>
          </div>
          <span style={{ fontSize:12.5,fontWeight:600,color:'var(--ak-text-sub)',marginLeft:10 }}>
            {profile.sessionsUsed||0}/{profile.sessionsLimit||30}</span>
        </div>
        <Row icon="ti-clock" label={t('settings.teaching_hours')} value={profile.teachingHours||'0h'}/>
        <Row icon="ti-bolt"  label={t('settings.xp_balance')}     value={`${(profile.xpBalance||0).toLocaleString()} XP`}/>
        <Row icon="ti-arrow-up" label={t('settings.upgrade_plan')} sub={t('settings.upgrade_sub')}
          onClick={()=>showToast(t('settings.upgrade_soon'))}>
          <span style={{ fontSize:12.5,fontWeight:800,color,marginRight:4 }}>Pro</span>
        </Row>
      </Section>

      <Section title={t('settings.personalization')}>
        <Row icon="ti-language" label={t('settings.language')}
          value={profile.language||localStorage.getItem(LS_LANGUAGE)||'English'}
          onClick={()=>openSheet('language',t('settings.language'),'select',LANGUAGES)}/>
        <Row icon="ti-moon" label={t('settings.display_mode')}
          value={(() => { const m = profile.displayMode||localStorage.getItem(LS_DISPLAY)||'system'; return m.charAt(0).toUpperCase()+m.slice(1); })()}
          onClick={()=>openSheet('displayMode',t('settings.display_mode'),'display-mode')}/>
        <Row icon="ti-palette" label={t('settings.theme_accent')}
          onClick={()=>openSheet('accentColor',t('settings.accent_colour'),'accent')}>
          <div style={{ width:18,height:18,borderRadius:'50%',background:color,marginRight:6,flexShrink:0 }}/>
        </Row>
      </Section>

      <NotifSection
        notif={profile.notif||{}}
        setNotif={n=>setProfile(p=>({...p,notif:n}))}
        onSaveNotif={onSaveNotif}/>

      <Section title={t('settings.help_support')}>
        <Row icon="ti-message-circle" label={t('settings.contact_support')}  onClick={()=>showToast(t('settings.opening_support'))}/>
        <Row icon="ti-help-circle"    label={t('settings.help_centre')}      onClick={()=>showToast(t('settings.opening_help'))}/>
        <Row icon="ti-bug"            label={t('settings.report_bug')}     onClick={()=>showToast(t('settings.opening_bug'))}/>
        <Row icon="ti-star"           label={t('settings.rate_app')}     onClick={()=>showToast(t('settings.thanks_rating'))}/>
      </Section>

      <Section title={t('settings.about_version')}>
        <Row icon="ti-info-circle" label={t('settings.app_version')} value="v1.0.0"/>
        <Row icon="ti-file-text"   label={t('settings.terms')}     onClick={()=>showToast(t('settings.opening_terms'))}/>
        <Row icon="ti-shield"      label={t('settings.privacy_policy')}       onClick={()=>showToast(t('settings.opening_privacy'))}/>
        <Row icon="ti-license"     label={t('settings.licences')} onClick={()=>showToast(t('settings.opening_licences'))}/>
      </Section>

      <Section title={t('settings.privacy')}>
        <Row icon="ti-key" label={t('settings.change_password')}
          onClick={()=>openSheet('password',t('settings.change_password'),'change-password')}/>
        <div style={{ ...rowBase,cursor:'pointer' }}
          onMouseEnter={e=>e.currentTarget.style.background='var(--ak-surface-hover)'}
          onMouseLeave={e=>e.currentTarget.style.background='var(--ak-surface)'}
          onClick={()=>setTwoFaSheet(profile.twoFactor ? 'disable' : 'enable')}>
          <span style={{ fontSize:17,width:28,flexShrink:0,display:'flex',alignItems:'center' }}>
            <Icon name="ti-lock" size={17} color="var(--ak-text-sub)"/>
          </span>
          <div style={{ flex:1 }}>
            <p style={{ fontSize:13.5,fontWeight:700,margin:0,color:'var(--ak-text)' }}>{t('settings.two_factor')}</p>
            <p style={{ fontSize:11.5,color:'var(--ak-text-muted)',marginTop:2,margin:0 }}>
              {profile.twoFactor ? t('settings.twofa_enabled') : t('settings.twofa_add')}
            </p>
          </div>
          <div style={{ display:'flex',alignItems:'center',gap:8 }}>
            {profile.twoFactor && (
              <span style={{ fontSize:11,fontWeight:800,padding:'3px 8px',borderRadius:6,
                background:'#D1FAE520',color:'#10B981',border:'1px solid #10B98130' }}>ON</span>
            )}
            <span style={{ color:'var(--ak-border3)',fontSize:16 }}>›</span>
          </div>
        </div>
        <Row icon="ti-player-pause" label={t('settings.deactivate')} danger
          sub={t('settings.deactivate_sub')}
          onClick={()=>openSheet('deactivate',t('settings.deactivate'),'deactivate')}/>
        <Row icon="ti-trash" label={t('settings.delete')} danger
          sub={t('settings.delete_sub')}
          onClick={()=>openSheet('deleteAccount',t('settings.delete'),'delete-confirm')}/>
      </Section>
      <div style={{ height:40 }}/>

      {avatarSheet&&(
        <AvatarPickerSheet type="user"
          current={{ emoji:profile.avatarEmoji, photoUrl:profile.avatarUrl }}
          color={color}
          onClose={()=>setAvatarSheet(false)}
          onSavePhoto={async dataUrl=>{
            setProfile(p=>({...p,avatarUrl:dataUrl}));
            showToast('Uploading…');
            try {
              const { data } = await uploadAvatar(dataUrl, 'user');
              if (data?.url) setProfile(p=>({...p,avatarUrl:data.url}));
              showToast('Photo updated');
            } catch { showToast('Upload failed — saved locally'); }
          }}
          onSaveEmoji={em=>{
            setProfile(p=>({...p,avatarEmoji:em,avatarUrl:null}));
            try { onSaveProfile({ avatarEmoji: em }); } catch { /* best-effort */ }
            showToast('Saved');
          }}/>
      )}
      {subjectSheet&&(
        <SubjectsSheet current={profile.subjects||[]} accentColor={color}
          onClose={()=>setSubjectSheet(false)}
          onSave={async s=>{
            setProfile(p=>({...p,subjects:s}));
            try { await onSaveProfile({ subjects:s }); showToast('Subjects saved'); }
            catch { showToast('Saved locally'); }
          }}/>
      )}
      {sheet&&(
        <GenericSheet {...sheet} value={profile[sheet.field]}
          onClose={()=>setSheet(null)}
          onSave={(f,v)=>{ saveField(f,v); setSheet(null); }}/>
      )}
      {twoFaSheet&&(
        <TwoFactorSheet mode={twoFaSheet}
          onClose={()=>setTwoFaSheet(null)}
          onDone={(enabled)=>{
            setProfile(p=>({...p,twoFactor:enabled}));
            showToast(enabled ? '2FA enabled' : '2FA disabled');
          }}/>
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


export { UserTab };
