import { test, expect } from '@playwright/test';
import { mockYouTube } from './player-fixture.js';
test('private room UI, shared player, chat, waiting, reconnect and late join',async({browser})=>{
 const aCtx=await browser.newContext();const bCtx=await browser.newContext();const cCtx=await browser.newContext();
 try{
  for(const ctx of [aCtx,bCtx,cCtx]){ await ctx.route('https://www.youtube.com/iframe_api',route=>route.fulfill({contentType:'application/javascript',body:mockYouTube})); await ctx.addInitScript(()=>{const Original=window.WebSocket;window.WebSocket=class extends Original{constructor(...args){super(...args);window.testSocket=this}}}); }
  const a=await aCtx.newPage();const b=await bCtx.newPage();const c=await cCtx.newPage();const errors=[];a.on('pageerror',e=>errors.push(e.message));b.on('pageerror',e=>errors.push(e.message));
  await a.goto('/');await expect(a.getByRole('heading',{name:'Different places. Same moment.'})).toBeVisible();await a.screenshot({path:'test-results/landing.png',fullPage:true});
  await a.getByLabel('What should we call you?').fill('Alice');await a.getByRole('button',{name:'Create a private room'}).click();await expect(a.getByText('A seat for your friend')).toBeVisible();await a.getByText('Room details & invitation').click();const invite=await a.getByLabel('Private invitation — share only with your friend').inputValue();await a.screenshot({path:'test-results/room-empty.png',fullPage:true});
  await a.getByLabel('YouTube video URL').fill('https://evil.example/watch?v=M7lc1UVf-VE');await a.getByRole('button',{name:'Load video'}).click();await expect(a.getByRole('alert')).toContainText('not a YouTube video');await a.getByRole('button',{name:'Dismiss error'}).click();
  await a.getByLabel('YouTube video URL').fill('https://youtu.be/M7lc1UVf-VE');await a.getByRole('button',{name:'Load video'}).click();await a.getByRole('button',{name:'Activate & ready'}).click();await a.getByRole('button',{name:'Play together'}).click();await expect(a.getByText('Watching together',{exact:true})).toBeVisible();
  await b.goto(invite);await b.getByLabel('What should we call you?').fill('Bob');await b.getByRole('button',{name:'Join the room'}).click();await expect(a.getByText('Bob',{exact:true})).toBeVisible();await expect(a.getByRole('button',{name:'Play together'})).toBeDisabled();await b.getByRole('button',{name:'Activate & ready'}).click();await expect(a.getByRole('button',{name:'Play together'})).toBeEnabled();
  await a.getByRole('button',{name:'Play together'}).click();await expect(b.getByText('Watching together',{exact:true})).toBeVisible();await expect.poll(()=>b.evaluate(()=>window.testPlayer.getPlayerState())).toBe(1);
  await a.getByRole('button',{name:'Pause together'}).click();await expect.poll(()=>b.evaluate(()=>window.testPlayer.getPlayerState())).toBe(2);
  await b.evaluate(()=>{window.testStartupDelay=1000;window.testPauseOnSeek=true;window.testPlayer.seekCalls=[]});
  await a.getByRole('button',{name:'Play together'}).click();
  await expect.poll(()=>b.evaluate(()=>window.testPlayer.seekCalls.filter(s=>s.ahead===false).length),{timeout:6000}).toBe(1);
  const positions=await Promise.all([a.evaluate(()=>window.testPlayer.getCurrentTime()),b.evaluate(()=>window.testPlayer.getCurrentTime())]);expect(Math.abs(positions[0]-positions[1])).toBeLessThan(.35);
  await b.waitForTimeout(2000);expect(await b.evaluate(()=>window.testPlayer.seekCalls.filter(s=>s.ahead===false).length)).toBe(1);await expect.poll(()=>b.evaluate(()=>window.testPlayer.getPlayerState())).toBe(1);await expect.poll(()=>a.evaluate(()=>window.testPlayer.getPlayerState())).toBe(1);await b.evaluate(()=>{window.testStartupDelay=0;window.testPauseOnSeek=false});
  await b.getByLabel('Jump to time').fill('1:30');await b.getByRole('button',{name:'Jump',exact:true}).click();await expect.poll(()=>a.evaluate(()=>Math.floor(window.testPlayer.getCurrentTime()))).toBeGreaterThanOrEqual(90);
  // Model a pause whose event was swallowed during command suppression.
  await b.evaluate(()=>{const p=window.testPlayer;p.time=p.getCurrentTime();p.at=Date.now();p.state=2;});
  await expect(a.getByRole('button',{name:'Play together'})).toBeDisabled({timeout:6000});await expect.poll(()=>a.evaluate(()=>window.testPlayer.getPlayerState())).toBe(2);
  await b.getByRole('button',{name:'Activate & ready'}).click();await expect(a.getByRole('button',{name:'Play together'})).toBeEnabled();await a.getByRole('button',{name:'Play together'}).click();
  await b.getByRole('button',{name:'Pause together'}).click();await expect.poll(()=>a.evaluate(()=>window.testPlayer.getPlayerState())).toBe(2);
  // Native provider controls are forwarded, while programmatic callbacks are suppressed.
  await b.waitForTimeout(2000);await b.evaluate(()=>window.testPlayer.seekTo(210,true));await expect.poll(()=>a.evaluate(()=>Math.floor(window.testPlayer.getCurrentTime()))).toBe(210);
  await b.waitForTimeout(2000);await b.evaluate(()=>window.testPlayer.playVideo());await expect(a.getByText('Watching together',{exact:true})).toBeVisible();await b.waitForTimeout(2000);await b.evaluate(()=>window.testPlayer.pauseVideo());await expect.poll(()=>a.evaluate(()=>window.testPlayer.getPlayerState())).toBe(2);
  await b.evaluate(()=>window.testPlayer.config.events.onAutoplayBlocked());await expect(a.getByRole('button',{name:'Play together'})).toBeDisabled();await expect(b.getByRole('button',{name:'Activate & ready'})).toBeVisible();await b.getByRole('button',{name:'Activate & ready'}).click();await expect(a.getByRole('button',{name:'Play together'})).toBeEnabled();
  await a.getByLabel('Message your friend').fill('<script>hello friend</script>');await a.getByRole('button',{name:'Send message'}).click();await expect(b.getByRole('log')).toContainText('<script>hello friend</script>');await expect(b.getByRole('log').locator('script')).toHaveCount(0);
  await b.getByRole('button',{name:'Send ❤️'}).click();await expect(a.getByRole('log')).toContainText('❤️');
  await a.getByRole('button',{name:'Play together'}).click();await b.getByRole('button',{name:'Wait for me',exact:true}).click();await expect(a.getByRole('button',{name:'Play together'})).toBeDisabled();await expect(a.getByText('Bob').first()).toBeVisible();await b.getByRole('button',{name:'I’m ready'}).click();await expect(a.getByRole('button',{name:'Play together'})).toBeEnabled();
  await b.evaluate(()=>window.testSocket.close());await expect(a.getByText('Disconnected',{exact:true})).toBeVisible();await expect(b.getByRole('button',{name:'Resync my player'})).toBeEnabled({timeout:15000});await expect(a.getByRole('button',{name:'Play together'})).toBeEnabled();await expect(b.getByRole('log')).toContainText('hello friend');
  await c.goto(invite);await c.getByLabel('What should we call you?').fill('Charlie');await c.getByRole('button',{name:'Join the room'}).click();await expect(c.getByRole('alert')).toContainText('two people');
  await a.screenshot({path:'test-results/room-active.png',fullPage:true});await b.setViewportSize({width:390,height:844});await b.screenshot({path:'test-results/room-mobile.png',fullPage:true});expect(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
  await a.getByRole('button',{name:'Room options'}).click();await a.getByRole('button',{name:'Remove guest',exact:true}).click();await expect(b.getByRole('alert')).toContainText('removed');
 }finally{await aCtx.close();await bCtx.close();await cCtx.close();}
});

test('iPhone path confirms actual playback and stays playing beyond 15 seconds without automatic seeks',async({browser})=>{
 test.setTimeout(60000);
 const desktop=await browser.newContext();const phone=await browser.newContext({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',viewport:{width:390,height:844}});
 try {
  for(const ctx of [desktop,phone]){await ctx.route('https://www.youtube.com/iframe_api',route=>route.fulfill({contentType:'application/javascript',body:mockYouTube}));await ctx.addInitScript(()=>{const Original=window.WebSocket;window.WebSocket=class extends Original{constructor(...args){super(...args);window.testSocket=this}}});}
  const a=await desktop.newPage();const b=await phone.newPage();await a.goto('/');await a.getByLabel('What should we call you?').fill('Laptop');await a.getByRole('button',{name:'Create a private room'}).click();await a.getByText('Room details & invitation').click();const invite=await a.getByLabel('Private invitation — share only with your friend').inputValue();
  await a.getByLabel('YouTube video URL').fill('https://youtu.be/M7lc1UVf-VE');await a.getByRole('button',{name:'Load video',exact:true}).click();await a.getByRole('button',{name:'Activate & ready'}).click();
  await b.goto(invite);await b.getByLabel('What should we call you?').fill('iPhone');await b.getByRole('button',{name:'Join the room'}).click();await expect(b.getByText(/Automatic catch-up seeks are disabled|automatic catch-up seeks are disabled/)).toBeVisible();
  await b.evaluate(()=>window.testStartupDelay=1000);await b.getByRole('button',{name:'Activate & ready'}).click();await expect(a.getByRole('button',{name:'Play together'})).toBeDisabled();await expect(a.getByRole('button',{name:'Play together'})).toBeEnabled({timeout:5000});
  await b.evaluate(()=>{window.testPlayer.seekCalls=[];window.testStartupDelay=1000});await a.getByRole('button',{name:'Play together'}).click();
  await b.waitForTimeout(18000);
  expect(await a.evaluate(()=>window.testPlayer.getPlayerState())).toBe(1);expect(await b.evaluate(()=>window.testPlayer.getPlayerState())).toBe(1);expect(await b.evaluate(()=>window.testPlayer.seekCalls.length)).toBe(1);
  await b.evaluate(()=>window.testSocket.close());await expect(a.getByText('Disconnected',{exact:true})).toBeVisible();await expect(b.getByRole('button',{name:'Resync my player'})).toBeEnabled({timeout:8000});
  expect(await a.evaluate(()=>window.testPlayer.getPlayerState())).toBe(1);expect(await b.evaluate(()=>window.testPlayer.getPlayerState())).toBe(1);expect(await b.evaluate(()=>window.testPlayer.seekCalls.length)).toBe(1);await expect(a.getByText('Watching together',{exact:true})).toBeVisible();
  const diag=await b.evaluate(()=>window.__watchDiagnostics());expect(diag.version).toBe('reconnect-grace-1');expect(diag.events.some(e=>e.event==='sample')).toBe(true);expect(JSON.stringify(diag)).not.toMatch(/credential|invite|memberId/);
 } finally {await desktop.close();await phone.close();}
});

test('join by code from home, rotate invalidates old code, and full/locked rooms explain failure',async({browser})=>{
 const ownerCtx=await browser.newContext();const friendCtx=await browser.newContext();
 try{
  const a=await ownerCtx.newPage();const b=await friendCtx.newPage();await a.goto('/');await a.getByLabel('What should we call you?').fill('Code host');await a.getByRole('button',{name:'Create a private room'}).click();await expect(a.getByRole('region',{name:'Room invitation code'})).toBeVisible();const old=await a.locator('.invitation-code').innerText();expect(old).toMatch(/^[0-9]{4}$/);
  await a.getByRole('button',{name:'Room options'}).click();await a.getByRole('button',{name:'Replace link & code',exact:true}).click();await expect(a.locator('.invitation-code')).not.toHaveText(old);const current=await a.locator('.invitation-code').innerText();
  await b.goto('/');await b.getByRole('button',{name:'Join with code',exact:true}).click();await b.getByLabel('What should we call you?').fill('Code friend');await b.getByLabel('Invitation code',{exact:true}).fill(old);await b.getByRole('button',{name:'Join the room',exact:true}).click();await expect(b.getByRole('alert')).toContainText('invalid or has expired');
  await a.getByRole('button',{name:'Room options'}).click();await a.getByRole('button',{name:'Lock invitation',exact:true}).click();await b.getByLabel('Invitation code',{exact:true}).fill(current.toLowerCase());await b.getByRole('button',{name:'Join the room',exact:true}).click();await expect(b.getByRole('alert')).toContainText('no longer available');
  await a.getByRole('button',{name:'Room options'}).click();await a.getByRole('button',{name:'Unlock invitation',exact:true}).click();await b.getByRole('button',{name:'Join the room',exact:true}).click();await expect(a.getByText('Code friend',{exact:true})).toBeVisible();await expect(b.getByRole('heading',{name:'Let’s watch something.'})).toBeVisible();await b.setViewportSize({width:390,height:844});expect(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await b.screenshot({path:'test-results/invitation-code-mobile.png',fullPage:true});await a.screenshot({path:'test-results/invitation-code-room.png',fullPage:true});
 }finally{await ownerCtx.close();await friendCtx.close();}
});

test('ready button resyncs both paused players before play and waits for a delayed alignment',async({browser})=>{
 const ownerCtx=await browser.newContext();const friendCtx=await browser.newContext();
 try{
  for(const ctx of [ownerCtx,friendCtx])await ctx.route('https://www.youtube.com/iframe_api',r=>r.fulfill({contentType:'application/javascript',body:mockYouTube}));
  const a=await ownerCtx.newPage();const b=await friendCtx.newPage();await a.goto('/');await a.getByLabel('What should we call you?').fill('Prepare A');await a.getByRole('button',{name:'Create a private room'}).click();await a.getByText('Room details & invitation').click();const invite=await a.getByLabel('Private invitation — share only with your friend').inputValue();
  await a.getByLabel('YouTube video URL').fill('https://youtu.be/M7lc1UVf-VE');await a.getByRole('button',{name:'Load video',exact:true}).click();await a.getByRole('button',{name:'Activate & ready'}).click();await b.goto(invite);await b.getByLabel('What should we call you?').fill('Prepare B');await b.getByRole('button',{name:'Join the room'}).click();await b.getByRole('button',{name:'Activate & ready'}).click();await expect(a.getByRole('button',{name:'Play together'})).toBeEnabled();
  await a.getByLabel('Jump to time').fill('1:30');await a.getByRole('button',{name:'Jump',exact:true}).click();await expect.poll(()=>b.evaluate(()=>window.testPlayer.getCurrentTime())).toBe(90);
  await a.evaluate(()=>{window.testPlayer.time=20;window.testPlayer.at=Date.now();window.testPlayer.calls=[]});await b.evaluate(()=>{window.testPlayer.time=5;window.testPlayer.at=Date.now();window.testPlayer.calls=[];window.testAlignmentDelay=1500});
  await a.getByRole('button',{name:'I’m ready',exact:true}).click();await expect(a.getByText('Aligning players…',{exact:true})).toBeVisible();await expect(a.getByRole('button',{name:'Play together'})).toBeDisabled();
  await a.waitForTimeout(500);expect(await a.evaluate(()=>window.testPlayer.getPlayerState())).toBe(2);expect(await b.evaluate(()=>window.testPlayer.getPlayerState())).toBe(2);expect(await a.evaluate(()=>window.testPlayer.calls.filter(c=>c.method==='play').length)).toBe(0);
  await expect(a.getByText('Watching together',{exact:true})).toBeVisible();await expect.poll(()=>b.evaluate(()=>window.testPlayer.getPlayerState())).toBe(1);
  for(const page of [a,b]){const calls=await page.evaluate(()=>window.testPlayer.calls);const playIndex=calls.findIndex(c=>c.method==='play');expect(playIndex).toBeGreaterThan(0);expect(calls.slice(0,playIndex).some(c=>c.method==='seek-complete'&&c.position===90)).toBe(true);expect(calls[playIndex].position).toBeCloseTo(90,0);}
 }finally{await ownerCtx.close();await friendCtx.close();}
});
