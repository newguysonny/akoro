/**
 * RankingSheet — leaderboards inside the school-site student chat.
 *
 * Uses the learner app's /api/ranking endpoints and its podium-then-list
 * layout, but shows only the boards that rank PEOPLE — see BOARDS below.
 */
import { useState, useEffect } from 'react';
import { School, Trophy, BookOpen } from 'lucide-react';
import { apiGet } from '../../services/api.js';
import { GOLD } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

// Student-focused: both boards rank PEOPLE, so the pupil can always find
// themselves. The learner app also carries Courses and Schools boards, but
// those rank courses and schools against each other — a student opening them
// never appears in the list, which is confusing on their own school's site.
const BOARDS = [
  { key: 'classroom', label: 'My class',  icon: School, ti: 'ti-school', endpoint: '/api/ranking/my-classroom',
    empty: 'No one in your class has earned XP yet.' },
  { key: 'school',    label: 'My school',  icon: Trophy, ti: 'ti-trophy', endpoint: '/api/ranking/my-school',
    empty: 'No one in your school has earned XP yet.' },
  { key: 'subjects',  label: 'Subjects',   icon: BookOpen, ti: 'ti-book', endpoint: '/api/ranking/my-class-subjects',
    empty: 'No subject XP in your class yet.' },
];

const SILVER = '#C0C0C0', BRONZE = '#CD7F32';

const mapRow = (r) => ({
  rank: r.rank,
  name: r.name || r.full_name || r.username || 'Unknown',
  avatar: r.avatar || r.avatar_url || null,
  xp: r.total_xp || 0,
  isMe: !!r.is_me,
  subject: r.subject,
  students: r.students,
});

