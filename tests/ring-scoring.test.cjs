'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Engine,pistonGeometry}=require('../src/internals.js');
const step=1/120;

test('Only faces that traverse a chip groove accumulate wear, including a reversal inside a step',()=>{
 function pass(side,film,split=false){
  const m=new Engine(),cy=m.cylinders[0];cy.contact.filmMicron=film;
  m.fragments.markLiner(0,side,349,355,.75,'wedge');
  const start=Math.PI-.35,end=Math.PI+.35;
  if(split){m.phase=Math.PI;m.advanceRingScoring(start);m.phase=end;m.advanceRingScoring(Math.PI);}
  else{m.phase=end;m.advanceRingScoring(start);}
  const wear=cy.contact.ringFaces.slice();m.advanceRingScoring(end);
  assert.deepEqual(cy.contact.ringFaces,wear);
  assert.ok(m.cylinders.slice(1).every(c=>c.contact.ringFaces.every(v=>v===0)));
  return wear;
 }
 const left=pass(-1,0),right=pass(1,0);
 assert.ok(left[3]>0&&left.every((w,k)=>k===3||w===0));assert.equal(left[3],right[7]);
 assert.deepEqual(left,pass(-1,0,true));assert.ok(pass(-1,4)[3]<left[3]);
});

test('A real skirt chip scores the bore, wears successive rings, and leaks gas on the scored side',()=>{
 const m=new Engine();m.setProfile('normal');m.requestStart();
 for(let i=0;i<234;i++)m.step(step,.25);
 assert.ok(m.toggleBenchFault('skirt','break',0));
 let peak=0;const cy=m.cylinders[0],d=cy.contact;
 for(let i=0;i<2400;i++){
  m.step(step,.65);peak=Math.max(peak,d.ringGasRight);
  assert.equal(d.ringGasLeft,0);assert.equal(d.crownGasFlow,0);
 }
 const scar=m.fragments.linerScuffs.find(s=>s.kind==='wedge');
 assert.equal(scar.side,1);assert.ok(scar.top<pistonGeometry(Math.PI,0).top+9);
 assert.ok(d.ringFaces[4]>.1&&d.ringFaces[5]>d.ringFaces[4]&&d.ringFaces[7]>d.ringFaces[5]);
 assert.ok(peak>1&&m.crankcasePressure>.001);assert.equal(d.ringSeizures,0);
 const saved=m.snapshot(),restored=Engine.restore(saved);
 assert.deepEqual(restored.cylinders[0].contact.ringFaces,d.ringFaces);
 const control=Engine.restore(saved);control.cylinders[0].contact.ringFaces.fill(0);
 for(const engine of [restored,control]){engine.phase=.36;engine.cylinders[0].lit=true;engine.refreshCycle();}
 const worn=restored.cylinders[0],clean=control.cylinders[0];
 assert.ok(worn.chamberBar<clean.chamberBar&&worn.gasTorqueNm<clean.gasTorqueNm);
 m.phase=2.5*Math.PI;m.refreshCycle();assert.equal(d.ringGasRight,0);
 m.rpm=0;m.phase=.36;m.refreshCycle();assert.equal(d.ringGasRight,0);
 delete saved.cylinders[0].contact.ringFaces;
 assert.ok(Engine.restore(saved).cylinders[0].contact.ringFaces.every(w=>w===0));
});
