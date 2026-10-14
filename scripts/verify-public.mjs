import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
const origin = new URL(process.argv[2] || 'https://watch.chaigallery.in').origin;
const sessions = []; const sockets = []; let sequence = 0;
function inbox(ws) { const queue=[];const waiting=[];ws.on('message',data=>{const msg=JSON.parse(data);const next=waiting.shift();if(next)next(msg);else queue.push(msg);});return async type=>{for(;;){const msg=queue.shift()||await new Promise((resolve,reject)=>{const receive=m=>{clearTimeout(timer);resolve(m)};const timer=setTimeout(()=>{const i=waiting.indexOf(receive);if(i>=0)waiting.splice(i,1);reject(new Error(`Timeout waiting for ${type}`));},10000);waiting.push(receive);});if(msg.type===type)return msg;}}; }
async function post(route,body,requestOrigin=origin) { const res=await fetch(origin+route,{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});return {status:res.status,body:await res.json()}; }
async function connect(session) { const ws=new WebSocket(origin.replace('https:','wss:').replace('http:','ws:')+'/socket',{origin,handshakeTimeout:10000});sockets.push(ws);const next=inbox(ws);await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});ws.send(JSON.stringify({type:'hello',...session}));return {ws,next,room:(await next('snapshot')).room}; }
function send(client,command) { client.ws.send(JSON.stringify({...command,eventId:`public-check-${sequence++}`})); }
async function until(client,predicate) { for(;;){const msg=await client.next('snapshot');if(predicate(msg.room))return msg.room;} }
let owner;
try {
 const health=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(15000)});assert.equal(health.status,200);assert.equal((await health.json()).ok,true);
 assert.equal((await post('/api/rooms',{nickname:'Origin test'},'https://unauthorized.example')).status,400);
 const created=await post('/api/rooms',{nickname:'Deployment check A'});assert.equal(created.status,200);sessions.push(created.body);owner=await connect(created.body);
 const joined=await post(`/api/rooms/${created.body.roomId}/join`,{nickname:'Deployment check B',invite:owner.room.invite});assert.equal(joined.status,200);sessions.push(joined.body);let friend=await connect(joined.body);
 send(owner,{type:'source',url:'https://youtu.be/M7lc1UVf-VE'});let room=await until(friend,r=>r.source);
 for(const client of [owner,friend])send(client,{type:'status',status:'ready',sourceRevision:room.sourceRevision});room=await until(friend,r=>r.members.every(m=>m.status==='ready'));
 send(friend,{type:'control',action:'seek',position:30,sourceRevision:room.sourceRevision,revision:room.timeline.revision});room=await until(friend,r=>r.timeline.position===30);
 send(owner,{type:'control',action:'play',sourceRevision:room.sourceRevision,revision:room.timeline.revision});room=await until(friend,r=>r.timeline.playing);
 send(friend,{type:'chat',text:'Public tunnel verification'});room=await until(friend,r=>r.chat.length>0);
 friend.ws.close();await new Promise(resolve=>friend.ws.once('close',resolve));friend=await connect(joined.body);assert.equal(friend.room.timeline.playing,false);assert.equal(friend.room.chat[0].text,'Public tunnel verification');assert.ok(friend.room.timeline.position>=30);
 console.log('PASS: public HTTPS, authorized origin, origin rejection, two-person join, WSS, shared seek/play, chat and reconnect recovery.');
 send(owner,{type:'end'});await owner.next('ended');owner=null;console.log('PASS: temporary verification room deleted.');
}finally {if(owner?.ws.readyState===WebSocket.OPEN)send(owner,{type:'end'});for(const ws of sockets)ws.terminate();}
