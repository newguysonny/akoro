import React, { useState, useEffect } from 'react';
import { BRAND, RED, GREEN, GOLD, SUBJECT_COLORS, SUBJECTS } from '../../constants.js';
import { apiGet } from '../../services/api.js';
import { TrophyIcon, FlameIcon, StarIcon, ZapIcon } from '../common/Icons.jsx';

function RankingsTab() {
  const [boardType, setBoardType] = useState("classroom");
  const [data, setData] = useState([]);
  const [classroomId, setClassroomId] = useState(null);
  const [loading, setLoading] = useState(false);
  const BOARD_TABS=[{key:"classroom",label:"Classroom",icon:"🏫"},{key:"courses",label:"Courses",icon:"📘"},{key:"interSchool",label:"Inter-Schools",icon:"🌍"}];

  // Get classroom_id from sessions on mount
  useEffect(() => {
    apiGet('/api/student/sessions')
      .then(d => {
        const id = d.sessions?.[0]?.classroom_id;
        if (id) setClassroomId(id);
      })
      .catch(() => {});
  }, []);

  // Fetch ranking data when boardType or classroomId changes
  useEffect(() => {
    setLoading(true);
    let endpoint = '/api/ranking/global';
    if (boardType === 'classroom' && classroomId) {
      endpoint = `/api/ranking/classroom/${classroomId}`;
    } else if (boardType === 'courses') {
      endpoint = '/api/ranking/global';
    }
    apiGet(endpoint)
      .then(d => {
        const leaders = d.leaders || [];
        setData(leaders.map(r => ({
          rank: r.rank,
          name: r.full_name || r.username || 'Unknown',
          avatar: r.avatar_url || `https://i.pravatar.cc/150?u=${r.user_id}`,
          xp: r.total_xp || 0,
          isMe: r.is_me || false,
        })));
      })
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [boardType, classroomId]);

  const changeColor=c=>c&&c.startsWith("+")?GREEN:c&&c.startsWith("-")?RED:"#9CA3AF";
  return (
    <div style={{ flex:1,overflowY:"auto",background:"#fff",display:"flex",flexDirection:"column" }}>
      <div style={{ display:"flex",padding:"12px 16px 0",gap:8,borderBottom:"1px solid #F3F4F6" }}>
        {BOARD_TABS.map(({key,label,icon})=>(
          <button key={key} onClick={()=>setBoardType(key)} style={{ flex:1,padding:"8px 4px 10px",background:"none",border:"none",cursor:"pointer",fontSize:11.5,fontWeight:boardType===key?800:600,color:boardType===key?BRAND:"#9CA3AF",borderBottom:`2.5px solid ${boardType===key?BRAND:"transparent"}`,transition:"all .2s",fontFamily:"'Nunito',sans-serif",display:"flex",flexDirection:"column",alignItems:"center",gap:2 }}>
            <span style={{ fontSize:16 }}>{icon}</span>{label}
          </button>
        ))}
      </div>
      <div style={{ padding:"18px 16px 12px",background:`linear-gradient(160deg,${BRAND}12,${BRAND}04)`,borderBottom:"1px solid #F3F4F6" }}>
        <p style={{ fontSize:10,fontWeight:800,color:BRAND,letterSpacing:.5,margin:"0 0 12px",textAlign:"center" }}>🏆 TOP LEADERBOARD</p>
        <div style={{ display:"flex",alignItems:"flex-end",justifyContent:"center",gap:10 }}>
          {data[1]&&<div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:5 }}><img src={data[1].avatar} alt="" style={{ width:46,height:46,borderRadius:"50%",objectFit:"cover",border:"2.5px solid #C0C0C0" }}/><span style={{ fontSize:9.5,fontWeight:800,color:"#374151",textAlign:"center",maxWidth:68,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{data[1].name}</span><div style={{ width:58,background:"#C0C0C0",borderRadius:"6px 6px 0 0",padding:"8px 0 6px",textAlign:"center" }}><span style={{ fontSize:16 }}>🥈</span><p style={{ fontSize:10,fontWeight:800,color:"#fff",margin:0 }}>{(data[1].xp||0).toLocaleString()}</p><p style={{ fontSize:9,fontWeight:600,color:"rgba(255,255,255,.8)",margin:0 }}>XP</p></div></div>}
          {data[0]&&<div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:5,marginBottom:-4 }}><div style={{ position:"relative" }}><img src={data[0].avatar} alt="" style={{ width:58,height:58,borderRadius:"50%",objectFit:"cover",border:`3px solid ${GOLD}` }}/><div style={{ position:"absolute",top:-10,left:"50%",transform:"translateX(-50%)",fontSize:18 }}>👑</div></div><span style={{ fontSize:10,fontWeight:900,color:"#111827",textAlign:"center",maxWidth:80,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{data[0].name}</span><div style={{ width:68,background:`linear-gradient(135deg,${GOLD},#D97706)`,borderRadius:"6px 6px 0 0",padding:"10px 0 6px",textAlign:"center" }}><span style={{ fontSize:18 }}>🥇</span><p style={{ fontSize:11,fontWeight:900,color:"#fff",margin:0 }}>{(data[0].xp||0).toLocaleString()}</p><p style={{ fontSize:9,fontWeight:600,color:"rgba(255,255,255,.85)",margin:0 }}>XP</p></div></div>}
          {data[2]&&<div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:5 }}><img src={data[2].avatar} alt="" style={{ width:40,height:40,borderRadius:"50%",objectFit:"cover",border:"2.5px solid #CD7F32" }}/><span style={{ fontSize:9.5,fontWeight:800,color:"#374151",textAlign:"center",maxWidth:60,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{data[2].name}</span><div style={{ width:52,background:"#CD7F32",borderRadius:"6px 6px 0 0",padding:"6px 0 6px",textAlign:"center" }}><span style={{ fontSize:14 }}>🥉</span><p style={{ fontSize:9.5,fontWeight:800,color:"#fff",margin:0 }}>{(data[2].xp||0).toLocaleString()}</p><p style={{ fontSize:9,fontWeight:600,color:"rgba(255,255,255,.8)",margin:0 }}>XP</p></div></div>}
        </div>
      </div>
      <div style={{ flex:1 }}>
        {data.slice(3).map(entry=>{
          const isMe=entry.isMe,subjectColor=entry.subject?SUBJECT_COLORS[entry.subject]:null;
          return (
            <div key={entry.rank} style={{ display:"flex",alignItems:"center",gap:12,padding:"11px 18px",borderBottom:"1px solid #F3F4F6",background:isMe?`${BRAND}06`:"#fff" }}>
              <div style={{ width:28,height:28,borderRadius:8,background:isMe?`${BRAND}15`:"#F3F4F6",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}><span style={{ fontSize:12,fontWeight:900,color:isMe?BRAND:"#6B7280" }}>{entry.rank}</span></div>
              <img src={entry.avatar} alt="" style={{ width:40,height:40,borderRadius:"50%",objectFit:"cover",border:`2px solid ${isMe?BRAND:"#E5E7EB"}`,flexShrink:0 }}/>
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ display:"flex",alignItems:"center",gap:5 }}><span style={{ fontSize:13.5,fontWeight:800,color:isMe?BRAND:"#111827" }}>{entry.name}</span>{isMe&&<span style={{ fontSize:9,fontWeight:800,color:BRAND,background:`${BRAND}15`,borderRadius:4,padding:"1px 5px" }}>YOU</span>}</div>
                <div style={{ display:"flex",alignItems:"center",gap:6,marginTop:2 }}>
                  {entry.streak!==undefined&&<span style={{ fontSize:10,fontWeight:700,color:"#9CA3AF" }}>🔥 {entry.streak}d streak</span>}
                  {entry.subject&&<span style={{ fontSize:10,fontWeight:700,color:subjectColor||"#9CA3AF",background:`${subjectColor}15`,borderRadius:4,padding:"1px 6px" }}>{SUBJECTS[entry.subject]?.icon} {SUBJECTS[entry.subject]?.label}</span>}
                  {entry.completions!==undefined&&<span style={{ fontSize:10,fontWeight:600,color:"#9CA3AF" }}>{entry.completions} completions</span>}
                  {entry.students!==undefined&&<span style={{ fontSize:10,fontWeight:600,color:"#9CA3AF" }}>👥 {entry.students} students</span>}
                </div>
              </div>
              <div style={{ textAlign:"right",flexShrink:0 }}>
                <div style={{ display:"flex",alignItems:"center",gap:4,justifyContent:"flex-end" }}><ZapIcon size={11} color={GOLD}/><span style={{ fontSize:13,fontWeight:900,color:"#111827" }}>{(entry.xp||0).toLocaleString()}</span></div>
                <span style={{ fontSize:10,fontWeight:800,color:changeColor(entry.change) }}>{entry.change}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════ */

export default RankingsTab;
