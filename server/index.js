import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { Rooms } from './rooms.js';

export function createApp(options = {}) {
  const rooms = options.rooms || new Rooms(); const app = express(); const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 }); const clients = new Map(); const limits = new Map();
  const allowed = process.env.PUBLIC_ORIGIN?.split(',').map(x => x.trim());
  const validOrigin = (req) => { const origin = req.headers.origin; return origin && (allowed ? allowed.includes(origin) : [`http://${req.headers.host}`, `https://${req.headers.host}`].includes(origin)); };
  function rate(key, max, period = 60000) { const now = Date.now(); let v = limits.get(key); if (!v || now > v.until) { v = { count: 0, until: now + period }; limits.set(key, v); } if (++v.count > max) throw new Error('Too many requests. Please wait a moment.'); }
  app.disable('x-powered-by');
  app.use((req, res, next) => { res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube.com; img-src 'self' data: https://i.ytimg.com; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss: https://www.youtube.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"); next(); });
  app.use(express.json({ limit: '4kb' }));
  app.get('/api/health', (_, res) => res.json({ ok: true }));
  const credentials = ({ room, member }) => ({ roomId: room.id, credential: member.credential, memberId: member.id });
  app.post('/api/rooms', (req, res) => { try { if (!validOrigin(req)) throw new Error('Open the app from its configured web address.'); rate(`http:${req.socket.remoteAddress}`, 20); res.json(credentials(rooms.create(req.body.nickname))); } catch (e) { res.status(400).json({ error: e.message }); } });
  app.post('/api/rooms/:id/join', (req, res) => { try { if (!validOrigin(req)) throw new Error('Open the app from its configured web address.'); rate(`http:${req.socket.remoteAddress}`, 20); const result = rooms.join(req.params.id, req.body.invite, req.body.nickname); res.json(credentials(result)); broadcast(result.room); } catch (e) { res.status(400).json({ error: e.message }); } });
  function send(ws, data) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
  function broadcast(room) { for (const [ws, info] of clients) if (info.room.id === room.id) { if (!room.members.includes(info.member)) { send(ws, { type: 'ended', error: 'Your access to this room was removed.' }); ws.close(4003); } else send(ws, { type: 'snapshot', room: rooms.snapshot(room) }); } }
  server.on('upgrade', (req, socket, head) => { if (req.url !== '/socket' || !validOrigin(req)) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; } try { rate(`ws:${req.socket.remoteAddress}`, 60); } catch { socket.destroy(); return; } wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws)); });
  wss.on('connection', ws => {
    let alive = true; ws.on('pong', () => alive = true);
    const heartbeat = setInterval(() => { if (!alive) return ws.terminate(); alive = false; ws.ping(); }, 15000);
    const authTimeout = setTimeout(() => { if (!clients.has(ws)) ws.close(4001); }, 5000);
    ws.on('message', raw => { let playbackCommand = false; try {
      rate(ws, 100, 10000); const msg = JSON.parse(raw.toString()); if (!msg || typeof msg !== 'object') throw new Error('Invalid message.');
      playbackCommand = msg.type === 'control';
      if (!clients.has(ws)) {
        if (msg.type !== 'hello') throw new Error('Join the room first.');
        const info = rooms.auth(msg.roomId, msg.credential);
        for (const [other, v] of clients) if (v.member.id === info.member.id) { clients.delete(other); other.close(4002, 'Connected in another tab'); }
        clients.set(ws, info); clearTimeout(authTimeout); info.member.online = true; info.member.status = 'preparing'; info.room.touched = Date.now(); if (info.room.timeline.playing) rooms.pause(info.room, `${info.member.nickname} reconnected — preparing player`); broadcast(info.room); return;
      }
      const info = clients.get(ws); rooms.auth(info.room.id, info.member.credential);
      if (msg.type === 'ping') { send(ws, { type: 'pong', sent: msg.sent, serverNow: Date.now() }); return; }
      if (msg.type === 'resync') { send(ws, { type: 'snapshot', room: rooms.snapshot(info.room), force: true }); return; }
      if (msg.type === 'chat') rate(`chat:${info.member.id}`, 6, 10000);
      if (msg.type === 'source') rate(`source:${info.member.id}`, 5, 10000);
      const outcome = rooms.command(info.room, info.member, msg);
      if (outcome === 'ended') { for (const [other, v] of clients) if (v.room.id === info.room.id) { send(other, { type: 'ended', error: 'The creator ended this room.' }); other.close(4003); } }
      else broadcast(info.room);
    } catch (e) { send(ws, { type: 'error', error: e.message }); const info = clients.get(ws); if (info && rooms.rooms.has(info.room.id)) send(ws, { type: 'snapshot', room: rooms.snapshot(info.room), force: playbackCommand }); } });
    ws.on('close', () => { clearTimeout(heartbeat); clearTimeout(authTimeout); limits.delete(ws); const info = clients.get(ws); clients.delete(ws); if (info && rooms.rooms.has(info.room.id)) { rooms.disconnect(info.room, info.member); broadcast(info.room); } });
    ws.on('error', () => {});
  });
  const cleanup = setInterval(() => { rooms.cleanup(); for (const [key, value] of limits) if (Date.now() > value.until) limits.delete(key); for (const [ws, info] of clients) if (!rooms.rooms.has(info.room.id)) { send(ws, { type: 'ended', error: 'This room expired.' }); ws.close(4003); } }, 60000); cleanup.unref();
  const dist = fileURLToPath(new URL('../dist', import.meta.url)); app.use(express.static(dist)); app.get('/{*path}', (_, res) => res.sendFile(path.join(dist, 'index.html')));
  app.use((err, _req, res, _next) => res.status(400).json({ error: 'Invalid request.' }));
  return { app, server, rooms, close: () => { clearInterval(cleanup); for (const ws of wss.clients) ws.terminate(); wss.close(); server.close(); } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createApp(); server.listen(Number(process.env.PORT) || 3001, '0.0.0.0', () => console.log(`Side by Side listening on http://localhost:${process.env.PORT || 3001}`));
}
