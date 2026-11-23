'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Engine,CHAMBER_CLEARANCE_L}=require('../src/internals.js');
const DT=1/120;

test('A parked leaking cylinder fills up and suffers hydrolock on restart',()=>{
 const source=new Engine();
 source.setProfile('stress');source.requestStart();
 for(let i=0;i<360;i++)source.step(DT,0);
 for(let i=0;i<68*120;i++){source.step(DT,1);source.drainEvents();}
 const m=Engine.restore(source.snapshot()),c=m.cylinders.find(c=>c.active),d=c.contact;
 assert.equal(m.activeCount,1);
 assert.ok(d.headSeal>.2&&d.boreCoolant<CHAMBER_CLEARANCE_L);
 for(let i=0;i<150;i++)m.step(DT,1);
 m.requestStop();
 for(let i=0;i<5*120&&m.rpm>0;i++)m.step(DT,0);
 assert.equal(m.rpm,0);
 // Park with the exhaust valve closed so that coolant can collect.
 m.phase=(c.offset+2.45*Math.PI)%(4*Math.PI);m.refreshCycle();
 for(let i=0;i<35*120;i++)m.step(DT,0);
 assert.equal(m.rpm,0);
 assert.ok(d.boreCoolant>CHAMBER_CLEARANCE_L&&d.plugWet>.9&&d.rodBend===0);
 const filled=Engine.restore(m.snapshot());
 assert.equal(filled.cylinders[c.id].contact.boreCoolant,d.boreCoolant);
 assert.equal(filled.cylinders[c.id].contact.plugWet,d.plugWet);
 const before=d.wetMisses, fired=c.fired;
 m.drainEvents();m.requestStart();
 let hits=0,phaseAtHit,bendSave;
 for(let i=0;i<14*120;i++){
  m.step(DT,0);
  for(const event of m.drainEvents())if(event.type==='hydrolock'){
   hits++;phaseAtHit=c.cycle.stroke;bendSave=m.snapshot();
  }
 }
 assert.equal(hits,1);
 assert.ok(phaseAtHit===3||phaseAtHit===0);
 assert.ok(d.rodBend>.3&&d.wetMisses>before&&c.fired>fired);
 assert.equal(m.ignition,'running');assert.equal(m.activeCount,1);
 assert.ok(Math.abs(m.waterCircuit.total-m.coolantLevel*6)<1e-8);
 const damaged=Engine.restore(bendSave);
 assert.equal(damaged.cylinders[c.id].contact.rodBend,d.rodBend);
 assert.ok(damaged.log.some(e=>e.type==='hydrolock'&&e.cylinder===c.id));

 const bent=Engine.restore(m.snapshot()),straight=Engine.restore(m.snapshot());
 straight.cylinders[c.id].contact.rodBend=0;
 const piston=bent.cylinders[c.id],contact=piston.contact,beforeWear=contact.skewScuff;
 let jam,load=0,reference=0;
 for(let i=0;i<35*120&&!jam;i++){
  bent.step(DT,1,.09);straight.step(DT,1,.09);
  jam=bent.drainEvents().find(e=>e.type==='skewSeize');
  straight.drainEvents();
  load=Math.max(load,bent.skirtBoundaryNm);reference=Math.max(reference,straight.skirtBoundaryNm);
 }
 assert.ok(jam&&contact.skewSeized&&contact.skewScuff>beforeWear+.10&&load>reference+2);
 assert.ok(Math.abs(bent.pistonSkewAngle(piston))>.001);
 const point=bent.skewContactPoint(piston);
 assert.deepEqual([jam.x,jam.y],[point.x,point.y]);
 const scar=bent.fragments.linerScuffs.find(s=>s.kind==='skew'&&s.cylinder===c.id),restoreBind=Engine.restore(bent.snapshot());
 assert.ok(scar?.side===1&&scar.depth>.2&&restoreBind.cylinders[c.id].contact.skewSeized);
 assert.ok(restoreBind.fragments.linerScuffs.some(s=>s.kind==='skew'&&s.depth===scar.depth));
 let freed=false;
 for(let i=0;i<8*120;i++){
  bent.step(DT,0);
  freed||=bent.drainEvents().some(e=>e.type==='skewFree');
 }
 assert.ok(freed&&!contact.skewSeized&&bent.activeCount===1&&bent.rpm>0&&piston.active);
 assert.ok(scar.depth>.2&&contact.rodBend===d.rodBend);
 assert.equal(contact.ringSeizures,1);
 assert.equal(contact.boreOil,0);
 assert.ok(!bent.log.some(e=>e.type==='ringFracture'));

 for(const stage of [1,2]){
  let fracture;
  const previousId=bent.fragments.nextId;
  for(let i=0;i<12*120&&!fracture;i++){
   bent.step(DT,1,.09);
   fracture=bent.drainEvents().find(e=>e.type==='ringFracture');
  }
  assert.equal(fracture?.stage,stage);
  assert.ok(bent.fragments.bodies.some(p=>p.id>=previousId&&p.kind==='ring'&&p.zone==='chamber'&&p.cylinder===c.id));
  if(stage===1)for(let i=0;i<3*120;i++)bent.step(DT,0);
 }
 const saved=bent.snapshot(),sealed=Engine.restore(saved),broken=Engine.restore(saved);
 sealed.cylinders[c.id].contact.ringSeizures=1;
 for(const m of [sealed,broken]){m.phase=(piston.offset+3.88*Math.PI)%(4*Math.PI);m.refreshCycle();}
 const intact=sealed.cylinders[c.id],damagedRings=broken.cylinders[c.id];
 assert.equal(damagedRings.contact.ringSeizures,3);
 assert.ok(broken.log.some(e=>e.type==='ringFracture'&&e.stage===2));
 assert.ok((damagedRings.chamberBar-1)<(intact.chamberBar-1)*.67);
 const oilFed=Engine.restore({...saved,oil:1.6}),oiled=oilFed.cylinders[c.id].contact;
 let blue=0,oilIn=0,dryBlue=0;
 for(let i=0;i<8*120;i++){
  bent.step(DT,.55);oilFed.step(DT,.55);
  blue=Math.max(blue,oilFed.exhaust.ringOil);oilIn=Math.max(oilIn,oiled.boreOil);dryBlue=Math.max(dryBlue,bent.exhaust.ringOil);
 }
 assert.equal(dryBlue,0);
 assert.ok(blue>.03&&oilIn>.00002&&oilFed.activeCount===1&&oilFed.rpm>0,JSON.stringify({blue,oilIn}));
 assert.ok(Math.abs(oilFed.oil-oilFed.oilCircuit.total)<1e-8);
});

