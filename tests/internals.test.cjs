'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Engine,Circuit,Fragments,FRAGMENT_CAP,pistonGeometry,TAU}=require('../src/internals.js');
const {Engine:Legacy}=require('../src/ignition.js');
const run=(e,t,g=0,b=0)=>{for(let i=0;i<Math.round(t*120);i++)e.step(1/120,g,b);return e;};
const start=()=>{const e=new Engine();e.setProfile('normal');e.requestStart();return run(e,4);};
test('Oil and coolant circuits conserve the model inventories during recirculation',()=>{
 const e=start();run(e,18,.5,.3);
 assert.ok(Math.abs(e.oilCircuit.total-e.oil)<1e-9);assert.ok(Math.abs(e.waterCircuit.total-e.coolantLevel*6)<1e-9);
 assert.ok(e.oilCircuit.q>0&&e.waterCircuit.q>0);
 for(const f of[e.oilCircuit,e.waterCircuit])for(const c of f.cells){assert.ok(c.litres>=0&&c.litres<=c.capacity+1e-12);assert.ok(Number.isFinite(c.temp));}
});
test('Dry circuits cannot generate fluid, flow or pressure',()=>{
 const e=start();e.oil=0;e.coolantLevel=0;run(e,8,.3);
 assert.equal(e.oilCircuit.total,0);assert.equal(e.waterCircuit.total,0);assert.ok(e.oilCircuit.q<1e-8);assert.ok(e.waterCircuit.q<1e-8);
});
test('Oil darkening builds under load and survives shutdown, cooling and save',()=>{
 const e=start();assert.ok(e.oilOxidation<.001);
 e.setProfile('stress');run(e,44,1);
 assert.ok(e.oil>1&&e.oilOxidation>.1&&e.oilOxidation<.6);
 const darkened=e.oilOxidation,saved=e.snapshot();
 e.requestStop();run(e,75);
 assert.equal(e.oilOxidation,darkened);
 assert.equal(Engine.restore(e.snapshot()).oilOxidation,darkened);
 delete saved.oilOxidation;
 assert.equal(Engine.restore(saved).oilOxidation,saved.oilCircuit.filterLoad*.55);
});
test('Oxidized oil circulates more slowly at equal temperature and level',()=>{
 const e=new Engine(),fresh=new Circuit('oil'),aged=new Circuit('oil');
 e.rpm=2200;e.oilTemp=96;
 for(let i=0;i<240;i++){
  e.oilOxidation=0;fresh.step(1/120,e,0);
  e.oilOxidation=.8;aged.step(1/120,e,0);
 }
 assert.ok(aged.q>0&&aged.q<fresh.q);
 assert.ok(Math.abs(aged.total-fresh.total)<1e-9);
});
test('The thermostat uses a bypass cold and routes coolant to the radiator warm',()=>{
 const e=new Engine();e.rpm=2000;e.coolant=70;const cold=new Circuit('water');cold.step(.01,e,0);
 assert.ok(cold.bypass>.99);assert.equal(cold.cells[3].flow,0);assert.ok(cold.bypassFlow>0);
 const phase=cold.bypassPhase;assert.ok(phase>0);
 e.coolant=98;cold.step(.01,e,0);
 assert.ok(cold.cells[3].flow>0);assert.equal(cold.bypass,0);assert.equal(cold.bypassFlow,0);
 assert.equal(cold.bypassPhase,phase);
 const saved=cold.snapshot(),restored=new Circuit('water');restored.restore(saved,6);
 assert.equal(restored.bypassPhase,phase);
 delete saved.bypassPhase;restored.restore(saved,6);assert.equal(restored.bypassPhase,0);
});
test('Metal contamination restricts oil flow and opens the filter bypass',()=>{
 const e=new Engine();e.rpm=3000;const clean=new Circuit('oil'),dirty=new Circuit('oil');
 for(let i=0;i<600;i++){clean.step(1/120,e,0);dirty.step(1/120,e,1);}
 assert.ok(dirty.filterLoad>.7);assert.ok(dirty.bypass>0);assert.ok(dirty.q<clean.q);
});
test('Cold oil moves slower and can open a clean filter bypass',()=>{
 const e=new Engine(),cold=new Circuit('oil'),warm=new Circuit('oil');e.rpm=2200;
 for(let i=0;i<240;i++){
  e.oilTemp=35;cold.step(1/120,e,0);
  e.oilTemp=96;warm.step(1/120,e,0);
 }
 assert.ok(cold.q>0&&cold.q<warm.q);
 assert.ok(cold.bypass>0&&warm.bypass===0&&cold.filterLoad===0);
});
test('Filter accumulation requires circulation and survives v7 restore',()=>{
 const e=new Engine(),c=e.oilCircuit;
 c.step(1/120,e,1);assert.equal(c.filterLoad,0);
 e.rpm=2000;c.step(1/120,e,1);assert.equal(c.filterLoad,0);
 for(let i=0;i<120;i++)c.step(1/120,e,1);
 const load=c.filterLoad;assert.ok(load>0&&load<.8);
 e.rpm=0;for(let i=0;i<120;i++)c.step(1/120,e,1);
 assert.equal(c.filterLoad,load);assert.equal(Engine.restore(e.snapshot()).oilCircuit.filterLoad,load);
});
test('Stopped oil drains into the pan without increasing inventory or pump pressure',()=>{
 const e=new Engine(),c=e.oilCircuit,initial=c.cells[0].litres;
 for(let i=0;i<600;i++)c.step(1/120,e,0);
 assert.ok(c.cells[0].litres>initial&&c.cells[0].litres<=c.cells[0].capacity);
 assert.equal(c.q,0);assert.equal(c.pressure,0);
 assert.ok(Math.abs(c.total-e.oil)<1e-9);
});
test('Residual oil runs off the stopped engine, faster when warm and with a finite budget',()=>{
 const cold=new Engine(),hot=new Engine();
 for(const [e,temp] of [[cold,45],[hot,160]]){e.oil=0;e.oilTemp=temp;e.film=.06;}
 const loss=e=>{let amount=0;for(let i=0;i<600;i++){e.step(1/120,0,0);amount+=e.oilRunoff/120;}return amount;};
 const coldDrain=loss(cold),hotDrain=loss(hot);
 assert.ok(hotDrain>coldDrain&&coldDrain>0&&hotDrain<.06);
 assert.equal(hot.oil,0);assert.equal(hot.rpm,0);assert.equal(hot.coolantRunoff,0);
});
test('The cooling circuit loses boiling margin when coolant is scarce',()=>{
 const e=new Engine(),full=new Circuit('water'),low=new Circuit('water');
 e.rpm=1800;e.coolant=118;const fullBoil=e.coolantBoilingPoint();full.step(.05,e,0);
 e.coolantLevel=.32;const lowBoil=e.coolantBoilingPoint();low.step(.05,e,0);
 assert.ok(lowBoil<fullBoil&&low.vapour>full.vapour);
});
test('Crankcase tangential contact drives wear while submerged impacts rebound less',()=>{
 const f=new Fragments(),chip=f.add(1,'ring','case',561,543);
 chip.jammed=true;
 assert.equal(f.circle(chip,chip.x-14,chip.y,18,200,0),0);
 assert.ok(f.circle(chip,chip.x-14,chip.y,18,0,200)>0);
 chip.jammed=false;
 const impulse=surface=>{
  f.oilSurface=surface;
  Object.assign(chip,{x:561,y:543,vx:90,vy:200,w:0});
  f.contact(chip,0,-1,.5);
  return {rebound:-chip.vy,slide:chip.vx,spin:chip.w};
 };
 const dry=impulse(548),wet=impulse(531);
 assert.ok(dry.rebound>wet.rebound&&wet.rebound>0);
 assert.ok(wet.slide>dry.slide&&wet.spin!==0);
});
test('Manual stop lets circulation decay instead of continuing wall-clock animation',()=>{
 const e=start();run(e,5,.5);e.requestStop();run(e,80);assert.equal(e.rpm,0);assert.ok(e.oilCircuit.q<1e-6);assert.ok(e.waterCircuit.q<1e-6);
});
test('Head gasket damage makes exhaust steam and joint damage opens the collector leak',()=>{
 const e=start();e.gasket=.5;run(e,.1);
 assert.ok(e.exhaust.steam>0);assert.ok(e.exhaust.leak<.001);
 e.components.exhaust=.8;run(e,.1);
 assert.ok(e.exhaust.leak>=.52&&e.exhaust.leak<.53);
});
test('A hot worn flange opens under a pressure pulse while a healthy seal stays compressed',()=>{
 const e=start();
 Object.assign(e.exhaust,{flangeTemp:405,manifold:590,pressure:0,pulse:1});
 e.updateExhaustGap();
 assert.equal(e.exhaust.jointGap,0);
 assert.equal(e.exhaust.leak,0);
 e.exhaust.sealWear=.5;
 e.exhaust.pulse=0;e.updateExhaustGap();
 assert.equal(e.exhaust.jointGap,0);
 e.exhaust.pulse=1;e.updateExhaustGap();
 assert.ok(e.exhaust.jointGap>0&&e.exhaust.jointGap<.05&&e.exhaust.leak>0);
});
test('Exhaust seal warps and leaks under sustained stress, with wear retained in v7',()=>{
 const e=new Engine();e.requestStart();run(e,4);run(e,50,1,.2);
 const initialWear=e.exhaust.sealWear;
 assert.ok(initialWear>0&&initialWear<.4);
 assert.equal(e.exhaust.jointGap,0);
 const events=[];
 for(let i=0;i<40;i++){run(e,1,1,.2);events.push(...e.drainEvents());}
 assert.ok(e.exhaust.flangeTemp>380&&e.exhaust.flangeTemp<e.exhaust.manifold);
 assert.equal(e.exhaust.sealWear,1);
 assert.ok(e.exhaust.jointGap>.2&&e.exhaust.leak>e.components.exhaust*.65+.01);
 const failures=events.filter(event=>event.type==='exhaustSeal');
 assert.equal(failures.length,1);
 const hot=e.exhaust.flangeTemp,opening=e.exhaust.jointGap;
 e.requestStop();run(e,60);
 assert.ok(e.exhaust.flangeTemp<hot&&e.exhaust.jointGap<opening);
 assert.equal(e.exhaust.sealWear,1);
 const saved=JSON.parse(JSON.stringify(e.snapshot())),restored=Engine.restore(saved);
 for(const key of ['flangeTemp','sealWear','jointGap','leak'])assert.equal(restored.exhaust[key],e.exhaust[key]);
 assert.deepEqual(restored.log.filter(event=>event.type==='exhaustSeal'),failures);
 delete saved.exhaust.flangeTemp;delete saved.exhaust.sealWear;
 const previous=Engine.restore(saved);
 assert.ok(Number.isFinite(previous.exhaust.flangeTemp)&&previous.exhaust.sealWear===0);
 assert.equal(previous.exhaust.leak,.65*e.components.exhaust);
 saved.exhaust.flangeTemp='hot';saved.exhaust.sealWear=2;saved.exhaust.jointGap=99;
 const hostile=Engine.restore(saved);
 assert.ok(Number.isFinite(hostile.exhaust.flangeTemp)&&hostile.exhaust.sealWear===1&&hostile.exhaust.jointGap<=1.2);
});
test('Pickup, pump, baffle and radiator failures alter the circuits they belong to',()=>{
 const state=start().snapshot();
 const compare=part=>{
  const e=Engine.restore(state);
  if(part)e.auxWear[part]=1;
  e.rpm=3500;e.block=130;e.coolant=99;
  return run(e,4,.88);
 };
 const clean=compare(),pickup=compare('oilPickup'),pump=compare('waterPump');
 assert.ok(pickup.pressure<clean.pressure*.6&&pickup.oilCircuit.q<clean.oilCircuit.q*.8);
 assert.ok(pickup.oilCircuit.cells[1].bubbles>.4&&Math.abs(pickup.oil-clean.oil)<1e-9);
 assert.ok(Math.abs(pickup.oilCircuit.total-pickup.oil)<1e-9);
 assert.ok(pump.waterCircuit.q<clean.waterCircuit.q*.4&&pump.block>clean.block+2);
 assert.equal(pump.coolantLevel,clean.coolantLevel);
 const baffle=compare('mufflerBaffle'),radiator=compare('radiator');
 assert.ok(baffle.exhaust.pressure>clean.exhaust.pressure+4&&baffle.exhaust.resonator>clean.exhaust.resonator);
 assert.ok(radiator.radiatorRunoff>0&&radiator.coolantLevel<clean.coolantLevel);
 assert.equal(radiator.coolantRunoff,0);
 assert.ok(Math.abs(radiator.waterCircuit.total-radiator.coolantLevel*6)<1e-9);
 radiator.requestStop();run(radiator,20);
 assert.equal(radiator.rpm,0);assert.equal(radiator.auxWear.radiator,1);
 assert.ok(radiator.radiatorRunoff>0);
 radiator.coolantLevel=0;run(radiator,.1);
 assert.equal(radiator.radiatorRunoff,0);assert.equal(radiator.waterCircuit.total,0);
});
test('Auxiliary parts progressively fail once, persist in v7 and never stop the last piston',()=>{
 const e=new Engine();e.setProfile('stress');e.requestStart();run(e,4);
 const parts=['waterPump','oilPickup','mufflerBaffle','radiator'];
 const progress=new Set(),events=[];
 for(let i=0;i<120*120;i++){
  e.step(1/120,1);
  for(const part of parts)if(e.auxWear[part]>0&&e.auxWear[part]<1)progress.add(part);
  events.push(...e.drainEvents().filter(event=>parts.includes(event.type)));
 }
 assert.equal(progress.size,parts.length);
 assert.deepEqual(events.map(event=>event.type).sort(),parts.slice().sort());
 assert.ok(e.activeCount===1&&e.ignition==='running');
 const save=JSON.parse(JSON.stringify(e.snapshot())),restored=Engine.restore(save);
 assert.equal(save.version,7);
 assert.deepEqual(restored.auxWear,e.auxWear);
 assert.equal(restored.events.length,0);
 assert.deepEqual(restored.log.filter(event=>parts.includes(event.type)),e.log.filter(event=>parts.includes(event.type)));
 delete save.auxWear;
 const legacy=Engine.restore(save);
 assert.ok(Object.values(legacy.auxWear).every(wear=>wear===0));
 assert.ok(!legacy.log.some(event=>parts.includes(event.type)));
 save.auxWear={waterPump:2,oilPickup:-1,mufflerBaffle:NaN,radiator:'1'};
 assert.deepEqual(Engine.restore(save).auxWear,{waterPump:1,oilPickup:0,mufflerBaffle:0,radiator:0});
});
test('Ring lands, the skirt and the exhaust valve fail progressively and leave distinct debris',()=>{
 const e=new Engine();e.requestStart();run(e,2);
 const kinds={ringLand:'ringLand',skirt:'skirt',exhaustValve:'valve'};
 const events=new Map(),partial=new Set();
 let valvePeak=0,crownPeak=0;
 for(let step=0;step<120*220;step++){
  e.step(1/120,1);
  for(const cy of e.cylinders){
   for(const [part,wear] of Object.entries(cy.partWear))if(wear>0&&wear<1)partial.add(`${cy.id}:${part}`);
   valvePeak=Math.max(valvePeak,cy.exhaustValveTemp);
   crownPeak=Math.max(crownPeak,cy.contact.crownTemp);
  }
  for(const event of e.drainEvents()){
   if(!Object.hasOwn(kinds,event.type))continue;
   const key=`${event.cylinder}:${event.type}`;
   assert.ok(!events.has(key));
   assert.ok(partial.has(key));
   assert.ok(e.fragments.bodies.some(p=>p.cylinder===event.cylinder&&p.kind===kinds[event.type]&&p.zone===(event.type==='skirt'?'liner':'chamber')));
   events.set(key,event);
  }
 }
 assert.deepEqual(new Set([...events.values()].map(event=>event.type)),new Set(Object.keys(kinds)));
 assert.ok(e.cylinders.some(cy=>cy.active&&Object.values(cy.partWear).every(wear=>wear===1)));
 assert.ok(valvePeak>500&&crownPeak<350&&e.activeCount===1&&e.rpm>=380);
 const saved=JSON.parse(JSON.stringify(e.snapshot())),restored=Engine.restore(saved);
 assert.equal(saved.version,7);
 assert.deepEqual(restored.cylinders.map(cy=>cy.partWear),e.cylinders.map(cy=>cy.partWear));
 assert.deepEqual(restored.cylinders.map(cy=>cy.exhaustValveTemp),e.cylinders.map(cy=>cy.exhaustValveTemp));
 assert.deepEqual(restored.log.filter(event=>Object.hasOwn(kinds,event.type)),e.log.filter(event=>Object.hasOwn(kinds,event.type)));
 const hot=restored.cylinders.find(cy=>cy.active),initialCrown=hot.contact.crownTemp;
 hot.contact.bearingTemp=164;
 restored.requestStop();run(restored,60);
 assert.ok(hot.exhaustValveTemp<250&&hot.contact.crownTemp<initialCrown-45&&hot.contact.bearingTemp<130);
 assert.deepEqual(restored.cylinders.map(cy=>cy.partWear),e.cylinders.map(cy=>cy.partWear));
 for(const cy of saved.cylinders){delete cy.partWear;delete cy.exhaustValveTemp;}
 const legacy=Engine.restore(saved);
 assert.ok(legacy.cylinders.every(cy=>cy.exhaustValveTemp===legacy.headTemp&&Object.values(cy.partWear).every(wear=>wear===0)));
});
test('A chipped piston and valve reduce sealing and raise dry liner wear only in their cylinder',()=>{
 const baseline=start().snapshot(),healthy=Engine.restore(baseline),damaged=Engine.restore(baseline);
 healthy.oil=damaged.oil=0;
 healthy.pressure=damaged.pressure=0;
 healthy.cylinders[0].contact.filmMicron=damaged.cylinders[0].contact.filmMicron=0;
 damaged.cylinders[0].partWear={ringLand:1,skirt:1,exhaustValve:1};
 run(healthy,.1,.5);run(damaged,.1,.5);
 const a=healthy.cylinders[0],b=damaged.cylinders[0],untouched=damaged.cylinders[1];
 assert.ok(b.compression<a.compression*.8);
 assert.ok(b.contact.liner>a.contact.liner&&b.contact.wallTemp>a.contact.wallTemp);
 assert.ok(untouched.compression>b.compression&&untouched.contact.liner<b.contact.liner);
 assert.equal(damaged.activeCount,4);
});
test('Fragments collide with the pan and remain inside crankcase bounds',()=>{
 const e=new Engine(),w=new Fragments(19);e.rpm=0;e.shaftSpeed=0;
 for(let i=0;i<20;i++){const p=w.add(i%4,'metal','case',330+i*24,520);p.vy=700;}
 for(let i=0;i<600;i++)w.step(1/120,e);
 assert.ok(w.impacts>0);assert.equal(w.bodies.length,20);
 for(const p of w.bodies){assert.ok(p.x>=305+p.r-.01&&p.x<=890-p.r+.01);assert.ok(p.y>=417+p.r-.01&&p.y<=548-p.r+.01);}
});
test('Moving crank imparts velocity to an internal fragment',()=>{
 const e=start(),w=new Fragments(23),g=pistonGeometry(e.phase,0,373),p=w.add(0,'metal','case',g.crankX+17,g.crankY);
 p.vx=p.vy=0;const before={x:p.x,y:p.y};w.step(1/120,e);
 assert.ok(Math.hypot(p.vx,p.vy)>1);assert.ok(p.x!==before.x||p.y!==before.y);
});
test('A crankcase fragment catches at the cap lip only under an opposing moving contact',()=>{
 const e=new Engine(),w=e.fragments,p=w.add(0,'rod','case',882,425);p.vx=p.vy=0;
 for(let i=0;i<60;i++)w.step(1/120,e);
 assert.equal(p.jammed,false);assert.equal(p.pinch,0);
 const q=w.add(0,'rod','case',330,463);q.vx=q.vy=q.w=0;e.rpm=4000;e.shaftSpeed=18;
 for(let i=0;i<30;i++){e.phase+=e.shaftSpeed/120;w.step(1/120,e);}
 assert.equal(q.jammed,true);assert.equal(q.jamEdge,'cap');
 assert.equal(q.edgeX,321);assert.ok(q.edgeY>=449&&q.edgeY<=454);
 assert.equal(q.w,0);
 assert.ok(w.events.some(event=>event.type==='jam'&&event.edgeX===q.edgeX&&event.edgeY===q.edgeY));
});
test('A jam wears under moving contact and retains its progress in a version 7 save',()=>{
 const e=new Engine(),w=e.fragments;
 const sheltered=w.add(0,'rod','case',350,540),loaded=w.add(0,'rod','case',373,426);
 for(const p of [sheltered,loaded]){p.jammed=true;p.vx=p.vy=0;}
 e.rpm=3000;e.shaftSpeed=14;
 const advance=steps=>{for(let i=0;i<steps;i++){
  e.phase=(e.phase+e.shaftSpeed/120)%(2*TAU);w.step(1/120,e);
 }};
 advance(30);
 assert.ok(loaded.jamWear>0&&loaded.jammed);assert.ok(w.resistance>0);
 const save=JSON.parse(JSON.stringify(e.snapshot())),restored=Engine.restore(save);
 assert.equal(restored.fragments.bodies[1].jamWear,loaded.jamWear);
 delete save.fragments.bodies[1].jamWear;
 assert.equal(Engine.restore(save).fragments.bodies[1].jamWear,0);
 advance(930);
 assert.ok(loaded.releaseCount>0&&loaded.r<8&&loaded.mass<.11);
 assert.deepEqual([sheltered.jammed,sheltered.x,sheltered.y,sheltered.r,sheltered.jamWear,sheltered.releaseCount],[true,350,540,8,0,0]);
});
test('Ring pinching produces persistent jamming, friction and secondary liner damage',()=>{
 const e=start();const p=e.fragments.add(0,'ring','chamber',417,237);p.vx=p.vy=0;
 const before=e.cylinders[0].contact.liner;run(e,8,.4,.2);
 assert.ok(e.fragments.jamCount>0||e.fragments.bodies.some(x=>x.releaseCount>0));
 assert.ok(e.fragments.resistance>0);assert.ok(e.cylinders[0].contact.liner>before);assert.ok(e.fragments.dust>0);assert.ok(p.jamWear>0);
});
test('The closing crown cocks a ring at the liner but leaves a centered ring flat',()=>{
 const runSide=x=>{
  const e=new Engine(),p=e.fragments.add(1,'ring','chamber',x,244);
  p.vx=p.vy=p.w=0;e.rpm=2500;e.shaftSpeed=33;e.phase=e.cylinders[1].offset-1.55;
  for(let i=0;i<5;i++){e.phase+=e.shaftSpeed/120;e.fragments.step(1/120,e);}
  assert.ok(e.fragments.impacts>0);
  return p;
 };
 assert.ok(runSide(561).skew>.09);
 assert.ok(runSide(473).skew<-.09);
 const center=runSide(517);
 assert.equal(center.skew,0);assert.equal(center.jammed,false);
});
test('Oil film reduces abrasion and reaction torque at the same ring contact',()=>{
 function runContact(film){
  const e=new Engine(),p=e.fragments.add(1,'ring','chamber',561,236);
  e.rpm=2000;e.shaftSpeed=12;e.cylinders[1].contact.filmMicron=film;
  p.jammed=true;p.vx=p.vy=0;
  let peakRubbing=0,peakTorque=0;
  for(let i=0;i<180;i++){
   e.phase=(e.phase+e.shaftSpeed/120)%(TAU*2);
   e.fragments.step(1/120,e);
   peakRubbing=Math.max(peakRubbing,p.rubbing);
   peakTorque=Math.max(peakTorque,e.fragments.resistance);
  }
  return {wear:p.jamWear,heat:p.heat,peakRubbing,peakTorque};
 }
 const dry=runContact(0),wet=runContact(3);
 assert.ok(wet.wear>0&&wet.wear<dry.wear);
 assert.ok(wet.heat<dry.heat);
 assert.ok(wet.peakTorque>0&&wet.peakTorque<dry.peakTorque);
 assert.ok(wet.peakRubbing<dry.peakRubbing);
});
test('The second-cylinder ring wears, slips, saves its scuff and releases at half brake',()=>{
 const e=new Engine();e.setProfile('stress');e.requestStart();run(e,2);
 const isRing=p=>p.zone==='chamber'&&p.cylinder===1&&p.kind==='ring'&&p.jammed;
 let ring;
 for(let i=0;i<3600&&!ring;i++){e.step(1/120,1,0);ring=e.fragments.bodies.find(isRing);}
 assert.ok(ring);
 assert.equal(ring.jamEdge,'liner');assert.equal(ring.edgeX,565);
 const initialAngle=ring.a,initialRadius=ring.r,initialSkew=ring.skew;
 assert.ok(initialSkew>0);
 for(let i=0;i<7200&&ring.jamSlip<.1&&!ring.releaseCount;i++)e.step(1/120,1,.5);
 assert.ok(ring.jammed&&ring.jamSlip>=.1&&ring.r<initialRadius&&ring.r>initialRadius*.72);
 assert.notEqual(ring.a,initialAngle);
 assert.ok(ring.skew<initialSkew);
 const mark=e.fragments.linerScuffs.find(mark=>mark.cylinder===1);
 assert.ok(mark.side===1&&mark.top<=ring.y&&mark.bottom>=ring.y&&mark.depth>0);
 const data=JSON.parse(JSON.stringify(e.snapshot())),restored=Engine.restore(data);
 const restoredRing=restored.fragments.bodies.find(isRing);
 for(const key of ['r','jamRadius','jamWear','jamSlip','wearFace','skew','jamEdge','edgeX','edgeY'])assert.equal(restoredRing[key],ring[key]);
 assert.deepEqual(restored.fragments.linerScuffs,e.fragments.linerScuffs);
 for(let i=0;i<7200&&!ring.releaseCount;i++)e.step(1/120,1,.5);
 assert.equal(ring.releaseCount,1);
 assert.equal(ring.jammed,false);
 assert.equal(ring.jamEdge,'');
 assert.ok(ring.r<2.6&&ring.x>=469+ring.r&&ring.x<=565-ring.r);
 assert.ok(ring.y>=232+ring.r&&ring.y<=410);
 assert.equal(e.ignition,'running');
 assert.ok(e.fragments.linerScuffs.includes(mark)&&mark.depth>0&&e.fragments.linerScuffs.length<=16);
});
test('A sheltered crankcase jam leaves cylinder wear and compression alone',()=>{
 const clean=start(),blocked=start(),p=blocked.fragments.add(0,'rod','case',350,540);
 p.jammed=true;p.vx=p.vy=0;
 run(clean,8,.4,.1);run(blocked,8,.4,.1);
 assert.equal(blocked.fragments.jamCount,1);assert.equal(blocked.fragments.resistance,0);
 assert.deepEqual(blocked.cylinders,clean.cylinders);
});
test('A loaded crankcase wedge heats and wears the journal it actually touches',()=>{
 const clean=start(),blocked=start(),p=blocked.fragments.add(3,'bearing','case',373,426);
 p.jammed=true;p.vx=p.vy=0;
 run(clean,1,.4,.1);run(blocked,1,.4,.1);
 const journal=blocked.cylinders[0].contact;
 assert.ok(journal.bearing>clean.cylinders[0].contact.bearing+.002);
 assert.ok(journal.bearingTemp>clean.cylinders[0].contact.bearingTemp+1);
 // Tiny global filtration changes do not count as direct wear on a different journal.
 assert.ok(Math.abs(blocked.cylinders[3].contact.bearing-clean.cylinders[3].contact.bearing)<1e-7);
 assert.equal(Engine.restore(blocked.snapshot()).cylinders[0].contact.bearing,journal.bearing);
});
test('Fragments collide with each other without disappearing',()=>{
 const w=new Fragments();const a=w.add(0,'metal','case',360,535),b=w.add(1,'metal','case',362,535);a.vx=50;b.vx=-50;
 w.step(1/120,new Engine());assert.equal(w.bodies.length,2);assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=a.r+b.r-.2);
});
test('Pair separation cannot push chamber fragments through the liner',()=>{
 const e=new Engine(),w=e.fragments;
 const left=w.add(0,'rod','chamber',333,240),right=w.add(0,'rod','chamber',334,240);
 left.vx=left.vy=right.vx=right.vy=0;
 w.step(1/120,e);
 assert.ok(left.x-left.r>=325);assert.ok(right.x+right.r<=421);
});
test('Fragment pool has a hard cap and overflow becomes bounded contamination',()=>{
 const w=new Fragments();for(let i=0;i<500;i++)w.add(i%4);assert.equal(w.bodies.length,FRAGMENT_CAP);assert.ok(w.dust>0&&w.dust<=1);
});
test('A broken rod and an ejected piston shed different parts that persist in v7 saves',()=>{
 const e=start();
 e.cylinders[1].wear=.999;e.step(1/120,1,0);
 assert.equal(e.cylinders[1].failure,'rod');assert.equal(e.activeCount,3);
 assert.equal(e.fragments.bodies.length,12);
 const bearing=e.fragments.bodies.find(p=>p.kind==='bearing');
 assert.equal(bearing?.cylinder,1);assert.equal(bearing.zone,'case');
 assert.ok(e.fragments.bodies.some(p=>p.kind==='rod'&&['liner','case'].includes(p.zone)));
 assert.ok(!e.fragments.bodies.some(p=>p.kind==='crown'));
 run(e,4.1);
 e.cylinders[2].wear=.999;e.step(1/120,1,0);
 assert.equal(e.cylinders[2].failure,'ejected');assert.equal(e.activeCount,2);
 assert.equal(e.fragments.bodies.length,23);
 assert.ok(e.fragments.detached[2]);
 assert.deepEqual(Engine.restore(e.snapshot()).fragments.detached[2],e.fragments.detached[2]);
 for(let i=0;i<240&&e.fragments.detached[2];i++)e.step(1/120,0);
 assert.ok(!e.fragments.detached[2]);
 assert.equal(e.fragments.bodies.length,24);
 const crown=e.fragments.bodies.find(p=>p.kind==='crown');
 assert.equal(crown?.cylinder,2);assert.equal(crown.zone,'chamber');
 const restored=Engine.restore(JSON.parse(JSON.stringify(e.snapshot())));
 for(const p of [bearing,crown]){
  const saved=restored.fragments.bodies.find(q=>q.kind===p.kind&&q.cylinder===p.cylinder);
  for(const k of ['zone','x','y','mass','r'])assert.equal(saved?.[k],p[k]);
 }
 let crossing;
 for(let i=0;i<490&&crown.zone!=='case';i++){
  const prior={x:crown.x,y:crown.y};
  e.step(1/120,0);
  if(crown.zone==='case')crossing=Math.hypot(crown.x-prior.x,crown.y-prior.y);
 }
 assert.ok(crossing>0&&crossing<9);
 assert.equal(crown.zone,'case');assert.ok(crown.y>=417+crown.r&&crown.y<=548-crown.r);
 assert.equal(e.fragments.bodies.length,24);
});
test('Saved fragments retain location and jam state with safe validated numeric values',()=>{
 const e=start();const p=e.fragments.add(2,'ring','chamber',705,240);p.jammed=true;e.fragments.dust=.4;const d=e.snapshot();const r=Engine.restore(JSON.parse(JSON.stringify(d)));
 assert.equal(r.snapshot().version,7);assert.equal(r.fragments.bodies[0].jammed,true);assert.equal(r.fragments.bodies[0].x,p.x);assert.equal(r.fragments.dust,.4);
 assert.equal(r.gasCommand,0);assert.equal(r.brakeCommand,0);assert.equal(r.events.length,0);
});
test('Malformed fragment and fluid saves are sanitized, never NaN or unbounded arrays',()=>{
 const d=start().snapshot();d.fragments={bodies:Array.from({length:100},()=>({x:Infinity,y:-1e30,r:99,mass:NaN,jammed:true})),dust:Infinity};d.oilCircuit={cells:Array(6).fill({litres:1e9,temp:NaN,phase:Infinity})};
 const e=Engine.restore(d);run(e,1,.2);assert.ok(e.fragments.bodies.length<=64);assert.ok(Math.abs(e.oilCircuit.total-e.oil)<1e-8);
 for(const p of e.fragments.bodies)for(const k of ['x','y','vx','vy','r','mass'])assert.ok(Number.isFinite(p[k]));
});
test('Version 6 saves retain electrical state and damage without fabricating fragment history',()=>{
 const old=new Legacy();old.cylinders[2].active=false;old.cylinders[2].failure='rod';const e=Engine.restore(old.snapshot());assert.equal(e.activeCount,3);assert.equal(e.ignition,'off');assert.equal(e.fragments.bodies.length,0);
});
test('Realism model remains deterministic and invalid timesteps do nothing',()=>{
 const a=start(),b=start();run(a,24,.7);run(b,24,.7);assert.deepEqual(a.snapshot(),b.snapshot());const before=JSON.stringify(a.snapshot());a.step(NaN,1);a.step(-1);assert.equal(JSON.stringify(a.snapshot()),before);
});
test('An hour of loaded one-cylinder survival keeps contacts, fluids and events bounded',()=>{
 const e=start();e.setProfile('stress');run(e,240,1);assert.equal(e.activeCount,1);run(e,3600,1,1);
 assert.equal(e.activeCount,1);assert.equal(e.ignition,'running');assert.ok(e.rpm>=380);assert.ok(e.fragments.bodies.length<=64);assert.ok(e.events.length<=32);
 assert.ok(Math.abs(e.oilCircuit.total-e.oil)<1e-8);assert.ok(Math.abs(e.waterCircuit.total-e.coolantLevel*6)<1e-8);
 for(const x of[e.fragments.resistance,e.fragments.dust,e.exhaust.pressure,e.block,e.rpm])assert.ok(Number.isFinite(x));
});
