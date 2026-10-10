import React, { useState, useEffect } from 'react';
import { BRAND, RED, GREEN, GOLD, SUBJECT_COLORS, SUBJECTS, AVATAR_FALLBACK } from '../../constants.js';
import { apiGet } from '../../services/api.js';
import { TrophyIcon, FlameIcon, StarIcon, ZapIcon, Icon } from '../common/Icons.jsx';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { fetchWeeklyLeague, fetchDailyStatus, fetchDailyRanking } from '../../services/agentNetworkApi.js';

const LEAGUE_SCOPES = [['classmates', 'Classmates'], ['school', 'School'], ['everyone', 'Everyone']];

function RankingsTab() {
  const { t } = useLang();
  const [boardType, setBoardType] = useState("classroom");
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  // Subjects board: every subject board for the class arrives in ONE response,
  // so switching subject is a re-map, not another round trip.
  const [subjects, setSubjects] = useState([]);
  const [activeSubject, setActiveSubject] = useState(null);
  // Weekly league (XP since Monday) and today's daily battle ranking.
  const [leagueScope, setLeagueScope] = useState("classmates");
  const [leagueMe, setLeagueMe] = useState(null);
  const [daily, setDaily] = useState(null);
  const BOARD_TABS=[{key:"classroom",label:t('rankings.classroom'),icon:"ti-school"},{key:"courses",label:t('rankings.courses'),icon:"ti-book"},{key:"subjects",label:t('rankings.subjects'),icon:"ti-books"},{key:"interSchool",label:t('rankings.inter_schools'),icon:"ti-world"},{key:"weekly",label:"Weekly",icon:"ti-calendar-week"},{key:"daily",label:"Daily",icon:"ti-calendar-repeat"}];

  const mapRow = (r) => ({
    rank:     r.rank,
    name:     r.name || r.full_name || r.username || 'Unknown',
    avatar:   r.avatar || r.avatar_url || null,
    xp:       r.total_xp || 0,
    isMe:     r.is_me || false,
    subject:  r.subject,
    students: r.students,
  });

  // Each board ranks a different entity: classroom=students, courses=courses,
  // subjects=students within one subject, inter-school=schools. Ranking
  // endpoints wrap their payload in `data`.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setData([]);
    setSubjects([]);
    setActiveSubject(null);
    setLeagueMe(null);
    setDaily(null);
    if (boardType === 'weekly') {
      fetchWeeklyLeague(leagueScope)
        .then(res => {
          if (!alive) return;
          setData((res?.top || []).map(r => mapRow({ rank: r.rank, name: r.name, avatar: r.avatar, total_xp: r.xp, is_me: r.you })));
          setLeagueMe(res?.me || null);
        })
        .catch(() => { if (alive) setData([]); })
        .finally(() => { if (alive) setLoading(false); });
      return () => { alive = false; };
    }
    if (boardType === 'daily') {
      fetchDailyStatus()
        .then(st => fetchDailyRanking(st.subject).then(r => ({ ...r, status: st.status, next: st.next, startsAt: st.startsAt })))
        .then(r => { if (alive) setDaily(r); })
        .catch(() => { if (alive) setDaily({ top: [], players: 0 }); })
        .finally(() => { if (alive) setLoading(false); });
      return () => { alive = false; };
    }
    const endpoint = boardType === 'classroom' ? '/api/ranking/my-classroom'
      : boardType === 'courses'                ? '/api/ranking/courses'
      : boardType === 'subjects'               ? '/api/ranking/my-class-subjects'
      :                                          '/api/ranking/schools';
    apiGet(endpoint)
      .then(res => {
        if (!alive) return;
        if (boardType === 'subjects') {
          const list = res.data?.subjects || res.subjects || [];
          setSubjects(list);
          // Open on a subject the student actually appears in — that's the one
          // they came to look at.
          const mine = list.find(s => (s.leaders || []).some(l => l.is_me));
          const pick = mine || list[0] || null;
          setActiveSubject(pick?.subject || null);
          setData((pick?.leaders || []).map(mapRow));
          return;
        }
        const leaders = res.data?.leaders || res.leaders || [];
        setData(leaders.map(mapRow));
      })
      .catch(() => { if (alive) { setData([]); setSubjects([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [boardType, leagueScope]);

  const pickSubject = (subject) => {
    setActiveSubject(subject);
    const s = subjects.find(x => x.subject === subject);
    setData((s?.leaders || []).map(mapRow));
  };

  // Pinned footer: the student may sit far below the visible rows.
  const me = data.find(r => r.isMe);

  const changeColor=c=>c&&c.startsWith("+")?GREEN:c&&c.startsWith("-")?RED:"var(--ak-text-muted)";
  return (
    <div style={{ flex:1,overflowY:"auto",background:"var(--ak-surface)",display:"flex",flexDirection:"column" }}>
      <div style={{ display:"flex",padding:"12px 16px 0",gap:8,borderBottom:"1px solid var(--ak-border)",overflowX:"auto",scrollbarWidth:"none" }}>
        {BOARD_TABS.map(({key,label,icon})=>(
          <button key={key} onClick={()=>setBoardType(key)} style={{ flex:"1 0 auto",minWidth:58,padding:"8px 4px 10px",whiteSpace:"nowrap",background:"none",border:"none",cursor:"pointer",fontSize:11.5,fontWeight:boardType===key?800:600,color:boardType===key?BRAND:"var(--ak-text-muted)",borderBottom:`2.5px solid ${boardType===key?BRAND:"transparent"}`,transition:"all .2s",fontFamily:"'Nunito',sans-serif",display:"flex",flexDirection:"column",alignItems:"center",gap:2 }}>
            <Icon name={icon} size={16} color={boardType===key?BRAND:"var(--ak-text-muted)"}/>{label}
          </button>
        ))}
      </div>
      {boardType==='weekly'&&(
        <div style={{ padding:"10px 16px",borderBottom:"1px solid var(--ak-border)" }}>
          <div style={{ display:"flex",gap:7 }}>
            {LEAGUE_SCOPES.map(([k,l])=>(
              <button key={k} onClick={()=>setLeagueScope(k)} aria-pressed={leagueScope===k} style={{ padding:"6px 12px",borderRadius:999,border:`1.5px solid ${leagueScope===k?BRAND:"var(--ak-border2)"}`,background:leagueScope===k?`${BRAND}15`:"transparent",color:leagueScope===k?BRAND:"var(--ak-text-sub)",fontSize:11.5,fontWeight:leagueScope===k?800:600,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>{l}</button>
            ))}
          </div>
          <p style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-muted)",margin:"8px 0 0" }}>XP earned since Monday · resets every week{leagueMe?.rank?` · you're #${leagueMe.rank} with ${leagueMe.xp} XP`:''}</p>
        </div>
      )}
      {boardType==='daily'&&<DailyBoard daily={daily} loading={loading}/>}
      {boardType==='subjects'&&subjects.length>0&&(
        <div style={{ display:"flex",gap:7,padding:"10px 16px",overflowX:"auto",borderBottom:"1px solid var(--ak-border)",scrollbarWidth:"none" }}>
          {subjects.map(s=>{
            const on=s.subject===activeSubject,c=SUBJECT_COLORS[s.subject]||BRAND;
            return (
              <button key={s.subject} onClick={()=>pickSubject(s.subject)} style={{ flexShrink:0,padding:"6px 12px",borderRadius:999,border:`1.5px solid ${on?c:"var(--ak-border2)"}`,background:on?`${c}15`:"transparent",color:on?c:"var(--ak-text-sub)",fontSize:11.5,fontWeight:on?800:600,cursor:"pointer",fontFamily:"'Nunito',sans-serif",whiteSpace:"nowrap" }}>
                <Icon name={SUBJECTS[s.subject]?.icon||"ti-book"} size={12} color={c}/>{SUBJECTS[s.subject]?.label||s.subject}
              </button>
            );
          })}
        </div>
      )}
      {boardType==='subjects'&&!loading&&subjects.length===0&&(
        <div style={{ padding:"48px 24px",textAlign:"center",color:"var(--ak-text-muted)",fontSize:13,fontWeight:600 }}>{t('rankings.no_subject_xp')}</div>
      )}
      {loading && data.length===0 && boardType!=='daily' && (
        <div style={{ padding:"48px 24px",textAlign:"center",color:"var(--ak-text-muted)",fontSize:13,fontWeight:600 }}>Loading rankings…</div>
      )}
      {!loading && data.length===0 && boardType!=='daily' && !(boardType==='subjects'&&subjects.length===0) && (
        <div style={{ padding:"48px 24px",display:"flex",flexDirection:"column",alignItems:"center",gap:10 }}>
          <Icon name="ti-trophy" size={52} color="var(--ak-text-muted)" style={{opacity:.2}}/>
          <p style={{ fontSize:15,fontWeight:800,color:"var(--ak-text-sub)" }}>{t('rankings.empty')}</p>
          <p style={{ fontSize:12,color:"var(--ak-text-muted)",textAlign:"center",maxWidth:280 }}>{t('rankings.empty_hint')}</p>
        </div>
      )}
      {data.length>0 && (<>
      <div style={{ padding:"18px 16px 12px",background:`linear-gradient(160deg,${BRAND}12,${BRAND}04)`,borderBottom:"1px solid var(--ak-border)" }}>
        <p style={{ fontSize:10,fontWeight:800,color:BRAND,letterSpacing:.5,margin:"0 0 12px",textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><Icon name="ti-trophy" size={13} color={BRAND}/>TOP LEADERBOARD</p>
        <div style={{ display:"flex",alignItems:"flex-end",justifyContent:"center",gap:10 }}>
          {data[1]&&<div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:5 }}><img src={data[1].avatar || AVATAR_FALLBACK} alt="" style={{ width:46,height:46,borderRadius:"50%",objectFit:"cover",border:"2.5px solid #C0C0C0" }}/><span style={{ fontSize:9.5,fontWeight:800,color:"var(--ak-text-sec)",textAlign:"center",maxWidth:68,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{data[1].name}</span><div style={{ width:58,background:"#C0C0C0",borderRadius:"6px 6px 0 0",padding:"8px 0 6px",textAlign:"center" }}><Icon name="ti-medal" size={16} color="#C0C0C0"/><p style={{ fontSize:10,fontWeight:800,color:"#fff",margin:0 }}>{(data[1].xp||0).toLocaleString()}</p><p style={{ fontSize:9,fontWeight:600,color:"rgba(255,255,255,.8)",margin:0 }}>XP</p></div></div>}
          {data[0]&&<div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:5,marginBottom:-4 }}><div style={{ position:"relative" }}><img src={data[0].avatar || AVATAR_FALLBACK} alt="" style={{ width:58,height:58,borderRadius:"50%",objectFit:"cover",border:`3px solid ${GOLD}` }}/><div style={{ position:"absolute",top:-10,left:"50%",transform:"translateX(-50%)",fontSize:18 }}><Icon name="ti-crown" size={18} color={GOLD}/></div></div><span style={{ fontSize:10,fontWeight:900,color:"var(--ak-text)",textAlign:"center",maxWidth:80,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{data[0].name}</span><div style={{ width:68,background:`linear-gradient(135deg,${GOLD},#D97706)`,borderRadius:"6px 6px 0 0",padding:"10px 0 6px",textAlign:"center" }}><Icon name="ti-medal" size={18} color={GOLD}/><p style={{ fontSize:11,fontWeight:900,color:"#fff",margin:0 }}>{(data[0].xp||0).toLocaleString()}</p><p style={{ fontSize:9,fontWeight:600,color:"rgba(255,255,255,.85)",margin:0 }}>XP</p></div></div>}
          {data[2]&&<div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:5 }}><img src={data[2].avatar || AVATAR_FALLBACK} alt="" style={{ width:40,height:40,borderRadius:"50%",objectFit:"cover",border:"2.5px solid #CD7F32" }}/><span style={{ fontSize:9.5,fontWeight:800,color:"var(--ak-text-sec)",textAlign:"center",maxWidth:60,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{data[2].name}</span><div style={{ width:52,background:"#CD7F32",borderRadius:"6px 6px 0 0",padding:"6px 0 6px",textAlign:"center" }}><Icon name="ti-medal" size={14} color="#CD7F32"/><p style={{ fontSize:9.5,fontWeight:800,color:"#fff",margin:0 }}>{(data[2].xp||0).toLocaleString()}</p><p style={{ fontSize:9,fontWeight:600,color:"rgba(255,255,255,.8)",margin:0 }}>XP</p></div></div>}
        </div>
      </div>
      <div style={{ flex:1 }}>
        {data.slice(3).map(entry=>{
          const isMe=entry.isMe,subjectColor=entry.subject?SUBJECT_COLORS[entry.subject]:null;
          return (
            <div key={entry.rank} style={{ display:"flex",alignItems:"center",gap:12,padding:"11px 18px",borderBottom:"1px solid var(--ak-border)",background:isMe?`${BRAND}06`:"var(--ak-surface)" }}>
              <div style={{ width:28,height:28,borderRadius:8,background:isMe?`${BRAND}15`:"var(--ak-border)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}><span style={{ fontSize:12,fontWeight:900,color:isMe?BRAND:"var(--ak-text-sub)" }}>{entry.rank}</span></div>
              <img src={entry.avatar || AVATAR_FALLBACK} alt="" style={{ width:40,height:40,borderRadius:"50%",objectFit:"cover",border:`2px solid ${isMe?BRAND:"var(--ak-border2)"}`,flexShrink:0 }}/>
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ display:"flex",alignItems:"center",gap:5 }}><span style={{ fontSize:13.5,fontWeight:800,color:isMe?BRAND:"var(--ak-text)" }}>{entry.name}</span>{isMe&&<span style={{ fontSize:9,fontWeight:800,color:BRAND,background:`${BRAND}15`,borderRadius:4,padding:"1px 5px" }}>{t('rankings.you')}</span>}</div>
                <div style={{ display:"flex",alignItems:"center",gap:6,marginTop:2 }}>
                  {entry.streak!==undefined&&<span style={{ fontSize:10,fontWeight:700,color:"var(--ak-text-muted)",display:"inline-flex",alignItems:"center",gap:3 }}><Icon name="ti-flame" size={11} color="#F97316"/>{entry.streak}{t('rankings.day_streak')}</span>}
                  {entry.subject&&<span style={{ fontSize:10,fontWeight:700,color:subjectColor||"var(--ak-text-muted)",background:`${subjectColor}15`,borderRadius:4,padding:"1px 6px",display:"inline-flex",alignItems:"center",gap:3 }}><Icon name={SUBJECTS[entry.subject]?.icon||"ti-book"} size={11} color={subjectColor||"var(--ak-text-muted)"}/>{SUBJECTS[entry.subject]?.label}</span>}
                  {entry.completions!==undefined&&<span style={{ fontSize:10,fontWeight:600,color:"var(--ak-text-muted)" }}>{entry.completions} {t('rankings.completions')}</span>}
                  {entry.students!==undefined&&<span style={{ fontSize:10,fontWeight:600,color:"var(--ak-text-muted)",display:"inline-flex",alignItems:"center",gap:3 }}><Icon name="ti-users" size={11} color="var(--ak-text-muted)"/>{entry.students} {t('rankings.students')}</span>}
                </div>
              </div>
              <div style={{ textAlign:"right",flexShrink:0 }}>
                <div style={{ display:"flex",alignItems:"center",gap:4,justifyContent:"flex-end" }}><ZapIcon size={11} color={GOLD}/><span style={{ fontSize:13,fontWeight:900,color:"var(--ak-text)" }}>{(entry.xp||0).toLocaleString()}</span></div>
                <span style={{ fontSize:10,fontWeight:800,color:changeColor(entry.change) }}>{entry.change}</span>
              </div>
            </div>
          );
        })}
      </div>
      </>)}
      {me && (
        <div style={{ position:"sticky",bottom:0,display:"flex",alignItems:"center",gap:12,padding:"11px 18px",borderTop:`2px solid ${BRAND}30`,background:"var(--ak-surface)",boxShadow:"0 -4px 12px rgba(0,0,0,.06)" }}>
          <div style={{ width:28,height:28,borderRadius:8,background:`${BRAND}15`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
            <span style={{ fontSize:12,fontWeight:900,color:BRAND }}>{me.rank}</span>
          </div>
          <img src={me.avatar || AVATAR_FALLBACK} alt="" style={{ width:34,height:34,borderRadius:"50%",objectFit:"cover",border:`2px solid ${BRAND}`,flexShrink:0 }}/>
          <div style={{ flex:1,minWidth:0 }}>
            <span style={{ fontSize:12.5,fontWeight:900,color:BRAND }}>{t('rankings.your_rank')}</span>
            <div style={{ fontSize:10.5,fontWeight:700,color:"var(--ak-text-muted)" }}>{me.name}</div>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:4,flexShrink:0 }}>
            <ZapIcon size={11} color={GOLD}/>
            <span style={{ fontSize:13,fontWeight:900,color:"var(--ak-text)" }}>{(me.xp||0).toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* Today's daily battle: ranked by correct answers, then time. */
function DailyBoard({ daily, loading }) {
  if (loading || !daily) return <div style={{ padding:"48px 24px",textAlign:"center",color:"var(--ak-text-muted)",fontSize:13,fontWeight:600 }}>Loading rankings…</div>;
  const at = (iso) => iso ? new Date(iso).toLocaleTimeString('en-GB', { hour:'numeric', minute:'2-digit' }) : '';
  const head = daily.status === 'scheduled' ? `Today's battle starts at ${at(daily.startsAt)}`
    : daily.status === 'active' ? `Live now · ${daily.players} played so far`
    : `${daily.players} played today`;
  return (
    <div style={{ flex:1 }}>
      <div style={{ padding:"14px 18px",background:`linear-gradient(160deg,${BRAND}12,${BRAND}04)`,borderBottom:"1px solid var(--ak-border)" }}>
        <p style={{ fontSize:13.5,fontWeight:900,color:"var(--ak-text)",margin:0,display:"flex",alignItems:"center",gap:6 }}><Icon name="ti-calendar-repeat" size={15} color={BRAND}/>Daily battle{daily.subject?` · ${daily.subject}`:''}</p>
        <p style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-muted)",margin:"4px 0 0" }}>{head}{daily.me?` · you're #${daily.me.rank} of ${daily.me.of}`:''}</p>
      </div>
      {(daily.top || []).length===0 ? (
        <div style={{ padding:"48px 24px",display:"flex",flexDirection:"column",alignItems:"center",gap:10 }}>
          <Icon name="ti-trophy" size={52} color="var(--ak-text-muted)" style={{opacity:.2}}/>
          <p style={{ fontSize:13,fontWeight:700,color:"var(--ak-text-muted)",textAlign:"center",maxWidth:280,margin:0 }}>No one has played today's battle yet.</p>
        </div>
      ) : daily.top.map(r => (
        <div key={r.rank} style={{ display:"flex",alignItems:"center",gap:12,padding:"11px 18px",borderBottom:"1px solid var(--ak-border)",background:r.you?`${BRAND}06`:"var(--ak-surface)" }}>
          <div style={{ width:28,height:28,borderRadius:8,background:r.rank<=3?`${GOLD}22`:r.you?`${BRAND}15`:"var(--ak-border)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}><span style={{ fontSize:12,fontWeight:900,color:r.rank<=3?"#B45309":r.you?BRAND:"var(--ak-text-sub)" }}>{r.rank}</span></div>
          <img src={r.avatar || AVATAR_FALLBACK} alt="" style={{ width:36,height:36,borderRadius:"50%",objectFit:"cover",border:`2px solid ${r.you?BRAND:"var(--ak-border2)"}`,flexShrink:0 }}/>
          <span style={{ flex:1,minWidth:0,fontSize:13.5,fontWeight:800,color:r.you?BRAND:"var(--ak-text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{r.name}{r.you?' (you)':''}</span>
          <div style={{ textAlign:"right",flexShrink:0 }}>
            <div style={{ fontSize:13,fontWeight:900,color:GREEN }}>{r.correct}/{r.total}</div>
            {r.seconds!=null&&<div style={{ fontSize:10,fontWeight:700,color:"var(--ak-text-muted)" }}>{r.seconds}s</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════ */

export default RankingsTab;
