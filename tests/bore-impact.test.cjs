'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Engine,pistonGeometry}=require('../src/internals.js');
const h=1/240,x=373;

test('A descending skirt strikes a chip under its lip while the central recess clears it',()=>{
 function under(offset){
  const m=new Engine();m.rpm=3600;m.shaftSpeed=20;m.phase=Math.PI/2;
  const top=pistonGeometry(m.phase,0,x).top;
  const p=m.fragments.add(0,'metal','liner',x+offset,top+60+2-1,2);
  p.vx=p.vy=p.w=0;m.fragments.step(h,m);
  return {p,top,hits:m.fragments.impacts};
 }
 const lip=under(32),recess=under(0);
 assert.ok(lip.p.vy>500&&lip.p.y-lip.p.r>=lip.top+60);
 assert.equal(lip.hits,1);assert.equal(recess.hits,0);assert.ok(recess.p.vy<4);
});

test('A glancing liner strike spins the chip away and leaves a local oil-dependent score',()=>{
 function strike(film){
  const m=new Engine();m.phase=Math.PI;m.cylinders[0].contact.filmMicron=film;
  const p=m.fragments.add(0,'valve','chamber',x+44,280,3);
  Object.assign(p,{vx:460,vy:570,w:0});m.fragments.step(h,m);
  return {p,m,scar:m.fragments.linerScuffs[0]};
 }
 const dry=strike(0),wet=strike(4);
 assert.ok(dry.p.vx<0&&dry.p.w<0&&dry.p.vy<wet.p.vy);
 assert.equal(dry.scar.side,1);assert.equal(dry.scar.cylinder,0);
 const hit=dry.m.fragments.events.find(e=>e.type==='impact');
 assert.ok(Math.abs(hit.x-(x+48))<.01&&hit.y>281&&hit.y<281.5);
 assert.ok(dry.scar.depth>(wet.scar?.depth??0)&&dry.scar.top<hit.y&&dry.scar.bottom>=hit.y);
 assert.ok(dry.p.x+dry.p.r<x+48-.05&&dry.p.y>hit.y);
 assert.deepEqual(Engine.restore(dry.m.snapshot()).fragments.linerScuffs,[dry.scar]);
});

test('Only a hard crown strike leaves a dent, in piston coordinates, across reload',()=>{
 function strike(vy){
  const m=new Engine();m.phase=Math.PI;
  const top=pistonGeometry(m.phase,0,x).top;
  const p=m.fragments.add(0,'rod','chamber',x+14,top-4-.05,4);
  Object.assign(p,{vx:0,vy,w:0});m.fragments.step(h,m);
  return m;
 }
 const m=strike(660),dent=m.fragments.crownDents[0];
 assert.ok(Math.abs(dent.offset-14)<.01&&dent.depth>0);
 assert.ok(m.fragments.crownDents.slice(1).every(d=>d===null));
 const saved=JSON.parse(JSON.stringify(m.snapshot()));
 assert.deepEqual(Engine.restore(saved).fragments.crownDents,m.fragments.crownDents);
 delete saved.fragments.crownDents;assert.ok(Engine.restore(saved).fragments.crownDents.every(d=>d===null));
 assert.equal(strike(35).fragments.crownDents[0],null);
});

test('A rising crown catches an approaching shard before the substep ends',()=>{
 const m=new Engine();m.rpm=4200;m.shaftSpeed=18;m.phase=1.5*Math.PI;
 const before=pistonGeometry(m.phase-m.shaftSpeed*h,0,x).top;
 const end=pistonGeometry(m.phase,0,x).top,velocity=(end-before)/h;
 const p=m.fragments.add(0,'valve','chamber',x+8,before-3-.45,3);
 Object.assign(p,{vx:95,vy:0,w:0});m.fragments.step(h,m);
 assert.ok(p.vy<velocity&&p.y+p.r<end-.15);
 const hit=m.fragments.events.find(e=>e.type==='impact');
 assert.ok(hit.ny===-1&&hit.y<before&&hit.y>end);
});

