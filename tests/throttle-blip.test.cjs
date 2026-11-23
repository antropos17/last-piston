'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Engine}=require('../src/internals.js');

test('A snap opening fires once, re-arms on release and stays quiet on a slow sweep or key-off',()=>{
 const m=new Engine(),bursts=[];
 const step=gas=>{
  m.step(1/120,gas);
  bursts.push(...m.drainEvents().filter(e=>e.type==='tipIn'));
 };
 for(let i=0;i<60;i++)step(1);
 m.requestStart();
 for(let i=0;i<450;i++)step(0);
 for(let i=0;i<300;i++)step(i/300);
 assert.equal(bursts.length,0);
 for(let pass=1;pass<=2;pass++){
  for(let i=0;i<90;i++)step(0);
  for(let i=0;i<120;i++)step(.86);
  assert.equal(bursts.length,pass);
  assert.ok(bursts.at(-1).level>.65&&bursts.at(-1).level<=1);
 }
 assert.ok(!m.log.some(e=>e.type==='tipIn'));
});
