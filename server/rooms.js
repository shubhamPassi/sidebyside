import { randomBytes } from 'node:crypto';
import { parseYouTube } from '../shared/youtube.js';
import { normalizeInviteCode } from '../shared/invite-code.js';
const token = () => randomBytes(24).toString('base64url');
const name = (v) => { if (typeof v !== 'string' || !v.trim() || v.trim().length > 24) throw new Error('Choose a nickname of 1–24 characters.'); return v.trim(); };
export const positionAt = (t, now) => t.position + (t.playing ? Math.max(0, now - t.at) / 1000 : 0);
export class Rooms {
  constructor(now = Date.now) { this.now = now; this.rooms = new Map(); this.interruptions = new WeakMap(); this.codes = new Map(); this.playAcks = new WeakMap(); }
  newCode() { const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let code; do {code=[...randomBytes(8)].map(byte=>alphabet[byte & 31]).join('');}while(this.codes.has(code));return code; }
  deleteRoom(id) { const room=this.rooms.get(id); if(room)this.codes.delete(room.invitationCode);this.rooms.delete(id); }
  create(nickname) {
    if (this.rooms.size >= 1000) throw new Error('The server is busy. Please try again later.');
    const room = { id: token(), invite: token(), invitationCode: this.newCode(), created: this.now(), touched: this.now(), members: [], source: null, sourceRevision: 0, timeline: { revision: 0, position: 0, at: this.now(), playing: false, actor: 'Room created' }, chat: [], locked: false, seen: new Map() };
    room.pendingPlay=null; const member = this.member(nickname, true); room.members.push(member); this.rooms.set(room.id, room);this.codes.set(room.invitationCode,room.id);
    return { room, member };
  }
  member(nickname, owner = false) { return { id: token(), credential: token(), nickname: name(nickname), owner, online: false, status: 'preparing' }; }
  get(id) { const room = this.rooms.get(id); if (!room || this.now() - room.created > 24 * 60 * 60 * 1000 || (!room.members.some(m => m.online) && this.now() - room.touched > 30 * 60 * 1000)) { this.deleteRoom(id); throw new Error('This room expired or has ended. Create a new room.'); } return room; }
  joinCode(code, nickname) { const normalized=normalizeInviteCode(code);const id=this.codes.get(normalized);let room;try{room=this.get(id);}catch{throw new Error('This invitation code is invalid or has expired. Ask your friend for their current code.');}return this.join(room.id,room.invite,nickname); }
  join(id, invite, nickname) {
    const room = this.get(id);
    if (room.invite !== invite || room.locked) throw new Error('This invitation is no longer available. Ask your friend for a new link.');
    if (room.members.length >= 2) throw new Error('This room already has two people.');
    const member = this.member(nickname); room.members.push(member); room.touched = this.now(); if (room.timeline.playing || room.pendingPlay) this.pause(room, `${member.nickname} joined — preparing player`); return { room, member };
  }
  auth(id, credential) { const room = this.get(id); const member = room.members.find(m => m.credential === credential); if (!member) throw new Error('Your room access is no longer valid.'); return { room, member }; }
  snapshot(room) { return { id: room.id, invite: room.invite, invitationCode: room.invitationCode, pendingPlay: room.pendingPlay, source: room.source, sourceRevision: room.sourceRevision, timeline: room.timeline, members: room.members.map(({ credential, ...m }) => m), chat: room.chat, locked: room.locked, serverNow: this.now() }; }
  pause(room, actor) { room.pendingPlay=null;this.playAcks.delete(room);const t = room.timeline; room.timeline = { revision: t.revision + 1, position: positionAt(t, this.now()), at: this.now(), playing: false, actor }; }
  expirePlay(room,id) {if(room.pendingPlay?.id===id){const acked=this.playAcks.get(room)||new Set();for(const m of room.members)if(m.online&&!acked.has(m.id))m.status='needs-interaction';this.pause(room,'Alignment timed out — activate your player, then try Play together again');}}
  disconnect(room, member) { const interruption = { at: this.now(), status: member.status, sourceRevision: room.sourceRevision }; this.interruptions.set(member, interruption); member.online = false; member.status = 'disconnected'; room.touched = this.now(); if(room.pendingPlay)this.pause(room,'Connection interrupted during alignment — try Play together again');return interruption; }
  reconnect(room, member, resume = false, graceMs = 10000, sourceRevision = room.sourceRevision) {
    const interruption = this.interruptions.get(member);
    const canResume = resume && sourceRevision === room.sourceRevision && ((member.online && member.status === 'ready') || (interruption && !interruption.expired && this.now() - interruption.at <= graceMs && interruption.status === 'ready' && interruption.sourceRevision === room.sourceRevision));
    this.interruptions.delete(member); member.online = true; member.status = canResume ? 'ready' : 'preparing'; room.touched = this.now();
    if (!canResume && room.timeline.playing) this.pause(room, `${member.nickname} reconnected — preparing player`);
    return !!canResume;
  }
  expireDisconnect(room, member, interruption) {
    if (!member.online && room.members.includes(member) && this.interruptions.get(member) === interruption) { interruption.expired = true; if (room.timeline.playing) this.pause(room, `${member.nickname} disconnected — waiting`); }
  }
  command(room, member, msg) {
    room.touched = this.now();
    if (typeof msg.eventId !== 'string' || !/^[\w-]{1,80}$/.test(msg.eventId)) throw new Error('Invalid command.');
    if (room.seen.has(`${member.id}:${msg.eventId}`)) return;
    if (!member.online) throw new Error('Reconnect before changing the room.');
    if (msg.type === 'source') {
      room.pendingPlay=null;this.playAcks.delete(room);
      const videoId = parseYouTube(msg.url); room.source = { videoId, url: `https://www.youtube.com/watch?v=${videoId}` }; room.sourceRevision++;
      room.members.forEach(m => m.status = m.online ? 'preparing' : 'disconnected');
      room.timeline = { revision: room.timeline.revision + 1, position: 0, at: this.now(), playing: false, actor: `${member.nickname} chose a video` };
    } else if (msg.type === 'status') {
      if (msg.sourceRevision !== room.sourceRevision) throw new Error('Video changed. Try again.');
      if (!['ready', 'preparing', 'buffering', 'needs-interaction', 'waiting', 'error'].includes(msg.status)) throw new Error('Invalid player status.');
      member.status = msg.status;
      if (msg.status !== 'ready' && (room.timeline.playing || room.pendingPlay)) this.pause(room, `${member.nickname} needs a moment`);
    } else if(msg.type==='aligned') {
      const pending=room.pendingPlay;if(!pending||msg.playId!==pending.id||msg.sourceRevision!==room.sourceRevision||msg.revision!==pending.revision)throw new Error('Playback preparation changed. Try Play together again.');
      if(this.now()>pending.deadline){this.expirePlay(room,pending.id);throw new Error('Playback alignment timed out. Try again.');}
      if(member.status!=='ready'||typeof msg.position!=='number'||!Number.isFinite(msg.position)||Math.abs(msg.position-pending.position)>.5)throw new Error('Your player has not aligned yet.');
      const acked=this.playAcks.get(room);acked.add(member.id);
      if(room.members.every(m=>m.online&&m.status==='ready'&&acked.has(m.id))){room.pendingPlay=null;this.playAcks.delete(room);room.timeline={revision:room.timeline.revision+1,position:pending.position,at:this.now(),playing:true,actor:'Players aligned — watching together'};}
    } else if (msg.type === 'control') {
      if (!room.source) throw new Error('Choose a video first.');
      if (msg.sourceRevision !== room.sourceRevision || msg.revision !== room.timeline.revision) throw new Error('The room changed; the latest state has been restored. Try again.');
      if (!['play', 'pause', 'seek'].includes(msg.action)) throw new Error('Invalid playback action.');
      if (msg.action === 'play' && !room.members.every(m => m.online && m.status === 'ready')) throw new Error('Everyone in the room needs to be connected and ready.');
      if(msg.action==='play'&&room.pendingPlay)return;
      let position = positionAt(room.timeline, this.now());
      if (msg.action === 'seek') { if (typeof msg.position !== 'number' || !Number.isFinite(msg.position) || msg.position < 0 || msg.position > 86400) throw new Error('Invalid video position.'); position = msg.position; }
      room.pendingPlay=null;this.playAcks.delete(room);
      room.timeline = { revision: room.timeline.revision + 1, position, at: this.now(), playing: msg.action === 'seek' && room.timeline.playing, actor: `${member.nickname} ${msg.action === 'play' ? 'requested play — aligning players first' : msg.action === 'pause' ? 'paused the room' : 'jumped to a new moment'}` };
      if(msg.action==='play'){room.pendingPlay={id:token(),position,revision:room.timeline.revision,sourceRevision:room.sourceRevision,deadline:this.now()+10000};this.playAcks.set(room,new Set());}
    } else if (msg.type === 'chat') {
      if (typeof msg.text !== 'string' || !msg.text.trim() || msg.text.length > 500) throw new Error('Messages must be 1–500 characters.');
      room.chat.push({ id: token(), memberId: member.id, nickname: member.nickname, text: msg.text.trim(), at: this.now() }); room.chat = room.chat.slice(-100);
    } else if (['lock', 'rotate', 'remove', 'end'].includes(msg.type)) {
      if (!member.owner) throw new Error('Only the room creator can do that.');
      if (msg.type === 'lock') room.locked = !room.locked;
      if (msg.type === 'rotate') {room.invite = token();const next=this.newCode();this.codes.delete(room.invitationCode);room.invitationCode=next;this.codes.set(next,room.id);}
      if (msg.type === 'remove') { room.members = room.members.filter(m => m.owner); this.pause(room, 'Guest removed'); }
      if (msg.type === 'end') { this.deleteRoom(room.id); return 'ended'; }
    } else throw new Error('Unknown room command.');
    room.seen.set(`${member.id}:${msg.eventId}`, this.now()); if (room.seen.size > 1000) room.seen.delete(room.seen.keys().next().value);
  }
  cleanup() { for (const id of this.rooms.keys()) { try { this.get(id); } catch {} } }
}
