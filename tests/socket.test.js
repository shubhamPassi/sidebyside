import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';
function inbox(ws) { const queue=[]; const waiters=[]; ws.on('message',data=>{const msg=JSON.parse(data); const waiter=waiters.shift(); if(waiter)waiter(msg);else queue.push(msg);}); return async(type)=>{ const deadline=Date.now()+3000; while(Date.now()<deadline){let msg=queue.shift(); if(!msg)msg=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{const index=waiters.indexOf(receive);if(index>=0)waiters.splice(index,1);reject(new Error(`Timed out waiting for ${type}`));},3000);const receive=m=>{clearTimeout(timer);resolve(m)};waiters.push(receive)});if(msg.type===type)return msg;}throw new Error(`Missing ${type}`);}; }
test('HTTP and real WebSocket transport: join, playback, chat, reconnect, stale command, origins',async()=>{
 const app=createApp({reconnectGraceMs:200}); await new Promise(r=>app.server.listen(0,'127.0.0.1',r)); const origin=`http://127.0.0.1:${app.server.address().port}`; const sockets=[];
 try {
  const post=async(route,body,org=origin)=>{const res=await fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:org},body:JSON.stringify(body)});return {status:res.status,data:await res.json()};};
  assert.equal((await post('/api/rooms',{nickname:'Bad'},'https://evil.test')).status,400);
  const {data:host}=await post('/api/rooms',{nickname:'Alice'});
  async function connect(session,resume=false){ const ws=new WebSocket(origin.replace('http','ws')+'/socket',{origin});sockets.push(ws); const next=inbox(ws);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)}); ws.send(JSON.stringify({type:'hello',...session,resume,sourceRevision:resume?1:undefined}));const msg=await next('snapshot');return {ws,next,room:msg.room}; }
  const a=await connect(host);const {data:guest}=await post(`/api/rooms/${host.roomId}/join`,{nickname:'Bob',invite:a.room.invite}); const b=await connect(guest);
  let seq=0; const send=(client,msg)=>client.ws.send(JSON.stringify({...msg,eventId:`event-${seq++}`}));
  send(a,{type:'source',url:'https://youtu.be/M7lc1UVf-VE'});let snap=(await b.next('snapshot')).room; while(!snap.source) snap=(await b.next('snapshot')).room;
  send(a,{type:'status',status:'ready',sourceRevision:snap.sourceRevision});send(b,{type:'status',status:'ready',sourceRevision:snap.sourceRevision}); do {snap=(await b.next('snapshot')).room;}while(!snap.members.every(m=>m.status==='ready'));
  send(b,{type:'control',action:'seek',position:42,revision:snap.timeline.revision,sourceRevision:snap.sourceRevision});do{snap=(await b.next('snapshot')).room;}while(snap.timeline.position!==42);
  send(a,{type:'control',action:'play',revision:snap.timeline.revision,sourceRevision:snap.sourceRevision});do{snap=(await b.next('snapshot')).room;}while(!snap.pendingPlay);assert.equal(snap.timeline.playing,false);const prep=snap.pendingPlay;for(const c of [a,b])send(c,{type:'aligned',playId:prep.id,revision:prep.revision,sourceRevision:snap.sourceRevision,position:prep.position});do{snap=(await b.next('snapshot')).room;}while(!snap.timeline.playing);
  send(b,{type:'chat',text:'Hello together'});do{snap=(await b.next('snapshot')).room;}while(!snap.chat.length);
  b.ws.close();await new Promise(r=>b.ws.once('close',r));const recovered=await connect(guest,true);assert.equal(recovered.room.timeline.playing,true);assert.ok(recovered.room.timeline.position>=42);assert.equal(recovered.room.chat[0].text,'Hello together');assert.equal(recovered.room.members[1].status,'ready');
  send(recovered,{type:'control',action:'seek',position:0,revision:0,sourceRevision:snap.sourceRevision});assert.match((await recovered.next('error')).error,/room changed/);
  assert.equal((await recovered.next('snapshot')).force,true);
  recovered.ws.close();await new Promise(r=>recovered.ws.once('close',r));let stopped;do{stopped=(await a.next('snapshot')).room;}while(stopped.timeline.revision<=snap.timeline.revision||stopped.timeline.playing);const late=await connect(guest,true);assert.equal(late.room.timeline.playing,false);assert.equal(late.room.members[1].status,'preparing');
  const evil=new WebSocket(origin.replace('http','ws')+'/socket',{origin:'https://evil.test'}); await new Promise(resolve=>evil.once('error',resolve));
 }finally{for(const ws of sockets)ws.terminate();app.close();}
});
test('application keepalives prevent false heartbeat termination when protocol pong is absent',async()=>{
 const app=createApp({heartbeatIntervalMs:25});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;let ws;let keepalive;
 try{
  const {room,member}=app.rooms.create('Keepalive test');ws=new WebSocket(origin.replace('http','ws')+'/socket',{origin,autoPong:false});const next=inbox(ws);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)});ws.send(JSON.stringify({type:'hello',roomId:room.id,credential:member.credential}));await next('snapshot');
  keepalive=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'ping',sent:Date.now()}));},10);
  await new Promise(r=>setTimeout(r,180));assert.equal(ws.readyState,WebSocket.OPEN);assert.equal((await next('pong')).type,'pong');
 }finally{clearInterval(keepalive);ws?.terminate();app.close();}
});
