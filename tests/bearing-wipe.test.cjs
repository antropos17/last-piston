'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Engine,pistonGeometry}=require('../src/internals.js');
const STEP=1/120;

function start(clog){
 const m=new Engine();
 m.setProfile('normal');
 m.requestStart();
 for(let i=0;i<4*120;i++)m.step(STEP,0);
 m.drainEvents();
 m.oilCircuit.pickupClog=clog;
 return m;
}

test('A starved loaded rod bearing scores progressively, heats and sheds one capture-sized shell sliver',()=>{
 const clean=start(0),blocked=start(1);
 const journal=blocked.cylinders[1].contact;
 let partial=0,initialCloggedDrag=0,maxDrag=0,shard=null,tearCount=0;
 for(let i=0;i<52*120;i++){
  clean.step(STEP,.78,.32);
  blocked.step(STEP,.78,.32);
  if(journal.bearingWipe<1)partial=Math.max(partial,journal.bearingWipe);
  if(i<120)initialCloggedDrag=Math.max(initialCloggedDrag,blocked.bearingBoundaryNm);
  maxDrag=Math.max(maxDrag,blocked.bearingBoundaryNm);
  for(const event of blocked.drainEvents()){
   if(event.type!=='bearingWipe'||event.cylinder!==1)continue;
   tearCount++;
   shard=blocked.fragments.bodies.find(p=>p.kind==='bearing'&&p.cylinder===1&&p.r<=3.2);
  }
 }
 assert.equal(initialCloggedDrag,0);
 assert.ok(partial>.35&&partial<1);
 assert.equal(journal.bearingWipe,1);
 assert.equal(tearCount,1);
 assert.equal(shard?.zone,'case');
 assert.ok(shard.r>1.4&&shard.r<=3.2);
 assert.ok(journal.bearingTemp>clean.cylinders[1].contact.bearingTemp+35);
 assert.ok(maxDrag>2&&blocked.fragments.dust>0);
 assert.ok(clean.cylinders.every(c=>c.contact.bearingWipe===0));
 assert.equal(clean.bearingBoundaryNm,0);
 assert.equal(blocked.ignition,'running');
 assert.ok(blocked.activeCount>=1);

 const state=JSON.parse(JSON.stringify(blocked.snapshot()));
 const loaded=Engine.restore(state);
 assert.equal(loaded.cylinders[1].contact.bearingWipe,1);
 assert.ok(loaded.log.some(e=>e.type==='bearingWipe'&&e.cylinder===1));
 loaded.requestStop();
 for(let i=0;i<8*120;i++)loaded.step(STEP,0);
 assert.equal(loaded.cylinders[1].contact.bearingWipe,1);
 assert.equal(loaded.bearingBoundaryNm,0);

 delete state.cylinders[1].contact.bearingWipe;
 const old=Engine.restore(state);
 assert.equal(old.cylinders[1].contact.bearingWipe,0);
 assert.ok(!old.log.some(e=>e.type==='bearingWipe'&&e.cylinder===1));
});

test('A wiped bearing progressively loses its hot press fit under load and then spins',()=>{
 const blocked=start(.95),clean=start(0),idle=start(.95);
 const d=blocked.cylinders[1].contact;
 let wipeTime,spin,partialGrip=false,earlyKnock=0,lateKnock=0;
 for(let i=0;i<120*120&&!spin;i++){
  blocked.step(STEP,1,.39);clean.step(STEP,1,.39);idle.step(STEP,0);
  clean.drainEvents();idle.drainEvents();
  for(const event of blocked.drainEvents()){
   if(event.cylinder!==1)continue;
   if(event.type==='bearingWipe')wipeTime=event.time;
   else if(event.type==='bearingSpin')spin=event;
   else if(event.type==='bearingKnock'){
    if(i<28*120)earlyKnock=Math.max(earlyKnock,event.level);
    else lateKnock=Math.max(lateKnock,event.level);
   }
  }
  if(d.bearingWipe<1)assert.equal(d.bearingGrip,1);
  partialGrip||=d.bearingGrip>0&&d.bearingGrip<.9;
 }
 assert.ok(spin&&partialGrip&&wipeTime<spin.time);
 assert.ok(d.bearingSpun&&d.bearingGrip===0);
 assert.ok(earlyKnock>0&&lateKnock>earlyKnock+.2);
 assert.ok(blocked.pressure<clean.pressure*.4&&d.bearingTemp>clean.cylinders[1].contact.bearingTemp+70);
 assert.equal(clean.cylinders[1].contact.bearingGrip,1);
 assert.equal(idle.cylinders[1].contact.bearingGrip,1);
 assert.ok(Math.abs(Math.hypot(spin.nx,spin.ny)-1)<1e-9);

 const state=JSON.parse(JSON.stringify(blocked.snapshot()));
 const restored=Engine.restore(state),shell=restored.cylinders[1].contact;
 assert.ok(shell.bearingSpun&&restored.log.some(e=>e.type==='bearingSpin'&&e.cylinder===1));
 assert.equal(shell.bearingSpinAngle,d.bearingSpinAngle);
 const releaseAngle=shell.bearingSpinAngle;
 restored.step(STEP,1,.39);
 assert.notEqual(shell.bearingSpinAngle,releaseAngle);
 restored.requestStop();
 for(let i=0;i<25*120;i++)restored.step(STEP,0);
 assert.equal(restored.rpm,0);
 assert.ok(shell.bearingTemp<d.bearingTemp&&shell.bearingSpun);
 const stoppedAngle=shell.bearingSpinAngle;
 for(let i=0;i<120;i++)restored.step(STEP,0);
 assert.equal(shell.bearingSpinAngle,stoppedAngle);
 assert.ok(!restored.drainEvents().some(e=>e.type==='bearingSpin'&&e.cylinder===1));

 for(const [i,c] of state.cylinders.entries())if(i!==1){c.active=false;c.failure='rod';}
 const last=Engine.restore(state);
 for(let i=0;i<60*120;i++)last.step(STEP,.94,.48);
 assert.equal(last.activeCount,1);
 assert.ok(last.cylinders[1].active&&last.cylinders[1].contact.bearingSpun&&last.rpm>0);

 const legacy=state.cylinders[1].contact;
 for(const key of ['bearingGrip','bearingSpun','bearingSpinAngle'])delete legacy[key];
 const old=Engine.restore(state);
 assert.equal(old.cylinders[1].contact.bearingGrip,1);
 assert.equal(old.cylinders[1].contact.bearingSpun,false);
 assert.equal(old.cylinders[1].contact.bearingSpinAngle,0);
 assert.ok(!old.log.some(e=>e.type==='bearingSpin'&&e.cylinder===1));
});

