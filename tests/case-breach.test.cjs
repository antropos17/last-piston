'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Engine,Fragments,OIL_PAN,HOSE_RUPTURE}=require('../src/internals.js');
const DT=1/120;

test('The sump floor opens only after a hard hit from a rod fragment',()=>{
 const world=new Fragments(),floor=OIL_PAN.floor;
 const hit=(kind,speed,normal=-1,y=floor)=>{
  const p=world.add(1,kind,'case',510,y-7);
  p.vx=0;p.vy=speed;
  world.caseContact(p,0,normal,1,'case',510,y);
 };
 hit('rod',350);hit('bearing',850);hit('rod',850,1,417);
 assert.equal(world.caseBreach,null);
 hit('rod',810);
 assert.equal(world.caseBreach.x,510);
 assert.equal(world.caseBreach.cylinder,1);
 assert.deepEqual(Fragments.restore(world.snapshot()).caseBreach,world.caseBreach);
 const saved=world.snapshot();
 assert.equal(Fragments.restore({...saved,caseBreach:{...saved.caseBreach,x:900}}).caseBreach,null);
 delete saved.caseBreach;
 assert.equal(Fragments.restore(saved).caseBreach,null);
});

test('A real rod failure punches the sump and drains oil even after key-off',()=>{
 const m=new Engine();
 m.setProfile('stress');m.requestStart();
 for(let i=0;i<360;i++)m.step(DT,0);
 let puncture;
 for(let i=0;i<60*120&&!puncture;i++){
  m.step(DT,1);
  puncture=m.drainEvents().find(e=>e.type==='caseBreach');
 }
 assert.ok(puncture&&m.cylinders[puncture.cylinder].failure==='rod'&&m.caseLeakRate>.05);
 assert.equal(puncture.y,OIL_PAN.floor);
 const start=m.snapshot(),off=Engine.restore(start),sealed=Engine.restore(start);
 sealed.fragments.caseBreach=null;
 off.requestStop();
 const oilAtImpact=m.oil,pressureAtImpact=m.pressure;
 let smokyBeforeFire=false,fireSave,charredBeforeLeak=false,ruptures=0;
 for(let i=0;i<20*120;i++){
  m.step(DT,1);sealed.step(DT,1);off.step(DT,0);
  const events=m.drainEvents();
  assert.ok(!events.some(e=>e.type==='caseBreach'));
  if(events.some(e=>e.type==='spillFire'))fireSave=m.snapshot();
  if(!fireSave&&m.exhaustSpill.smoke>.35&&!m.exhaustSpill.burning)smokyBeforeFire=true;
  if(m.coolantHose.damage>.1&&m.coolantHose.damage<HOSE_RUPTURE&&m.coolantHose.runoff===0)charredBeforeLeak=true;
  ruptures+=events.filter(e=>e.type==='coolantHose').length;
 }
 assert.ok(m.oil>=0&&m.oil<sealed.oil-1&&m.pressure<sealed.pressure*.4&&m.pressure<pressureAtImpact*.4);
 assert.ok(Math.abs(m.oilCircuit.total-m.oil)<1e-8);
 assert.ok(off.rpm===0&&off.oil<oilAtImpact-1&&off.caseLeakRate>0);
 assert.ok(off.log.some(e=>e.type==='caseBreach'));
 assert.deepEqual(off.fragments.caseBreach,m.fragments.caseBreach);
 assert.ok(smokyBeforeFire&&fireSave);
 assert.ok(charredBeforeLeak&&ruptures===1&&m.coolantHose.runoff>0);
 const damaged=Engine.restore(m.snapshot());
 assert.equal(damaged.coolantHose.damage,m.coolantHose.damage);
 assert.ok(damaged.log.some(e=>e.type==='coolantHose'));
 const lit=Engine.restore(fireSave);
 assert.ok(lit.exhaustSpill.burning&&lit.exhaustSpill.oil>0&&lit.log.some(e=>e.type==='spillFire'));
 const fired=m.cylinders.find(c=>c.active).fired;
 let warped=false,wetBore=false,steam=0,failed;
 for(let i=0;i<60*120;i++){
  m.step(DT,1);
  const d=m.cylinders.find(c=>c.active).contact;
  warped||=d.headWarp>.015&&d.headSeal===0;
  wetBore||=d.boreCoolantFlow>0;
  steam=Math.max(steam,m.exhaust.coolantSteam);
  for(const e of m.drainEvents())if(e.type==='headSeal')failed=e;
 }
 assert.ok(m.oil===0&&m.caseLeakRate===0&&m.pressure<.02);
 assert.ok(!m.exhaustSpill.burning&&m.exhaustSpill.oil===0&&m.exhaustSpill.smoke<.001);
 assert.ok(m.coolantLevel<.1&&m.coolantHose.damage===damaged.coolantHose.damage);
 assert.ok(Math.abs(m.coolantLevel*6-m.waterCircuit.total)<1e-8);
 assert.ok(warped&&failed&&wetBore&&steam>.2);
 const damagedHead=Engine.restore(m.snapshot()).cylinders[failed.cylinder].contact;
 assert.ok(damagedHead.headWarp>.1&&damagedHead.headSeal>.6);
 assert.ok(m.activeCount===1&&m.rpm>0&&m.cylinders.find(c=>c.active).fired>fired);
});

test('Fire along the pipe away from the coolant hose leaves the hose intact',()=>{
 const m=new Engine();
 m.fragments.caseBreach={x:805,cylinder:1,area:.0004};
 Object.assign(m.exhaustSpill,{burning:true,oil:.035,temp:500,soak:1});
 m.exhaust.manifold=500;
 for(let i=0;i<600;i++)m.step(DT,0);
 assert.ok(m.exhaustSpill.burning&&m.coolantHose.damage===0&&m.coolantHose.runoff===0);
 assert.equal(m.coolantLevel,1);
});

test('Fire requires oil actually reaching the pipe and sustained heat',()=>{
 const make=(x,temp)=>{
  const m=new Engine();
  m.fragments.caseBreach={x,cylinder:1,area:.0004};
  m.exhaustSpill.temp=m.exhaust.manifold=temp;
  return m;
 };
 const cold=make(580,100),warm=make(580,330),miss=make(350,535);
 for(const m of [cold,warm,miss])for(let i=0;i<360;i++)m.step(DT,0);
 assert.ok(warm.exhaustSpill.smoke>.1&&!warm.exhaustSpill.burning);
 assert.ok(cold.caseLeakRate>0&&cold.exhaustSpill.oil>0&&cold.exhaustSpill.smoke===0&&!cold.exhaustSpill.burning);
 assert.ok(miss.caseLeakRate>0&&miss.exhaustSpill.oil===0&&miss.exhaustSpill.smoke===0&&!miss.exhaustSpill.burning);
});
