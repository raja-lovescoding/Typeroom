import { useEffect, useState } from 'react';
import { CLIENT_EVENTS } from '@typeroom/shared';
import { session } from '../lib/session.js';
import { socket } from '../lib/socket.js';
import '../styles/global.css';

export function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [playerId, setPlayerId] = useState<string>();

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      socket.emit(CLIENT_EVENTS.JOIN_ROOM, {
        username: 'Guest',
        token: session.getToken() ?? undefined,
      }, (response: { playerId?: string; token?: string }) => {
        if (response.playerId) setPlayerId(response.playerId);
        if (response.token) session.setToken(response.token);
      });
    };
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) onConnect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return <main><h1>Typeroom</h1><p>Status: {connected ? 'Connected' : 'Disconnected'}</p><p>Player ID: {playerId ?? 'Connecting...'}</p></main>;
}
