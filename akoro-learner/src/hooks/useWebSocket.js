import { useEffect } from 'react';
import { API } from '../services/api.js';

/**
 * Connects to the backend WebSocket and registers all
 * alert listeners for live classes, challenges, and decay.
 */
export function useWebSocket({
  setSessions, setChallenges, setBattles, setDecayAlerts,
  setSessionTab, setLiveSubTab, setTab, setToast,
}) {
  useEffect(() => {
    let socket;
    try {
      if (typeof window !== 'undefined' && window.io) {
        socket = window.io(API, { transports: ['websocket', 'polling'], withCredentials: true });

        socket.on('connect', () => {
          // The server joins only rooms for the authenticated socket identity.
          socket.emit('subscribe-student');
          socket.emit('join-student-room');
        });

        socket.on('live_class_starting', alert => {
          setToast(`${alert.title} starts in ${alert.minutesUntil} min!`);
          setSessions(prev => prev.map(s =>
            s.id === alert.sessionId
              ? { ...s, status:'starting-soon', scheduleBucket:'starting-soon',
                  minutesUntil: alert.minutesUntil, nextSession:`in ${alert.minutesUntil} min` }
              : s
          ));
          setSessionTab('live');
          setLiveSubTab('starting-soon');
        });

        socket.on('live_class_live', alert => {
          setToast(`${alert.title} is now LIVE! Join now.`);
          setSessions(prev => prev.map(s =>
            s.id === alert.sessionId
              ? { ...s, status:'live', scheduleBucket:'live', nextSession:'LIVE', joinUrl: alert.joinUrl }
              : s
          ));
          setSessionTab('live');
          setLiveSubTab('starting-soon');
        });

        socket.on('new_challenge', challenge => {
          setToast(`${challenge.challenger} challenged you!`);
          setChallenges(prev => [challenge, ...prev]);
          setTab('challenges');
        });

        socket.on('battle:participant-joined', data => {
          setBattles(prev => prev.map(b => b.id === data.battleId ? { ...b, status:'live' } : b));
        });

        socket.on('battle_accepted', data => {
          setToast(`${data.opponent} accepted your challenge!`);
          setBattles(prev => prev.map(b => b.id === data.battleId ? { ...b, status: data.status } : b));
          socket.emit('join-battle', data.battleId);
        });

        socket.on('join_battle_room', ({ battleId }) => socket.emit('join-battle', battleId));

        socket.on('knowledge_decay_alert', data => {
          if (data.alerts?.length) setDecayAlerts(prev => {
            const seen = new Set(prev.map(a => a.id));
            return [...prev, ...data.alerts.filter(a => !seen.has(a.id))];
          });
        });

        socket.on('subtopic_decay_alert', data => {
          if (data.alerts?.length) setDecayAlerts(prev => {
            const seen = new Set(prev.map(a => a.id));
            return [...prev, ...data.alerts.filter(a => !seen.has(a.id))];
          });
        });
      }
    } catch { /* WS unavailable */ }

    return () => socket?.disconnect?.();
  }, []);
}
