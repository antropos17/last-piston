'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Engine}=require('../src/internals.js');

test('A radiator fissure reduces boiling margin and jets faster with pressure while conserving liquid',()=>{
 const intact=new Engine(),cold=new Engine(),hot=new Engine();
 for(const m of [intact,cold,hot])m.waterCircuit.pressure=.35;
 intact.coolant=hot.coolant=106;cold.coolant=30;
 cold.auxWear.radiator=hot.auxWear.radiator=1;
 assert.ok(hot.coolantBoilingPoint()<intact.coolantBoilingPoint());
 const dt=1/120,initial=hot.coolantLevel*6;
 for(const m of [intact,cold,hot])m.advanceRadiatorLeak(dt);
 assert.equal(intact.radiatorRunoff,0);
 assert.equal(intact.radiatorJetSpeed,0);
 assert.ok(hot.radiatorRunoff>cold.radiatorRunoff&&cold.radiatorRunoff>0);
 assert.ok(hot.radiatorJetSpeed>cold.radiatorJetSpeed);
 assert.ok(Math.abs(initial-hot.coolantLevel*6-hot.radiatorRunoff*dt)<1e-10);
 hot.coolantLevel=0;hot.advanceRadiatorLeak(dt);
 assert.equal(hot.radiatorRunoff,0);
 assert.equal(hot.radiatorJetSpeed,0);
});
