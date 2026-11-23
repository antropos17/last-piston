'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Engine,OIL_PICKUP}=require('../src/internals.js');
const DT=1/120;
const X=OIL_PICKUP.x+6;

test('Air mixed into the covered oil pickup cuts pressure and increases bearing wear under load',()=>{
 const start=new Engine();start.setProfile('normal');start.requestStart();
 for(let i=0;i<480;i++)start.step(DT,0);
 start.oil=2.75;start.rpm=3500;
 for(let i=0;i<240;i++)start.step(DT,.66,.45);
 const state=start.snapshot(),clean=Engine.restore(state),foamed=Engine.restore(state);
 let peakAir=0,worstRatio=1;
 for(let i=0;i<2400;i++){
  if(i%5===0)foamed.oilCircuit.pan.aerate(X,.00025,1210);
  clean.step(DT,.66,.45);foamed.step(DT,.66,.45);
  peakAir=Math.max(peakAir,foamed.oilCircuit.pumpAeration);
  worstRatio=Math.min(worstRatio,foamed.pressure/clean.pressure);
 }
 assert.ok(foamed.oilCircuit.pickupSubmerged>.95&&foamed.oilCircuit.inletAir<.02);
 assert.ok(peakAir>.06&&worstRatio<.87);
 assert.ok(foamed.cylinders[1].contact.bearing>clean.cylinders[1].contact.bearing+.003);
 assert.ok(Math.abs(foamed.oilCircuit.total-foamed.oil)<1e-9);
 const loaded=Engine.restore(foamed.snapshot());
 assert.equal(loaded.oilCircuit.pumpAeration,foamed.oilCircuit.pumpAeration);
 assert.ok(Math.abs(loaded.oilCircuit.spray.volume-foamed.oilCircuit.spray.volume)<1e-9);
 for(let i=0;i<1200;i++)loaded.step(DT,.66,.45);
 assert.ok(loaded.oilCircuit.pumpAeration<peakAir*.55);
});