test('Cylinder oil is debited on intake and produces smoke only after firing and exhaust',()=>{
 const m=new Engine(),cy=m.cylinders[0],d=cy.contact;
 m.ignition='running';m.rpm=1400;m.manifoldBar=.46;d.ringSeizures=3;
 const phase=angle=>{m.phase=angle;m.refreshCycle();};
 const sump=m.oil;
 phase(2.5*Math.PI);
 for(let i=0;i<20;i++)m.advanceRingOil(DT);
 assert.ok(d.boreOil>.0001&&d.boreOil<=.00045);
 assert.ok(Math.abs(sump-m.oil-d.boreOil)<1e-12);
 assert.equal(m.exhaust.ringOil,0);
 const stored=Engine.restore(m.snapshot()).cylinders[0].contact;
 assert.equal(stored.boreOil,d.boreOil);
 phase(1.5*Math.PI);m.advanceRingOil(DT);
 assert.equal(m.exhaust.ringOil,0);
 cy.lit=true;phase(.25*Math.PI);m.advanceRingOil(DT);
 assert.ok(d.boreOilVapour>0&&m.burnedOil===d.boreOilVapour);
 assert.equal(m.exhaust.ringOil,0);
 phase(1.5*Math.PI);m.advanceRingOil(DT);
 assert.ok(m.exhaust.ringOil>0&&d.boreOilVapour<m.burnedOil);
 m.oil=0;phase(2.5*Math.PI);
 const left=d.boreOil;m.advanceRingOil(DT);
 assert.equal(d.boreOil,left);
 assert.equal(m.oil,0);
});

