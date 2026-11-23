'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Engine,SPEC,TAU}=require('../src/internals.js');

test('Open intake and exhaust ports follow swept volume and their own manifold pressure',()=>{
 const m=new Engine(),c=m.cylinders[0];
 m.rpm=3000;m.manifoldBar=.65;m.phase=2.5*Math.PI;m.refreshCycle();
 assert.ok(c.cycle.intakeLps>70&&c.cycle.intakeLps<85);
 assert.equal(c.cycle.exhaustLps,0);
 assert.ok(c.chamberBar<m.manifoldBar&&c.gasTorqueNm<0);
 const intake=c.cycle.intakeLps;
 m.rpm*=.5;m.refreshCycle();
 assert.equal(c.cycle.intakeLps,intake*.5);
 m.phase=1.5*Math.PI;m.refreshCycle();
 assert.ok(c.cycle.exhaustLps<0&&c.chamberBar>1);
 const before=c.chamberBar,torque=c.gasTorqueNm;
 m.exhaust.pressure=9;m.refreshCycle();
 assert.ok(Math.abs(c.chamberBar-before-.09)<1e-10&&c.gasTorqueNm<torque);
});

test('A cam stopped with the intake open lets the rising piston push air back',()=>{
 const m=new Engine(),c=m.cylinders[0];
 m.rpm=1800;m.phase=2.5*Math.PI;m.timingDrive.breakLink(m);
 m.phase=3.5*Math.PI;m.refreshCycle();
 assert.equal(c.cycle.intake,1);
 assert.ok(c.cycle.intakeLps<0&&c.chamberBar>m.manifoldBar);
 m.rpm=0;m.refreshCycle();assert.ok(c.cycle.intakeLps===0);
 m.rpm=1800;c.active=false;m.refreshCycle();assert.ok(c.cycle.intakeLps===0);
});

test('Backpressure absorbs shaft torque in proportion to the remaining swept volume',()=>{
 for(const count of [4,1]){
  const torque=pressure=>{
   const m=new Engine();m.rpm=2500;m.exhaust.pressure=pressure;
   for(const c of m.cylinders)c.active=c.id<count;
   m.integrateShaft(1/120,.6);return m.shaftDriveNm;
  };
  const expected=10*SPEC.displacement*.001*(count/4)/(2*TAU);
  assert.ok(Math.abs(torque(0)-torque(10)-expected)<1e-9);
 }
});
