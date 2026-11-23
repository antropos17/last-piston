'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Engine,TAU,HOT_DEPOSIT_C,CROWN_CRACK_FATIGUE,crownOpening,crankSealOpening}=require('../src/internals.js');
const DT=1/120;

test('Early ignition perforates the last piston and the resulting seal leak starves its main bearings',()=>{
 const source=new Engine();source.setProfile('normal');source.requestStart();
 for(let i=0;i<4*120;i++)source.step(DT,0);
 const state=source.snapshot();
 for(const c of state.cylinders.slice(1)){c.active=false;c.failure='rod';c.compression=0;}
 Object.assign(state.cylinders[0].contact,{ringSeizures:3,crownCarbon:.90,plugCarbon:.66});
 const m=Engine.restore(state),cy=m.cylinders[0],d=cy.contact;
 const cleanState=Engine.restore(state).snapshot();cleanState.cylinders[0].contact.ringSeizures=0;
 const clean=Engine.restore(cleanState);
 let first,firstDepth,firstFired,pressureGain=0,torqueDrop=0,cracked,breach,initialOpening;
 let flow=0,casePressure=0,pressureLoss=0,matchedDrop=0,sawIntake=false;
 const sealEvents=[];
 for(let i=0;i<55*120;i++){
  m.step(DT,1,.1);clean.step(DT,1,.1);
  for(const e of m.drainEvents()){
   if(e.type==='preIgnition'&&!first){
    first=e;firstDepth=d.crownFatigue;firstFired=cy.fired;
    assert.equal(cy.cycle.stroke,3);
    assert.ok(d.depositTemp>=HOT_DEPOSIT_C&&e.angle<TAU*2&&e.angle>TAU*2-.6);
   }
   if(e.type==='crownCrack')cracked=e;
   if(e.type==='crownBreach'){assert.equal(breach,undefined);breach=e;initialOpening=crownOpening(d);}
   if(e.type==='frontCrankSeal'||e.type==='rearCrankSeal')sealEvents.push(e);
  }
  if(!breach)assert.equal(d.crownGasFlow,0);
  else{
   flow=Math.max(flow,d.crownGasFlow);
   casePressure=Math.max(casePressure,m.crankcasePressure);
   if(cy.cycle.stroke===2){sawIntake=true;assert.equal(d.crownGasFlow,0);}
   if(cy.cycle.stroke===3&&d.crownGasFlow>2){
    const fatigue=d.crownFatigue,leaking=cy.chamberBar;
    d.crownFatigue=.6;m.refreshCycle();
    pressureLoss=Math.max(pressureLoss,cy.chamberBar-leaking);
    matchedDrop=Math.max(matchedDrop,1-(leaking-1)/(cy.chamberBar-1));
    d.crownFatigue=fatigue;m.refreshCycle();
   }
  }
  if(d.preIgnition&&cy.cycle.stroke===3){
   const pressure=cy.chamberBar,torque=cy.gasTorqueNm,level=d.preIgnition;
   d.preIgnition=0;m.refreshCycle();
   pressureGain=Math.max(pressureGain,pressure-cy.chamberBar);
   torqueDrop=Math.max(torqueDrop,cy.gasTorqueNm-torque);
   d.preIgnition=level;m.refreshCycle();
  }
  if(first&&d.preIgnitionHits===1&&cy.cycle.stroke===0)assert.equal(cy.fired,firstFired+1);
 }
 assert.ok(first&&cracked&&cracked.time>first.time);
 assert.ok(firstDepth>0&&firstDepth<CROWN_CRACK_FATIGUE&&d.crownFatigue>.55&&d.preIgnitionHits>8);
 assert.ok(pressureGain>4&&torqueDrop>20);
 assert.ok(breach&&breach.time>cracked.time&&initialOpening>0&&crownOpening(d)>initialOpening+.25);
 assert.ok(flow>2&&casePressure>.055&&pressureLoss>2&&matchedDrop>.25&&sawIntake);
 assert.equal(clean.cylinders[0].contact.preIgnitionHits,0);
 assert.equal(m.activeCount,1);
 assert.ok(m.ignition==='running'&&m.rpm>=380);
 const saved=Engine.restore(m.snapshot()),restored=saved.cylinders[0].contact;
 assert.equal(restored.crownFatigue,d.crownFatigue);
 assert.equal(restored.preIgnitionHits,d.preIgnitionHits);
 assert.ok(saved.log.some(e=>e.type==='preIgnition')&&saved.log.some(e=>e.type==='crownCrack'));
 assert.ok(saved.log.some(e=>e.type==='crownBreach'));
 assert.equal(crownOpening(restored),crownOpening(d));

 const oilBefore=m.oil,pressureBefore=m.pressure;
 let sealLoss=0,air=0;
 for(let i=0;i<130*120&&m.pressure>.15;i++){
  m.step(DT,1,.1);
  sealLoss+=(m.crankSeals[0].flow+m.crankSeals[1].flow)*DT;
  air=Math.max(air,m.oilCircuit.inletAir);
  sealEvents.push(...m.drainEvents().filter(e=>e.type==='frontCrankSeal'||e.type==='rearCrankSeal'));
 }
 assert.deepEqual(sealEvents.map(e=>e.type),['frontCrankSeal','rearCrankSeal']);
 assert.ok(sealEvents[0].time>breach.time&&sealEvents[1].time>sealEvents[0].time);
 assert.ok(sealLoss>2&&sealLoss>(oilBefore-m.oil)*.9&&m.oil>=0&&m.oil<1.6);
 assert.ok(air>.55&&m.pressure<pressureBefore*.35&&m.ignition==='running'&&m.activeCount===1);
 assert.ok(Math.abs(m.oilCircuit.total-m.oil)<1e-8);
 const reloaded=Engine.restore(m.snapshot());
 assert.deepEqual(reloaded.crankSeals.map(s=>s.wear),m.crankSeals.map(s=>s.wear));
 assert.ok(reloaded.log.some(e=>e.type==='rearCrankSeal')&&m.crankSeals.every(s=>crankSealOpening(s.wear)>0));
 const main=m.mainBearings[0],initialWear=main.wear,initialClearance=main.clearance;
 let knock=0;
 for(let i=0;i<94*120&&main.wear<.43;i++){
  m.step(DT,1,.1);
  for(const e of m.drainEvents())if(e.type==='mainBearingKnock')knock=Math.max(knock,e.level);
 }
 assert.ok(main.wear>initialWear+.25&&main.clearance>initialClearance+.045&&main.temp>139&&knock>.25,
  JSON.stringify({main,initialWear,knock}));
 const worn=m.snapshot(),loaded=Engine.restore(worn),idling=Engine.restore(worn);
 let loadedStrike=0,idleStrike=0;
 for(let i=0;i<12*120;i++){
  loaded.step(DT,1,.1);idling.step(DT,0);
  for(const e of loaded.drainEvents())if(e.type==='mainBearingKnock')loadedStrike=Math.max(loadedStrike,e.level);
  for(const e of idling.drainEvents())if(e.type==='mainBearingKnock')idleStrike=Math.max(idleStrike,e.level);
 }
 assert.ok(loadedStrike>idleStrike+.2&&loaded.activeCount===1&&loaded.ignition==='running'&&loaded.rpm>=380);
 assert.equal(Engine.restore(worn).mainBearings[0].clearance,main.clearance);
 assert.ok(Engine.restore(worn).log.some(e=>e.type==='mainBearingWear'&&e.bearing===0));
 m.requestStop();
 const fatigue=d.crownFatigue,hits=d.preIgnitionHits;
 for(let i=0;i<16*120;i++)m.step(DT,0);
 assert.ok(d.depositTemp<HOT_DEPOSIT_C&&d.preIgnition===0);
 assert.equal(d.preIgnitionHits,hits);
 assert.equal(d.crownFatigue,fatigue);
 assert.equal(d.crownGasFlow,0);
 assert.ok(m.crankcasePressure<1e-6&&crownOpening(d)>0);
 assert.ok(m.crankSeals.every(s=>s.flow===0&&crankSealOpening(s.wear)>0));
});
