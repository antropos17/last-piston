'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Engine}=require('../src/internals.js');
const {OilSplash}=require('../src/oil-splash.js');
const DT=1/120;

test('A returning drop pushes oil outward on both sides of its impact',()=>{
 const m=new Engine(),f=m.oilCircuit,x=590;
 f.pan.fillTo(.65);
 f.spray.drops.push({x,y:f.surfaceAt(x)-.1,vx:0,vy:650,litres:.00018,kind:1});
 f.spray.step(DT,m,f);
 assert.equal(f.spray.drops.length,0);
 assert.ok(f.pan.faces.some(v=>v>0)&&f.pan.faces.some(v=>v<0));
 assert.ok(f.pan.foamAt(x)>0);
});

test('Oil leaves the rotating counterweight tangentially and accelerates downwards in flight',()=>{
 const m=new Engine(),spray=new OilSplash(557),f=m.oilCircuit;
 m.rpm=5100;m.shaftSpeed=22;m.phase=1.95;
 f.cells[4].flow=24;spray.credit=1;
 spray.step(DT,m,f);
 assert.equal(spray.drops.length,1);
 const p=spray.drops[0],axis=[373,517,661,805].find(x=>Math.hypot(p.x-x,p.y-460)<56);
 assert.ok(Number.isFinite(axis));
 const radius=Math.hypot(p.x-axis,p.y-460);
 assert.ok(radius>=50&&radius<=55);
 assert.ok((p.x-axis)*p.vy-(p.y-460)*p.vx>0);
 assert.ok(p.vx*p.vx+p.vy*p.vy>200*200);
 const y0=p.y,vy0=p.vy;
 m.shaftSpeed=m.rpm=0;
 spray.step(1/240,m,f);
 assert.ok(spray.drops.includes(p));
 assert.ok(p.vy>vy0);
 assert.ok(Math.sign(p.y-y0)===Math.sign(p.vy));
});

test('Crank oil wets moving and fixed parts, drains to the pan and keeps total oil balanced',()=>{
 const m=new Engine(),surfaces=new Set(),kinds=new Set();
 m.setProfile('normal');m.requestStart();
 let peak=0,peakDrops=0,peakFilms=0;
 for(let i=0;i<18*120;i++){
  m.step(DT,i>3*120?.91:0);
  const {spray,total}=m.oilCircuit;
  for(const f of spray.films)surfaces.add(f.surface);
  for(const p of spray.drops)kinds.add(p.kind);
  peak=Math.max(peak,spray.volume);peakDrops=Math.max(peakDrops,spray.drops.length);
  peakFilms=Math.max(peakFilms,spray.films.length);
  assert.ok(Math.abs(total-m.oil)<1e-9);
 }
 assert.deepEqual([...surfaces].sort(),['case','rod','skirt']);
 assert.deepEqual([...kinds].sort(),[0,1]);
 assert.ok(peak>.001&&peak<=.045&&peakDrops<=48&&peakFilms<=30);
 const saved=JSON.parse(JSON.stringify(m.snapshot()));
 const restored=Engine.restore(saved);
 assert.ok(restored.oilCircuit.spray.volume>0);
 assert.deepEqual(restored.oilCircuit.spray.snapshot(),saved.oilCircuit.spray);
 assert.ok(Math.abs(restored.oil-restored.oilCircuit.total)<1e-9);
 delete saved.oilCircuit.spray;
 const legacy=Engine.restore(saved);
 assert.equal(legacy.oilCircuit.spray.volume,0);
 assert.ok(Math.abs(legacy.oil-legacy.oilCircuit.total)<1e-9);
 restored.oil=0;
 restored.step(DT,.91);
 assert.equal(restored.oilCircuit.spray.volume,0);
 assert.equal(restored.oilCircuit.total,0);
 m.requestStop();
 for(let i=0;i<30*120&&m.rpm>0;i++)m.step(DT,0,.22);
 assert.equal(m.rpm,0);
 const track=m.oilCircuit.spray.films.find(p=>p.surface==='case'&&p.y<480);
 assert.ok(track);
 const savedY=track.y,seed=m.oilCircuit.spray.seed,startY=track.startY;
 for(let i=0;i<2*120;i++)m.step(DT,0);
 assert.ok(m.oilCircuit.spray.films.includes(track)&&track.y>savedY&&track.startY===startY);
 assert.equal(m.oilCircuit.spray.seed,seed);
 assert.ok(m.oilCircuit.spray.drops.every(p=>p.kind===1));
 for(let i=0;i<60*120&&m.oilCircuit.spray.volume>0;i++)m.step(DT,0);
 assert.equal(m.oilCircuit.spray.volume,0);
 assert.ok(Math.abs(m.oilCircuit.total-m.oil)<1e-9);
});
