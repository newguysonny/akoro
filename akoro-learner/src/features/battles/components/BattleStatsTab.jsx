import { GREEN, GOLD } from '../../../constants.js';
import { panel } from './battleStyles.js';

export default function BattleStatsTab({ m }) {
  const { myXp, myAnswered, me, viewerCount, participants, isClassroom, A, Bp, myAccuracy } = m;

  return (
    <>
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[['Your XP this battle', myXp, '#E8884A'], ['Questions answered', myAnswered, GREEN], ['Your streak', `${me?.streak || 0}`, GOLD], ['Viewers', viewerCount || participants.length, '#3B82F6']].map(([label, val, color]) => (
                  <div key={label} style={panel}><div style={{ fontSize: 22, fontWeight: 900, color, marginBottom: 4 }}>{val}</div><div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.40)' }}>{label}</div></div>
                ))}
              </div>
              {!isClassroom && A && Bp && (
                <div style={panel}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,.40)', letterSpacing: .5, marginBottom: 12 }}>HEAD TO HEAD</div>
                  {[['Score', A.score, Bp.score], ['HP remaining', A.hp, Bp.hp], ['Streak', A.streak, Bp.streak]].map(([label, av, bv]) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                      <span style={{ fontWeight: 800, fontSize: 13, width: 40, textAlign: 'center', color: A.agentColor }}>{av}</span>
                      <span style={{ flex: 1, textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,.40)' }}>{label}</span>
                      <span style={{ fontWeight: 800, fontSize: 13, width: 40, textAlign: 'center', color: Bp.agentColor }}>{bv}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
                    <span style={{ flex: 1, textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,.40)' }}>Your accuracy: <b style={{ color: '#fff' }}>{myAccuracy}%</b></span>
                  </div>
                </div>
              )}
            </>
    </>
  );
}
