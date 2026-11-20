/**
 * BattleModal — the arena shell: ticker, header, tabs and footer.
 *
 * Its state, sockets, API calls and timers live in useBattleModal; each tab's
 * view is its own component. Props and rendered markup are unchanged.
 */
import { XIcon, UsersIcon, FlameIcon, BookIcon, ZapIcon, Icon } from '../../../components/common/Icons.jsx';
import { LiveBadge } from '../../../components/common/ProgressBar.jsx';
import useBattleModal from '../hooks/useBattleModal.js';
import BattleArenaTab from './BattleArenaTab.jsx';
import BattleStatsTab from './BattleStatsTab.jsx';
import BattleLogTab from './BattleLogTab.jsx';
import BattleQuestionsTab from './BattleQuestionsTab.jsx';
import { FONT } from './battleStyles.js';

const TAB_ITEMS = [['watch', 'Battle'], ['stats', 'Stats'], ['log', 'Log'], ['questions', 'Questions']];

export default function BattleModal({ battle: initialBattle, onClose, onMinimize }) {
  const m = useBattleModal({ battle: initialBattle });
  const { tickerItems, isLive, isCompleted, viewerCount, participants, lineupText, tab, setTab, iAmParticipant, isCheck, reviewHost, isReview, t } = m;

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(8px)', fontFamily: FONT }}>
      <style>{`@keyframes bm-ticker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}@keyframes bm-up{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      <div className="ak-bplayer" style={{ width: '100%', borderRadius: 24, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'linear-gradient(160deg,#0f1320,#141c2e,#1a1430)', border: '1px solid rgba(255,255,255,.1)', animation: 'bm-up .35s cubic-bezier(.32,1,.64,1)' }}>

        {/* Notification ticker */}
        <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', background: 'rgba(0,0,0,.30)', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
          <div style={{ display: 'inline-flex', gap: 48, animation: 'bm-ticker 28s linear infinite' }}>
            {tickerItems.map((tk, i) => <span key={i} style={{ fontSize: 10, color: 'rgba(255,255,255,.45)', fontWeight: 600, padding: "0 24px" }}><Icon name="ti-swords" size={10}/> {tk}</span>)}
          </div>
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {isLive && <LiveBadge />}
            {isCompleted && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 9px', borderRadius: 20, background: 'rgba(255,255,255,.10)', color: 'rgba(255,255,255,.55)' }}>COMPLETED</span>}
            {!isLive && !isCompleted && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 9px', borderRadius: 20, background: 'rgba(108,59,255,.25)', color: '#A78BFA' }}>LOBBY</span>}
            <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <span style={{ color: '#fff', fontWeight: 800, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{initialBattle?.title || initialBattle?.topic || 'Battle'}</span>
              {lineupText && <span style={{ color: 'rgba(255,255,255,.5)', fontWeight: 700, fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lineupText}</span>}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', display: 'flex', alignItems: 'center', gap: 4 }}><UsersIcon size={11} color="rgba(255,255,255,.45)" />{viewerCount || participants.length}</span>
            {/* Minimize — park the battle on the Now-Studying bar. The engine
                keeps running while it's parked, so this is non-destructive;
                hidden once completed (nothing left to continue). */}
            {onMinimize && !isCompleted && (
              <button onClick={onMinimize} aria-label={t('now.minimize')} title={t('now.minimize')}
                style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,.10)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.6)" strokeWidth="2.6" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            )}
            <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,.10)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><XIcon size={14} color="rgba(255,255,255,.6)" /></button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '10px 18px 0' }}>
          {TAB_ITEMS.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{ padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none', background: tab === key ? '#E8884A' : 'rgba(255,255,255,.10)', color: tab === key ? '#fff' : 'rgba(255,255,255,.50)', fontFamily: FONT }}>{label}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* ── BATTLE ── */}
          {tab === 'watch' && <BattleArenaTab m={m} />}

          {/* ── STATS ── */}
          {tab === 'stats' && <BattleStatsTab m={m} />}

          {/* ── LOG ── */}
          {tab === 'log' && <BattleLogTab m={m} />}

          {/* ── QUESTIONS ── */}
          {tab === 'questions' && <BattleQuestionsTab m={m} />}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 18px', borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'rgba(255,255,255,.35)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FlameIcon size={11} color="#F97316" />Live knowledge battle</span>
            <span>·</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><BookIcon size={11} color="rgba(255,255,255,.35)" />Your class</span>
          </div>
          {isLive && iAmParticipant && <span style={{ fontSize: 11, fontWeight: 700, color: '#E8884A', display: 'flex', alignItems: 'center', gap: 5 }}><ZapIcon size={11} color="#E8884A" />{isCheck ? (reviewHost === 'guide' ? 'Review with your guide — your agent is answering' : 'Agent Check — your agent is answering') : isReview ? 'Your review — your agent is answering' : 'Your agent is playing'}</span>}
        </div>
      </div>
    </div>
  );
}
