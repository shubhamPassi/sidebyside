import { useEffect, useRef, useState } from 'react';
import type { Room, Session } from './types';
import { acceptSnapshot } from './sync';
import { trace } from './diagnostics';
export function useRoom(session: Session | null) {
  const [room, setRoom] = useState<Room | null>(null); const [connection, setConnection] = useState('connecting'); const [error, setError] = useState(''); const [force, setForce] = useState(0);
  const socket = useRef<WebSocket | null>(null); const current = useRef<Room | null>(null); const offset = useRef(0);
  useEffect(() => {
    if (!session) return; let stopped = false; let timer: ReturnType<typeof setTimeout>; let attempt = 0; let bestRtt = Infinity;
    current.current = null; setRoom(null);
    function connect() {
      bestRtt = Infinity;
      setConnection(attempt ? 'reconnecting' : 'connecting');
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/socket`); socket.current = ws;
      ws.onopen = () => { ws.send(JSON.stringify({ type: 'hello', ...session })); ws.send(JSON.stringify({ type: 'ping', sent: Date.now() })); };
      ws.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === 'snapshot' && acceptSnapshot(current.current, message.room)) {
          trace('snapshot', { revision: message.room.timeline.revision, playing: message.room.timeline.playing, force: !!message.force });
          if (!current.current) offset.current = message.room.serverNow - Date.now();
          current.current = message.room; setRoom(message.room); setConnection('connected'); attempt = 0;
          if (message.force) setForce(x => x + 1);
        }
        if (message.type === 'error') { setError(message.error); if (!current.current) { stopped = true; setConnection('ended'); ws.close(); } }
        if (message.type === 'ended') { setError(message.error); stopped = true; setConnection('ended'); }
        if (message.type === 'pong' && typeof message.sent === 'number') { const rtt = Date.now() - message.sent; if (rtt < bestRtt) { bestRtt = rtt; offset.current = message.serverNow - (message.sent + rtt / 2); } }
      };
      ws.onclose = event => { trace('socket-close', { code: event.code }); if (stopped) return; if (event.code === 4002 || event.code === 4003) { stopped = true; setConnection('ended'); setError(event.code === 4002 ? 'This room was opened in another tab. Return to that tab or rejoin here.' : 'This room is no longer available.'); return; } setConnection('reconnecting'); timer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 15000)); };
      ws.onerror = () => ws.close();
    }
    connect();
    const ping = setInterval(() => { if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'ping', sent: Date.now() })); }, 2500);
    return () => { stopped = true; clearTimeout(timer); clearInterval(ping); socket.current?.close(); };
  }, [session]);
  function send(msg: Record<string, unknown>) { if (connection !== 'connected' || socket.current?.readyState !== WebSocket.OPEN) { setError('Reconnect before changing the room.'); return; } socket.current.send(JSON.stringify({ ...msg, eventId: crypto.randomUUID() })); }
  return { room, connection, error, setError, send, offset, force };
}
