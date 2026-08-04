import React, { useState, useEffect } from 'react';
import { BRAND, RED, GREEN, GOLD, SUBJECT_COLORS, SUBJECTS, AVATAR_FALLBACK } from '../../constants.js';
import { apiGet } from '../../services/api.js';
import { TrophyIcon, FlameIcon, StarIcon, ZapIcon } from '../common/Icons.jsx';
import { useLang } from '../../contexts/LanguageContext.jsx';

function RankingsTab() {
  const { t } = useLang();
  const [boardType, setBoardType] = useState("classroom");
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const BOARD_TABS=[{key:"classroom",label:t('rankings.classroom'),icon:"🏫"},{key:"courses",label:t('rankings.courses'),icon:"📘"},{key:"interSchool",label:t('rankings.inter_schools'),icon:"🌍"}];

  // Each board ranks a different entity: classroom=students, courses=courses,
  // inter-school=schools. Ranking endpoints wrap their payload in `data`.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setData([]);
    const endpoint = boardType === 'classroom' ? '/api/ranking/my-classroom'
      : boardType === 'courses'                ? '/api/ranking/courses'
      :                                          '/api/ranking/schools';
    apiGet(endpoint)
      .then(res => {
        if (!alive) return;
        const leaders = res.data?.leaders || res.leaders || [];
        setData(leaders.map(r => ({
          rank:     r.rank,
          name:     r.name || r.full_name || r.username || 'Unknown',
          avatar:   r.avatar || r.avatar_url || null,
          xp:       r.total_xp || 0,
          isMe:     r.is_me || false,
          subject:  r.subject,
          students: r.students,
        })));
      })
      .catch(() => { if (alive) setData([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [boardType]);

  const changeColor=c=>c&&c.startsWith("+")?GREEN:c&&c.startsWith("-")?RED:"var(--ak-text-muted)";
  return (
    <div style={{ flex:1,overflowY:"auto",background:"var(--ak-surface)",display:"flex",flexDirection:"column" }}>
      <div style={{ display:"flex",padding:"12px 16px 0",gap:8,borderBottom:"1px solid var(--ak-border)" }}>
        {BOARD_TABS.map(({key,label,icon})=>(
          <button key={key} onClick={()=>setBoardType(key)} style={{ flex:1,padding:"8px 4px 10px",background:"none",border:"none",cursor:"pointer",fontSize:11.5,fontWeight:boardType===key?800:600,color:boardType===key?BRAND:"var(--ak-text-muted)",borderBottom:`2.5px solid ${boardType===key?BRAND:"transparent"}`,transition:"all .2s",fontFamily:"'Nunito',sans-serif",display:"flex",flexDirection:"column",alignItems:"center",gap:2 }}>
            <span style={{ fontSize:16 }}>{icon}</span>{label}
          </button>
        ))}
      </div>
      {loading && data.length===0 && (
        <div style={{ padding:"48px 24px",textAlign:"center",color:"var(--ak-text-muted)",fontSize:13,fontWeight:600 }}>Loading rankings…</div>
      )}
      {!loading && data.length===0 && (
        <div style={{ padding:"48px 24px",display:"flex",flexDirection:"column",alignItems:"center",gap:10 }}>
          <span style={{ fontSize:52,opacity:.2 }}>🏆</span>
          <p style={{ fontSize:15,fontWeight:800,color:"var(--ak-text-sub)" }}>{t('rankings.empty')}</p>
          <p style={{ fontSize:12,color:"var(--ak-text-muted)",textAlign:"center",maxWidth:280 }}>{t('rankings.empty_hint')}</p>
        </div>
      )}
      {data.length>0 && (<>
      <div style={{ padding:"18px 16px 12px",background:`linear-gradient(160deg,${BRAND}12,${BRAND}04)`,borderBottom:"1px solid var(--ak-border)" }}>
        <p style={{ fontSize:10,fontWeight:800,color:BRAND,letterSpacing:.5,margin:"0 0 12px",textAlign:"center" }}>🏆 TOP LEADERBOARD</p>
        <div style={{ display:"flex",alignItems:"flex-end",justifyContent:"center",gap:10 }}>
          {data[1]&&<div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:5 }}><img src={data[1].avatar || AVATAR_FALLBACK} alt="" style={{ width:46,height:46,borderRadius:"50%",objectFit:"cover",border:"2.5px solid #C0C0C0" }}/><span style={{ fontSize:9.5,fontWeight:800,color:"var(--ak-text-sec)",textAlign:"center",maxWidth:68,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{data[1].name}</span><div style={{ width:58,background:"#C0C0C0",borderRadius:"6px 6px 0 0",padding:"8px 0 6px",textAlign:"center" }}><span style={{ fontSize:16 }}>🥈</span><p style={{ fontSize:10,fontWeight:800,color:"#fff",margin:0 }}>{(data[1].xp||0).toLocaleString()}</p><p style={{ fontSize:9,fontWeight:600,color:"rgba(255,255,255,.8)",margin:0 }}>XP</p></div></div>}
          {data[0]&&<div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:5,marginBottom:-4 }}><div style={{ position:"relative" }}><img src={data[0].avatar || AVATAR_FALLBACK} alt="" style={{ width:58,height:58,borderRadius:"50%",objectFit:"cover",border:`3px solid ${GOLD}` }}/><div style={{ position:"absolute",top:-10,left:"50%",transform:"translateX(-50%)",fontSize:18 }}>👑</div></div><span style={{ fontSize:10,fontWeight:900,color:"var(--ak-text)",textAlign:"center",maxWidth:80,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{data[0].name}</span><div style={{ width:68,background:`linear-gradient(135deg,${GOLD},#D97706)`,borderRadius:"6px 6px 0 0",padding:"10px 0 6px",textAlign:"center" }}><span style={{ fontSize:18 }}>🥇</span><p style={{ fontSize:11,fontWeight:900,color:"#fff",margin:0 }}>{(data[0].xp||0).toLocaleString()}</p><p style={{ fontSize:9,fontWeight:600,color:"rgba(255,255,255,.85)",margin:0 }}>XP</p></div></div>}
          {data[2]&&<div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:5 }}><img src={data[2].avatar || AVATAR_FALLBACK} alt="" style={{ width:40,height:40,borderRadius:"50%",objectFit:"cover",border:"2.5px solid #CD7F32" }}/><span style={{ fontSize:9.5,fontWeight:800,color:"var(--ak-text-sec)",textAlign:"center",maxWidth:60,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{data[2].name}</span><div style={{ width:52,background:"#CD7F32",borderRadius:"6px 6px 0 0",padding:"6px 0 6px",textAlign:"center" }}><span style={{ fontSize:14 }}>🥉</span><p style={{ fontSize:9.5,fontWeight:800,color:"#fff",margin:0 }}>{(data[2].xp||0).toLocaleString()}</p><p style={{ fontSize:9,fontWeight:600,color:"rgba(255,255,255,.8)",margin:0 }}>XP</p></div></div>}
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
                  {entry.streak!==undefined&&<span style={{ fontSize:10,fontWeight:700,color:"var(--ak-text-muted)" }}>🔥 {entry.streak}{t('rankings.day_streak')}</span>}
                  {entry.subject&&<span style={{ fontSize:10,fontWeight:700,color:subjectColor||"var(--ak-text-muted)",background:`${subjectColor}15`,borderRadius:4,padding:"1px 6px" }}>{SUBJECTS[entry.subject]?.icon} {SUBJECTS[entry.subject]?.label}</span>}
                  {entry.completions!==undefined&&<span style={{ fontSize:10,fontWeight:600,color:"var(--ak-text-muted)" }}>{entry.completions} {t('rankings.completions')}</span>}
                  {entry.students!==undefined&&<span style={{ fontSize:10,fontWeight:600,color:"var(--ak-text-muted)" }}>👥 {entry.students} {t('rankings.students')}</span>}
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
    </div>
  );
}

/* ══════════════════════════════════════════════════════ */

export default RankingsTab;
