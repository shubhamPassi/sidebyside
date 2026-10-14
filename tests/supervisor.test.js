import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn) { const deadline=Date.now()+15000;while(Date.now()<deadline){try{const value=await fn();if(value)return value;}catch{}await delay(100);}throw new Error('Supervisor check timed out'); }
test('watch supervisor starts both processes, prevents duplicates, restarts a crash and stops cleanly', {timeout:30000}, async()=>{
 const tempRoot=await fs.mkdtemp(path.join(os.tmpdir(),'sidebyside-supervisor-'));let supervisor;
 try {
  for(const dir of ['scripts','server','dist','.local'])await fs.mkdir(path.join(tempRoot,dir));
  await fs.copyFile(new URL('../scripts/watch-supervisor.mjs',import.meta.url),path.join(tempRoot,'scripts','watch-supervisor.mjs'));
  await fs.writeFile(path.join(tempRoot,'dist','index.html'),'test');
  await fs.writeFile(path.join(tempRoot,'server','index.js'),`require('node:fs').writeFileSync('.local/env-check.json',JSON.stringify({origin:process.env.PUBLIC_ORIGIN,bind:process.env.BIND_HOST}));setInterval(()=>{},1000);`);
  await fs.writeFile(path.join(tempRoot,'tunnel'),`setInterval(()=>{},1000);`);
  const tokenFile=path.join(tempRoot,'.local','test-token');await fs.writeFile(tokenFile,'test-token-not-a-credential');
  await fs.writeFile(path.join(tempRoot,'.local','watch-config.json'),JSON.stringify({hostname:'watch.example.com',cloudflaredPath:process.execPath,tokenFile}));
  const read=async()=>JSON.parse(await fs.readFile(path.join(tempRoot,'.local','runtime.json'),'utf8'));
  supervisor=spawn(process.execPath,[path.join(tempRoot,'scripts','watch-supervisor.mjs')],{cwd:tempRoot,stdio:'ignore',windowsHide:true});
  const state=await until(async()=>{const state=await read();return state.children.app&&state.children.tunnel&&state;});
  const env=await until(async()=>JSON.parse(await fs.readFile(path.join(tempRoot,'.local','env-check.json'),'utf8')));assert.equal(env.bind,'127.0.0.1');assert.ok(env.origin.startsWith('https://watch.example.com,'));
  const duplicate=spawn(process.execPath,[path.join(tempRoot,'scripts','watch-supervisor.mjs')],{cwd:tempRoot,stdio:'ignore',windowsHide:true});assert.equal(await new Promise(resolve=>duplicate.once('exit',resolve)),0);
  process.kill(state.children.app);const restored=await until(async()=>{const v=await read();return v.children.app&&v.children.app!==state.children.app&&v;});assert.equal(restored.children.tunnel,state.children.tunnel);
  await fs.writeFile(path.join(tempRoot,'.local','stop-request'),'stop');assert.equal(await new Promise(resolve=>supervisor.once('exit',resolve)),0);supervisor=null;
  await assert.rejects(()=>fs.access(path.join(tempRoot,'.local','supervisor.lock')));await assert.rejects(()=>fs.access(path.join(tempRoot,'.local','runtime.json')));
 } finally { if(supervisor){await fs.writeFile(path.join(tempRoot,'.local','stop-request'),'stop');await delay(3500);supervisor.kill();}assert.ok(path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(tempRoot).startsWith('sidebyside-supervisor-'));await fs.rm(tempRoot,{recursive:true,force:true}); }
});
