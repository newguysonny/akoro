import React, { useState, useEffect } from 'react';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { useNavigate } from 'react-router-dom';
import { BRAND, GREEN, RED } from '../../constants.js';
import { DHUB_ART } from './dhubArt.js';

function ArtTile({ art, icon, size = 40 }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: 12, flexShrink: 0,
      background: art.grad, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.4, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.25)' }}>
      {icon}
    </span>
  );
}

export default function NowStudying({ onClose }) {
  const { t } = useLang();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [battles, setBattles] = useState([]);
  const [minimizedBattles, setMinimizedBattles] = useState(new Set());
  const [viewFilter, setViewFilter] = useState('active');
  const [toast, setToast] = useState(null);

  useEffect(() => {
    // Load sessions from API
    const loadSessions = async () => {
      try {
        const res = await fetch('/api/student/sessions', { credentials: 'include' });
        const data = await res.json();
        if (data.sessions?.length) setSessions(data.sessions);
      } catch (e) {}
    };
    loadSessions();

    // Load battles
    const loadBattles = async () => {
      try {
        const res = await fetch('/api/battle/my-battles', { credentials: 'include' });
        const data = await res.json();
        if (data.battles?.length) setBattles(data.battles);
      } catch (e) {}
    };
    loadBattles();
  }, []);

  const minimizedCount = minimizedBattles.size;

  const toggleMinimize = (battleId) => {
    setMinimizedBattles(prev => prev.has(battleId) ? new Set(prev.delete(battleId)) : new Set([...prev, battleId]));
  };

  const toggleViewFilter = (filter) => {
    setViewFilter(filter);
  };

  return (
    <div style={{ 
      position: 'fixed', 
      inset: 0, 
      zIndex: 2400, 
      background: 'var(--ak-bg)', 
      display: 'flex', 
      flexDirection: 'column', 
      fontFamily: "'Nunito', sans-serif",
      animation: 'dhubSearchUp .25s cubic-bezier(.32,1,.64,1)' 
    }}>
      <style>{`
        @keyframes dhubSearchUp{from{transform:translateY(24px);opacity:0}to{transform:translateY(0);opacity:1}}
      `}</style>

      {/* Header: minimize button + title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px 10px', background: 'var(--ak-surface)', borderBottom: '1px solid var(--ak-border)' }}>
        <button onClick={onClose} aria-label={t('dhub.search_back')} title={t('dhub.search_back')}
          style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
            background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--ak-text)' }}>{t('now_studying')}</span>
        <div style={{ flex: 1, textAlign: 'right' }}>
          <button onClick={() => setMinimizedBattles(new Set())} style={{ padding: '6px 12px', borderRadius: '20px', background: minimizedCount > 0 ? `${BRAND}10` : 'var(--ak-surface)', border: minimizedCount > 0 ? `${BRAND}20` : '1px solid var(--ak-border)', color: minimizedCount > 0 ? BRAND : 'var(--ak-text)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            {minimizedCount === 0 ? t('battles.show_minimized') : `${minimizedCount} ${t('battles.minimized'}`)}
          </button>
        </div>
      </div>

      {/* Minimized battles count */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 16px 8px' }}>
        <span style={{ fontSize: 12, color: 'var(--ak-text-muted)' }}>Minimized: </span>
        <span style={{ fontSize: 12, color: BRAND }}>{minimizedCount}</span>
      </div>

      {/* Sessions section */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 16px 90px' }}>
        {!sessions.length && <div style={{ textAlign: 'center', padding: '20px 10x' }}><span style={{ fontSize: 32 }}>📚</span><p>{t('dhub.no_sessions')}</p></div>}

        {sessions.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ak-text)', margin: '8px 0 4px' }}>
              {t('dhub.card_sessions')}
            </h3>
            {sessions.slice(0, 5).map((session) => (
              <div key={session.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--ak-border)', cursor: 'pointer' }}>
                <ArtTile art={DHUB_ART.notes} icon={'📚'} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.topic || session.title}</div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--ak-text-muted)' }}>{session.type || 'session'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Battles section */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 16px 90px' }}>
        {!battles.length && minimizedCount === 0 && <div style={{ textAlign: 'center', padding: '20x 10x' }}><span style={{ fontSize: 32 }}>⚔️</span><p>{t('battles.empty')}</p></div>}

        {battles.length > 0 || minimizedCount > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ak-text)', margin: '8px 0 4px' }}>
              {t('battles.battles')}
            </h3>

            {/* Battles filter tabs */}
            <div style={{ display: 'flex', marginBottom: 12, borderBottom: '1px solid var(--ak-border)' }}>
              <button onClick={() => setViewFilter('active')} style={{ padding: '8px 16px', borderRadius: '20px 20px 0 0', background: viewFilter==='active' ? `${RED}10` : 'var(--ak-surface)', border: viewFilter==='active' ? `${RED}20` : '1px solid var(--ak-border)', color: viewFilter==='active' ? RED : 'var(--ak-text)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                {t('battles.active')}
              </button>
              <button onClick={() => setViewFilter('scheduled')} style={{ padding: '8px 16px', borderRadius: '0 20px', background: viewFilter==='scheduled' ? `${BRAND}10` : 'var(--ak-surface)', border: viewFilter==='scheduled' ? `${BRAND}20` : '1px solid var(--ak-border)', color: viewFilter==='scheduled' ? BRAND : 'var(--ak-text)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                {t('battles.scheduled')}
              </button>
              <button onClick={() => setViewFilter('completed')} style={{ padding: '8px 16px', borderRadius: '0 0 20px', background: viewFilter==='completed' ? `${GREEN}10` : 'var(--ak-surface)', border: viewFilter==='completed' ? `${GREEN}20` : '1px solid var(--ak-border)', color: viewFilter==='completed' ? GREEN : 'var(--ak-text)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                {t('battles.completed')}
              </button>
            </div>

            {/* Display battles */}
            {viewFilter === 'active' ? battles.filter(b => b.status === 'live') : viewFilter === 'scheduled' ? battles.filter(b => b.status === 'scheduled') : battles.filter(b => b.status === 'completed')}.map((battle) => {
              const isMinimized = minimizedBattles.has(battle.id);
              const minimizeBtnStyle = isMinimized ? { background: `${BRAND}10`, border: `${BRAND}20`, color: BRAND } : { background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', color: BRAND };
              const minimizeBtnText = isMinimized ? t('battles.show_minimized') : t('battles.minimize');

              return (
                <div key={battle.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--ak-border)', background: isMinimized ? 'var(--ak-surface)' : 'var(--ak-surface)', cursor: 'pointer', transition: 'background .15s' }}>
                  {/* Minimize button */}
                  {isMinimized ? (
                    <div style={{ position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: '50%', background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setMinimizedBattles(prev => prev.has(battle.id) ? prev.delete(battle.id) : new Set([...prev, battle.id])) }>
                      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </div>
                  ) : (
                    <div style={{ position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: '50%', background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setMinimizedBattles(prev => prev.has(battle.id) ? prev.delete(battle.id) : new Set([...prev, battle.id])) }>
                      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </div>
                  )}

                  {/* Battle details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {battle.status === 'live' && (
                        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="RED" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 12 6 18"/></svg>
                      )}
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ak-text)' }}>{battle.title || 'Battle'}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--ak-text-muted)' }}>{battle.xpPrize ? `• ${b.xpPrize}XP` : ''}</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--ak-text-muted)' }}>
                      {battle.challenger && `vs ${battle.challenger}`}
                      {battle.timeLimit && `• ⏱ ${battle.timeLimit}`}
                      {battle.startsIn && `• 🗓 ${battle.startsIn}`}
                    </div>
                  </div>

                  {/* Minimize toggle button */}
                  <button style={{ padding: '6px 12px', borderRadius: '20px', background: minimizeBtnStyle.background, border: minimizeBtnStyle.border, color: minimizeBtnStyle.color, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                    {minimizeBtnText}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && <div style={{ position: 'fixed', bottom: 24, left: 16, background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', padding: '12px 16px', borderRadius: '12px', zIndex: 2401 }}>{{toast}}</div> }

      {/* Close button at bottom */}
      <div style={{ position: 'fixed', bottom: 24, left: 16, right: 16, background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: '20px', padding: '16px', zIndex: 2401, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={{ padding: '8px 24px', borderRadius: '24px', background: BRAND, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
          {t('dhub.close')}
        </button>
      </div>
    </div>
  );
}
