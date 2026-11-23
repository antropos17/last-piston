'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Circuit,Engine}=require('../src/internals.js');
const DT=1/120;
function run(circuit,engine,seconds,dust=0){
 for(let i=0;i<seconds*120;i++)circuit.step(DT,engine,dust);
}
const retainedAndLoose=oil=>oil.filterLoad+oil.oilFines;

test('Suspended fines move into the filter only once, and leave with lost oil',()=>{
 const engine=new Engine(),oil=engine.oilCircuit;
 engine.oilTemp=96;engine.fragments.dust=.07;
 run(oil,engine,2,engine.fragments.dust);
 assert.equal(oil.filterLoad,0);
 assert.ok(oil.oilFines>0);
 const mass=retainedAndLoose(oil);
 engine.rpm=2850;run(oil,engine,12,engine.fragments.dust);
 assert.ok(oil.filterLoad>0&&oil.oilFines>0);
 assert.ok(Math.abs(retainedAndLoose(oil)-mass)<1e-10);

 const record=engine.snapshot(),saved=Engine.restore(record).oilCircuit;
 assert.equal(saved.oilFines,oil.oilFines);
 run(saved,engine,4,engine.fragments.dust);
 assert.ok(Math.abs(retainedAndLoose(saved)-mass)<1e-10);
 const before=saved.oilFines;
 saved.setInventory(saved.total*.5);
 assert.ok(Math.abs(saved.oilFines-before*.5)<1e-10);

 delete record.oilCircuit.oilFines;delete record.oilCircuit.dustAccounted;
 const legacy=Engine.restore(record).oilCircuit;
 run(legacy,engine,4,engine.fragments.dust);
 assert.equal(legacy.oilFines,0);
 assert.equal(legacy.filterLoad,record.oilCircuit.filterLoad);
});

test('Filter bypass cracks at a pressure difference and then carries unfiltered oil',()=>{
 const engine=new Engine(),oil=new Circuit('oil');
 engine.oilTemp=35;engine.rpm=850;run(oil,engine,2);
 assert.equal(oil.filterBypassFlow,0);
 engine.rpm=2800;run(oil,engine,2);
 assert.ok(oil.filterDeltaP>.78&&oil.filterBypassFlow>0);
 assert.ok(oil.filterBypassFlow<oil.cells[2].flow);
 assert.ok(Math.abs(oil.filterFlow+oil.filterBypassFlow-oil.cells[2].flow)<1e-10);

 engine.oilTemp=96;run(oil,engine,2);
 assert.ok(oil.filterDeltaP<.78);
 assert.equal(oil.filterBypassFlow,0);
 oil.filterLoad=.78;run(oil,engine,2);
 assert.ok(oil.filterDeltaP>.78&&oil.filterBypassFlow>oil.filterFlow);
 engine.rpm=0;run(oil,engine,2);
 assert.equal(oil.filterDeltaP,0);
 assert.equal(oil.filterBypassFlow,0);
});

test('Subcooled coolant bubbles start at the hot jacket and mostly condense at the radiator',()=>{
 const engine=new Engine(),water=engine.waterCircuit;
 engine.coolant=105;engine.headTemp=190;engine.rpm=2700;run(water,engine,10);
 const jacket=water.cells[1].bubbles,radiator=water.cells[3].bubbles;
 assert.equal(water.vapour,0);
 assert.ok(jacket>.03&&radiator>0&&radiator<jacket*.13);
 engine.coolant=93;engine.headTemp=125;run(water,engine,10);
 assert.ok(water.cells[1].bubbles<jacket*.1);
 assert.ok(Math.abs(water.total-engine.coolantLevel*6)<1e-9);
});
