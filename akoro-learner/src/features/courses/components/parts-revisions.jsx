/**
 * Course details — peer revision sessions.
 */
import { Clock, Users, CalendarPlus, Radio } from 'lucide-react';
import { BRAND } from '../../../constants.js';
import { Avatar, Btn, LiveBadge, SectionTitle } from './parts-ui.jsx';
import { card, INK, MUTED2, BORDER, FONT, initialsOf } from './parts-rules.js';

const REVISIONS = [
  { id: 1, topic: 'Chain Rule deep-dive', host: 'Chukwuemeka O.', bg: '#D4EAD8', time: 'Starts in 12 min', joined: 8, max: 12, status: 'starting' },
  { id: 2, topic: 'Integration by Parts Q&A', host: 'Ngozi A.', bg: '#E4D4F0', time: 'Live now', joined: 6, max: 10, status: 'live' },
  { id: 3, topic: 'Differential Equations Study Hall', host: 'Tobi M.', bg: '#C8D8E8', time: 'Tomorrow · 4 PM', joined: 0, max: 15, status: 'upcoming' },
];
const RV_HOST_BG = ['#D4EAD8', '#E4D4F0', '#C8D8E8', '#F0E4C8'];

function RevisionsSection({ revisions, onJoinLive }) {
  const list = revisions?.length
    ? revisions.map((s, i) => ({ id: i, topic: s.topic, host: s.host, bg: RV_HOST_BG[i % RV_HOST_BG.length], time: s.time, joined: s.joined, max: s.max, status: s.status === 'live' ? 'live' : 'upcoming' }))
    : REVISIONS;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SectionTitle sub="Student-hosted group review sessions.">Peer Revision</SectionTitle>
      <div className="cp-scroll" style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 }}>
        {list.map((s) => (
          <div key={s.id} style={{ ...card, padding: 18, flex: '0 0 min(300px,82vw)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ marginBottom: 6 }}>
                {s.status === 'live' && <LiveBadge />}
                {s.status === 'starting' && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 9px', borderRadius: 100, background: `${BRAND}14`, color: BRAND }}>Starting soon</span>}
                {s.status === 'upcoming' && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 9px', borderRadius: 100, background: '#F0ECE6', color: MUTED2 }}>Upcoming</span>}
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>{s.topic}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar initials={initialsOf(s.host)} bg={s.bg} size={32} />
              <div><div style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{s.host}</div><div style={{ fontSize: 11, color: MUTED2, display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={10} />{s.time}</div></div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: MUTED2, marginBottom: 5 }}><span><Users size={10} style={{ display: 'inline', marginRight: 3 }} />{s.joined}/{s.max}</span><span>{Math.round((s.joined / s.max) * 100)}% full</span></div>
              <div style={{ height: 5, background: '#EDE8E1', borderRadius: 4, overflow: 'hidden' }}><div style={{ height: '100%', width: `${(s.joined / s.max) * 100}%`, background: BRAND, borderRadius: 4 }} /></div>
            </div>
            <Btn variant={s.status === 'upcoming' ? 'outline' : s.status === 'live' ? 'green' : 'primary'} size="sm" style={{ width: '100%' }} onClick={onJoinLive}>
              {s.status === 'upcoming' ? <><CalendarPlus size={12} />Reserve</> : <><Radio size={12} />{s.status === 'live' ? 'Join' : 'Join early'}</>}
            </Btn>
          </div>
        ))}
      </div>
    </section>
  );
}

export { REVISIONS, RV_HOST_BG, RevisionsSection };