export default function RankingSheet({ onClose }) {
  const [board, setBoard] = useState('classroom');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  // Subjects board returns one leaderboard PER subject, so it needs its own
  // picker on top of the board tabs.
  const [subjects, setSubjects] = useState([]);
  const [subject, setSubject] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setRows([]); setErr('');
    const ep = BOARDS.find((b) => b.key === board).endpoint;
    apiGet(ep)
      .then((res) => {
        if (!alive) return;
        // Ranking endpoints wrap their payload in `data` (some don't) — accept both.
        if (board === 'subjects') {
          const list = res.data?.subjects || res.subjects || [];
          setSubjects(list);
          const pick = list.find((x) => x.subject === subject) || list[0] || null;
          setSubject(pick?.subject || null);
          setRows((pick?.leaders || []).map(mapRow));
          return;
        }
        const leaders = res.data?.leaders || res.leaders || [];
        setRows(leaders.map((r) => ({
          rank: r.rank,
          name: r.name || r.full_name || r.username || 'Unknown',
          avatar: r.avatar || r.avatar_url || null,
          xp: r.total_xp || 0,
          isMe: !!r.is_me,
          subject: r.subject,
          students: r.students,
        })));
      })
      // Don't render an empty leaderboard for a failed request — that reads as
      // "nobody has any XP", which is a different and discouraging message.
      .catch((e) => { if (alive) setErr(e?.message || 'Could not load rankings'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [board]);

  const initials = (n) => String(n || '?').trim().charAt(0).toUpperCase();
  const Avatar = ({ r, size, ring }) => r.avatar
    ? <img src={r.avatar} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: `2.5px solid ${ring}` }}
        onError={(e) => { e.currentTarget.style.display = 'none'; }} />
    : <div style={{ width: size, height: size, borderRadius: '50%', border: `2.5px solid ${ring}`, background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4, fontWeight: 900, color: C.muted }}>{initials(r.name)}</div>;

  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  // Pinned so a student never has to scroll a whole-school board to find
  // themselves. Only meaningful once the list has loaded.
  const me = rows.find((r) => r.isMe) || null;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2600, background: 'rgba(17,17,26,.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.surface, width: '100%', maxWidth: 540, maxHeight: '86vh', borderRadius: '20px 20px 0 0', display: 'flex', flexDirection: 'column', fontFamily: C.font, animation: 'rank-up .28s cubic-bezier(.34,1.4,.6,1)' }}>
        <style>{`@keyframes rank-up{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>

        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px 8px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15.5, fontWeight: 900, color: C.ink }}><Ico ti="ti-trophy" size={15} color={C.brand} /> Rankings</div>
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', width: 30, height: 30, borderRadius: '50%', border: 'none', background: C.bg, color: C.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ico ti="ti-x" size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, padding: '10px 12px 0', borderBottom: `1px solid ${C.border}` }}>
          {BOARDS.map((b) => (
            <button key={b.key} onClick={() => setBoard(b.key)} style={{
              flex: 1, padding: '8px 4px 10px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11.5, fontWeight: board === b.key ? 800 : 600, fontFamily: C.font,
              color: board === b.key ? C.brand : C.muted2,
              borderBottom: `2.5px solid ${board === b.key ? C.brand : 'transparent'}`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            }}>
              <Ico lucide={b.icon} ti={b.ti} size={16} />{b.label}
            </button>
          ))}
        </div>

        {board === 'subjects' && subjects.length > 0 && (
          <div style={{ display: 'flex', gap: 7, padding: '10px 12px', overflowX: 'auto', borderBottom: `1px solid ${C.border}`, scrollbarWidth: 'none' }}>
            {subjects.map((sx) => (
              <button key={sx.subject}
                onClick={() => { setSubject(sx.subject); setRows((sx.leaders || []).map(mapRow)); }}
                style={{
                  flexShrink: 0, padding: '6px 13px', borderRadius: 100, cursor: 'pointer', fontFamily: C.font,
                  fontSize: 12, fontWeight: 800,
                  border: subject === sx.subject ? `1.5px solid ${C.brand}` : `1.5px solid ${C.border}`,
                  background: subject === sx.subject ? tint(8) : C.surface,
                  color: subject === sx.subject ? C.brand : C.muted,
                }}>{sx.subject}</button>
            ))}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {err ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: '#EF4444', fontSize: 13, fontWeight: 700 }}>{err}</div>
          ) : loading ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: C.muted2, fontSize: 13, fontWeight: 600 }}>Loading rankings…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: '40px 24px', textAlign: 'center' }}>
              <div style={{ opacity: .25, display: 'flex', justifyContent: 'center' }}><Ico ti="ti-trophy" size={46} color={C.muted} /></div>
              <p style={{ fontSize: 14.5, fontWeight: 800, color: C.muted, margin: '10px 0 4px' }}>No rankings yet</p>
              <p style={{ fontSize: 12, color: C.muted2, margin: 0 }}>{BOARDS.find((b) => b.key === board)?.empty} Earn XP from lessons and assessments to climb the board.</p>
            </div>
          ) : (
            <>
              {/* Podium */}
              <div style={{ padding: '16px 16px 12px', background: `linear-gradient(160deg, ${tint(7)}, ${tint(2)})`, borderBottom: `1px solid ${C.border}` }}>
                <p style={{ fontSize: 10, fontWeight: 800, color: C.brand, letterSpacing: .5, margin: '0 0 12px', textAlign: 'center' }}>TOP LEADERBOARD</p>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 10 }}>
                  {podium[1] && (
                    <div style={col}>
                      <Avatar r={podium[1]} size={46} ring={SILVER} />
                      <span style={nameSm}>{podium[1].name}</span>
                      <div style={{ ...plinth, width: 58, background: SILVER }}>
                        <Ico ti="ti-medal" size={16} color={SILVER} />
                        <p style={xpSm}>{podium[1].xp.toLocaleString()}</p><p style={xpLbl}>XP</p>
                      </div>
                    </div>
                  )}
                  {podium[0] && (
                    <div style={{ ...col, marginBottom: -4 }}>
                      <div style={{ position: 'relative' }}>
                        <Avatar r={podium[0]} size={58} ring={GOLD} />
                        <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)' }}><Ico ti="ti-crown" size={18} color={GOLD} /></div>
                      </div>
                      <span style={{ ...nameSm, fontWeight: 900, color: C.ink, maxWidth: 80 }}>{podium[0].name}</span>
                      <div style={{ ...plinth, width: 68, background: `linear-gradient(135deg, ${GOLD}, #D97706)` }}>
                        <Ico ti="ti-medal" size={18} color={GOLD} />
                        <p style={{ ...xpSm, fontSize: 11 }}>{podium[0].xp.toLocaleString()}</p><p style={xpLbl}>XP</p>
                      </div>
                    </div>
                  )}
                  {podium[2] && (
                    <div style={col}>
                      <Avatar r={podium[2]} size={40} ring={BRONZE} />
                      <span style={{ ...nameSm, maxWidth: 60 }}>{podium[2].name}</span>
                      <div style={{ ...plinth, width: 52, background: BRONZE }}>
                        <Ico ti="ti-medal" size={14} color={BRONZE} />
                        <p style={xpSm}>{podium[2].xp.toLocaleString()}</p><p style={xpLbl}>XP</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* The rest */}
              {rest.map((r) => (
                <div key={r.rank} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 16px', borderBottom: `1px solid ${C.border}`, background: r.isMe ? tint(4) : C.surface }}>
                  <div style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, background: r.isMe ? tint(13) : C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, color: r.isMe ? C.brand : C.muted }}>{r.rank}</div>
                  <Avatar r={r} size={36} ring={r.isMe ? C.brand : C.border} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: r.isMe ? C.brand : C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                      {r.isMe && <span style={{ fontSize: 9, fontWeight: 800, color: C.brand, background: tint(13), borderRadius: 4, padding: '1px 5px' }}>You</span>}
                    </div>
                    {(r.subject || r.students !== undefined) && (
                      <div style={{ fontSize: 10.5, color: C.muted2, fontWeight: 600, marginTop: 2 }}>
                        {r.subject && <>{r.subject}</>}
                        {r.students !== undefined && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Ico ti="ti-users" size={11} /> {r.students} students</span>}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <Ico ti="ti-bolt" size={11} color={GOLD} />
                    <span style={{ fontSize: 13, fontWeight: 900, color: C.ink }}>{r.xp.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {!loading && !err && rows.length > 0 && (
          <div style={{ borderTop: `2px solid ${C.border}`, background: tint(4), padding: '10px 16px', flexShrink: 0 }}>
            {me ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <div style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, background: tint(13), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, color: C.brand }}>{me.rank}</div>
                <Avatar r={me} size={32} ring={C.brand} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 900, color: C.brand }}>Your rank</div>
                  <div style={{ fontSize: 11, color: C.muted2, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me.name}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <Ico ti="ti-bolt" size={11} color={GOLD} />
                  <span style={{ fontSize: 13, fontWeight: 900, color: C.ink }}>{me.xp.toLocaleString()}</span>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 11.5, color: C.muted, fontWeight: 600, textAlign: 'center' }}>
                You're not on this board yet — earn XP from lessons and assessments to appear.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const col = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 };
const nameSm = { fontSize: 9.5, fontWeight: 800, color: C.muted, textAlign: 'center', maxWidth: 68, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const plinth = { borderRadius: '6px 6px 0 0', padding: '8px 0 6px', textAlign: 'center' };
const xpSm = { fontSize: 10, fontWeight: 800, color: '#fff', margin: 0 };
const xpLbl = { fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,.85)', margin: 0 };
