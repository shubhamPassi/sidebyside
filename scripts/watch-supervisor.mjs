import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = path.join(root, '.local');
await fs.mkdir(local, { recursive: true });
const configPath = path.join(local, 'watch-config.json');
let config;
try { config = JSON.parse(await fs.readFile(configPath, 'utf8')); }
catch { console.error('Watch setup is incomplete. Run scripts/setup-watch.ps1 first.'); process.exit(1); }
if (!/^watch\.[a-z0-9.-]+$/.test(config.hostname) || !path.isAbsolute(config.cloudflaredPath) || !path.isAbsolute(config.tokenFile)) {
  console.error('Invalid local watch configuration.'); process.exit(1);
}
await fs.access(config.tokenFile); await fs.access(config.cloudflaredPath); await fs.access(path.join(root, 'dist', 'index.html'));
const lockPath = path.join(local, 'supervisor.lock');
try {
  const previous = Number(await fs.readFile(lockPath, 'utf8'));
  if (Number.isInteger(previous) && previous > 0) { try { process.kill(previous, 0); console.log('Watch supervisor is already running.'); process.exit(0); } catch {} }
  await fs.unlink(lockPath);
} catch (e) { if (e.code !== 'ENOENT') throw e; }
const lock = await fs.open(lockPath, 'wx'); await lock.writeFile(String(process.pid)); await lock.close();
await fs.rm(path.join(local, 'stop-request'), { force: true });
const logs = path.join(local, 'logs'); await fs.mkdir(logs, {recursive:true});
const children = new Map(); const retries = new Map(); let stopping = false; const timers = new Set();
const statePath = path.join(local, 'runtime.json');
async function saveState() { await fs.writeFile(statePath, JSON.stringify({ pid: process.pid, hostname: config.hostname, startedAt: started, children: Object.fromEntries([...children].map(([k,v]) => [k,v.pid])) }, null, 2)); }
const started = new Date().toISOString();
function launch(name, executable, args, env) {
  if (stopping) return;
  const child = spawn(executable, args, { cwd:root, env, windowsHide:true, stdio:['ignore','pipe','pipe'] }); children.set(name,child);
  const output = createWriteStream(path.join(logs, `${name}.log`), {flags:'a'});
  output.write(`\n[${new Date().toISOString()}] Starting ${name}\n`); child.stdout.pipe(output,{end:false}); child.stderr.pipe(output,{end:false});
  const reset = setTimeout(()=>retries.set(name,0),60000); timers.add(reset);
  let handled = false;
  function retry(message) {
    if (handled) return; handled=true; children.delete(name); clearTimeout(reset); timers.delete(reset); output.end(`[${new Date().toISOString()}] ${message}\n`);
    if (stopping) return; saveState().catch(()=>{}); const attempt=(retries.get(name)||0)+1; retries.set(name,attempt);
    const timer=setTimeout(()=>{timers.delete(timer);launch(name,executable,args,env);},Math.min(1000*2**Math.min(attempt,5),30000));timers.add(timer);
  }
  child.once('error',e=>retry(`Start failed: ${e.code || 'unknown error'}`));child.once('exit',code=>retry(`Exited (${code})`)); saveState().catch(()=>{});
}
async function stop() {
  if(stopping)return;stopping=true;clearInterval(poll);for(const timer of timers)clearTimeout(timer);
  const exits=[...children.values()].map(child=>new Promise(resolve=>{child.once('exit',resolve); if(child.exitCode!==null)resolve(); else child.kill();}));
  await Promise.race([Promise.all(exits),new Promise(resolve=>setTimeout(resolve,3000))]);
  await fs.rm(lockPath,{force:true});await fs.rm(statePath,{force:true});await fs.rm(path.join(local,'stop-request'),{force:true});process.exit(0);
}
const poll=setInterval(async()=>{try{await fs.access(path.join(local,'stop-request'));await stop();}catch{}},1000);
process.on('SIGINT',stop);process.on('SIGTERM',stop);
launch('app',process.execPath,['server/index.js'],{...process.env,PORT:'3001',BIND_HOST:'127.0.0.1',PUBLIC_ORIGIN:`https://${config.hostname},http://localhost:3001,http://127.0.0.1:3001`});
const tunnelEnv={...process.env};delete tunnelEnv.TUNNEL_TOKEN;delete tunnelEnv.TUNNEL_TOKEN_FILE;
launch('tunnel',config.cloudflaredPath,['tunnel','--no-autoupdate','run','--token-file',config.tokenFile],tunnelEnv);
