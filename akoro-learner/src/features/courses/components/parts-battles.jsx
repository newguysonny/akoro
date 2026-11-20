/**
 * Course details — knowledge battles and the course leaderboard.
 */
import { useState } from 'react';
import { Swords, Play, Users, Plus, Crown, Bot, Gem, Zap, Tornado, Sparkles, Triangle } from 'lucide-react';
import { BRAND } from '../../../constants.js';
import { apiPost } from '../../../services/api.js';
import BattleModal from '../../battles/index.js';
import { Avatar, Btn, LiveBadge, SectionTitle } from './parts-ui.jsx';
import { card, INK, MUTED, MUTED2, BORDER, RED, GREEN, GOLD, FONT } from './parts-rules.js';

const AGENTS = [
  { id: 'nexus', name: 'Nexus', icon: Bot, owner: 'You', bg: `${BRAND}1A`, color: BRAND, isYou: true },
  { id: 'pythia', name: 'Pythia', icon: Gem, owner: 'Dr. Amara', bg: '#EDE8F8', color: '#7C3AED', isTeacher: true },
  { id: 'axiom', name: 'Axiom', icon: Zap, owner: 'Mr. Tobi', bg: '#FFF4C8', color: '#D97706', isTeacher: true },
  { id: 'zeno', name: 'Zeno', icon: Tornado, owner: 'Chukwuemeka', bg: '#D4EAD8', color: '#059669' },
  { id: 'ada', name: 'Ada', icon: Sparkles, owner: 'Ngozi', bg: '#E4D4F0', color: '#7C3AED' },
  { id: 'sigma', name: 'Sigma', icon: Triangle, owner: 'Babatunde', bg: '#C8D8E8', color: '#2563EB' },
];
const BATTLES = [
  { id: 1, topic: 'Chain Rule Gauntlet', a: 0, b: 1, sa: 7, sb: 5, status: 'live', viewers: 23 },
  { id: 2, topic: 'Limits Speed Round', a: 2, b: 3, sa: 4, sb: 6, status: 'live', viewers: 11 },
  { id: 3, topic: 'Integration Masters', a: 4, b: 5, sa: 0, sb: 0, status: 'upcoming', viewers: 0 },
  { id: 4, topic: 'WAEC Prep Battle', a: 1, b: 4, sa: 9, sb: 7, status: 'completed', viewers: 0 },
];

function BattleCard({ b, onOpen }) {
  // b.a / b.b may be agent indices (demo) or agent objects (real)
  const A = typeof b.a === 'object' ? b.a : AGENTS[b.a];
  const B = typeof b.b === 'object' ? b.b : AGENTS[b.b];
  const sa = b.sa != null ? b.sa : (A.score || 0), sb = b.sb != null ? b.sb : (B.score || 0);
  const aWin = b.status === 'completed' && sa > sb;
  const bWin = b.status === 'completed' && sb > sa;
  const Side = ({ ag, score, win }) => (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <Avatar icon={ag.icon} emoji={ag.emoji} color={ag.color} bg={ag.bg || `${ag.color || BRAND}1A`} size={42} ring={ag.isYou ? true : undefined} />
        {win && <div style={{ position: 'absolute', top: -8, right: -8, fontSize: 15 }}><Crown size={15} fill={GOLD} color={GOLD}/></div>}
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: INK, marginTop: 4 }}>{ag.name}</div>
      {ag.owner && <div style={{ fontSize: 10.5, color: MUTED2 }}>{ag.owner}</div>}
      {ag.isTeacher && <div style={{ fontSize: 9, fontWeight: 800, color: BRAND }}>Teacher</div>}
      <div style={{ fontSize: 19, fontWeight: 900, color: ag.color, marginTop: 2 }}>{score}</div>
    </div>
  );
  return (
    <div style={{ ...card, padding: 18, flex: '0 0 min(300px,82vw)', display: 'flex', flexDirection: 'column', gap: 12, border: b.status === 'live' ? `1px solid ${BRAND}` : `1px solid ${BORDER}` }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: INK, marginBottom: 4 }}>{b.topic}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {b.status === 'live' && <LiveBadge />}
          {b.status === 'upcoming' && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 100, background: `${BRAND}14`, color: BRAND }}>Starting soon</span>}
          {b.status === 'completed' && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 100, background: '#E8F8EE', color: '#2AA76E' }}>Ended</span>}
          {b.status === 'live' && <span style={{ fontSize: 10.5, color: MUTED2, display: 'flex', alignItems: 'center', gap: 3 }}><Users size={10} />{b.viewers}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Side ag={A} score={sa} win={aWin} />
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: INK, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, flexShrink: 0 }}>VS</div>
        <Side ag={B} score={sb} win={bWin} />
      </div>
      <Btn variant={b.status === 'live' ? 'primary' : 'outline'} size="sm" style={{ width: '100%', opacity: b.id ? 1 : .6 }}
        onClick={() => b.id && onOpen?.(b)}>
        {b.status === 'live' ? <><Swords size={12} />Watch live</> : b.status === 'upcoming' ? <><Play size={12} />Preview</> : <>View result</>}
      </Btn>
    </div>
  );
}

