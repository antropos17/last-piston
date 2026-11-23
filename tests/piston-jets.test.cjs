'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Circuit,Engine,PISTON_JET_CLOG_WARNING,pistonGeometry}=require('../src/internals.js');
const STEP=1/120,CENTRES=[373,517,661,805];

function rig(pressure){
 const engine=new Engine(),oil=new Circuit('oil');
 engine.rpm=3500;engine.oilTemp=96;engine.pressure=pressure;
 return {engine,oil};
}
function advance({engine,oil},ticks){
 for(let i=0;i<ticks;i++){
  if(engine.rpm>0)engine.phase+=18*STEP;
  oil.step(STEP,engine,engine.fragments.dust);
  assert.ok(Math.abs(oil.total-engine.oil)<1e-9);
 }
}

test('Gallery pressure opens piston nozzles and a weak jet can fall short',()=>{
 const closed=rig(.9),weak=rig(1.151),strong=rig(4.3);
 for(const fixture of [closed,weak,strong])advance(fixture,360);
 assert.ok(closed.oil.pistonJets.every(j=>j.flow===0&&j.hitFlow===0));
 assert.ok(weak.oil.pistonJets.every(j=>j.flow>0&&j.hitFlow===0&&j.endY<j.y));
 for(const [i,j] of strong.oil.pistonJets.entries()){
  const piston=pistonGeometry(strong.engine.phase,i,CENTRES[i]);
  assert.ok(j.flow>weak.oil.pistonJets[i].flow&&j.hit&&j.hitFlow>0&&j.hitFlow<j.flow);
  assert.ok(Math.abs(j.endY-(piston.top+60.55))<1e-8);
  assert.ok(j.endX<j.x&&j.controlY<j.y&&Number.isFinite(j.temp));
 }
 assert.ok(strong.oil.spray.films.some(f=>f.surface==='skirt'));
});

test('Piston nozzles and bearings share finite gallery flow and keep v7 drainback',()=>{
 const fixture=rig(4.3),{engine,oil}=fixture;
 advance(fixture,240);
 const jetFlow=oil.pistonJets.reduce((sum,j)=>sum+j.flow,0);
 assert.ok(Math.abs(oil.cells[3].flow-oil.cells[4].flow-jetFlow)<1e-8);

 const saved=oil.snapshot(),restored=new Circuit('oil');restored.restore(saved,engine.oil);
 assert.ok(Math.abs(restored.spray.volume-oil.spray.volume)<1e-9);
 engine.cylinders[1].active=false;engine.cylinders[1].failure='ejected';
 advance({engine,oil:restored},120);
 assert.ok(restored.pistonJets[1].flow>0&&restored.pistonJets[1].hitFlow===0);

 engine.rpm=0;advance({engine,oil:restored},960);
 assert.ok(restored.pistonJets.every(j=>j.flow===0&&j.hitFlow===0));
 assert.equal(restored.spray.volume,0);
});

test('Bypassed fines restrict the first nozzle without starving the whole gallery',()=>{
 const filtered=rig(4.3),bypassed=rig(4.3),clean=rig(4.3),closed=rig(.9);
 for(const fixture of [filtered,bypassed,closed])fixture.engine.fragments.dust=.12;
 for(const fixture of [bypassed,clean,closed])fixture.oil.filterLoad=.78;
 for(const fixture of [filtered,bypassed,clean,closed])advance(fixture,600);
 const {engine,oil}=bypassed,clogs=()=>oil.pistonJets.map(j=>j.clog);
 const early=clogs();
 assert.ok(early[0]>.1&&early[0]<PISTON_JET_CLOG_WARNING);
 const depositMass=.011; // normalized solids required to close one throat
 const solids=()=>oil.filterLoad+oil.oilFines+clogs().reduce((sum,clog)=>sum+clog*depositMass,0);
 assert.ok(Math.abs(solids()-(.78+.12*6))<1e-10);
 for(const fixture of [filtered,bypassed,clean,closed])advance(fixture,1800);
 assert.equal(filtered.oil.filterBypassFlow,0);
 assert.ok(oil.filterBypassFlow>oil.filterFlow);
 assert.ok(clean.oil.pistonJets.every(j=>j.clog===0)&&closed.oil.pistonJets.every(j=>j.clog===0));
 assert.ok(clogs().every((clog,i)=>clog>early[i]));
 assert.deepEqual(clogs().map(clog=>clog>=PISTON_JET_CLOG_WARNING),[true,false,false,false]);
 assert.deepEqual(engine.drainEvents().filter(e=>e.type==='jetClog').map(e=>e.cylinder),[0]);
 assert.ok(Math.abs(solids()-(.78+.12*6))<1e-10);
 assert.ok(oil.pistonJets[0].flow<filtered.oil.pistonJets[0].flow*.45);
 assert.ok(oil.pistonJets[0].hitFlow<filtered.oil.pistonJets[0].hitFlow*.4);
 assert.ok(oil.pistonJets[3].hitFlow>filtered.oil.pistonJets[3].hitFlow*.7);
 const jetFlow=oil.pistonJets.reduce((sum,j)=>sum+j.flow,0);
 assert.ok(Math.abs(oil.cells[3].flow-oil.cells[4].flow-jetFlow)<1e-8);

 const saved=oil.snapshot(),restored=new Circuit('oil');restored.restore(saved,engine.oil);
 engine.rpm=0;advance({engine,oil:restored},1200);
 assert.deepEqual(restored.pistonJets.map(j=>j.clog),clogs());
 assert.ok(restored.pistonJets.every(j=>j.flow===0&&j.hitFlow===0));
 assert.ok(!engine.drainEvents().some(e=>e.type==='jetClog'));
 delete saved.jetClogs;restored.restore(saved,engine.oil);
 assert.ok(restored.pistonJets.every(j=>j.clog===0));
});
