import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { WS_URL } from '../constants.js';

export function useInstructorSocket(userId) {
  const socketRef = useRef(null);

  useEffect(() => {
    if (!userId) return;
    const socket = io(WS_URL, { withCredentials: true, transports: ['websocket', 'polling'], auth: { portal: 'admin' } });
    socketRef.current = socket;
    socket.on('connect', () => {
      socket.emit('subscribe-notifications', userId);
    });
    return () => socket.disconnect();
  }, [userId]);

  const on   = (ev, cb) => { socketRef.current?.on(ev, cb); };
  const off  = (ev, cb) => { socketRef.current?.off(ev, cb); };
  const emit = (ev, data) => { socketRef.current?.emit(ev, data); };

  return { on, off, emit };
}
