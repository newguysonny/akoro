export default function BattleLogTab({ m }) {
  const { logRef, log } = m;

  return (
            <div ref={logRef} style={{ flex: 1, minHeight: 260, maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {log.length === 0 && <div style={{ color: 'rgba(255,255,255,.28)', fontSize: 13, textAlign: 'center', paddingTop: 30 }}>Battle events will appear here…</div>}
              {log.map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11.5 }}>
                  <span style={{ color: 'rgba(255,255,255,.28)', flexShrink: 0, fontFamily: 'monospace' }}>{e.ts}</span>
                  <span style={{ color: 'rgba(255,255,255,.6)' }}>{e.msg}</span>
                </div>
              ))}
            </div>
  );
}