test('Oil combustion fouls the plug and crown, reducing torque without killing the last cylinder',()=>{
 const original=new Engine();original.setProfile('normal');original.requestStart();
 for(let i=0;i<4*120;i++)original.step(DT,0);
 const state=original.snapshot();
 state.cylinders[0].contact.ringSeizures=3;
 for(const c of state.cylinders.slice(1)){c.active=false;c.failure='rod';c.compression=0;}
 const wet=Engine.restore(state),dry=Engine.restore({...state,oil:0}),c=wet.cylinders[0],d=c.contact;
 let firstDeposit=0;
 for(let i=0;i<132*120;i++){
  wet.step(DT,.55);dry.step(DT,.55);
  if(i===12*120)firstDeposit=d.plugCarbon;
 }
 assert.ok(firstDeposit>0&&firstDeposit<d.plugCarbon&&d.plugCarbon>.45&&d.crownCarbon>.35,JSON.stringify({firstDeposit,plug:d.plugCarbon,crown:d.crownCarbon,rpm:wet.rpm,egt:wet.egt,burned:wet.burnedOil}));
 assert.equal(dry.cylinders[0].contact.plugCarbon,0);
 assert.equal(dry.cylinders[0].contact.crownCarbon,0);
 const fouledSave=wet.snapshot(),clean=Engine.restore({...fouledSave,oil:0}),fouled=Engine.restore({...fouledSave,oil:0});
 const a=clean.cylinders[0],b=fouled.cylinders[0];
 a.contact.plugCarbon=0;
 assert.equal(b.contact.plugCarbon,d.plugCarbon);
 assert.equal(b.contact.crownCarbon,d.crownCarbon);
 assert.ok(fouled.log.some(e=>e.type==='plugFouling'&&e.cylinder===0));
 assert.ok(fouled.sparkEnergy(b)<.72&&fouled.ignitionMissChance(b)>clean.ignitionMissChance(a)&&fouled.power<clean.power);
 clean.rpm=fouled.rpm=2200;
 clean.step(DT,.68);fouled.step(DT,.68);
 assert.ok(fouled.shaftDriveNm<clean.shaftDriveNm);
 for(let i=0;i<40*120;i++){clean.step(DT,.68);fouled.step(DT,.68);}
 assert.ok(b.missed>a.missed&&a.fired>0&&b.fired>0,JSON.stringify({clean:a.missed,fouled:b.missed}));
 assert.equal(b.contact.wetMisses,0);
 assert.equal(fouled.activeCount,1);
 assert.ok(fouled.ignition==='running'&&fouled.rpm>=380);
});

test('A small charge or an open stroke cannot trigger hydrolock',()=>{
 const m=new Engine(),c=m.cylinders[0],d=c.contact;
 d.headSeal=1;
 d.boreCoolant=CHAMBER_CLEARANCE_L*.6;
 m.phase=4*Math.PI-.04;m.refreshCycle();m.checkHydraulicCompression(c,m.phase-.04);
 assert.equal(d.rodBend,0);
 d.boreCoolant=CHAMBER_CLEARANCE_L*1.25;
 m.phase=2.2*Math.PI;m.refreshCycle();m.checkHydraulicCompression(c,m.phase-.04);
 assert.equal(d.rodBend,0);
 d.boreCoolant=CHAMBER_CLEARANCE_L*1.02;
 m.phase=4*Math.PI-.04;m.refreshCycle();m.checkHydraulicCompression(c,m.phase-.04);
 assert.ok(m.drainEvents().some(e=>e.type==='hydrolock'&&!e.bent));
 assert.equal(d.rodBend,0);
});
