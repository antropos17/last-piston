'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Engine,Fragments,TAU}=require('../src/internals.js');

test('A loaded wedge chips the cap against the neighboring journal and leaves real debris',()=>{
 const e=new Engine(),f=e.fragments,rod=f.add(3,'rod','case',330,469);
 rod.vx=rod.vy=0;
 e.rpm=3000;e.shaftSpeed=14;
 const events=[];
 const run=steps=>{for(let i=0;i<steps;i++){
  e.phase=(e.phase+e.shaftSpeed/120)%(2*TAU);
  f.step(1/120,e);
  events.push(...f.events.splice(0));
 }};
 run(77);
 assert.equal(rod.jamEdge,'cap');
 const [mark]=f.edgeChips;
 assert.equal(mark.edge,'cap');
 assert.equal(mark.cylinder,0);
 assert.ok(mark.damage>0&&mark.damage<1);
 const partial=mark.damage;
 const incomplete=JSON.parse(JSON.stringify(f.snapshot()));
 assert.deepEqual(Fragments.restore(incomplete).edgeChips,[mark]);
 e.rpm=e.shaftSpeed=0;run(90);
 assert.equal(mark.damage,partial);
 assert.ok(!events.some(e=>e.type==='edgeChip'));

 e.rpm=3000;e.shaftSpeed=14;run(178);
 assert.ok(rod.jammed);
 assert.equal(mark.damage,1);
 const edges=events.filter(e=>e.type==='edgeChip');
 assert.equal(edges.length,1);
 assert.deepEqual([edges[0].cylinder,edges[0].x,edges[0].y],[0,rod.edgeX,rod.edgeY]);
 const [shard]=f.bodies.filter(p=>p.kind==='edge');
 assert.ok(shard&&shard.r<rod.r&&shard.zone==='case'&&shard.x>mark.x&&shard.vx>0);

 const save=JSON.parse(JSON.stringify(e.snapshot())),restored=Engine.restore(save);
 assert.deepEqual(restored.fragments.edgeChips,[mark]);
 assert.ok(restored.fragments.bodies.some(p=>p.kind==='edge'&&p.id===shard.id));
 delete save.fragments.edgeChips;
 assert.deepEqual(Engine.restore(save).fragments.edgeChips,[]);
 run(300);
 assert.equal(events.filter(e=>e.type==='edgeChip'&&e.x===mark.x&&e.y===mark.y).length,1);
 assert.equal(mark.damage,1);
});

test('A trapped rod gradually sheds chips into the oil before it slips out of the clamp',()=>{
 const e=new Engine(),f=e.fragments,rod=f.add(3,'rod','case',330,469);
 rod.vx=rod.vy=0;e.rpm=3000;e.shaftSpeed=14;
 const wet=new Set();
 let release,maxRadiusStep=0,saved=false;
 for(let n=0;n<800;n++){
  const {x,y,r,jammed}=rod;
  e.phase=(e.phase+14/120)%(2*TAU);
  f.step(1/120,e);
  if(jammed)maxRadiusStep=Math.max(maxRadiusStep,r-rod.r);
  if(jammed&&!rod.jammed&&!release)release={shift:Math.hypot(rod.x-x,rod.y-y),r0:r,r:rod.r};
  if(rod.jammed&&rod.jamGrit>0&&!saved){
   const copy=Fragments.restore(f.snapshot()).bodies.find(p=>p.id===rod.id);
   assert.equal(copy.jamGrit,rod.jamGrit);
   assert.equal(copy.r,rod.r);
   saved=true;
  }
  for(const chip of f.bodies)if(chip.kind==='metal'&&chip.y-chip.r>f.oilSurfaceAt(chip.x))wet.add(chip.id);
 }
 assert.ok(saved&&release&&maxRadiusStep>0&&maxRadiusStep<.12);
 assert.equal(release.r0,release.r);
 assert.ok(release.shift<2.5&&release.r<8);
 assert.ok(wet.size>=2);
});

test('Loaded chips retain their IDs even when the snapshot body order changes',()=>{
 const f=new Fragments(),parent=f.add(0,'rod'),chip=f.add(0,'metal'),removed=f.add(0,'edge');
 const snapshot=f.snapshot();
 snapshot.bodies=[snapshot.bodies[1],snapshot.bodies[0]];
 const restored=Fragments.restore(snapshot);
 assert.deepEqual(restored.bodies.map(p=>[p.id,p.kind]),[[chip.id,'metal'],[parent.id,'rod']]);
 assert.ok(restored.add(0,'metal').id>removed.id);
 snapshot.bodies[0].id=parent.id;
 assert.equal(new Set(Fragments.restore(snapshot).bodies.map(p=>p.id)).size,2);
});
