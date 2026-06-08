import React from 'react';

function Toast({ msg, color, onDone }) {
  useEffect(()=>{ const t=setTimeout(onDone,3200); return()=>clearTimeout(t); },[]);
  return (
    <div style={{ position:"fixed",top:72,left:"50%",transform:"translateX(-50%)",zIndex:4000,background:`linear-gradient(135deg,${color},${color}CC)`,borderRadius:20,padding:"10px 20px",display:"flex",alignItems:"center",gap:8,boxShadow:`0 6px 24px ${color}40`,whiteSpace:"nowrap",animation:"toast-in .3s cubic-bezier(.34,1.56,.64,1)",fontFamily:"'Nunito',sans-serif" }}>
      <span style={{ fontSize:16 }}>⚡</span>
      <span style={{ fontSize:13,fontWeight:800,color:"#fff" }}>{msg}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════ */

export default Toast;
