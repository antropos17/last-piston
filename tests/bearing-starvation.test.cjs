'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {Engine}=require('../src/internals.js');
const STEP=1/120;

function run(engine,seconds,gas=0,brake=0){
 const knocks=[];
 for(let i=0;i<seconds*120;i++){
  engine.step(STEP,gas,brake);
  for(const event of engine.drainEvents())if(event.type==='bearingKnock')knocks.push(event);
 }
 return knocks;
}

function start(clog){
 const engine=new Engine();
 engine.setProfile('normal');
 engine.requestStart();
 run(engine,4);
 assert.equal(engine.ignition,'running');
 engine.oilCircuit.pickupClog=clog;
 return engine;
}

test('Pickup restriction lowers gallery pressure under load and as the shaft coasts down',()=>{
 const clean=start(0),partial=start(.5),blocked=start(1);
 for(const engine of [clean,partial,blocked]){
  engine.rpm=3500;
  run(engine,10,.66,.47);
 }
 // Extra boundary friction reduces the blocked engine's speed at the same pedals.
 assert.ok(Math.abs(clean.rpm-blocked.rpm)/clean.rpm<.045);
 assert.ok(clean.pressure>partial.pressure&&partial.pressure>blocked.pressure*2);
 assert.ok(clean.oilCircuit.cells[4].flow>partial.oilCircuit.cells[4].flow);
 assert.ok(partial.oilCircuit.cells[4].flow>blocked.oilCircuit.cells[4].flow*2);
 assert.ok(blocked.oil>4.5);
 for(const engine of [clean,blocked]){
  engine.requestStop();
  run(engine,1);
  assert.ok(engine.rpm>0);
 }
 assert.ok(blocked.pressure<clean.pressure*.3);
});

test('Starved bearings heat, gain wear and knock only during loaded clearance take-up',()=>{
 const clean=start(0),blocked=start(1),idle=start(1);
 clean.rpm=blocked.rpm=3500;
 const cleanKnocks=run(clean,16,.66,.47);
 const blockedKnocks=run(blocked,16,.66,.47);
 const idleKnocks=run(idle,16);
 const good=clean.cylinders[1].contact,worn=blocked.cylinders[1].contact;
 assert.equal(cleanKnocks.length,0);
 assert.equal(idleKnocks.length,0);
 assert.ok(worn.bearingTemp>Math.max(good.bearingTemp,idle.cylinders[1].contact.bearingTemp)+25);
 assert.ok(worn.bearing>good.bearing+.04);
 assert.ok(blockedKnocks.some(event=>event.cylinder===1&&event.level>.08));
 assert.ok(blockedKnocks.every(event=>event.level<=1&&event.y>416&&event.y<525
  &&Math.abs(Math.hypot(event.nx,event.ny)-1)<1e-9));
 blocked.requestStop();
 assert.deepEqual(run(blocked,5,.66,.47),[]);
 assert.ok(!blocked.log.some(event=>event.type==='bearingKnock'));
});

test('A bearing strike plays a lower, damped recorded impact with its own cadence',()=>{
 const window={Piston:{clamp:(v,min,max)=>Math.max(min,Math.min(v,max))}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/sample-audio.js'),'utf8'),{window});
 const player=new window.Piston.MotorAudio(),sounds=[];
 player.ctx={state:'running',currentTime:1};
 player.lastState={ignition:'running',rpm:3600};
 player.play=(name,volume,rate,options)=>{sounds.push({name,volume,rate,...options});return {};};
 player.event({type:'pistonSlap',level:.4,x:400});
 player.event({type:'bearingKnock',level:.4,x:770});
 player.event({type:'bearingKnock',level:.8,x:770});
 assert.deepEqual(sounds.map(sound=>sound.name),['impact','impact']);
 assert.ok(sounds[1].rate<sounds[0].rate&&sounds[1].cutoff<sounds[0].cutoff);
 assert.ok(sounds[1].decay>sounds[0].decay&&sounds[1].panPosition>0&&sounds[1].offset>0);
 player.ctx.currentTime+=.1;
 player.event({type:'bearingKnock',level:.8,x:770});
 assert.ok(sounds[2].volume>sounds[1].volume);
 player.ctx.currentTime+=.1;
 player.lastState.ignition='off';
 player.event({type:'bearingKnock',level:1,x:770});
 assert.equal(sounds.length,3);
 player.lastState.ignition='running';
 player.event({type:'bearingSpin',level:1,x:517});
 assert.equal(sounds[3].name,'impact');
 assert.ok(sounds[3].decay>sounds[2].decay&&sounds[3].panPosition<0);
});
