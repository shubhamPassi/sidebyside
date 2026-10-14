import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedPosition, acceptSnapshot } from '../src/sync.ts';
test('client clock offset compensates delayed snapshots and paused time stays fixed',()=>{
 const timeline={revision:4,position:70,at:10000,playing:true,actor:'A'};
 for(const latency of [50,150,300]) assert.equal(expectedPosition(timeline,2000,8000+latency),70+latency/1000);
 assert.equal(expectedPosition({...timeline,playing:false},2000,90000),70);
 assert.equal(expectedPosition(timeline,-2000,9000),70);
});
test('client ignores obsolete source and timeline revisions including delayed reconnect events',()=>{
 const state=(sourceRevision,revision)=>({sourceRevision,timeline:{revision,position:0,at:0,playing:false,actor:'A'}});
 assert.equal(acceptSnapshot(null,state(1,1)),true);
 assert.equal(acceptSnapshot(state(2,5),state(1,20)),false);
 assert.equal(acceptSnapshot(state(2,5),state(2,4)),false);
 assert.equal(acceptSnapshot(state(2,5),state(2,5)),true);
 assert.equal(acceptSnapshot(state(2,5),state(3,6)),true);
});
