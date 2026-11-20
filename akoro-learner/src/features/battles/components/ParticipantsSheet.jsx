/**
 * ParticipantsSheet — who is in this battle, and what became of them.
 *
 * Teachers got this the day battles became invitations; learners never did.
 * A learner who set a battle for three classmates could see "3 invited" on the
 * card and nothing else — not who had accepted, not who had turned it down, not
 * who had simply not looked yet. The same question, with no way to ask it.
 *
 * The endpoint has always allowed it: /battles/:id/participants is readable by
 * the creator and by anyone taking part, which is exactly this learner. Only
 * the surface was missing.
 *
 * Before the battle runs this is a list of answers owed. After it runs the
 * score IS the state — "accepted" next to a finished battle says nothing — so
 * the rows switch to showing what each agent scored.
 */
import { useState, useEffect } from 'react';
import { BRAND, RED, GREEN, GOLD } from '../../../constants.js';
import { apiGet } from '../../../services/api.js';
import { XIcon, Icon } from '../../../components/common/Icons.jsx';
import { useLang } from '../../../contexts/LanguageContext.jsx';

const FONT = "'Nunito', sans-serif";

const STATE = {
  accepted: { label: 'Accepted',      color: '#4ADE80', bg: 'rgba(16,185,129,.14)' },
  declined: { label: 'Declined',      color: '#FCA5A5', bg: 'rgba(239,68,68,.12)'  },
  invited:  { label: 'Not answered',  color: 'rgba(255,255,255,.45)', bg: 'rgba(255,255,255,.07)' },
};

export default function ParticipantsSheet({ battle, onClose }) {
  const { t } = useLang();
  const [data,  setData]  = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!battle?.id) return;
    let live = true;
    apiGet(`/api/battle/battles/${battle.id}/participants`, { cache: false })
      .then(d => { if (live) setData(d?.data ?? null); })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [battle?.id]);

  if (!battle) return null;

  const s   = data?.summary;
  const ran = ['live', 'completed'].includes(data?.status);
  // The host runs the battle; they are not one of its answers.
  const people = (data?.participants ?? []).filter(p => p.role !== 'teacher');

  return (
    <>
      <div onClick={onClose} style={{ position:'fixed',inset:0,zIndex:2000,background:'rgba(6,6,18,.72)',backdropFilter:'blur(8px)' }} />
      <div style={{
        position:'fixed',bottom:0,left:0,right:0,zIndex:2100,background:'var(--ak-surface)',
        borderRadius:'24px 24px 0 0',padding:'0 0 34px',boxShadow:'0 -8px 40px rgba(0,0,0,.18)',
        animation:'sheet-up .32s cubic-bezier(.32,1.2,.64,1)',fontFamily:FONT,maxHeight:'86vh',overflowY:'auto',
      }}>
        <div style={{ width:38,height:4,borderRadius:2,background:'var(--ak-border2)',margin:'14px auto 0' }} />

        <div style={{ display:'flex',alignItems:'center',gap:10,padding:'16px 20px 10px' }}>
          <div style={{ flex:1,minWidth:0 }}>
            <p style={{ fontSize:15,fontWeight:900,color:'var(--ak-text)',margin:0 }}>{battle.title}</p>
            <p style={{ fontSize:11.5,color:'var(--ak-text-muted)',margin:'2px 0 0' }}>
              {ran ? t('participants.how_they_did') : t('participants.who_is_in')}
            </p>
          </div>
          <button onClick={onClose} style={{ border:'none',background:'var(--ak-surface-hover)',borderRadius:'50%',width:30,height:30,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer' }}>
            <XIcon size={14} color="var(--ak-text-muted)" />
          </button>
        </div>

        {error ? (
          <div style={{ padding:'8px 20px 20px',fontSize:12.5,color:'#FCA5A5' }}>{error}</div>
        ) : !data ? (
          <div style={{ padding:'8px 20px 20px',fontSize:12.5,color:'var(--ak-text-muted)' }}>{t('common.loading')}</div>
        ) : (
          <div style={{ padding:'0 20px' }}>
            <div style={{ display:'flex',gap:6,flexWrap:'wrap',marginBottom:14 }}>
              <Chip color="#4ADE80" bg="rgba(16,185,129,.14)">{s.accepted} accepted</Chip>
              {s.pending  > 0 && <Chip color="rgba(255,255,255,.5)" bg="rgba(255,255,255,.07)">{s.pending} not answered</Chip>}
              {s.declined > 0 && <Chip color="#FCA5A5" bg="rgba(239,68,68,.12)">{s.declined} declined</Chip>}
            </div>

            <div style={{ display:'flex',flexDirection:'column',gap:7 }}>
              {people.map(p => {
                const st = STATE[p.state] ?? STATE.invited;
                return (
                  <div key={p.userId} style={{
                    display:'flex',alignItems:'center',gap:10,padding:'10px 12px',
                    borderRadius:12,background:'var(--ak-surface-hover)',
                    border:`1px solid ${p.isWinner ? 'rgba(245,158,11,.45)' : 'var(--ak-border)'}`,
                  }}>
                    <span style={{ fontSize:18 }}>{p.emoji || '🧑‍🎓'}</span>
                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ fontSize:12.5,fontWeight:800,color:'var(--ak-text)' }}>
                        {p.fullName} {p.isWinner && <Icon name="ti-trophy" size={11} color="#F59E0B"/>}
                      </div>
                      <div style={{ fontSize:10.5,color:'var(--ak-text-muted)' }}>@{p.username}</div>
                    </div>
                    {/* Once it has run the score is the state; before that, the
                        state is all there is. */}
                    {ran && p.state === 'accepted' ? (
                      <span style={{ fontSize:11,fontWeight:800,color:BRAND }}>
                        {p.score} · {p.correct} <Icon name="ti-check" size={10}/>
                      </span>
                    ) : (
                      <Chip color={st.color} bg={st.bg}>{st.label}</Chip>
                    )}
                  </div>
                );
              })}
              {people.length === 0 && (
                <div style={{ fontSize:12,color:'var(--ak-text-muted)',padding:'8px 0' }}>
                  {t('participants.nobody')}
                </div>
              )}
            </div>

            {s.pending > 0 && !ran && (
              <p style={{ fontSize:11,color:'var(--ak-text-muted)',lineHeight:1.5,margin:'12px 0 0' }}>
                {t('participants.pending_note')}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function Chip({ children, color, bg }) {
  return (
    <span style={{ fontSize:10.5,fontWeight:800,color,background:bg,borderRadius:20,padding:'3px 10px',whiteSpace:'nowrap' }}>
      {children}
    </span>
  );
}