test('A spun bearing scores the journal and accumulated loaded blows break the rod',()=>{
 const seed=start(0),id=1;
 for(let i=0;i<9;i++){
  const chip=seed.fragments.add(id,'ring','case',381+12*i,542);
  chip.vx=chip.vy=0;
 }
 for(let i=0;i<140*120&&!seed.cylinders[id].contact.bearingSpun;i++){
  seed.step(STEP,1,.40);seed.drainEvents();
 }
 assert.ok(seed.cylinders[id].contact.bearingSpun);
 const atSpin=seed.snapshot(),loaded=Engine.restore(atSpin),idle=Engine.restore(atSpin);
 const cy=loaded.cylinders[id],d=cy.contact;
 const startClearance=d.bearingClearance,firstFragment=loaded.fragments.nextId;
 let early,nearBreak,broken;
 for(let i=0;i<80*120&&cy.active;i++){
  const priorFatigue=d.rodFatigue;
  loaded.step(STEP,1,.40);idle.step(STEP,0);
  idle.drainEvents();
  broken=loaded.drainEvents().find(e=>e.type==='cylinder'&&e.cylinder===id);
  if(!early&&d.journalScoring>.16&&d.rodFatigue<.5&&cy.active)early=d.bearingClearance;
  if(d.rodFatigue>.90&&d.rodFatigue<1&&d.rodFatigue>priorFatigue)nearBreak=loaded.snapshot();
 }
 assert.ok(early>startClearance&&d.bearingClearance>early+.06&&d.journalScoring>=.9);
 assert.ok(broken?.message.includes('после проворота вкладыша')&&cy.failure==='rod'&&!cy.active);
 assert.equal(cy.freeze,loaded.phase);
 assert.equal(cy.gasTorqueNm,0);
 assert.equal(loaded.activeCount,3);
 assert.ok(idle.cylinders[id].active&&idle.cylinders[id].contact.rodFatigue===0);
 assert.ok(idle.cylinders[id].contact.bearingClearance<early);
 const p=pistonGeometry(cy.freeze,id,517);
 assert.ok(loaded.fragments.bodies.some(b=>b.id>=firstFragment&&b.kind==='rod'&&b.cylinder===id&&
  Math.hypot(b.x-p.crankX,b.y-p.crankY)<28));

 const restored=Engine.restore(JSON.parse(JSON.stringify(loaded.snapshot()))),saved=restored.cylinders[id];
 assert.ok(!saved.active&&saved.failure==='rod');
 assert.equal(saved.contact.journalScoring,d.journalScoring);
 assert.equal(saved.contact.bearingClearance,d.bearingClearance);
 assert.equal(saved.contact.rodFatigue,1);
 assert.ok(restored.log.some(e=>e.type==='cylinder'&&e.message===broken.message));

 assert.ok(nearBreak);
 for(const [i,c] of nearBreak.cylinders.entries())if(i!==id){c.active=false;c.failure='rod';}
 const last=Engine.restore(nearBreak),survivor=last.cylinders[id],fired=survivor.fired;
 for(let i=0;i<60*120;i++){
  last.step(STEP,1,.09);
  assert.ok(!last.drainEvents().some(e=>e.type==='cylinder'));
 }
 assert.equal(survivor.contact.rodFatigue,1);
 assert.equal(last.activeCount,1);
 assert.ok(survivor.active&&survivor.fired>fired&&last.rpm>0);

 const oldContact=atSpin.cylinders[id].contact;
 delete oldContact.journalScoring;delete oldContact.rodFatigue;
 oldContact.bearingClearance=200;
 const old=Engine.restore(atSpin).cylinders[id].contact;
 assert.equal(old.journalScoring,0);
 assert.equal(old.bearingClearance,startClearance);
 assert.equal(old.rodFatigue,0);
});
