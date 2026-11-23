'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {OilPan,OIL_PAN}=require('../src/oil-pan.js');

const H=1/120;
const INLET=367,INLET_Y=543;

function returningOil(pan,speed){
 pan.fillTo(.55);
 for(let i=0;i<600;i++){
  if(i%8===0)pan.aerate(INLET,.00015,speed);
  pan.step(H,0,.35);
 }
}

test('Impacts make local foam and suspended air without changing liquid volume',()=>{
 const quiet=new OilPan(),fast=new OilPan(),dry=new OilPan();
 returningOil(quiet,260);returningOil(fast,940);
 dry.aerate(INLET,.001,1200);
 assert.equal(quiet.foamAt(INLET),0);
 assert.equal(quiet.entrainedAirAt(INLET,INLET_Y),0);
 assert.equal(dry.foamAt(INLET),0);
 assert.equal(dry.entrainedAirAt(INLET,INLET_Y),0);
 assert.ok(fast.foamAt(INLET)>.3&&fast.foamAt(INLET)<1);
 assert.ok(fast.entrainedAirAt(INLET,INLET_Y)>.015);
 assert.ok(fast.entrainedAirAt(INLET,538)>fast.entrainedAirAt(INLET,INLET_Y));
 assert.equal(fast.entrainedAirAt(INLET,535),0);
 assert.equal(fast.foamAt(600),0);
 assert.deepEqual(fast.depths,quiet.depths);
 assert.equal(fast.surfaceAt(INLET),OIL_PAN.floor-.55*OIL_PAN.depth);
});

test('The sump flow advects foam and air, which separate after the last impact',()=>{
 const pan=new OilPan();returningOil(pan,940);
 const volume=pan.depths.reduce((sum,h)=>sum+h,0),foam=pan.foamAt(INLET);
 const air=pan.entrainedAirAt(INLET,INLET_Y);
 for(let i=0;i<120;i++)pan.step(H,300,.35);
 assert.ok(pan.foamAt(435)>.1);
 assert.ok(pan.entrainedAirAt(435,INLET_Y)>.005);
 assert.ok(pan.foamAt(INLET)<foam);
 for(let i=0;i<1200;i++)pan.step(H,0,.35);
 assert.ok(pan.foamAt(435)<.015);
 assert.ok(pan.entrainedAirAt(INLET,INLET_Y)<air*.02);
 assert.ok(Math.abs(pan.depths.reduce((sum,h)=>sum+h,0)-volume)<1e-9);
});

test('Pan snapshots preserve gas distribution while older and invalid states restore clear oil',()=>{
 const pan=new OilPan();returningOil(pan,940);
 const state=pan.snapshot(),restored=new OilPan();
 restored.fillTo(.55);restored.restore(state);
 assert.deepEqual(restored.snapshot(),state);
 state.mixedAir[1]=1000;
 delete state.surfaceAir;
 restored.restore(state);
 assert.equal(restored.foamAt(INLET),0);
 assert.equal(restored.entrainedAirAt(INLET,INLET_Y),0);
 assert.deepEqual(restored.depths,pan.depths);
});