function BattlesSection({ battles: real, leaderboard: realLb, lobbies }) {
  const BATTLE_LIST = real?.length ? real : BATTLES;
  const [filter, setFilter] = useState('all');
  const [openBattle, setOpenBattle] = useState(null);
  const [joining, setJoining] = useState(null);
  const [lobbyState, setLobbyState] = useState(null);
  const lobbyList = lobbyState ?? lobbies ?? [];

  const joinLobby = async (lb) => {
    if (joining) return;
    setJoining(lb.id);
    try {
      await apiPost(`/api/battle/battles/${lb.id}/join`, {});
      setLobbyState((prev) => (prev ?? lobbies ?? []).map((x) => x.id === lb.id ? { ...x, alreadyJoined: true } : x));
      setOpenBattle({ id: lb.id, status: 'lobby', topic: lb.topic });
    } catch { /* full / already in / expired — surfaced by disabled state */ }
    finally { setJoining(null); }
  };
  const live = BATTLE_LIST.filter((b) => b.status === 'live');
  const upcoming = BATTLE_LIST.filter((b) => b.status === 'upcoming');
  const completed = BATTLE_LIST.filter((b) => b.status === 'completed');
  const leaderboard = realLb?.length
    ? realLb.map((ag) => ({ ...ag, bg: `${ag.color || BRAND}1A` }))
    : AGENTS.map((ag) => ({ ...ag, pts: BATTLES.reduce((s, b) => s + (b.a === AGENTS.indexOf(ag) ? b.sa : b.b === AGENTS.indexOf(ag) ? b.sb : 0), 0) })).sort((x, y) => y.pts - x.pts).slice(0, 5);

  const Group = ({ label, color, items }) => items.length === 0 ? null : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, animation: color === RED ? 'cp-pulse 1.3s ease infinite' : 'none' }} />
        <span style={{ fontSize: 11.5, fontWeight: 900, letterSpacing: '.04em', textTransform: 'uppercase', color }}>{label} · {items.length}</span>
      </div>
      <div className="cp-scroll" style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 }}>{items.map((b) => <BattleCard key={b.id} b={b} onOpen={setOpenBattle} />)}</div>
    </div>
  );

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionTitle sub="Agents battle around the clock on this class's curriculum.">24/7 Knowledge Battles</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12 }}>
        {[['Live', live.length, RED], ['Upcoming', upcoming.length, BRAND], ['Completed', completed.length, GREEN], ['Battles', BATTLE_LIST.length, '#2563EB']].map(([l, v, c]) => (
          <div key={l} style={{ ...card, padding: 14 }}><div style={{ fontSize: 20, fontWeight: 900, color: c }}>{v}</div><div style={{ fontSize: 11.5, color: MUTED }}>{l}</div></div>
        ))}
      </div>
      {/* Open lobbies — join to play */}
      {lobbyList.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 900, letterSpacing: '.04em', textTransform: 'uppercase', color: '#E8884A' }}>Open lobbies · {lobbyList.length}</div>
          <div className="cp-scroll" style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6 }}>
            {lobbyList.map((lb) => (
              <div key={lb.id} style={{ ...card, padding: 16, flex: '0 0 min(260px,80vw)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{lb.topic}</div>
                <div style={{ fontSize: 11.5, color: MUTED }}>{lb.participants} in · {lb.spotsLeft} spot{lb.spotsLeft === 1 ? '' : 's'} left</div>
                <Btn variant={lb.alreadyJoined ? 'outline' : 'primary'} size="sm" style={{ width: '100%', opacity: (joining === lb.id || lb.spotsLeft <= 0) ? .6 : 1 }}
                  onClick={() => lb.alreadyJoined ? setOpenBattle({ id: lb.id, status: 'lobby', topic: lb.topic }) : joinLobby(lb)}>
                  {joining === lb.id ? 'Joining…' : lb.alreadyJoined ? <><Swords size={12} />Enter lobby</> : lb.spotsLeft <= 0 ? 'Full' : <><Plus size={12} />Join battle</>}
                </Btn>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: '#F0ECE6', borderRadius: 12, width: 'fit-content' }}>
        {[['all', 'All battles'], ['live', 'Live now']].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{ padding: '7px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 800, background: filter === k ? INK : 'transparent', color: filter === k ? '#fff' : MUTED }}>{l}</button>
        ))}
      </div>
      {/* Grouped lists */}
      {filter === 'live' ? (
        live.length ? <Group label="Live now" color={RED} items={live} /> : <div style={{ ...card, padding: 24, textAlign: 'center', color: MUTED2, fontSize: 13 }}>No live battles right now.</div>
      ) : (
        <>
          <Group label="Live now" color={RED} items={live} />
          <Group label="Starting soon" color={BRAND} items={upcoming} />
          <Group label="Completed" color={MUTED2} items={completed} />
        </>
      )}
      <div style={{ ...card, padding: 18 }}>
        <div style={{ fontSize: 13.5, fontWeight: 900, color: INK, marginBottom: 10 }}>Course Leaderboard</div>
        {leaderboard.map((ag, i) => (
          <div key={ag.id || ag.name || i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: i < leaderboard.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
            <div style={{ width: 22, textAlign: 'center', fontSize: 15, fontWeight: 900, color: i === 0 ? GOLD : MUTED2 }}>{i === 0 ? <Crown size={14} fill={GOLD} color={GOLD}/> : i + 1}</div>
            <Avatar icon={ag.icon} emoji={ag.emoji} color={ag.color} bg={ag.bg || `${ag.color || BRAND}1A`} size={32} ring={ag.isYou ? true : undefined} />
            <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{ag.name}{ag.isYou && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: '#fff', background: INK, padding: '1px 7px', borderRadius: 100 }}>You</span>}</div>{ag.owner && <div style={{ fontSize: 11, color: MUTED2 }}>{ag.owner}</div>}</div>
            <div style={{ fontWeight: 900, color: ag.isYou ? BRAND : INK }}>{ag.pts} <span style={{ fontSize: 10, color: MUTED2, fontWeight: 700 }}>pts</span></div>
          </div>
        ))}
      </div>
      {openBattle && <BattleModal battle={openBattle} onClose={() => setOpenBattle(null)} />}
    </section>
  );
}

export { AGENTS, BATTLES, BattleCard, BattlesSection };
