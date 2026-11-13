/**
 * Settings — page shell (tab switch, data loading), composing UserTab/AgentTab.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { groupOf, isAgentGroup, tr } from './groups.js';
import { useAuth }        from '../../contexts/AuthContext.jsx';
import { useTheme, applyTheme, LS_DISPLAY, LS_ACCENT } from '../../contexts/ThemeContext.jsx';
import { useLang, LS_LANGUAGE, LANG_NAME_TO_CODE }     from '../../contexts/LanguageContext.jsx';
import {
  getMyProfile,
  patchMyProfile,
  patchNotifications,
  putAgent,
  getTeachingGuides,
  getMyAgents,
  setDefaultAgent,
  deactivateAccount,
  deleteAccount,
} from '../../services/settingsApi.js';
import {
  BRAND, RED, ORANGE, Icon,
} from './shared.jsx';
import { MoreHorizontal, Pencil, LogOut } from 'lucide-react';
import { LogoutModal } from './sheets.jsx';
import { DrawnAvatar } from '../../components/common/AgentAvatar.jsx';
import { UserTab } from './userTab.jsx';
import { AgentTab } from './agentTab.jsx';
import { AppShell } from '../../components/AppShell.jsx';
import { effectivePlan } from '../../utils/planOverride.js';
import { APP_HOME } from '../../config/target.js';

/* ─── Loading skeleton ────────────────────────────────────────── */
/* ─── Loading skeleton ────────────────────────────────────────── */
function LoadingSkeleton() {
  return (
    <div style={{ padding:'20px 16px' }}>
      {[80,60,120,100,90].map((w,i)=>(
        <div key={i} style={{ height:16,width:`${w}%`,background:'var(--ak-tag-bg)',
          borderRadius:8,marginBottom:16,animation:'pulse 1.5s ease-in-out infinite' }}/>
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}

/* ─── Main SettingsPage ───────────────────────────────────────── */
export default function SettingsPage() {
  const navigate                   = useNavigate();
  // /settings → the Account/Agent tabs; /settings/<group> → one group's own page.
  const groupKey                   = useParams()['*'] || '';
  const group                      = groupOf(groupKey);
  const { user, logout }           = useAuth();
  const { accentColor, setMode: onSetMode, setAccent: onSetAccent } = useTheme();
  const { language, setLanguage: onSetLanguage, t }                 = useLang();

  const [tab,         setTab]         = useState(isAgentGroup(group) ? 'agent' : 'user');
  const [profile,     setProfile]     = useState(null);
  const [agent,       setAgent]       = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [showLogout,  setShowLogout]  = useState(false);
  const [moreOpen,    setMoreOpen]    = useState(false);
  const [hint,        setHint]        = useState('');
  const moreRef       = useRef(null);
  const hintTimer     = useRef(null);
  const [guides,      setGuides]      = useState([]);   // display labels for the picker
  const [guideMap,    setGuideMap]    = useState({});   // label → { pairId, name, emoji }

  /* When API returns saved accent/lang, push into global contexts */
  useEffect(() => {
    if (profile?.accentColor) onSetAccent(profile.accentColor);
  }, [profile?.accentColor]);
  useEffect(() => {
    if (profile?.language) onSetLanguage(profile.language);
  }, [profile?.language]);

  /* ── Load the guide catalog from the marketplace (purchase-driven) ──
     Catalog = platform default (NaNa Esumai) + the student's purchased
     agents. Falls back to the static guide stub if the user id isn't
     available yet or the marketplace call fails. */
  useEffect(() => {
    if (!user?.id) return;
    getMyAgents(user.id)
      .then(d => {
        if (!d?.success) throw new Error('no marketplace data');
        const opts = [
          ...(d.platformAgents  || []).map(a => ({
            label: `${a.avatar || '🧠'} ${a.name}`, pairId: a.id, name: a.name, emoji: a.avatar || '🧠',
          })),
          ...(d.purchasedAgents || []).map(a => ({
            label: `${a.avatar || '🎓'} ${a.name}`, pairId: a.id, name: a.name, emoji: a.avatar || '🎓',
          })),
        ];
        if (!opts.length) throw new Error('empty catalog');
        setGuides(opts.map(o => o.label));
        const map = {};
        opts.forEach(o => { map[o.label] = o; });
        setGuideMap(map);
      })
      .catch(() => {
        // Fallback: static stub so the picker is never empty
        getTeachingGuides().then(d => {
          if (d.data?.guides) {
            const opts = d.data.guides.map(g => ({
              label: `${g.emoji} ${g.name}`, pairId: g.id, name: g.name, emoji: g.emoji,
            }));
            setGuides(opts.map(o => o.label));
            const map = {};
            opts.forEach(o => { map[o.label] = o; });
            setGuideMap(map);
          }
        }).catch(() => {});
      });
  }, [user?.id]);

  /* ── Load profile on mount ─────────────────────────────────── */
  useEffect(() => {
    getMyProfile()
      .then(({ data }) => {
        const displayMode = data.displayMode || localStorage.getItem(LS_DISPLAY) || 'system';
        const accent      = data.accentColor  || localStorage.getItem(LS_ACCENT)  || BRAND;
        const language    = data.language     || localStorage.getItem(LS_LANGUAGE) || 'English';

        /* Push API values into global contexts */
        onSetMode(displayMode);
        onSetAccent(accent);
        onSetLanguage(language);

        setProfile({
          id:            data.id,
          email:         data.email,
          username:      data.username,
          fullName:      data.fullName,
          avatarUrl:     data.avatarUrl,
          avatarEmoji:   data.avatarEmoji || '👨🏾‍🎓',
          phone:         data.phone,
          country:       data.country,
          city:          data.city || '',
          school:        data.schoolName,
          schoolType:    data.schoolType,
          year:          data.yearGroup,
          teachingGuide: data.teachingGuide || 'NaNa Esumai',
          guideEmoji:    data.guideEmoji    || '🧠',
          subjects:      data.subjects      || [],
          language,
          timeZone:      data.timeZone || null,
          displayMode,
          accentColor:   accent,
          twoFactor:     data.twoFactorEnabled || false,
          // OAuth sign-ups may have no password on file; default to true so an
          // older API (no hasPassword field) keeps the full 3-field sheet.
          hasPassword:   data.hasPassword !== false,
          googleLinked:  !!data.email,
          plan:          effectivePlan(data.plan),
          sessionsUsed:  0,
          sessionsLimit: 30,
          teachingHours: '0h',
          xpBalance:     data.agent?.xpEarned || 0,
          memberId:      data.id,
          memberSince:   data.memberSince,
          notif: {
            email:true,sms:false,push:true,whatsapp:false,whatsappNumber:'',
            sessionReminders:true,sessionStarted:true,sessionCancelled:true,
            announcements:true,qaReplies:true,reminderEmails:true,
            ...(data.notif || {}),
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
        if (user) {
          const displayMode = localStorage.getItem(LS_DISPLAY) || 'system';
          const accent      = localStorage.getItem(LS_ACCENT)  || BRAND;
          const language    = localStorage.getItem(LS_LANGUAGE) || 'English';
          setProfile({
            id:user.id,email:user.email,username:user.username,
            fullName:user.fullName,avatarUrl:user.avatarUrl,avatarEmoji:'👨🏾‍🎓',
            subjects:[],language,displayMode,accentColor:accent,
            twoFactor:false,hasPassword:true,googleLinked:false,plan:effectivePlan(),sessionsUsed:0,
            sessionsLimit:30,teachingHours:'0h',xpBalance:0,
            memberId:user.id,memberSince:'—',
            notif:{ email:true,sms:false,push:true,whatsapp:false,whatsappNumber:'',
              sessionReminders:true,sessionStarted:true,sessionCancelled:true,
              announcements:true,qaReplies:true,reminderEmails:true },
          });
          setAgent({ name:'My Agent',emoji:'🤖',photoUrl:null,color:ORANGE,bg:'#FEF0E6',
            personality:'',studyLevel:'',yearGroup:'',examBoard:'',subjects:[],goal:'',
            level:1,totalSessions:0,totalTurns:0,knowledgeScore:0,xpEarned:0 });
        }
      })
      .finally(() => setLoading(false));
  }, [user]);

  const handleSaveProfile     = useCallback(p => patchMyProfile(p), []);
  const handleSaveNotif       = useCallback(n => patchNotifications(n), []);
  const handleSaveAgent       = useCallback(a => putAgent(a), []);
  const handleLogoutConfirm   = useCallback(() => { setShowLogout(false); logout(); }, [logout]);

  // Surfaces the user a small toast at the bottom of the screen, which will automatically disappear after a moment.
  const showHint = useCallback((msg) => {
    setHint(msg);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(''), 1600);
  }, []);
  const showComingSoon = useCallback(() => { setMoreOpen(false); showHint('Coming soon'); }, [showHint]);

  // The more-menu closes on outside click or Escape, just like the reference account menu.
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e) => { if (!moreRef.current?.contains(e.target)) setMoreOpen(false); };
    const onKey  = (e) => { if (e.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [moreOpen]);

  const color = accentColor;
  if (groupKey && !group) return <Navigate to="/settings" replace/>;

  return (
    <AppShell>
    <div className="ak-settings-page" style={{ minHeight:'100%',background:'var(--ak-bg)',
      fontFamily:"'Nunito',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
        @keyframes sheet-up{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
        *{box-sizing:border-box}
        input,textarea,button,select{font-family:'Nunito',sans-serif}
        /* Mobile keeps the centred 480px column; on tablet/desktop (>=768px,
           the app's isMobile breakpoint) the page spans the full width of
           the shell's content area — like the Discover hub / Contents and
           the Pharm D pages. */
        .ak-settings-page{width:100%;max-width:480px;margin:0 auto}
        @media (min-width:768px){
          .ak-settings-page{max-width:none;margin:0}
        }
      `}</style>

      {/* Header */}
      <header style={{ position:'sticky',top:0,zIndex:100,
        background:'var(--ak-surface)',borderBottom:'1px solid var(--ak-border)',
        boxShadow:'0 1px 6px rgba(0,0,0,.06)',
        height:54,display:'flex',alignItems:'center',
        padding:'0 16px',gap:12 }}>
        <button onClick={()=>navigate(group ? '/settings' : APP_HOME)} aria-label={group ? 'Back to settings' : 'Back'}
          style={{ background:'none',border:'none',cursor:'pointer',
            padding:4,display:'flex',alignItems:'center',flexShrink:0 }}>
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none"
            stroke="var(--ak-text)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        {group ? (
          <div style={{ flex:1,minWidth:0 }}>
            <h1 data-testid="settings-group-title" style={{ fontSize:16,fontWeight:900,color:'var(--ak-text)',margin:0,lineHeight:1.2,
              overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
              {tr(t, group.titleKey, group.title)}
            </h1>
          </div>
        ) : (<>
        <div style={{ width:34,height:34,borderRadius:'50%',overflow:'hidden',
          border:`2px solid ${color}`,flexShrink:0,
          display:'flex',alignItems:'center',justifyContent:'center',
          background:`${color}18`,fontSize:16 }}>
          {(profile?.avatarUrl || user?.avatarUrl)
            ? <img src={profile?.avatarUrl || user?.avatarUrl} style={{ width:'100%',height:'100%',objectFit:'cover' }}/>
            : <DrawnAvatar emoji={profile?.avatarEmoji} size={24}/>
          }
        </div>
        <div style={{ flex:1,minWidth:0 }}>
          <p style={{ fontSize:14,fontWeight:800,color:'var(--ak-text)',margin:0,lineHeight:1.2,
            overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
            {profile?.fullName || user?.fullName || '…'}
          </p>
          <p style={{ fontSize:11,color:'var(--ak-text-muted)',margin:0 }}>@{profile?.username || user?.username || '…'}</p>
        </div>
        </>)}
        <div ref={moreRef} style={{ display:'flex',alignItems:'center',gap:7,flexShrink:0,position:'relative' }}>
          <button onClick={()=>setMoreOpen(o=>!o)} title="More" aria-label="More options"
            aria-haspopup="menu" aria-expanded={moreOpen}
            style={{ width:34,height:34,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',
              background:'var(--ak-tag-bg)',border:'1px solid var(--ak-border2)',cursor:'pointer',padding:0 }}>
            <MoreHorizontal size={15} color="var(--ak-text-sub)"/>
          </button>
          {moreOpen&&(
            <div role="menu" aria-label="More options" style={{ position:'absolute',top:'calc(100% + 6px)',right:0,zIndex:30,
              minWidth:190,padding:'8px 0',background:'var(--ak-surface)',border:'1px solid var(--ak-border2)',
              borderRadius:16,boxShadow:'0 16px 40px rgba(17,24,39,.14), 0 2px 8px rgba(17,24,39,.06)' }}>
              <button role="menuitem" onClick={showComingSoon}
                style={{ display:'flex',alignItems:'center',gap:12,width:'100%',padding:'12px 16px',border:'none',
                  background:'none',color:'var(--ak-text-sec)',fontFamily:"'Nunito',sans-serif",
                  fontSize:13.5,fontWeight:700,textAlign:'left',cursor:'pointer' }}>
                <Pencil size={16} color="var(--ak-text-sec)"/> Edit Profile
              </button>
              <button role="menuitem" onClick={()=>{ setMoreOpen(false); setShowLogout(true); }}
                style={{ display:'flex',alignItems:'center',gap:12,width:'100%',padding:'12px 16px',border:'none',
                  background:'none',color:'var(--ak-danger-text, #B91C1C)',fontFamily:"'Nunito',sans-serif",
                  fontSize:13.5,fontWeight:700,textAlign:'left',cursor:'pointer' }}>
                <LogOut size={16} color="var(--ak-danger-text, #B91C1C)"/> Logout
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Tabs — only on the settings home; a group page is just its own options */}
      {!group && <div style={{ display:'flex',background:'var(--ak-surface)',borderBottom:'1px solid var(--ak-border)',padding:'0 16px' }}>
        {['user','agent'].map(tabKey=>(
          <button key={tabKey} onClick={()=>setTab(tabKey)}
            style={{ flex:1,padding:'11px 0',background:'none',border:'none',
              cursor:'pointer',fontSize:13,fontWeight:tab===tabKey?900:600,
              color:tab===tabKey?BRAND:'var(--ak-text-muted)',
              borderBottom:`2.5px solid ${tab===tabKey?BRAND:'transparent'}`,
              transition:'all .2s',fontFamily:"'Nunito',sans-serif",
              display:'flex',alignItems:'center',justifyContent:'center',gap:6 }}>
            {tabKey==='user'
              ? <><Icon name="ti-user" size={14}/> {t('settings.tab_account')}</>
              : <><span>{agent?.photoUrl
                  ? <img src={agent.photoUrl} style={{ width:16,height:16,borderRadius:'50%',objectFit:'cover' }}/>
                  : agent?.emoji||'🤖'
                }</span> {agent?.name||t('settings.tab_agent')}</>
            }
          </button>
        ))}
      </div>}

      {loading ? <LoadingSkeleton /> : (
        (group ? !isAgentGroup(group) : tab==='user')
          ? <UserTab
              profile={profile} setProfile={setProfile}
              onSaveProfile={handleSaveProfile}
              onSaveNotif={handleSaveNotif}
              onSaveAgent={handleSaveAgent}
              guides={guides}
              guideMap={guideMap}
              accentColor={accentColor}
              onLogout={handleLogoutConfirm}
              onSetMode={onSetMode}
              onSetAccent={onSetAccent}
              onSetLanguage={onSetLanguage}
              group={group?.key || null}/>
          : <AgentTab
              agent={agent} setAgent={setAgent}
              onSaveAgent={handleSaveAgent}
              group={isAgentGroup(group) ? group.key : null}/>
      )}

      {showLogout&&(
        <LogoutModal onClose={()=>setShowLogout(false)} onConfirm={handleLogoutConfirm}/>
      )}
      {hint&&(
        <div role="status" style={{ position:'fixed',left:'50%',bottom:24,transform:'translateX(-50%)',zIndex:60,
          padding:'10px 16px',borderRadius:999,background:'var(--ak-text)',color:'var(--ak-surface)',
          fontWeight:800,fontSize:13,fontFamily:"'Nunito',sans-serif",boxShadow:'0 8px 22px rgba(17,24,39,.28)' }}>
          {hint}
        </div>
      )}
    </div>
    </AppShell>
  );
}
