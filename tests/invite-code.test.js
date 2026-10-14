import test from 'node:test';
import assert from 'node:assert/strict';
import { Rooms } from '../server/rooms.js';
import { normalizeInviteCode, formatInviteCode } from '../shared/invite-code.js';
import { createApp } from '../server/index.js';
test('invitation codes are unique, normalized and capacity limited',()=>{
 const rooms=new Rooms();const first=rooms.create('Host');const second=rooms.create('Other');assert.notEqual(first.room.invitationCode,second.room.invitationCode);assert.match(first.room.invitationCode,/^[A-HJ-NP-Z2-9]{8}$/);
 const printed=formatInviteCode(first.room.invitationCode);assert.match(printed,/^.{4}-.{4}$/);assert.equal(normalizeInviteCode(printed.toLowerCase()),first.room.invitationCode);
 const joined=rooms.joinCode(` ${printed.toLowerCase()} `,'Friend');assert.equal(joined.room.id,first.room.id);assert.equal(joined.member.owner,false);assert.throws(()=>rooms.joinCode(printed,'Third'),/two people/);
 for(const code of ['1234','IIII-OOOO','ABCD/2345',null,'A'.repeat(33)])assert.throws(()=>normalizeInviteCode(code));
});
test('lock and rotation protect codes; end and expiry remove their lookup entries',()=>{
 let now=1000;const rooms=new Rooms(()=>now);const {room,member}=rooms.create('Host');member.online=true;let sequence=0;const cmd=type=>rooms.command(room,member,{type,eventId:`code-test-${sequence++}`});const oldCode=room.invitationCode;const oldInvite=room.invite;
 cmd('lock');assert.throws(()=>rooms.joinCode(oldCode,'Friend'),/no longer available/);cmd('lock');cmd('rotate');assert.notEqual(room.invitationCode,oldCode);assert.notEqual(room.invite,oldInvite);assert.throws(()=>rooms.joinCode(oldCode,'Friend'),/invalid or has expired/);assert.equal(rooms.codes.has(oldCode),false);
 rooms.joinCode(room.invitationCode,'Friend');cmd('remove');assert.throws(()=>rooms.auth(room.id,'bad-credential'));const last=room.invitationCode;cmd('end');assert.throws(()=>rooms.joinCode(last,'Friend'));assert.equal(rooms.codes.has(last),false);
 const expired=rooms.create('Expired');now+=30*60*1000+1;assert.throws(()=>rooms.joinCode(expired.room.invitationCode,'Friend'),/expired/);assert.equal(rooms.codes.has(expired.room.invitationCode),false);
});
test('code join HTTP endpoint validates origin, works with formatted codes and rate limits guesses',async()=>{
 const app=createApp();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;
 const post=async(body,org=origin)=>{const res=await fetch(origin+'/api/rooms/join-code',{method:'POST',headers:{Origin:org,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,data:await res.json()};};
 try{const {room}=app.rooms.create('Host');assert.equal((await post({code:room.invitationCode,nickname:'Bad'},'https://evil.test')).status,400);const joined=await post({code:formatInviteCode(room.invitationCode).toLowerCase(),nickname:'Friend'});assert.equal(joined.status,200);assert.equal(joined.data.roomId,room.id);assert.ok(joined.data.credential);for(let i=0;i<9;i++)assert.equal((await post({code:'ABCD-2345',nickname:'Guess'})).status,400);assert.match((await post({code:'ABCD-2345',nickname:'Guess'})).data.error,/Too many requests/);}finally{app.close();}
});
