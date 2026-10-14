import test from 'node:test';
import assert from 'node:assert/strict';
import { StartupAlignment } from '../src/startupAlignment.ts';
test('one-second player startup lag catches up once after stable playback',()=>{
 const recovery=new StartupAlignment();recovery.arm(600,0);
 assert.equal(recovery.observe(0,600,1,true,1000),null);
 assert.equal(recovery.observe(.8,600,1.8,true,1800),1.8);
 assert.equal(recovery.observe(1,600,3,true,3000),null);
});
test('negligible drift finishes without a seek; changed duration, waits and expiry skip correction',()=>{
 const make=()=>{const r=new StartupAlignment();r.arm(600,0);return r;};
 const aligned=make();assert.equal(aligned.observe(1,600,1.1,true,1000),null);assert.equal(aligned.observe(1.8,600,1.9,true,1800),null);assert.equal(aligned.observe(2,600,3,true,3000),null);
 for(const args of [[0,30,1,true,1000],[0,600,1,false,1000],[0,600,14,true,14000]]){const r=make();assert.equal(r.observe(...args),null);assert.equal(r.observe(.8,600,1.8,true,1800),null);}
});
test('unstable buffering samples do not seek and large ambiguous drift stays manual',()=>{
 const r=new StartupAlignment();r.arm(600,0);assert.equal(r.observe(0,600,1,true,1000),null);assert.equal(r.observe(0,600,1.8,true,1800),null);assert.equal(r.observe(.8,600,2.6,true,2600),2.6);
 const ad=new StartupAlignment();ad.arm(600,0);assert.equal(ad.observe(0,600,8,true,1000),null);assert.equal(ad.observe(.8,600,8.8,true,1800),null);
});
