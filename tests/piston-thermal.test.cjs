'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Engine,SKIRT_CRACK_FATIGUE}=require('../src/internals.js');
const DT=1/120;

test('Weak cooling shrinks the loaded skirt clearance and leaves scoring after the piston cools',()=>{
 const start=new Engine();
 start.setProfile('normal');
 start.requestStart();
 for(let i=0;i<480;i++)start.step(DT,0);
 const state=start.snapshot(),healthy=Engine.restore(state),starved=Engine.restore(state);
 starved.oilCircuit.pickupClog=1;
 const d=starved.cylinders[1].contact,c=healthy.cylinders[1].contact;
 let event;
 for(let i=0;i<8400&&!event;i++){
  healthy.step(DT,1,.33);starved.step(DT,1,.33);
  event=starved.drainEvents().find(e=>e.type==='pistonSeize'&&e.cylinder===1);
  if(i===60)assert.ok(d.clearance>.025&&!d.thermalSeized);
 }
 assert.ok(event&&starved.ignition==='running'&&starved.activeCount===4);
 assert.ok(starved.oilCircuit.pistonJets[1].hitFlow<.03&&healthy.oilCircuit.pistonJets[1].hitFlow>.3);
 assert.ok(d.crownTemp>c.crownTemp+22&&d.skirtTemp>c.skirtTemp+12);
 assert.ok(d.clearance<0&&d.thermalSeized&&d.thermalBind>0);
 assert.ok(c.clearance>0&&!c.thermalSeized);
 assert.equal(event.x,starved.skirtContactPoint(starved.cylinders[1]).x);
 assert.equal(event.y,starved.skirtContactPoint(starved.cylinders[1]).y);
 for(let i=0;i<240;i++)starved.step(DT,1,.33);
 const scar=starved.fragments.linerScuffs.find(m=>m.cylinder===1&&m.kind==='skirt'&&m.side===d.thermalSide);
 assert.ok(scar?.depth>0&&scar.top<scar.bottom);
 const restored=Engine.restore(JSON.parse(JSON.stringify(starved.snapshot())));
 assert.ok(restored.cylinders[1].contact.thermalSeized);
 assert.deepEqual(restored.fragments.linerScuffs,starved.fragments.linerScuffs);
 restored.requestStop();
 const scars=structuredClone(restored.fragments.linerScuffs);
 const before=restored.cylinders[1].contact.skirtTemp;
 let released;
 for(let i=0;i<3600&&!released;i++){
  restored.step(DT,0);
  released=restored.drainEvents().find(e=>e.type==='pistonFree'&&e.cylinder===1);
 }
 assert.ok(released&&restored.cylinders[1].active);
 assert.ok(!restored.cylinders[1].contact.thermalSeized&&restored.cylinders[1].contact.clearance>.012);
 assert.ok(restored.cylinders[1].contact.skirtTemp<before-8);
 assert.deepEqual(restored.fragments.linerScuffs,scars);
 assert.ok(Engine.restore(restored.snapshot()).log.some(e=>e.type==='pistonFree'&&e.cylinder===1));
});

test('An older v7 piston restores without a falsely latched skirt',()=>{
 const state=new Engine().snapshot(),d=state.cylinders[1].contact;
 for(const key of ['skirtTemp','clearance','thermalBind','thermalSeized','thermalSide','skirtCycled','skirtFatigue','skirtSide','skirtChips'])delete d[key];
 const contact=Engine.restore(state).cylinders[1].contact;
 assert.ok(Number.isFinite(contact.skirtTemp)&&contact.clearance>0);
 assert.equal(contact.thermalBind,0);
 assert.equal(contact.thermalSeized,false);
 assert.equal(contact.skirtFatigue,0);
 assert.equal(contact.skirtChips,0);
 assert.equal(contact.skirtCycled,false);

 Object.assign(d,{skirtCycled:'true',skirtFatigue:2,skirtSide:0,skirtChips:7});
 const invalid=Engine.restore(state).cylinders[1].contact;
 assert.ok(invalid.skirtFatigue<SKIRT_CRACK_FATIGUE);
 assert.equal(invalid.skirtChips,0);
});

test('Repeated hot skirt contact propagates a lasting crack and sheds physical flakes',()=>{
 const m=new Engine(),steps=seconds=>Math.round(seconds/DT);
 m.setProfile('normal');m.requestStart();
 for(let i=0;i<steps(4);i++)m.step(DT,0);
 // Start with a restricted local nozzle and a clean pickup. All wear and
 // loose pieces below are created by loading and cooling the live engine.
 m.oilCircuit.pistonJets[1].clog=1;
 const d=m.cylinders[1].contact,events=[];
 let flakes=0;
 function advance(gas,brake){
  m.step(DT,gas,brake);
  for(const event of m.drainEvents().filter(e=>e.cylinder===1)){
   events.push(event.type);
   if(event.type!=='skirtChip')continue;
   const flake=m.fragments.bodies.find(p=>p.id===event.fragmentId);
   assert.ok(flake?.kind==='skirt'&&flake.zone==='liner'&&flake.vy>0&&flake.r<=3.2);
   flakes++;
   const saved=Engine.restore(JSON.parse(JSON.stringify(m.snapshot())));
   const skirt=saved.cylinders[1].contact;
   assert.equal(skirt.skirtSide,d.skirtSide);
   assert.equal(skirt.skirtFatigue,d.skirtFatigue);
   assert.equal(skirt.skirtChips,d.skirtChips);
   const restoredFlake=saved.fragments.bodies.find(p=>p.kind==='skirt'&&p.zone==='liner'&&p.cylinder===1&&p.r===flake.r);
   assert.deepEqual([restoredFlake?.x,restoredFlake?.y,restoredFlake?.vx,restoredFlake?.vy],[flake.x,flake.y,flake.vx,flake.vy]);
   assert.ok(saved.log.some(e=>e.type==='skirtChip'&&e.cylinder===1));
  }
 }
 for(let episode=0;episode<4;episode++){
  if(episode===3)m.toggleBenchFault('piston','heat',1);
  for(let i=0;i<steps(90)&&!d.thermalSeized;i++)advance(1,.33);
  assert.ok(d.thermalSeized);
  for(let i=0;i<steps(7);i++)advance(1,.33);
  if(episode===3)m.toggleBenchFault('piston','heat',1);
  for(let i=0;i<steps(30)&&d.thermalSeized;i++)advance(0,0);
  assert.ok(!d.thermalSeized&&d.skirtCycled);
  if(episode===0){
   assert.ok(d.skirtFatigue>0&&d.skirtFatigue<SKIRT_CRACK_FATIGUE);
   assert.equal(d.skirtChips,0);
  }
 }
 assert.equal(events.filter(e=>e==='skirtCrack').length,1);
 assert.ok(events.indexOf('pistonFree')<events.indexOf('skirtCrack'));
 assert.ok(events.indexOf('skirtCrack')<events.indexOf('skirtChip'));
 assert.equal(flakes,3);
 assert.equal(m.activeCount,4);
 assert.ok(m.oilCircuit.pickupClog>0&&m.oilCircuit.pickupClog<1);
 const restored=Engine.restore(m.snapshot());
 assert.equal(restored.oilCircuit.pickupClog,m.oilCircuit.pickupClog);
 assert.equal(restored.cylinders[1].contact.skirtChips,3);
});
