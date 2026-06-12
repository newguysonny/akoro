import React from 'react';
import { RED } from '../../constants.js';

function ProgressBar({ value, color }) {
  return (
    <div style={{ height:5,background:"var(--ak-tag-bg)",borderRadius:99,overflow:"hidden",marginTop:5 }}>
      <div style={{ height:"100%",width:`${value}%`,background:`linear-gradient(90deg,${color}88,${color})`,borderRadius:99,transition:"width 0.6s ease" }}/>
    </div>
  );
}
function LiveBadge() {
  return (
    <span style={{ display:"inline-flex",alignItems:"center",gap:5,padding:"2px 9px",borderRadius:20,background:RED,color:"#fff",fontSize:10,fontWeight:800 }}>
      <span style={{ width:6,height:6,borderRadius:"50%",background:"#fff",display:"inline-block",animation:"pulse-dot 1.3s ease infinite" }}/>LIVE
    </span>
  );
}

export { ProgressBar, LiveBadge };