test('A chip clears a broken skirt lip and the bore left by an ejected piston',()=>{
 for(const failure of ['skirt','ejected']){
  const m=new Engine(),cy=m.cylinders[0];m.phase=Math.PI/2;
  if(failure==='skirt')cy.partWear.skirt=1;
  else{cy.active=false;cy.failure='ejected';cy.freeze=m.phase;}
  const top=pistonGeometry(m.phase,0,x).top;
  const p=m.fragments.add(0,'skirt','liner',x+32,top+(failure==='skirt'?58:48),2);
  Object.assign(p,{vx:0,vy:-90,w:0});m.fragments.step(h,m);
  assert.equal(m.fragments.impacts,0);assert.ok(p.vy<0);
 }
});

test('A broken skirt traps its own chip, slows the crank and releases it on the return stroke',()=>{
 function fracture(){
  const m=new Engine();m.setProfile('normal');m.requestStart();
  for(let n=0;n<284;n++)m.step(1/120,.25);
  assert.ok(m.toggleBenchFault('skirt','break',0));return m;
 }
 const m=fracture(),control=fracture(),chip=m.fragments.bodies.find(p=>p.kind==='skirt');
 control.fragments.bodies=control.fragments.bodies.filter(p=>p.id!==chip.id);
 let caught=false,released=false,peak=0,rpmDrop=0,speedDrop=0,lastBottom=0;
 for(let i=0;i<48;i++){
  m.step(1/120,.45);control.step(1/120,.45);
  if(!chip.jammed){if(caught){released=true;assert.equal(m.fragments.skirtWedgeNm,0);}continue;}
  caught=true;assert.equal(chip.jamEdge,'liner');assert.equal(chip.x+chip.r,x+48);
  const scar=m.fragments.linerScuffs.find(s=>s.kind==='wedge');
  peak=Math.max(peak,m.fragments.skirtWedgeNm);
  rpmDrop=Math.max(rpmDrop,control.rpm-m.rpm);speedDrop=Math.max(speedDrop,control.shaftSpeed-m.shaftSpeed);
  if(scar){assert.ok(scar.bottom>=lastBottom);lastBottom=scar.bottom;}
 }
 const [scar]=m.fragments.linerScuffs.filter(s=>s.kind==='wedge');
 assert.ok(caught&&released&&peak>8&&rpmDrop>5&&speedDrop>.5);
 assert.equal(scar.side,1);assert.equal(scar.cylinder,0);
 assert.ok(scar.bottom-scar.top>18);assert.equal(scar.bottom,lastBottom);
 assert.deepEqual(Engine.restore(m.snapshot()).fragments.linerScuffs,m.fragments.linerScuffs);
});

test('A wedged chip cuts both liners under load, leaves a shallower oiled score and holds still at rest',()=>{
 function drag(side,film){
  const m=new Engine();m.phase=.9;m.rpm=2000;m.shaftSpeed=13;
  const r=3,p=m.fragments.add(0,'metal','liner',x+side*(48-r-.05),pistonGeometry(m.phase,0,x).top+61+r,r);
  p.vx=p.vy=p.w=0;m.cylinders[0].contact.filmMicron=film;
  let peak=0;
  for(let n=0;n<20;n++){m.phase+=m.shaftSpeed*h;m.fragments.step(h,m);peak=Math.max(peak,m.fragments.skirtWedgeNm);}
  assert.ok(p.jammed);const scar=m.fragments.linerScuffs[0];
  assert.equal(scar.side,side);assert.equal(scar.kind,'wedge');
  const restored=Engine.restore(m.snapshot()).fragments.bodies.find(b=>b.id===p.id);
  assert.ok(restored.jammed);assert.equal(restored.edgeY,p.y);assert.equal(restored.edgeX,x+side*48);
  const before=[p.y,scar.bottom,scar.depth];m.rpm=m.shaftSpeed=0;
  for(let n=0;n<240;n++)m.fragments.step(h,m);
  assert.deepEqual([p.y,scar.bottom,scar.depth],before);assert.ok(p.jammed);assert.equal(m.fragments.skirtWedgeNm,0);
  return {peak,depth:scar.depth};
 }
 for(const side of [-1,1]){
  const dry=drag(side,0),wet=drag(side,4);
  assert.ok(wet.peak>0&&wet.peak<dry.peak&&wet.depth>0&&wet.depth<dry.depth);
 }
});
