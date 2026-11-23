'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Engine,OilPan,OIL_PAN,OIL_PICKUP}=require('../src/internals.js');
const H=1/120;
const INLET=OIL_PICKUP.x+6;

test('Shared face flux moves real oil without creating volume and colder oil damps the motion',()=>{
 const hot=new OilPan(),cold=new OilPan();
 hot.fillTo(.28);cold.fillTo(.28);
 for(let i=0;i<120;i++){
  hot.step(H,300,.36);
  cold.step(H,300,2.5);
 }
 assert.ok(hot.surfaceAt(INLET)>cold.surfaceAt(INLET)+.3);
 assert.ok(hot.surfaceAt(848)<cold.surfaceAt(848)-.4);
 assert.ok(hot.velocityAt(400)>0);
 for(let i=0;i<750;i++)hot.step(H,0,.36);
 const mean=hot.depths.reduce((sum,h)=>sum+h,0)/hot.depths.length;
 assert.ok(Math.abs(mean-OIL_PAN.depth*.28)<1e-10);
 assert.ok(Math.abs(hot.surfaceAt(INLET)-hot.surfaceAt(848))<.12);
 assert.equal(hot.velocityAt(OIL_PAN.left),0);
 assert.equal(hot.velocityAt(OIL_PAN.right),0);
 hot.fillTo(.06);
 for(let i=0;i<600;i++)hot.step(H,1450,.36);
 assert.ok(hot.depths.every(h=>Number.isFinite(h)&&h>=0));
 assert.ok(Math.min(...hot.depths)<.01);
});

test('Uncovering the pickup at the same oil volume drops gallery pressure and allows re-priming',()=>{
 const engine=new Engine();engine.setProfile('normal');engine.requestStart();
 for(let i=0;i<480;i++)engine.step(H,0);
 engine.oil=2.55;
 for(let i=0;i<240;i++)engine.step(H,0);
 const state=engine.snapshot(),control=Engine.restore(state),sloshed=Engine.restore(state);
 const oil=sloshed.oilCircuit;
 const sumpBefore=oil.cells[0].litres;
 for(let i=0;i<120;i++)oil.pan.step(H,300,.36);
 assert.equal(oil.cells[0].litres,sumpBefore);
 assert.ok(control.oilCircuit.pickupSubmerged>.99&&oil.pickupSubmerged<.02);
 let highestAir=0,lowestPressure=1;
 for(let i=0;i<720;i++){
  sloshed.step(H,0);control.step(H,0);
  highestAir=Math.max(highestAir,oil.inletAir);
  lowestPressure=Math.min(lowestPressure,sloshed.pressure/control.pressure);
  assert.ok(Math.abs(oil.total-sloshed.oil)<1e-9);
 }
 assert.ok(highestAir>.9&&lowestPressure<.55);
 assert.ok(oil.inletAir<.01&&Math.abs(sloshed.pressure-control.pressure)<.015);
 assert.equal(sloshed.fragments.oilSurfaceAt(INLET),oil.surfaceAt(INLET));
});

test('Save v7 keeps a valid wave and reconstructs a level surface for older or malformed saves',()=>{
 const e=new Engine();
 for(let i=0;i<120;i++)e.oilCircuit.pan.step(H,160,.36);
 const saved=JSON.parse(JSON.stringify(e.snapshot()));
 const restored=Engine.restore(saved).oilCircuit;
 assert.notEqual(e.oilCircuit.surfaceAt(INLET),e.oilCircuit.surfaceAt(800));
 assert.deepEqual(restored.pan.snapshot(),e.oilCircuit.pan.snapshot());
 saved.oilCircuit.pan.depths[0]+=3;
 const damaged=Engine.restore(saved).oilCircuit;
 assert.equal(damaged.surfaceAt(INLET),damaged.surfaceAt(800));
 assert.ok(Math.abs(damaged.total-e.oil)<1e-9);
 delete saved.oilCircuit.pan;
 const legacy=Engine.restore(saved).oilCircuit;
 assert.equal(legacy.surfaceAt(INLET),legacy.surfaceAt(800));
});
