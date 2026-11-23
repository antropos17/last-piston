'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Engine,OIL_PICKUP}=require('../src/internals.js');
const h=1/120;
const run=(m,seconds,gas=0,brake=0)=>{
 for(let i=0;i<seconds/h;i++)m.step(h,gas,brake);
};
const start=()=>{
 const m=new Engine();m.requestStart();run(m,4);run(m,5,.82,.25);return m;
};
const piece=(m,kind,zone,x,y)=>{
 const chip=m.fragments.add(0,kind,zone,x,y);chip.vx=chip.vy=0;return chip;
};

test('Wet chips are carried into the pickup in order and gradually cut oil delivery',()=>{
 const m=start(),clean=start(),oil=m.oilCircuit,{x,y}=OIL_PICKUP;
 const edge=piece(m,'edge','case',x+36,y+6);
 const ring=piece(m,'ring','case',x+61,y+5);
 const initialEdgeX=edge.x;
 run(m,.25,.82,.25);
 assert.ok(edge.x<initialEdgeX-2);
 assert.equal(oil.pickupCaptured,0);
 for(let i=0;i<240&&oil.pickupCaptured===0;i++)m.step(h,.82,.25);
 assert.equal(oil.pickupCaptured,1);
 assert.equal(m.fragments.bodies.includes(edge),false);
 assert.equal(m.fragments.bodies.includes(ring),true);
 const firstClog=oil.pickupClog;
 assert.ok(firstClog>0&&firstClog<1);
 run(m,3,.82,.25);run(clean,m.time-clean.time,.82,.25);
 assert.equal(oil.pickupCaptured,2);
 assert.ok(oil.pickupClog>firstClog&&oil.pickupClog<1);
 assert.equal(m.fragments.bodies.includes(ring),false);
 assert.ok(oil.q>0&&oil.q<clean.oilCircuit.q*.91);
 assert.ok(Math.abs(oil.total-m.oil)<1e-9);
 assert.equal(oil.filterLoad,0);

 const saved=JSON.parse(JSON.stringify(m.snapshot())),restored=Engine.restore(saved);
 assert.equal(saved.version,7);
 for(const field of ['pickupClog','pickupCaptured']){
  assert.equal(restored.oilCircuit[field],oil[field]);
  delete saved.oilCircuit[field];
 }
 assert.equal(Engine.restore(saved).oilCircuit.pickupClog,0);
 assert.equal(Engine.restore(saved).oilCircuit.pickupCaptured,0);
});

test('The pickup keeps clear of large and wedged pieces and cannot capture in air or after shutdown',()=>{
 const m=start(),{x,y}=OIL_PICKUP;
 const large=piece(m,'rod','case',x+18,y);
 const wedged=piece(m,'ring','case',x+3,y+4);wedged.jammed=true;
 const chamber=piece(m,'ring','chamber',417,236);
 run(m,2,.82,.25);
 assert.equal(m.oilCircuit.pickupCaptured,0);
 for(const chip of [large,wedged,chamber])assert.ok(m.fragments.bodies.includes(chip));

 const stopped=start();stopped.requestStop();run(stopped,40);
 const low=start();low.oil=.5;
 for(const e of [stopped,low]){
  const edge=piece(e,'edge','case',x+9,y+4);
  run(e,.25);
  assert.ok(e.fragments.bodies.includes(edge));
  assert.equal(e.oilCircuit.pickupCaptured,0);
 }
 assert.equal(stopped.rpm,0);
 assert.ok(low.rpm>0&&low.oil>0&&low.fragments.oilSurface>y+4);
});
