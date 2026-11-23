'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Engine}=require('../src/internals.js');
const STEP=1/120;
const run=(engine,seconds,gas=0)=>{
 for(let i=0;i<120*seconds;i++)engine.step(STEP,gas);
};
function warm(profile){
 const engine=new Engine();
 engine.setProfile(profile);
 assert.equal(engine.requestStart(),true);
 run(engine,4);
 assert.equal(engine.ignition,'running');
 return engine;
}

test('Oil feed takes up chain slack after start, and a healthy drive stays in time under load',()=>{
 const engine=warm('normal'),drive=engine.timingDrive;
 assert.ok(drive.tensionerPressure>=.7);
 run(engine,60,1);
 assert.ok(drive.tensionerPressure>2&&drive.tensionerTravel>2);
 assert.equal(engine.activeCount,4);
 assert.equal(drive.teethSkipped,0);
 assert.equal(drive.broken,false);
 assert.equal(drive.camAngle,engine.camAngle);
 assert.ok(drive.stretch<.001&&drive.guideWear<.01);
 assert.equal(engine.log.some(e=>e.type.startsWith('chain')),false);
 engine.requestStop();
 run(engine,45);
 assert.equal(engine.rpm,0);
 assert.ok(drive.tensionerPressure<.001&&Math.abs(drive.slack)<.01&&Math.abs(drive.tight)<.01);
});

test('A dry timing drive hits its guide, jumps a tooth and then opens while the final piston runs',()=>{
 const engine=warm('stress'),drive=engine.timingDrive;
 const hits=new Map();
 engine.oil=0;
 for(let i=0;i<120*190&&!drive.broken;i++){
  engine.step(STEP,1);
  for(const event of engine.drainEvents())if(event.type.startsWith('chain')&&!hits.has(event.type))hits.set(event.type,event);
 }
 assert.ok(hits.has('chainRattle')&&hits.has('chainSkip')&&hits.has('chainGuide')&&hits.has('chainBreak'));
 assert.ok(hits.get('chainRattle').time<hits.get('chainSkip').time&&hits.get('chainSkip').time<hits.get('chainBreak').time);
 assert.ok(hits.get('chainGuide').time<hits.get('chainBreak').time);
 assert.ok(hits.get('chainRattle').level>0&&hits.get('chainRattle').level<1);
 assert.equal(engine.activeCount,1);
 assert.equal(engine.ignition,'running');
 assert.ok(drive.stretch>.01&&drive.tensionerPressure<.1);
 const frozenCam=engine.camAngle,crank=engine.phase;
 const valve=engine.cylinders[1].cycle.intake;
 run(engine,1,1);
 assert.notEqual(engine.phase,crank);
 assert.equal(engine.camAngle,frozenCam);
 assert.equal(engine.cylinders[1].cycle.intake,valve);
 assert.ok(drive.gap>.9&&drive.torqueFactor<.4&&engine.rpm>0);
 const state=engine.snapshot();
 const restored=Engine.restore(JSON.parse(JSON.stringify(state)));
 assert.deepEqual(restored.timingDrive.snapshot(),drive.snapshot());
 assert.equal(restored.camAngle,frozenCam);
 assert.ok(restored.log.some(e=>e.type==='chainBreak'));
 delete state.timingDrive;
 assert.equal(Engine.restore(state).timingDrive.broken,false);
});
