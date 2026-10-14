import { randomBytes } from 'node:crypto';
import { parseYouTube } from '../shared/youtube.js';
const token = () => randomBytes(24).toString('base64url');
const name = (v) => { if (typeof v !== 'string' || !v.trim() || v.trim().length > 24) throw new Error('Choose a nickname of 1–24 characters.'); return v.trim(); };
export const positionAt = (t, now) => t.position + (t.playing ? Math.max(0, now - t.at) / 1000 : 0);
export class Rooms {
  constructor(now = Date.now) { this.now = now; this.rooms = new Map(); }
  create(nickname) {
    if (this.rooms.size >= 1000) throw new Error('The server is busy. Please try again later.');
    const room = { id: token(), invite: token(), created: this.now(), touched: this.now(), members: [], source: null, sourceRevision: 0, timeline: { revision: 0, position: 0, at: this.now(), playing: false, actor: 'Room created' }, chat: [], locked: false, seen: new Map() };
    const member = this.member(nickname, true); room.members.push(member); this.rooms.set(room.id, room);
    return { room, member };
  }
  member(nickname, owner = false) { return { id: token(), credential: token(), nickname: name(nickname), owner, online: false, status: 'preparing' }; }
  get(id) { const room = this.rooms.get(id); if (!room || this.now() - room.created > 24 * 60 * 60 * 1000 || (!room.members.some(m => m.online) && this.now() - room.touched > 30 * 60 * 1000)) { this.rooms.delete(id); throw new Error('This room expired or has ended. Create a new room.'); } return room; }
  join(id, invite, nickname) {
    const room = this.get(id);
    if (room.invite !== invite || room.locked) throw new Error('This invitation is no longer available. Ask your friend for a new link.');
    if (room.members.length >= 2) throw new Error('This room already has two people.');
    const member = this.member(nickname); room.members.push(member); room.touched = this.now(); if (room.timeline.playing) this.pause(room, `${member.nickname} joined — preparing player`); return { room, member };
  }
  auth(id, credential) { const room = this.get(id); const member = room.members.find(m => m.credential === credential); if (!member) throw new Error('Your room access is no longer valid.'); return { room, member }; }
  snapshot(room) { return { id: room.id, invite: room.invite, source: room.source, sourceRevision: room.sourceRevision, timeline: room.timeline, members: room.members.map(({ credential, ...m }) => m), chat: room.chat, locked: room.locked, serverNow: this.now() }; }
  pause(room, actor) { const t = room.timeline; room.timeline = { revision: t.revision + 1, position: positionAt(t, this.now()), at: this.now(), playing: false, actor }; }
  disconnect(room, member) { member.online = false; member.status = 'disconnected'; room.touched = this.now(); if (room.timeline.playing) this.pause(room, `${member.nickname} disconnected — waiting`); }
  command(room, member, msg) {
    room.touched = this.now();
    if (typeof msg.eventId !== 'string' || !/^[\w-]{1,80}$/.test(msg.eventId)) throw new Error('Invalid command.');
    if (room.seen.has(`${member.id}:${msg.eventId}`)) return;
    if (!member.online) throw new Error('Reconnect before changing the room.');
    if (msg.type === 'source') {
      const videoId = parseYouTube(msg.url); room.source = { videoId, url: `https://www.youtube.com/watch?v=${videoId}` }; room.sourceRevision++;
      room.members.forEach(m => m.status = m.online ? 'preparing' : 'disconnected');
      room.timeline = { revision: room.timeline.revision + 1, position: 0, at: this.now(), playing: false, actor: `${member.nickname} chose a video` };
    } else if (msg.type === 'status') {
      if (msg.sourceRevision !== room.sourceRevision) throw new Error('Video changed. Try again.');
      if (!['ready', 'preparing', 'buffering', 'needs-interaction', 'waiting', 'error'].includes(msg.status)) throw new Error('Invalid player status.');
      member.status = msg.status;
      if (msg.status !== 'ready' && room.timeline.playing) this.pause(room, `${member.nickname} needs a moment`);
    } else if (msg.type === 'control') {
      if (!room.source) throw new Error('Choose a video first.');
      if (msg.sourceRevision !== room.sourceRevision || msg.revision !== room.timeline.revision) throw new Error('The room changed; the latest state has been restored. Try again.');
      if (!['play', 'pause', 'seek'].includes(msg.action)) throw new Error('Invalid playback action.');
      if (msg.action === 'play' && !room.members.every(m => m.online && m.status === 'ready')) throw new Error('Everyone in the room needs to be connected and ready.');
      let position = positionAt(room.timeline, this.now());
      if (msg.action === 'seek') { if (typeof msg.position !== 'number' || !Number.isFinite(msg.position) || msg.position < 0 || msg.position > 86400) throw new Error('Invalid video position.'); position = msg.position; }
      room.timeline = { revision: room.timeline.revision + 1, position, at: this.now(), playing: msg.action === 'play' || (msg.action === 'seek' && room.timeline.playing), actor: `${member.nickname} ${msg.action === 'play' ? 'pressed play' : msg.action === 'pause' ? 'paused the room' : 'jumped to a new moment'}` };
    } else if (msg.type === 'chat') {
      if (typeof msg.text !== 'string' || !msg.text.trim() || msg.text.length > 500) throw new Error('Messages must be 1–500 characters.');
      room.chat.push({ id: token(), memberId: member.id, nickname: member.nickname, text: msg.text.trim(), at: this.now() }); room.chat = room.chat.slice(-100);
    } else if (['lock', 'rotate', 'remove', 'end'].includes(msg.type)) {
      if (!member.owner) throw new Error('Only the room creator can do that.');
      if (msg.type === 'lock') room.locked = !room.locked;
      if (msg.type === 'rotate') room.invite = token();
      if (msg.type === 'remove') { room.members = room.members.filter(m => m.owner); this.pause(room, 'Guest removed'); }
      if (msg.type === 'end') { this.rooms.delete(room.id); return 'ended'; }
    } else throw new Error('Unknown room command.');
    room.seen.set(`${member.id}:${msg.eventId}`, this.now()); if (room.seen.size > 1000) room.seen.delete(room.seen.keys().next().value);
  }
  cleanup() { for (const id of this.rooms.keys()) { try { this.get(id); } catch {} } }
}
