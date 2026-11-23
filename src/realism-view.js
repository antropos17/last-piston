/* Mechanical cutaway: finite-flow inspection windows and model-owned debris.
 * Geometry is never integrated here. Rendering the paused engine is pure.
 */
(function(root){
'use strict';
const {Renderer:Prior,clamp,TAU,pistonGeometry,OIL_PICKUP,OIL_PAN,SPILL_PIPE,COOLANT_HOSE,HOSE_RUPTURE,CRANK_SEALS,crankSealOpening}=root.Piston,XS=[373,517,661,805];
const EXHAUST_JOINT=[974,271],EXHAUST_OUTLET=[1155,359],OUTLET_ANGLE=.38;
const MUFFLER_BOUNDS=[982,282,146,94],MUFFLER_DUCT=[[991,323],[1010,323],[1101,330],[1116,330]];
const HEAT_W=120,HEAT_H=96,HEAT_PAD=8;
const RADIATOR_NECK=[151,431];
const OIL_RUNS=[[286,287,105],[916,329,170],[307,508,45]];
const COOLANT_RUNS=[[284,231,67],[914,231,76]];
const oilWet=m=>clamp(m.film*12+m.oilRunoff*4,0,1);
const coolantWet=m=>Math.sqrt(clamp(m.coolantRunoff*25,0,1));
const steelGlow=temp=>clamp((temp-525)/134,0,1);
class Renderer extends Prior{
 constructor(canvas){
  super(canvas);this.resetPlumes();this.contactMarks=[];this.metalSparks=[];
 }

 makeSmoke(){
  const textures=super.makeSmoke();
  // Keep the billow masks and give each aerosol an upper-left light face.
  for(let i=0;i<9;i++){
   const q=textures[i].getContext('2d');q.globalCompositeOperation='source-atop';
   const light=q.createLinearGradient(10,4,113,125);
   light.addColorStop(0,i<3?'rgba(175,178,172,.37)':i<6?'rgba(132,151,160,.5)':'rgba(235,239,231,.6)');
   light.addColorStop(.57,i<3?'rgba(133,135,130,.14)':i<6?'rgba(112,131,142,.31)':'rgba(198,204,200,.23)');
   light.addColorStop(1,'rgba(45,46,44,.33)');
   q.fillStyle=light;q.fillRect(0,0,128,128);
   q.globalCompositeOperation='source-over';
  }
  for(let i=0;i<3;i++){
   const soot=document.createElement('canvas');soot.width=soot.height=128;
   const q=soot.getContext('2d');
   q.drawImage(textures[i],0,0);q.globalCompositeOperation='source-atop';
   const ash=q.createRadialGradient(42,35,4,67,74,65);
   ash.addColorStop(0,'rgba(91,86,78,.85)');ash.addColorStop(.55,'rgba(32,30,29,.91)');ash.addColorStop(1,'rgba(53,52,49,.82)');
   q.fillStyle=ash;q.fillRect(0,0,128,128);
   textures.push(soot);
  }
  for(let i=3;i<6;i++){
   const haze=document.createElement('canvas');haze.width=haze.height=128;
   const q=haze.getContext('2d');q.drawImage(textures[i],0,0);q.globalCompositeOperation='source-atop';
   const light=q.createLinearGradient(0,0,128,128);
   light.addColorStop(0,'rgba(157,180,204,.86)');light.addColorStop(1,'rgba(85,109,142,.63)');
   q.fillStyle=light;q.fillRect(0,0,128,128);textures.push(haze);
  }
  return textures;
 }

 event(e,m){
  if(e.type==='tipIn'){
   this.currentModel=m;
   this.spring.vx-=55*e.level;this.spring.rollRate-=.32*e.level;
   const strength=e.level*(1-m.exhaust.leak);
   for(let i=0;i<Math.ceil(strength*(this.reduced?3:9)*this.quality);i++)this.puff(...EXHAUST_OUTLET,'tipIn',strength);
   return;
  }
  if(e.type==='backfire'){
   super.event(e,m);
   this.rings.length=0;
   return;
  }
  if(e.type==='pistonSlap'){
   const s=this.spring,level=clamp(e.level||0,0,1),direction=-Math.sign(e.nx);
   const lever=clamp((540-e.y)/320,0,1);
   // Equal and opposite reaction on the block, applied above the mounts.
   s.vx=clamp(s.vx+direction*18*Math.sqrt(level),-56,56);
   s.rollRate=clamp(s.rollRate+direction*.18*lever*Math.sqrt(level),-.36,.36);
   return;
  }
  if(e.type==='bearingKnock'||e.type==='preIgnition'||e.type==='mainBearingKnock'){
   const s=this.spring,kick=(e.type==='mainBearingKnock'?24:e.type==='preIgnition'?21:14)*Math.sqrt(clamp(e.level,0,1));
   s.vx=clamp(s.vx-e.nx*kick,-56,56);
   s.vy=clamp(s.vy-e.ny*kick,-48,48);
   s.rollRate=clamp(s.rollRate-e.ny*kick*(e.x-589)*.000047,-.36,.36);
   return;
  }
  if(e.type==='chainRattle'||e.type==='chainSkip'||e.type==='chainBreak'){
   this.impulse=Math.max(this.impulse,e.type==='chainBreak'?5:e.type==='chainSkip'?2:e.level*.76);
   return;
  }
  if(e.type==='impact'||e.type==='jam'||e.type==='edgeChip'||e.type==='bearingWipe'||e.type==='bearingSpin'||e.type==='caseBreach'||e.type==='hydrolock'){
   const jam=e.type==='jam',strength=e.level||.1;
   this.impulse=Math.max(this.impulse,e.type==='hydrolock'?4+strength*5:e.type==='caseBreach'?5.7:e.type==='bearingSpin'?4.8:jam?3.8:e.type==='bearingWipe'?3.3:strength*2);
   if(Number.isFinite(e.y)&&(jam||strength>.24)){
    if(this.contactMarks.length>=12)this.contactMarks.shift();
    this.contactMarks.push({x:e.x,y:e.y,nx:e.nx??0,ny:e.ny??-1,strength,age:0,jam});
   }
   if(!this.reduced&&e.spark>.07){
    for(let i=0;i<2+Math.floor(e.spark*3)&&this.metalSparks.length<16;i++){
     const side=(this.rand()-.5)*2,kick=31+this.rand()*72;
     this.metalSparks.push({x:e.x,y:e.y,vx:(e.nx-e.ny*side)*kick,vy:(e.ny+e.nx*side)*kick,age:0,life:.055+this.rand()*.09});
    }
   }
   return;
  }
  if(e.type==='cylinder'){
   this.impulse=11;
   const power=clamp(m.film*10,0,.8)*clamp((m.headerTemp-150)/100,0,1);
   if(power>.06)for(let i=0;i<4;i++)this.puff(XS[e.cylinder],218,'oil-mist',power);
   return;
  }
  super.event(e,m);
 }
 fragment(x,y,kind='chip',force=1){
  // Internal metal belongs to the model, not the old external firework emitter.
  if(kind==='spark'||x>290&&x<915&&y>230&&y<552)return;
  super.fragment(x,y,kind,force);
 }
 restoreDebris(m){this.debris=[];}
 smokeLimit(){return Math.round((this.performanceMode==='eco'?150:260)*this.quality);}
 puff(x,y,kind='exhaust',power=1){
  const m=this.currentModel;if(!m)return;
  const e=m.exhaust;
  const burst=kind==='tipIn',tail=burst||kind==='tailpipe'||kind==='backfire',leak=kind==='exhaust-leak',exhaust=tail||leak;
  // Suppress inherited ambient emissions; their random sources ignore the liquid and exhaust circuits.
  if(kind==='exhaust'||kind==='steam'||kind==='oil'||(exhaust&&(m.ignition!=='running'||(m.overrun&&e.ringOil<.012))))return;
  if(this.smoke.length>=this.smokeLimit())return;
  const radiator=kind==='radiator-steam',p=radiator?{x,y}:this.world(x,y);
  if(exhaust){
   const jet=clamp(e.pulse+(burst?power:kind==='backfire'?.6:0),0,1.6),pressure=clamp(e.pressure/12,0,1);
   const condensation=tail?e.condensation:0;
   const vapour=e.steam*(1.8+1.3*e.coolantSteam)+condensation*.87,oil=e.oil*1.45,carbon=e.carbon*1.35;
   const burntOil=4.7*e.ringOil,mix=this.rand()*(.044+vapour+oil+carbon+burntOil);
   const texture=burst?9:mix<burntOil?12:mix<burntOil+vapour?6:mix<burntOil+vapour+oil?3:mix<burntOil+vapour+oil+carbon?9:0;
   const oilCloud=texture===12?Math.sqrt(e.ringOil):0;
   power*=burst?1:.006+jet*.024+pressure*.012+e.oil*.98+e.steam*1.26+e.coolantSteam*.82+(texture===9?Math.sqrt(e.carbon)*1.55:e.carbon*.83)+condensation*.55+e.ringOil*1.45+.43*oilCloud;
   const rise=clamp(((tail?e.tail:e.manifold)-28)/(tail?200:490),0,1);
   const dissipates=texture===6&&(e.steam<.08||this.rand()<condensation/Math.max(.001,condensation+e.steam*2));
   const speed=25+Math.sqrt(e.jetSpeed)*13+jet*56+pressure*17+this.rand()*(burst?95:8);
   const angle=OUTLET_ANGLE+this.pose.a+(this.rand()-.5)*(tail?.24:.39);
   const side=(this.rand()-.5)*(tail?5:3),dx=Math.cos(angle),dy=Math.sin(angle);
   this.smoke.push({x:p.x+(tail?dx*3-dy*side:0),y:p.y+(tail?dy*3+dx*side:side),
    vx:tail?speed*dx:14+jet*36+pressure*22,vy:tail?speed*dy:-33-jet*28-this.rand()*16,
    age:0,life:(dissipates?.73:tail?2.35:1.42)+this.rand()*(dissipates?.43:.82)+oilCloud*.9,r:(tail?7.5:4.2)+this.rand()*4+jet*1.6+e.coolantSteam*12+oilCloud*7,
    grow:(tail?27:18)+Math.min(1,power)*14+rise*10+e.coolantSteam*20+oilCloud*26,rot:this.rand()*TAU,spin:Math.sign(side)*(.65+jet*.7),
    tex:texture+Math.floor(this.rand()*3),alpha:clamp(power,0,1.04),front:leak,jet:true,tail,rise});
   return;
  }
  if(kind==='spill-smoke'){
   const dark=m.exhaustSpill.burning;
   this.smoke.push({x:p.x,y:p.y,vx:(this.rand()-.46)*26,vy:-56-this.rand()*28,
    age:0,life:1.35+this.rand()*.95,r:5+this.rand()*7,grow:24+power*17,rot:this.rand()*TAU,
    spin:(this.rand()-.5)*.62,tex:(dark?9:3)+Math.floor(this.rand()*3),alpha:.19+power*.59,front:this.rand()<.72});
   return;
  }
  const steam=kind==='coolant-steam'||kind==='hose-steam'||radiator,oil=kind==='oil-mist',drift=radiator?1:x<320?-1:1;
  this.smoke.push({x:p.x,y:p.y,vx:drift*(6+this.rand()*12),vy:-(steam?44:22)-this.rand()*(steam?26:17),
   age:0,life:(steam?1.65:2.5)+this.rand()*.65,r:(steam?6:8)+this.rand()*6,grow:steam?21+power*14:14+power*8,
   rot:this.rand()*TAU,spin:(this.rand()-.5)*.26,tex:(steam?6:oil?3:0)+Math.floor(this.rand()*3),
   alpha:clamp(power,.02,steam?.92:.8),front:!oil||this.rand()<.25});
 }
 update(dt,m){
  super.update(dt,m);
  if(m.fragments.caseBreach)this.drops=this.drops.filter(p=>p.pipeY===undefined||p.y<p.pipeY);
  if(this.smoke.length>this.smokeLimit())this.smoke.length=this.smokeLimit();
  for(const p of this.smoke)if(p.jet){
   const mixing=Math.min(1,p.age*3.2);
   const roomAir=p.tail?-13:0;
   p.vx=roomAir+(p.vx-roomAir)*Math.exp(-dt*(p.tail?1.65+mixing:.96));
   const buoyancy=p.tex>=6&&p.tex<9?65:37;
   p.vy-=dt*((p.front?12:32)+p.rise*buoyancy)*mixing;
   p.grow*=1-dt*.48;
   if(!this.reduced){
    // Neighbouring puffs entrain the same air. Opposite edges roll out of the jet.
    const eddy=Math.sin(p.x*.036+p.y*.021-this.t*2.7);
    p.vx+=(eddy*(16+p.rise*17)+Math.cos(p.rot)*p.spin*13)*dt*mixing;
    p.vy+=(Math.cos(p.x*.036-this.t*2.7)*12+p.spin*27/(1+p.age*3))*dt*mixing;
   }
  }
  for(const mark of this.contactMarks)mark.age+=dt;
  while(this.contactMarks[0]?.age>.33)this.contactMarks.shift();
  for(const p of this.metalSparks){p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=440*dt;}
  this.metalSparks=this.metalSparks.filter(p=>p.age<p.life);
  const plumeDt=dt*this.quality*(this.reduced?.62:1);
  const s=m.exhaustSpill,hole=m.fragments.caseBreach;
  this.spillSmokeAcc=s.smoke>.015?this.spillSmokeAcc+plumeDt*s.smoke*68:0;
  while(this.spillSmokeAcc>=1&&hole){
   this.spillSmokeAcc--;
   this.puff(hole.x+(this.rand()-.5)*14,SPILL_PIPE.y-SPILL_PIPE.r,'spill-smoke',s.smoke);
  }
  const hoseSteam=clamp(m.coolantHose.runoff*9,0,.86)*clamp((s.temp-102)/175,0,1);
  this.hoseSteamAcc=hoseSteam>.01?this.hoseSteamAcc+plumeDt*hoseSteam*39:0;
  while(this.hoseSteamAcc>=1&&hole){
   this.hoseSteamAcc--;
   this.puff(hole.x+7,COOLANT_HOSE.y+14,'hose-steam',hoseSteam);
  }
  const e=m.exhaust;
  if(m.ignition==='running'&&(!m.overrun||e.ringOil>=.012)){
   const visible=clamp(.12+e.condensation*1.3+e.oil*2.8+e.steam*3+e.carbon*2.3+e.ringOil*3,.12,1);
   const emission=plumeDt*((8+e.pulse**2*51+clamp(e.jetSpeed*.7,0,20))*visible+e.coolantSteam*102+e.ringOil*212+e.carbon*23);
   const baffle=m.auxWear?.mufflerBaffle||0;
   this.exhaustAcc+=emission*(1-e.leak)*(1-clamp((baffle-.65)/.35,0,1)*.27);
   this.leakAcc+=emission*e.leak;
   while(this.exhaustAcc>=1){this.exhaustAcc--;this.puff(...EXHAUST_OUTLET,'tailpipe');}
   while(this.leakAcc>=1){this.leakAcc--;this.puff(...EXHAUST_JOINT,'exhaust-leak');}
  }else this.exhaustAcc=this.leakAcc=0;

  const steam=m.steam*clamp((m.coolantRunoff||0)*68+m.waterCircuit.vapour*.3,0,1)*clamp((m.coolant-94)/26,0,1)*clamp(m.coolantLevel/.24,0,1);
  const mist=Math.min(m.oilSmoke,m.film*10)*clamp((m.headerTemp-150)/160,0,1);
  this.steamAcc=steam>.015?this.steamAcc+plumeDt*steam*32:0;
  this.mistAcc=mist>.015?this.mistAcc+plumeDt*mist*24:0;
  const radiatorSteam=clamp((m.radiatorRunoff||0)*28,0,.7)*clamp((m.waterCircuit.cells[3].temp-92)/30,0,1);
  this.radiatorSteamAcc=radiatorSteam>.015?this.radiatorSteamAcc+plumeDt*radiatorSteam*35:0;
  while(this.steamAcc>=1){
   this.steamAcc--;this.puff(this.rand()<.5?282:915,217,'coolant-steam',.36+steam*.68);
  }
  while(this.mistAcc>=1){
   this.mistAcc--;this.puff(this.rand()<.33?285:918,this.rand()<.5?329:470,'oil-mist',.40+mist*.55);
  }
  while(this.radiatorSteamAcc>=1){
   this.radiatorSteamAcc--;this.puff(...RADIATOR_NECK,'radiator-steam',.36+radiatorSteam*.55);
  }
 }
 emitDrops(dt,m){
  const dropDt=dt*this.quality*(this.reduced?.65:1);
  this.oilAcc+=dropDt*Math.min(29,m.oilRunoff*155);
  this.coolantAcc+=dropDt*Math.min(34,m.coolantRunoff*154);
  this.radiatorDropAcc+=dropDt*Math.min(43,(m.radiatorRunoff||0)*665);
  const hole=m.fragments.caseBreach;
  if(m.caseLeakRate>.0001&&hole){
   this.caseDropAcc+=dropDt*Math.min(38,m.caseLeakRate*310);
   while(this.caseDropAcc>=1){
    this.caseDropAcc--;
    if(this.drops.length>=65)this.drops.shift();
    const p=this.world(hole.x+(this.rand()-.5)*4,568);
    const caught=hole.x>=SPILL_PIPE.left&&hole.x<=SPILL_PIPE.right&&this.rand()<.74;
    this.drops.push({x:p.x,y:p.y,vx:this.spring.vx*.22+(this.rand()-.5)*15,
     vy:38+Math.sqrt(m.caseLeakRate)*127,r:.85+this.rand()*.85,age:0,fluid:'oil',
     pipeY:caught?this.world(hole.x,SPILL_PIPE.y-SPILL_PIPE.r).y:undefined});
   }
  }else this.caseDropAcc=0;
  for(let i=0;i<CRANK_SEALS.length;i++){
   const {x,y,side}=CRANK_SEALS[i],flow=m.crankSeals[i].flow;
   if(!flow){this.sealDropAcc[i]=0;continue;}
   this.sealDropAcc[i]+=dropDt*Math.min(19,flow*495);
   while(this.sealDropAcc[i]>=1){
    this.sealDropAcc[i]--;
    if(this.drops.length>=65)this.drops.shift();
    const p=this.world(x+side*13,y+29+this.rand()*7);
    this.drops.push({x:p.x,y:p.y,vx:side*(6+Math.sqrt(flow)*67)+this.spring.vx*.18,
     vy:18+this.rand()*23,r:.77+this.rand()*.81,age:0,fluid:'oil',seal:i});
   }
  }
  const hose=m.coolantHose;
  if(hose.runoff>.001&&hole){
   this.hoseDropAcc+=dropDt*Math.min(43,hose.runoff*295);
   while(this.hoseDropAcc>=1){
    this.hoseDropAcc--;
    if(this.drops.length>=65)this.drops.shift();
    const p=this.world(hole.x+2,COOLANT_HOSE.y+4),v=Math.min(hose.jetSpeed*14,155);
    this.drops.push({x:p.x,y:p.y,vx:v*(.6+this.rand()*.31),vy:v*.4+10+this.rand()*19,
     r:.53+this.rand()*.91,age:0,fluid:'coolant'});
   }
  }else this.hoseDropAcc=0;
  while(this.oilAcc>=1){this.oilAcc--;this.detachDrop(OIL_RUNS[Math.floor(this.rand()*OIL_RUNS.length)],oilWet(m),'oil');}
  while(this.coolantAcc>=1){this.coolantAcc--;this.detachDrop(COOLANT_RUNS[Math.floor(this.rand()*COOLANT_RUNS.length)],coolantWet(m),'coolant');}
  while(this.radiatorDropAcc>=1){
   this.radiatorDropAcc--;
   if(this.drops.length>=65)this.drops.shift();
   const velocity=Math.min(m.radiatorJetSpeed*18,166);
   const angle=Math.PI*.86+(this.rand()-.5)*(.10+velocity*.0015);
   const size=.59+this.rand()*.77+(1-clamp(velocity/125,0,1))*.6;
   this.drops.push({x:RADIATOR_NECK[0]+(this.rand()-.5)*1.4,y:RADIATOR_NECK[1]+(this.rand()-.5)*2,
    vx:Math.cos(angle)*velocity,vy:Math.sin(angle)*velocity+6,r:size,age:0,fluid:'coolant'});
  }
 }
 detachDrop([x,y,length],wet,fluid){
  if(this.drops.length>=65)this.drops.shift();
  const p=this.world(x+2,y+length*wet);
  const water=fluid==='coolant';
  this.drops.push({x:p.x,y:p.y,vx:this.spring.vx*.25+(this.rand()-.5)*(water?20:9),vy:(water?82:24)+this.rand()*14,
   r:(water?1.25:1.65)+this.rand()*1.15,age:0,fluid});
 }
 oilColor(m,light,alpha=1){
  const oxidation=clamp((m?.oilOxidation||0)*2.65,0,1);
  const dark=clamp(Math.pow(oxidation,.85)*.86+(m?.oilCircuit?.finesConcentration||0)*.48,0,1);
  const tone=clamp(light,0,1)**1.55;
  const r=Math.round(23+154*tone-dark*(10+117*tone));
  const g=Math.round(21+100*tone-dark*(8+71*tone));
  const b=Math.round(16+46*tone-dark*(4+28*tone));
  return `rgba(${r},${g},${b},${alpha})`;
 }
 oilFilm(m){
  this.drawRunoff(OIL_RUNS,oilWet(m),m.oilRunoff,false,m);
  this.drawRunoff(COOLANT_RUNS,coolantWet(m),m.coolantRunoff,true,m);
  this.drawCaseBreach(m);
  this.drawCrankSeals(m);
  this.drawLowerCoolantHose(m);
  const f=m.oilCircuit,films=f.spray?.films;
  if(!films?.length)return;
  const c=this.c,inspect=this.mode==='oil';
  c.save();c.beginPath();c.rect(OIL_PAN.left-23,300,OIL_PAN.right-OIL_PAN.left+45,248);c.clip();
  for(const {x,y,tx,ty,litres,surface,startY} of films){
   if(litres<=0||y>f.surfaceAt(x)+.25)continue;
   const wet=clamp(Math.sqrt(litres/.0012),.15,1);
   if(surface==='case'){
    const length=clamp(y-startY,0,10+wet*47),width=.68+1.85*wet,top=y-length;
    // Thin edges transmit the casting colour; the thick leading bead reflects the lamp.
    const bend=Math.sin(x*.77+startY*.29)*Math.min(3,length*.12);
    const film=c.createLinearGradient(0,top-1,0,y+1);
    film.addColorStop(0,this.oilColor(m,.48,0));film.addColorStop(.42,this.oilColor(m,.23,.52));film.addColorStop(1,this.oilColor(m,.17,.96));
    c.beginPath();c.moveTo(x,top);
    c.bezierCurveTo(x+bend,top+length*.34,x-width*1.4,y-length*.24,x-width,y);
    c.quadraticCurveTo(x,y+width*2.6,x+width,y);
    c.bezierCurveTo(x+width*.7,y-length*.25,x+bend+width*.55,top+length*.38,x,top);
    c.fillStyle=film;c.fill();
    this.ellipse(x,y,width,width*1.35,this.oilColor(m,.30,.94));
    this.line([[x-width*.54,y-width*.72],[x-width*.63,y-.15]],'rgba(212,210,183,.77)',.65);
    continue;
   }
   const reach=3+wet*11,spread=.65+wet*2.65;
   c.save();c.translate(x,y);c.rotate(Math.atan2(ty,tx));
   const glaze=c.createLinearGradient(-reach,0,reach,0);
   glaze.addColorStop(0,this.oilColor(m,.36,0));
   glaze.addColorStop(.34,this.oilColor(m,.18,wet*.95));
   glaze.addColorStop(.68,this.oilColor(m,.69,wet*(inspect?.92:.68)));
   glaze.addColorStop(1,this.oilColor(m,.51,0));
   c.beginPath();c.moveTo(-reach,.2);
   c.bezierCurveTo(-reach*.37,-spread,reach*.48,-spread*.9,reach,.35);
   c.bezierCurveTo(reach*.35,spread*.68,-reach*.24,spread*.92,-reach,.2);
   c.fillStyle=glaze;c.fill();
   this.line([[-reach*.58,-spread*.38],[-reach*.19,-spread*.55],[reach*.28,-spread*.29]],this.oilColor(m,1,wet*(inspect?.91:.78)),.74);
   c.restore();
  }
  c.restore();
 }
 drawCrankSeals(m){
  const c=this.c;
  for(let i=0;i<CRANK_SEALS.length;i++){
   const {x,y,side}=CRANK_SEALS[i],s=m.crankSeals[i],gap=crankSealOpening(s.wear);
   const wet=clamp(Math.sqrt(s.film/.018)+s.flow*4,0,1);
   c.save();c.translate(x,y);c.scale(side,1);
   this.ellipse(0,0,5.8,12.3,'#272823','#777569',.85);
   this.ellipse(1.2,0,3.25,9.8,'#171b16','#5d6051',.72);
   this.line([[-.9,-10.1],[.6,-7.5],[1.1,-4],[1.25,1],[2.2+gap*2.2,6.5],[1+gap*1.2,9.3]],'#989482',.69);
   if(wet>.01){
    const path=[[1.3,4.5],[4.8,9],[7.1,14],[11.2,19],[12.6,28],[13.4,31+wet*25]];
    this.line(path,this.oilColor(m,.24,.39+wet*.46),1.6+wet*4.8);
    this.line(path.map(([u,v])=>[u-.55,v+.7]),this.oilColor(m,.88,.23+wet*.57),.49+wet*.76);
    this.ellipse(12.8,27.9,1.5+wet,1.6+wet*1.4,this.oilColor(m,.39,.79));
   }
   c.restore();
  }
 }
 drawCaseBreach(m){
  const hole=m.fragments.caseBreach;
  if(!hole)return;
  const c=this.c,y=OIL_PAN.floor,wide=Math.sqrt(hole.area/.00035);
  c.save();c.translate(hole.x,y);c.scale(wide,1);
  this.poly([[-12,0],[-4,1],[-2,-2],[7,1],[11,6],[6,10],[8,14],[2,19],[-5,19],[-9,12],[-7,7]],'#191a17','#766f5d',.8);
  this.line([[-12,0],[-4,1],[-2,-2],[7,1],[11,6],[6,10]],'#b1ab94',1);
  this.poly([[-9,12],[-5,19],[-11,16],[-13,10]],'#49483d','#8f8872',.55);
  const flow=clamp(m.caseLeakRate/.145,0,1);
  if(flow>.005){
   const onPipe=hole.x>=SPILL_PIPE.left&&hole.x<=SPILL_PIPE.right;
   const end=Math.min(onPipe?SPILL_PIPE.y-SPILL_PIPE.r-y:48,22+flow*23),bend=Math.sin(m.time*11)*flow;
   c.beginPath();c.moveTo(-1,2);c.quadraticCurveTo(-4,18,bend,end);
   c.lineWidth=1+flow*5;c.strokeStyle=this.oilColor(m,.33,.83);c.stroke();
   c.beginPath();c.moveTo(-2,4);c.quadraticCurveTo(-5,19,bend-.7,end-4);
   c.lineWidth=.52+flow*.62;c.strokeStyle=this.oilColor(m,.91,.8);c.stroke();
  }
  c.restore();
 }
 drawSpillFlame(m){
  const s=m.exhaustSpill,hole=m.fragments.caseBreach;
  if(!hole||s.oil<.0002)return;
  const c=this.c,x=hole.x,y=SPILL_PIPE.y-SPILL_PIPE.r+.6;
  const wet=clamp(s.oil/.018,0,1);
  this.ellipse(x,y+2,4+wet*13,1.1+wet*.7,this.oilColor(m,.18,.85));
  this.line([[x-7,y+1],[x,y+.6],[x+9,y+2]],this.oilColor(m,.81,.48),.65);
  if(!s.burning)return;
  const t=m.time,flame=.32+.68*Math.sqrt(wet);
  c.save();c.translate(x,y);
  const glow=c.createRadialGradient(0,-4,1,0,-4,24);
  glow.addColorStop(0,`rgba(255,126,53,${.32*flame})`);glow.addColorStop(1,'rgba(227,97,33,0)');
  c.fillStyle=glow;c.fillRect(-24,-28,48,48);
  for(let i=0;i<5;i++){
   const sway=Math.sin(t*(8+i*1.8)+i*5),lean=(this.reduced?.36:1)*sway*3;
   const x=(i-2)*3.1,h=(9+i%3*6+(1+sway)*5)*flame,w=(2.1+i%3)*flame;
   const tongue=c.createLinearGradient(0,0,0,-h);
   tongue.addColorStop(0,'#ffedb8');tongue.addColorStop(.27,'#ffc566');
   tongue.addColorStop(.66,'#e87734');tongue.addColorStop(1,'rgba(212,84,30,.08)');
   c.beginPath();c.moveTo(x-w,0);c.bezierCurveTo(x-w*1.4,-h*.35,x+lean*.8,-h*.58,x+lean,-h);
   c.bezierCurveTo(x+lean-h*.07,-h*.55,x+w*1.5,-h*.3,x+w,0);c.closePath();c.fillStyle=tongue;c.fill();
  }
  c.restore();
 }
 drawLowerCoolantHose(m){
  const c=this.c,{left,right,y,r}=COOLANT_HOSE,h=m.coolantHose;
  const tube=[[left-15,y-22],[left-14,y-11],[left-7,y-3],[left,y],[right,y],[right+5,y+4]];
  this.line(tube,'#161915',r*2+1);
  this.line(tube,'#343931',r*2-1.1);
  this.line(tube.map(([x,y])=>[x,y-1.6]),'#72766a85',2.5);
  this.rr(right-4,y-r-.9,5,2*r+1.8,1,'#777a6f','#363b34',.6);
  this.rr(right+1,y-3,6,7,1,'#4a4d42','#32372f',.7);
  if(h.damage<.035)return;
  const x=m.fragments.caseBreach.x,span=5+13*h.damage;
  const char=c.createLinearGradient(x-span,y,x+span,y);
  char.addColorStop(0,'#1c1b1800');char.addColorStop(.35,'#242019');
  char.addColorStop(.64,'#171612');char.addColorStop(1,'#1c1b1800');
  this.line([[x-span,y],[x+span,y]],char,r*1.9);
  this.fracture([[x-8,y+3],[x-4,y-1],[x,y+1],[x+4,y-2],[x+7,y+2]],h.damage,1);
  if(h.damage<=HOSE_RUPTURE)return;
  const opening=clamp((h.damage-HOSE_RUPTURE)/(1-HOSE_RUPTURE),0,1);
  c.save();c.translate(x,y);c.scale(.44+opening*.56,1);
  this.poly([[-7,3],[-5,0],[-2,2],[2,-.5],[6,1],[4,5],[-1,5]],'#111613','#4f5245',.62);
  c.restore();
  if(h.runoff>.001){
   const strength=clamp(h.runoff/.14,0,1),reach=5+Math.min(33,h.jetSpeed*4);
   c.beginPath();c.moveTo(x+1,y+3);c.quadraticCurveTo(x+reach*.65,y+7,x+reach,y+15+reach*.28);
   c.strokeStyle='rgba(89,154,133,.78)';c.lineWidth=1.1+strength*2.7;c.stroke();
   c.strokeStyle='rgba(205,230,213,.72)';c.lineWidth=.55+strength*.45;c.stroke();
  }
 }
 drawSmoke(front){
  super.drawSmoke(front);
  const m=this.currentModel;
  if(front&&m?.exhaustSpill?.oil>.0002){
   this.c.save();this.engineTransform();this.drawSpillFlame(m);this.c.restore();
  }
 }
 crankShadows(m){
  super.crankShadows(m);
  this.drawPistonJets(m);
 }
 crank(m){
  super.crank(m);
  this.drawCrankSpray(m);
 }
 drawCrankSpray(m){
  const f=m.oilCircuit,drops=f.spray?.drops;
  if(!drops?.length)return;
  const c=this.c,inspect=this.mode==='oil';
  const sparse=this.performanceMode==='eco'||this.quality<.72||this.reduced;
  // Oil leaves the visible cheek of the counterweight, behind the connecting rods.
  c.save();c.beginPath();c.rect(299,405,593,143);
  for(const cy of m.cylinders)c.rect(XS[cy.id]-46,303,92,102);
  c.clip();
  for(const p of drops){
   const drain=p.kind===1;
   if(p.litres<=0||p.y>f.surfaceAt(p.x)+.18||(sparse&&!drain&&p.litres<.00008))continue;
   const scale=clamp(Math.cbrt(p.litres/.00013),.48,1.75);
   const speed=Math.hypot(p.vx,p.vy),r=(drain?1.55:1.42)*scale;
   const trail=this.reduced?0:Math.min(drain?5:14,speed*(drain?.006:.010));
   c.save();c.translate(p.x,p.y);c.rotate(Math.atan2(-p.vx,p.vy));
   if(trail>.3){
    const shine=c.createLinearGradient(0,-trail,0,0);
    shine.addColorStop(0,this.oilColor(m,.54,0));
    shine.addColorStop(.52,this.oilColor(m,.63,.36));shine.addColorStop(1,this.oilColor(m,.48,.79));
    c.beginPath();c.moveTo(-r*.82,0);c.quadraticCurveTo(-r*.55,-trail*.48,0,-trail);
    c.quadraticCurveTo(r*.55,-trail*.48,r*.82,0);c.fillStyle=shine;c.fill();
   }
   this.ellipse(0,0,r,r*(drain?1.29:1.15),this.oilColor(m,.43,inspect?.96:.88));
   c.restore();
   if(inspect||!sparse)this.ellipse(p.x-r*.28,p.y-r*.38,r*.37,r*.24,'rgba(219,217,192,.88)');
  }
  c.restore();
 }
 drawPistonJets(m){
  const jets=m.oilCircuit.pistonJets;
  if(!jets?.length)return;
  const c=this.c,inspect=this.mode==='oil',sparse=this.performanceMode==='eco'||this.quality<.72||this.reduced;
  c.save();c.lineCap='round';c.lineJoin='round';
  for(const {x,y,angle,endX,endY,controlX,controlY,flow,hit,phase,clog=0} of jets){
   const ux=Math.cos(angle),uy=Math.sin(angle),baseX=x-8*ux,baseY=y-8*uy;
   c.beginPath();c.moveTo(baseX+6,423);c.quadraticCurveTo(baseX+5,baseY,baseX,baseY);c.lineTo(x,y);
   c.lineWidth=4.8;c.strokeStyle='#252823';c.stroke();
   c.lineWidth=3.15;c.strokeStyle='#8b8d7e';c.stroke();
   c.lineWidth=.85;c.strokeStyle='#b2ac94';c.stroke();
   c.save();c.translate(x,y);c.rotate(angle);
   this.rr(-9,-2.7,3.8,5.4,.47,'#77786a','#3e4137',.56);
   this.rr(-3.6,-1.65,3.7,3.3,.36,'#a7a18b','#4b4d41',.52);
   this.line([[.12,-.99],[.12,.97]],'#342c22',.64);
   const deposit=clamp((clog-.2)/.8,0,1);
   if(deposit>0){
    const crustEdge=.97-1.96*deposit;
    this.poly([[-.08,.98],[-1.08-1.12*deposit,.94],[-.96,crustEdge+.19*deposit],[-.54,crustEdge-.12*deposit],[-.08,crustEdge]],'#513625');
    this.line([[-.96,crustEdge+.19*deposit],[-.54,crustEdge-.12*deposit],[-.08,crustEdge]],'#916446',.52*deposit);
   }
   c.restore();
   if(flow<=.01||Math.hypot(endX-x,endY-y)<=1)continue;
   const force=clamp(flow/.48,0,1),thin=force<.3;
   const oil=c.createLinearGradient(x,y,endX,endY),opacity=(inspect?.89:.7)*(.39+force*.61);
   oil.addColorStop(0,this.oilColor(m,.65,opacity));
   oil.addColorStop(.48,this.oilColor(m,.87,opacity*.92));
   oil.addColorStop(1,this.oilColor(m,.94,opacity*(hit?.81:.2)));
   c.beginPath();c.moveTo(x+ux*.52,y+uy*.52);c.quadraticCurveTo(controlX,controlY,endX,endY);
   if(thin)c.setLineDash([1.2+force*6,3.4-force*3]);
   c.strokeStyle=oil;c.lineWidth=.6+force*1.06;c.stroke();
   c.setLineDash([]);
   if(!thin&&!sparse){
    const glint=2.3+force*2.1,gap=5.55;
    c.setLineDash([glint,gap]);c.lineDashOffset=-phase*(glint+gap);
    c.strokeStyle=this.oilColor(m,1,opacity*.53);c.lineWidth=.58;c.stroke();
    c.setLineDash([]);c.lineDashOffset=0;
   }
  }
  c.restore();
 }
 drawRunoff(routes,wet,flow,coolant,m){
  if(wet<.015)return;
  const c=this.c;c.save();c.lineCap='round';
  for(const [x,y,length] of routes){
   const h=length*wet,end=y+h;
   c.beginPath();c.moveTo(x,y);c.bezierCurveTo(x,y+h/3,x+3,y+h*2/3,x+2,end);
   c.strokeStyle=coolant?'rgba(30,56,47,.72)':'rgba(23,20,16,.82)';c.lineWidth=1.25+wet*(coolant?3.8:5.2);c.stroke();
   c.strokeStyle=coolant?'rgba(112,150,131,.57)':this.oilColor(m,.63,.72);c.lineWidth=.6+wet*1.1;c.stroke();
   const bead=.57+wet*.85;
   this.ellipse(x+2,end,bead,bead*(coolant?1.9:1.4),coolant?'rgba(95,135,113,.88)':this.oilColor(m,.49));
   this.line([[x+1.7,end-wet],[x+1.85,end-wet*.45]],'rgba(227,222,209,.43)',.5);
   if(!this.reduced&&flow>.001&&h>8){
    const u=((this.t*(coolant?1.35:.72)*(1+Math.min(.8,flow*6))+x*.079)%1)**1.65;
    const xx=x+u*u*(9-7*u),yy=y+h*u;
    this.ellipse(xx-.3,yy,.38+wet*.22,.8+wet*(coolant?2.7:1.6),coolant?'rgba(211,222,210,.55)':this.oilColor(m,.87,.66));
   }
  }
  c.restore();
 }
 drawDrop(p){
  const c=this.c,water=p.fluid==='coolant',r=p.r,speed=Math.hypot(p.vx,p.vy);
  const stretch=clamp(1+speed/(water?390:660),1,1.84),tail=this.reduced?.55:Math.min(water?5:3,speed*.011);
  c.save();c.translate(p.x,p.y);c.rotate(Math.atan2(-p.vx,p.vy));
  this.line([[0,0],[0,-tail]],water?'rgba(115,156,132,.47)':this.oilColor(this.currentModel,.41,.67),r*.7);
  this.ellipse(0,0,r/stretch**.38,stretch*r,water?'rgba(60,109,84,.83)':this.oilColor(this.currentModel,.51));
  this.ellipse(-r*.26,-r*.44,r*.24,r*.39,water?'rgba(218,231,213,.65)':this.oilColor(this.currentModel,.99,.75));
  c.restore();
 }
 stand(m){
  super.stand(m);
  if(this.reduced)return;
  for(const p of this.stains)if(p.age<.26){
   const u=p.age/.26,c=this.c,r=2+u*p.r*1.24;
   c.save();c.beginPath();c.ellipse(p.x,612,r,.7+u*1.8,0,3.54,5.45);
   c.strokeStyle=`rgba(203,205,190,${(1-u)*.36})`;c.lineWidth=.55;c.stroke();c.restore();
  }
 }
 floorStains(){
  const c=this.c;
  for(const p of this.stains){
   const water=p.fluid==='coolant',fade=water?clamp(1-p.age/24,0,.79):.94;
   if(fade<=0)continue;
   const phase=p.x*.073,rx=p.r*1.7,ry=Math.max(1.2,p.r*.31);
   c.save();c.translate(p.x,612);c.globalAlpha=fade;
   c.beginPath();
   for(let i=0;i<=32;i++){
    const a=i/32*TAU,r=1+.13*Math.sin(a*2+phase)+.068*Math.cos(a*5-phase)+.031*Math.sin(a*9+phase);
    const x=Math.cos(a)*rx*r,y=Math.sin(a)*ry*r+.075*ry*Math.cos(a*2+phase);
    if(i===0)c.moveTo(x,y);else c.lineTo(x,y);
   }
   c.closePath();
   const body=c.createRadialGradient(-rx*.21,-ry*.28,0,0,0,rx*1.12);
   body.addColorStop(0,water?'rgba(28,40,34,.7)':'rgba(23,20,17,.96)');
   body.addColorStop(.65,water?'rgba(38,55,47,.68)':'rgba(25,23,19,.9)');
   body.addColorStop(1,water?'rgba(51,65,56,.47)':'rgba(38,30,21,.58)');
   c.fillStyle=body;c.fill();
   c.clip();
   const sheen=c.createLinearGradient(-rx,-ry*.68,rx,ry*.35);
   sheen.addColorStop(0,'rgba(227,228,215,0)');sheen.addColorStop(.28,'rgba(227,228,215,.25)');
   sheen.addColorStop(.52,'rgba(227,228,215,.11)');sheen.addColorStop(1,'rgba(227,228,215,0)');
   this.ellipse(-rx*.2,-ry*.56,rx*.81,Math.max(.55,ry*.2),sheen);
   this.line([[-rx*.76,-ry*.53],[-rx*.43,-ry*.76],[-rx*.11,-ry*.79]],'rgba(209,209,193,.14)',.52);
   c.restore();
  }
 }
 externalFluids(m){
  const circuit=m.waterCircuit,w=circuit.cells,o=m.oilCircuit.cells;
  const enginePoint=(x,y)=>{const p=this.world(x,y);return [p.x,p.y];};
  const thermostatOutlet=enginePoint(240,257),pumpInlet=enginePoint(249,399);
  const inletTee=enginePoint(238,399);
  // The lower tank connection tees into pump suction; a small rising line
  // vents the thermostat housing into the tank headspace.
  this.pipe([[197,224],[197,239],[176,258],[176,389],[186,406],[219,405],inletTee],w[0],'#47534b',6,circuit.q*.04,w[0].phase);
  this.pipe([enginePoint(248,246),[237,232],[235,198],[228,181],[220,181]],w[0],'#47534b',4,circuit.q*.02,w[0].phase);
  this.pipe([thermostatOutlet,[219,257],[200,276],[174,276],[151,265]],w[3],'#669ba4',13);
  this.pipe([[151,431],[151,441],[175,454],[202,454],[219,438],[224,413],inletTee,pumpInlet],w[3],'#669ba4',13);
  this.pipe([enginePoint(250,272),enginePoint(234,290),enginePoint(234,380),inletTee],w[2],'#63878c',8,circuit.bypassFlow,circuit.bypassPhase);
  const pumpDischarge=[enginePoint(291,408),enginePoint(308,408)];
  this.line(pumpDischarge,'#33332d',11);this.line(pumpDischarge,'#767368',7);
  this.line([enginePoint(282,256),enginePoint(304,256)],'#33332d',10);
  this.line([enginePoint(282,255),enginePoint(304,255)],'#767368',5);
  const c=this.c,plastic=c.createLinearGradient(172,159,226,228);
  plastic.addColorStop(0,'#d0c7a9');plastic.addColorStop(.35,'#99957a');
  plastic.addColorStop(.75,'#6e6b55');plastic.addColorStop(1,'#49483d');
  for(const [x,y] of [[164,166],[164,211]]){
   this.rr(x,y,25,8,2,'#464339','#878174',.75);this.bolt(x+3,y+4,1.8);
  }
  this.rr(170,160,57,67,9,plastic,'#aaa38a',1.15);
  this.rr(178,169,41,47,4,'#272c22','#636450',.85);
  this.rr(184.5,147,27,13,2.3,'#34332b','#777264',.9);
  this.line([[187,149.4],[208,149.4]],'#a29a81',.75);
  for(let x=187;x<=208;x+=3)this.line([[x,151],[x,158]],'#555046',1.2);
  // The external spin-on filter is between the pump delivery and the block
  // gallery. Its inlet and return enter separately at the filter head.
  this.pipe([enginePoint(316,507),enginePoint(291,507),enginePoint(280,520),enginePoint(268,537)],o[1],'#877455',7);
  this.pipe([enginePoint(256,533),enginePoint(256,518),enginePoint(279,495),enginePoint(288,434),enginePoint(304,424)],o[2],'#8b7652',7);
  if(!this.atlas?.parts.has('filter-cutaway')){
   c.save();this.engineTransform();this.rr(243,535,28,30,5,'#847b69','#c8bea9',1);
   this.rr(247,541,20,13,2,'#2c271e','#6b6150',.7);c.restore();
  }
 }
 lubrication(m){
  const c=this.c,f=m.oilCircuit,water=m.waterCircuit;
  const pickupWear=m.auxWear?.oilPickup||0,brokenPickup=pickupWear>=1;
  if(this.mode==='oil'){
   // A dashed section convention shows bores inside the casting. The main
   // bearings between the throws receive oil before the drillings in the shaft.
   c.save();
   const path=[[304,424],[869,424]],bearings=[307,445,589,733,871];
   c.setLineDash([5,3]);
   this.line(path,'rgba(15,15,12,.75)',4.1);
   this.line(path,'rgba(173,136,82,.85)',1.7);
   for(const x of bearings)this.line([[x,424],[x,446]],'rgba(173,136,82,.8)',1.5);
   c.setLineDash([]);
   if(f.cells[3].flow>.005&&f.cells[3].litres>.005)for(let i=0;i<8;i++){
    const x=304+((f.cells[3].phase+i/8)%1)*565;
    this.line([[x-3,424],[x+1,424]],'#e0bb7c',1.15);
   }
   c.restore();
  }
  const sump=f.cells[0],fill=clamp(sump.litres/sump.capacity,0,1),{left,right,floor}=OIL_PAN;
  const surfaceY=x=>f.surfaceAt(x);
  if(fill>.005){
   const surface=[];
   let top=floor;
   for(let i=0;i<=68;i++){
    const x=left+(right-left)*i/68,y=surfaceY(x);
    surface.push([x,y]);top=Math.min(top,y);
   }
   const oil=c.createLinearGradient(0,top,0,floor+1);
   oil.addColorStop(0,this.oilColor(m,.53,.84));
   oil.addColorStop(.23,this.oilColor(m,.22,.94));oil.addColorStop(1,this.oilColor(m,.025,.99));
   c.beginPath();c.moveTo(...surface[0]);
   for(let i=1;i<surface.length;i++)c.lineTo(...surface[i]);
   c.lineTo(right,floor);c.lineTo(left,floor);c.closePath();c.fillStyle=oil;c.fill();
   c.save();c.clip();
   const reflected=c.createLinearGradient(left,0,right,0);
   reflected.addColorStop(0,'#12150f90');reflected.addColorStop(.22,'#d8c6a02b');
   reflected.addColorStop(.55,'#221c1358');reflected.addColorStop(.74,'#b9a6821c');reflected.addColorStop(1,'#1418128f');
   c.fillStyle=reflected;c.fillRect(left,top,right-left,floor-top);
   // Foam gathers at the same surface cells that receive returning oil.
   const sparse=this.performanceMode==='eco'||this.quality<.72||this.reduced;
   const step=sparse?3:2;
   // Only the shallow face of each wave catches the strip light above the crank bays.
   const lamp=c.createLinearGradient(left,0,right,0);
   for(const [at,colour] of [[0,'#34362c00'],[.13,'#e0dfc7ad'],[.29,'#66695720'],[.55,'#a7aca54a'],[.69,'#e5e4d3a3'],[1,'#333b3500']])lamp.addColorStop(at,colour);
   c.beginPath();c.moveTo(...surface[0]);
   for(let i=step;i<surface.length;i+=step)c.lineTo(...surface[i]);
   c.lineTo(...surface[surface.length-1]);
   for(let i=surface.length-1;i>0;i-=step){
    const [x,y]=surface[i],[prevX,prevY]=surface[Math.max(0,i-step)];
    const tilt=(y-prevY)/(x-prevX),lit=1/(1+Math.abs(tilt-.026)*27);
    const opening=.5+.5*Math.cos((x-XS[0])*TAU/144);
    c.lineTo(x,y+.28+lit*(.32+opening*2.9));
   }
   c.closePath();c.fillStyle=lamp;c.fill();
   for(let i=0;i+step<surface.length;i+=step){
    const [x,y]=surface[i],[end,endY]=surface[i+step],mid=(x+end)*.5;
    const coverage=f.pan?.foamAt?.(mid)??0;
    if(coverage<.018||y>floor-.55||endY>floor-.55)continue;
    const foam=clamp(coverage*2.2,0,.9),depth=.5+foam*2;
    c.beginPath();c.moveTo(x,y);c.lineTo(end,endY);c.lineTo(end,endY+depth*.65);
    c.quadraticCurveTo(mid,surfaceY(mid)+depth,x,y+depth*.24);c.closePath();
    c.fillStyle=`rgba(199,170,118,${.52*foam})`;c.fill();
    const count=Math.min(sparse?2:5,Math.ceil(foam*5));
    for(let j=0;j<count;j++){
     const bx=x+(end-x)*(.17+.65*((i*.271+j*.381)%1)),by=surfaceY(bx)+.39+(j%3)*.53;
     const r=.44+((i+j*3)%5)*.14+foam*.39;
     this.ellipse(bx,by,r,r*.71,`rgba(90,65,35,${.35*foam})`,`rgba(229,202,151,${.72*foam})`,.48);
    }
   }
   c.restore();
   const reflection=c.createLinearGradient(left,0,right,0);
   reflection.addColorStop(0,this.oilColor(m,.62,.28));
   reflection.addColorStop(.23,'rgba(200,199,174,.77)');
   reflection.addColorStop(.59,this.oilColor(m,.62,.24));
   reflection.addColorStop(.76,'rgba(170,172,152,.54)');
   reflection.addColorStop(1,this.oilColor(m,.59,.32));
   c.beginPath();
   for(let i=1;i<surface.length;i++)if(surface[i][1]<floor-.3&&surface[i-1][1]<floor-.3){
    c.moveTo(...surface[i-1]);c.lineTo(...surface[i]);
   }
   c.lineWidth=.72;c.strokeStyle=reflection;c.stroke();
   if(this.mode==='oil'&&!this.reduced)for(let i=0;i<17;i++){
    const x=left+12+(right-left-24)*i/17,y=surfaceY(x),v=f.surfaceVelocityAt(x);
    if(Math.abs(v)<6||y>floor-1)continue;
    const dx=clamp(v*.035,-5.4,5.4);
    this.line([[x-dx,y+.8],[x,y+.6]],this.oilColor(m,.82,.34),.63);
   }
  }
  // The exposed section of the strainer stays visible at the bottom of the pan.
  const pickup=[[347,539],[354,539],[358,537]];
  this.line(pickup,'#211d16',7);this.line(pickup,'#786849',4.5);
  const air=clamp(f.inletAir*.66+(f.pumpAeration||0)*1.8,0,1);
  if(sump.flow>.05&&air>.06)for(let i=0;i<3;i++){
   const x=357-((sump.phase*4+i/3)%1)*9;
   this.ellipse(x,538.7,.3+air*.68,.46,null,'#e5c99b9c',.54);
  }
  if(brokenPickup)this.fracture([[349,537],[351,539],[350,542],[353,543]],1,1.65);
  c.save();c.translate(OIL_PICKUP.x,OIL_PICKUP.y);
  this.rr(-5,-4,22,9,2,'#3f3627','#988466',.8);
  this.rr(-3,-2.7,18,6.1,1,'#353020');
  for(let i=0;i<7;i++)this.line([[-1+2.35*i,-2.2],[-1+2.35*i+(brokenPickup?i*.30:0),2.9]],'#99886b',.55);
  this.line([[-2.5,-.5],[14.5,-.5]],'#83765c',.5);
  const deposits=Math.min(18,Math.max(f.pickupCaptured,Math.round(f.pickupRestriction*16)));
  for(let i=0;i<deposits;i++){
   const x=-1.2+(i*11%17)*.91,y=-1.6+(i*7%11)*.43,r=.45+f.pickupRestriction*.85+(i%3)*.17;
   this.poly([[x-r,y+.25],[x+.10,y-r],[x+r,y-.08],[x+.57*r,y+r*.65]],i%3===0?'#665640':'#29241b');
  }
  if(brokenPickup)this.poly([[3,-3],[7,-.7],[12,-2.2],[10,1.7],[5,2.7],[6,1]],'#28241e','#bc9864',.5);
  c.restore();
  // The visible liquid level persists at rest; only advected features need pump flow.
  const jacket=water.cells[1],wet=clamp(jacket.litres/jacket.capacity,0,1),inspect=this.mode==='oil';
  const end=398-wet*154,depth=398-end;
  if(wet>.005)for(const cy of m.cylinders)for(const side of[-1,1]){const x=XS[cy.id];
   const xx=x+side*57,liquid=c.createLinearGradient(xx-3,0,xx+3,0);
   liquid.addColorStop(0,'#24372e');liquid.addColorStop(.44,inspect?'#527864':'#42584a');liquid.addColorStop(1,'#283a30');
   this.rr(xx-2.9,end,5.8,depth,1.25,liquid);
   if(wet<.98)this.line([[xx-2.5,end+.6],[xx+2.5,end+.6]],'#a5b49284',.61);
   if(jacket.flow>.005&&!this.reduced&&jacket.bubbles>.025){
    const count=Math.min(this.quality<.6?3:7,Math.ceil(jacket.bubbles*10));
    for(let j=0;j<count;j++){
     const u=(jacket.phase*(.48+j*.075)+j*.3819+x*.001)%1;
     if(u>.985)continue;
     const r=.34+u*.35+jacket.bubbles*.54;
     this.ellipse(xx+Math.sin(j+u*8)*1.25,397-u*depth,r,r*1.42,'#243c3296','#bfcead8a',.46);
    }
   }
  }
 }
 exhaust(m){
  const c=this.c,e=m.exhaust,heat=clamp((e.manifold-180)/540,0,1),hot=steelGlow(e.manifold);
  this.bake('under-pan-exhaust',Math.floor(m.exhaustSpill.temp/32),[370,291,666,326],()=>{
   const q=this.c,{left,right,y,r}=SPILL_PIPE;
   const route=new Path2D();route.moveTo(973,294);
   route.bezierCurveTo(972,435,938,536,901,568);route.quadraticCurveTo(885,y,right,y);
   route.lineTo(left,y);route.bezierCurveTo(381,y,382,604,left,604);
   route.lineTo(901,604);route.bezierCurveTo(991,604,1003,539,998,461);
   route.bezierCurveTo(993,397,981,342,1003,323);
   q.lineCap='round';q.strokeStyle='#1b1c1a';q.lineWidth=r*2+2;q.stroke(route);
   q.strokeStyle='#50514a';q.lineWidth=r*2;q.stroke(route);
   q.save();q.translate(-1,-1.8);q.strokeStyle='#919083';q.lineWidth=11;q.stroke(route);
   q.translate(-1,-1);q.strokeStyle='#b5b2a03d';q.lineWidth=5;q.stroke(route);q.restore();
   const temper=clamp((m.exhaustSpill.temp-180)/410,0,1);
   const finish=q.createLinearGradient(0,y-r,0,y+r);
   finish.addColorStop(0,`rgba(129,107,73,${temper*.72})`);finish.addColorStop(.46,`rgba(121,89,63,${temper*.57})`);finish.addColorStop(1,'rgba(66,58,49,.42)');
   q.strokeStyle=finish;q.lineWidth=r*2-2;q.stroke(route);
   q.strokeStyle=q.createPattern(this.oxideTexture,'repeat');q.stroke(route);
   for(const x of [left+20,right-19])this.line([[x,y-r+2],[x-.6,y+1],[x,y+r-2]],'#4a4438aa',1.4);
  });
  const temps=m.cylinders.map(cy=>Math.floor(cy.contact.crownTemp/35));
  this.bake('exhaust-runners',Math.floor(heat*14)+':'+Math.floor(hot*20)+':'+temps.join(','),[415,173,586,88],()=>{
   const q=this.c;
   // The rear manifold is unfolded in depth. Each port has its own runner
   // and its own socket at the collector mouth.
   for(let i=m.cylinders.length-1;i>=0;i--){
    const x=XS[i]+54,lane=181+i*13,socket=961+i*7,bend=922+i*8;
    const runner=new Path2D();runner.moveTo(x,194);
    runner.bezierCurveTo(x+16,194,x+22,lane,x+49,lane);
    runner.lineTo(bend,lane);
    runner.bezierCurveTo(socket-6,lane,socket,Math.min(lane+14,239),socket,245);
    runner.lineTo(socket,251);
    q.lineJoin='round';q.lineCap='round';
    q.strokeStyle='#252724';q.lineWidth=16;q.stroke(runner);
    q.strokeStyle='#626560';q.lineWidth=14.15;q.stroke(runner);
    q.save();q.translate(-.9,-1.25);
    q.strokeStyle='rgba(155,159,150,.65)';q.lineWidth=10.3;q.stroke(runner);
    q.translate(-.3,-.65);q.strokeStyle='rgba(213,213,201,.20)';q.lineWidth=4.9;q.stroke(runner);q.restore();
    q.strokeStyle=q.createPattern(this.oxideTexture,'repeat');q.lineWidth=13.2;q.stroke(runner);
    const localHeat=heat*(.48+.52*clamp((temps[i]*35-115)/150,0,1));
    if(localHeat>.03){
     const temper=q.createLinearGradient(bend-30,lane,socket,250);
     temper.addColorStop(0,`rgba(134,107,75,${localHeat*.68})`);
     temper.addColorStop(.48,`rgba(145,94,73,${localHeat*.75})`);
     temper.addColorStop(1,`rgba(85,63,69,${localHeat*.7})`);
     q.strokeStyle=temper;q.lineWidth=12;q.stroke(runner);
     const red=hot*localHeat;
     if(red>.012){
      const glow=q.createLinearGradient(bend-46,lane,socket,253);
      glow.addColorStop(0,'rgba(137,36,24,0)');
      glow.addColorStop(.62,`rgba(194,52,24,${red*.30})`);
      glow.addColorStop(1,`rgba(219,73,30,${red*.88})`);
      q.strokeStyle=glow;q.lineWidth=11;q.stroke(runner);
     }
    }
    q.strokeStyle='rgba(210,214,200,.27)';q.lineWidth=.58;
    q.save();q.translate(-2,-2);q.stroke(runner);q.restore();
    this.line([[socket-4,244],[socket+4,244]],'#4c4941',1.1);
   }
  });
  const vectorSilencer=this.atlas?.parts.has('muffler-cutaway')||false;
  const tailHeat=clamp((e.tail-100)/340,0,1);
  const shade=[Math.floor(heat*17),Math.floor(hot*24),Math.floor(tailHeat*12),vectorSilencer].join(':');
  this.bake('exhaust-body',shade,[942,232,235,167],()=>{
   const q=this.c;
   const collector=q.createLinearGradient(950,0,997,0);
   collector.addColorStop(0,'#3d403d');collector.addColorStop(.15,'#676862');collector.addColorStop(.36,'#9b9c90');
   collector.addColorStop(.58,'#72736a');collector.addColorStop(1,'#3c3e38');
   const shell=[[951,246],[956,239],[990,239],[997,247],[997,258],[991,275],[956,275],[951,256]];
   this.poly(shell,collector,'#3b3b32',.75);
   this.poly(shell,q.createPattern(this.oxideTexture,'repeat'));
   q.save();q.clip();q.drawImage(this.sootPatch,943,248,48,34);q.restore();
   if(heat>.015){
    const temper=q.createLinearGradient(0,239,0,276);
    temper.addColorStop(0,`rgba(139,111,68,${heat*.42})`);
    temper.addColorStop(.32,`rgba(104,81,94,${heat*.54})`);
    temper.addColorStop(.7,`rgba(157,92,60,${heat*.79})`);
    temper.addColorStop(1,`rgba(112,65,48,${heat*.88})`);
    this.poly(shell,temper);
   }
   if(hot>.015){
    const emission=q.createRadialGradient(976,259,2,976,257,27);
    emission.addColorStop(0,`rgba(252,97,42,${hot*.95})`);
    emission.addColorStop(.52,`rgba(235,68,28,${hot*.86})`);
    emission.addColorStop(1,'rgba(132,39,21,0)');
    this.poly(shell,emission);
   }
   this.line([[957,240],[986,240],[992,243]],'rgba(193,189,173,.51)',.77);
   const elbow=new Path2D();
   elbow.moveTo(973,271);elbow.lineTo(973,299);
   elbow.moveTo(991,323);elbow.lineTo(1004,323);
   const elbowSteel=q.createLinearGradient(954,273,997,339);
   elbowSteel.addColorStop(0,'#575852');elbowSteel.addColorStop(.32,'#919286');
   elbowSteel.addColorStop(.53,'#a3a397');elbowSteel.addColorStop(.71,'#74756b');elbowSteel.addColorStop(1,'#464942');
   q.lineCap='butt';q.strokeStyle='#201e1a';q.lineWidth=43;q.stroke(elbow);
   q.strokeStyle=elbowSteel;q.lineWidth=40;q.stroke(elbow);
   q.save();q.translate(-4,-3.9);q.strokeStyle='rgba(211,211,197,.16)';q.lineWidth=6;q.stroke(elbow);q.restore();
   if(heat>.02){
    const temper=q.createLinearGradient(970,270,996,326);
    temper.addColorStop(0,`rgba(146,70,52,${heat*.63})`);temper.addColorStop(1,'rgba(105,83,61,0)');
    q.strokeStyle=temper;q.lineWidth=37;q.stroke(elbow);
   }
   this.rr(949,278,47,20,3,'#575953','#30322b',.7);
   q.save();q.clip();
   for(let x=935;x<996;x+=3.8){
    this.line([[x,277],[x+24,299]],'rgba(183,178,163,.35)',.56);
    this.line([[x+27,277],[x+14,299]],'rgba(37,39,35,.65)',.73);
   }
   q.restore();
   for(const y of [278,296]){
    this.rr(948.8,y,48,2.8,.8,'#76756d','#363630',.45);
    this.line([[953,y+.6],[991,y+.6]],'#aaa99c',.55);
   }
   if(hot>.02){
    const bounce=q.createRadialGradient(974,270,1,974,269,25);
    bounce.addColorStop(0,`rgba(231,92,41,${hot*.40})`);bounce.addColorStop(1,'rgba(159,46,20,0)');
    q.fillStyle=bounce;q.fillRect(953,271,41,9);
   }
   const tail=new Path2D();
   tail.moveTo(1114,330);tail.bezierCurveTo(1138,330,1142,354,...EXHAUST_OUTLET);
   const tailSteel=q.createLinearGradient(1154,321,1121,364);
   tailSteel.addColorStop(0,'#5b5d55');tailSteel.addColorStop(.31,'#8f9186');
   tailSteel.addColorStop(.44,'#afb0a2');tailSteel.addColorStop(.57,'#898a7d');tailSteel.addColorStop(1,'#4b4d46');
   q.lineCap='butt';q.strokeStyle='#25211c';q.lineWidth=47;q.stroke(tail);
   q.strokeStyle=tailSteel;q.lineWidth=44.8;q.stroke(tail);
   if(tailHeat>.02){
    const temper=q.createLinearGradient(1114,330,1160,360);
    temper.addColorStop(0,`rgba(158,96,60,${tailHeat*.64})`);
    temper.addColorStop(1,`rgba(105,78,82,${tailHeat*.51})`);
    q.strokeStyle=temper;q.lineWidth=42;q.stroke(tail);
   }
   const carbon=q.createLinearGradient(1130,342,...EXHAUST_OUTLET);
   carbon.addColorStop(0,'#1f1c1800');carbon.addColorStop(.55,'#221f1a36');carbon.addColorStop(1,'#151511e8');
   q.strokeStyle=carbon;q.lineWidth=44;q.stroke(tail);
   if(!vectorSilencer)this.rr(984,291,142,77,17,'#514b40','#afa088',1.1);
   q.save();q.translate(...EXHAUST_OUTLET);q.rotate(OUTLET_ANGLE);
   const rim=q.createLinearGradient(-8,-20,7,21);
   rim.addColorStop(0,'#c1c3b4');rim.addColorStop(.35,'#93958c');rim.addColorStop(1,'#575951');
   const bore=q.createLinearGradient(-5,-19,5,17);
   bore.addColorStop(0,'#0d0c09');bore.addColorStop(.73,'#191610');bore.addColorStop(1,'#473a29');
   this.ellipse(0,0,9,23,rim,'#33352f',.85);
   this.ellipse(.72,.12,6.8,20.1,bore,'#515047',.53);
   this.ellipse(-.5,-.8,4.9,16.7,'rgba(11,10,8,.65)');
   q.restore();
  });
  this.exhaustFlange(e);
  this.exhaustShimmer(e);
  const structural=m.components.exhaust;
  if(structural>.28){
   this.fracture([[959,257],[961,259],[960.1,262],[962.8,264],[962.9,266.1],[966,267.1],[967,269]],structural,.65+structural*.7);
   this.fracture([[962.8,264],[964.9,262.7],[966.7,262.8]],clamp((structural-.61)/.39,0,1),.69);
  }
  if(this.mode==='thermal'&&this.partFocus==='exhaust')this.text(Math.round(e.manifold)+' °C',974,230,9,'#d8b994','center');
 }
 exhaustFlange(e){
  const c=this.c,gap=(e.jointGap||0)*1.8,wear=e.sealWear||0;
  const temper=clamp(((e.flangeTemp||0)-210)/275,0,1);
  this.poly([[947,269],[952,266.7],[996,266.7],[999,269]],'#85877a');
  this.rr(947,269,52,4.1,1.18,'#5b6055','#9b9d8f',.55);
  this.rr(947.65,273.5+gap,50.7,4.6,1.02,'#4a5047','#73796d',.65);
  this.line([[952,274+gap],[993,274+gap]],'#a8aa9786',.7);
  this.line([[951,273.1],[995,273.1]],`rgba(34,32,26,${.78+wear*.2})`,.72);
  c.save();c.beginPath();c.rect(953,274,41,21);c.clip();
  c.globalAlpha=.45+.55*Math.max(wear,e.soot);
  c.drawImage(this.sootPatch,944,263,54,26+11*wear);c.restore();
  if(gap>.018){
   this.line([[954,273.1+.25*gap],[966,273+.48*gap],[987,273.1+.61*gap],[993,273.1+.43*gap]],'#0f1110',.62+gap*.82);
   this.line([[954,274+gap],[982,274+gap],[994,274.14+gap]],'#a3a08b70',.58);
  }
  if(wear>.22||temper>.1){
   const stain=c.createLinearGradient(953,0,994,0);
   stain.addColorStop(0,'#3a2e2500');stain.addColorStop(.26,`rgba(99,67,44,${temper*.7})`);
   stain.addColorStop(.60,`rgba(29,25,20,${wear*.78})`);stain.addColorStop(1,'#3a2e2500');
   c.fillStyle=stain;c.fillRect(953,271,41,6+gap);
  }
  this.bolt(952,270.4,2.25);this.bolt(994,270.4,2.25);
 }
 exhaustShimmer(e){
  if(this.reduced||this.performanceMode==='eco')return;
  const manifold=clamp((e.manifold-315)/247,0,1);
  const tail=clamp((e.tail-74)/130,0,1)*clamp(e.pressure/2.1+e.pulse*.4,0,1);
  if(manifold>.055)this.refractAir(932,151,manifold,this.t*12);
  if(tail>.055)this.refractAir(EXHAUST_OUTLET[0]+5,EXHAUST_OUTLET[1]-35,tail*.75,this.t*15+2.9);
 }
 refractAir(x,y,heat,phase){
  const c=this.c,t=c.getTransform(),w=HEAT_W,h=HEAT_H,pad=HEAT_PAD;
  const cx=x+w*.5,cy=y+h*.5,px=t.a*cx+t.c*cy+t.e,py=t.b*cx+t.d*cy+t.f;
  const dx=Math.abs(t.a)*(w*.5+pad)+Math.abs(t.c)*h*.5,dy=Math.abs(t.b)*(w*.5+pad)+Math.abs(t.d)*h*.5;
  const sx=Math.max(0,Math.floor(px-dx)),sy=Math.max(0,Math.floor(py-dy));
  const sw=Math.min(c.canvas.width,Math.ceil(px+dx))-sx,sh=Math.min(c.canvas.height,Math.ceil(py+dy))-sy;
  if(sw<2||sh<2)return;
  if(!this.heatShimmer){
   const source=document.createElement('canvas'),layer=document.createElement('canvas');
   source.width=w+pad*2;layer.width=w;source.height=layer.height=h;
   const copy=source.getContext('2d'),warp=layer.getContext('2d');
   const mask=warp.createRadialGradient(w*.46,h*.55,h*.10,w*.49,h*.49,h*.51);
   mask.addColorStop(0,'rgba(0,0,0,.98)');mask.addColorStop(.50,'rgba(0,0,0,.80)');mask.addColorStop(1,'rgba(0,0,0,0)');
   this.heatShimmer={source,layer,copy,warp,mask};
  }
  const {source,layer,copy,warp,mask}=this.heatShimmer,inv=t.inverse();
  copy.setTransform(1,0,0,1,0,0);copy.clearRect(0,0,source.width,h);
  copy.setTransform(inv.a,inv.b,inv.c,inv.d,inv.e-x+pad,inv.f-y);
  // Copy only this hot patch, including its source margin and rotated camera pose.
  copy.drawImage(c.canvas,sx,sy,sw,sh,sx,sy,sw,sh);
  warp.clearRect(0,0,w,h);
  for(let row=0;row<h;row+=4){
   const d=heat*(Math.sin(phase+row*.097)*4.3+Math.sin(phase*1.67-row*.207)*2.45);
   warp.drawImage(source,pad+d,row,w,4,0,row,w,4);
  }
  warp.globalCompositeOperation='destination-in';warp.fillStyle=mask;warp.fillRect(0,0,w,h);
  warp.globalCompositeOperation='source-over';
  c.save();c.globalAlpha=Math.min(.81,heat*.92);c.drawImage(layer,x,y);c.restore();
 }
 drawInternal(m){
  const c=this.c;c.save();this.engineTransform();
  for(const scar of m.fragments.linerScuffs){
   const x=XS[scar.cylinder]+scar.side*47;
   if(this.zoom>1&&(scar.kind==='wedge'||scar.kind==='strike'||!scar.kind)){
    const cy=m.cylinders[scar.cylinder],side=scar.side;
    if(cy.active){
     const top=pistonGeometry(m.phase,cy).top;
     for(let k=0;k<root.Piston.RING_HEIGHTS.length;k++){
      const y=top+root.Piston.RING_HEIGHTS[k];
      if(y<scar.top||y>scar.bottom||!root.Piston.hasRingFace(cy,m.ringShed[cy.id],side,k))continue;
      const film=clamp(cy.contact.filmMicron/3,0,1);
      this.ellipse(x-side*.5,y+.95,1.05+film,.34+film*.35,'rgba(107,81,46,.8)');
      this.line([[x-side*1.7,y-.65],[x+side*.55,y-.8]],'#d6c8a8',.55+scar.depth*.38);
     }
    }
   }
   if(scar.kind==='strike'){
    const tip=x-scar.side*(.45+scar.depth*1.3),mid=(scar.top+scar.bottom)*.5;
    this.poly([[x,scar.top],[tip,mid],[x,scar.bottom],[x+scar.side*.65,mid]],'#383b33');
    this.line([[tip,mid],[x,scar.bottom]],`rgba(217,205,174,${.35+.58*scar.depth})`,.7);
    continue;
   }
   if(scar.kind==='wedge'){
    const {side,top,bottom,depth}=scar,wall=XS[scar.cylinder]+48*side;
    const length=bottom-top,width=side*(.45+depth*1.7);
    const shoulder=wall+width,tip=bottom-Math.min(1.2,length*.1);
    this.poly([[wall,top],[shoulder,top+length*.18],[shoulder+width*.3,tip],[wall,bottom]],'#4b4238');
    this.line([[wall,top],[wall+width*.14,tip],[wall,bottom]],'#302e28',.58);
    this.line([[shoulder,top+length*.18],[shoulder+width*.3,tip],[wall,bottom]],'#ae9e85',.42+depth*.58);
    continue;
   }
   if(scar.kind==='skirt'||scar.kind==='skew'){
    const length=scar.bottom-scar.top,depth=scar.depth,side=scar.side;
    const rub=c.createLinearGradient(0,scar.top,0,scar.bottom);
    rub.addColorStop(0,'rgba(65,57,50,0)');
    rub.addColorStop(.17,`rgba(64,53,47,${.5+.4*depth})`);
    rub.addColorStop(.78,`rgba(55,47,41,${.67+.24*depth})`);
    rub.addColorStop(1,'rgba(65,57,50,0)');
    this.line([[x,scar.top],[x-side*.5,scar.top+length*.55],[x,scar.bottom]],rub,1.4+3.3*depth);
    this.line([[x-side*.95,scar.top+length*.09],[x-side*1.48,scar.bottom-length*.08]],`rgba(205,193,166,${.35+.44*depth})`,.66+depth*.68);
    if(depth>.12)this.line([[x-side*2.8,scar.top+length*.21],[x-side*3.15,scar.bottom-length*.19]],`rgba(170,157,132,${.28+.48*depth})`,.61);
    continue;
   }
   this.line([[x,scar.top],[x+.26,scar.top+(scar.bottom-scar.top)*.55],[x-.14,scar.bottom]],`rgba(23,24,22,${.48+.43*scar.depth})`,.82+scar.depth*1.15);
   this.line([[x-scar.side*.6,scar.top+.3],[x-scar.side*.84,scar.bottom]],`rgba(194,189,171,${.18+.52*scar.depth})`,.67);
   if(scar.depth>.16){
    const length=scar.bottom-scar.top,offset=scar.side*(1.04+scar.depth*.88);
    this.line([[x-offset,scar.top+length*.17],[x-offset*1.24,scar.top+length*.57],[x-offset*1.12,scar.bottom-length*.11]],
     `rgba(102,90,74,${.46*scar.depth})`,.55+scar.depth*.48);
   }
  }
  // Only model particles are drawn. Their positions survive reload and zoom.
  for(const p of m.fragments.bodies){
   if(p.jammed&&p.zone==='chamber'&&p.rubbing>.05){
    const x=XS[p.cylinder],cy=m.cylinders[p.cylinder];
    const crown=pistonGeometry(cy.active?m.phase:cy.freeze,cy,x).top;
    const stroke=`rgba(222,187,138,${.25+.65*p.rubbing})`;
    if(Math.abs(p.x-x)+p.r>=46){
     const liner=x+Math.sign(p.x-x)*48;
     this.line([[liner,p.y-p.r],[liner,p.y+p.r]],stroke,1.6);
    }
    if(p.y-p.r<234)this.line([[p.x-p.r,232],[p.x+p.r,232]],stroke,1.6);
    if(Math.abs(crown-p.y-p.r)<3)this.line([[p.x-p.r,crown],[p.x+p.r,crown]],stroke,1.6);
   }
   if(p.jammed&&p.jamEdge&&Number.isFinite(p.edgeX)&&Number.isFinite(p.edgeY))this.drawEdgeContact(p);
   c.save();c.translate(p.x,p.y);
   if(p.kind==='ring'&&p.skew){
    // Foreshorten only the ring face. Its centre remains on the contact plane.
    const s=Math.sin(p.skew),f=Math.cos(p.skew);
    c.transform(1,0,s*.28,f,0,0);
   }
   c.rotate(p.a);
   const sump=p.zone==='case'?m.oilCircuit.surfaceAt(p.x):OIL_PAN.floor;
   const r=p.r,wet=p.zone==='case'&&p.y>sump,heat=clamp((p.heat-170)/190,0,1);
   if(p.kind==='ring'){
    c.beginPath();
    const worn=p.zone==='chamber'?1-p.r/p.jamRadius:0;
    if(worn>.025){
     const angle=Math.acos(1-worn);
     c.arc(0,0,p.r,p.wearFace+angle,p.wearFace+TAU-angle);
     const face=p.r*Math.cos(angle),edge=p.r*Math.sin(angle);
     c.save();c.rotate(p.wearFace);
     c.moveTo(face,-edge);c.lineTo(face,-edge*.27);
     c.moveTo(face,edge*.27);c.lineTo(face,edge);c.restore();
    }else c.arc(0,0,p.r,.25,5.4);
    c.strokeStyle=wet?'#3e3c31':'#3c3e3b';c.lineWidth=1.8;c.stroke();
    const ringLight=c.createLinearGradient(-r,-r,r,r);
    ringLight.addColorStop(0,wet?'#a59d7d':'#c7c7b6');
    ringLight.addColorStop(.48,p.jammed&&p.rubbing>.35?'#c7aa7c':'#96968d');
    ringLight.addColorStop(1,wet?'#615642':'#747570');
    c.strokeStyle=ringLight;c.lineWidth=1.12;c.stroke();
   }
   else if(p.kind==='rod'){
    const face=c.createLinearGradient(-r,-r,r,r);
    face.addColorStop(0,wet?'#716b58':'#98998f');face.addColorStop(.43,wet?'#5b564c':'#7d817a');face.addColorStop(1,'#3a3b35');
    const crown=[[-r,-r*.5],[-r*.53,-r*.9],[-r*.22,-r*.47],[r*.69,-r*.78],[r*.97,-r*.41],[r*.75,r*.82],[r*.31,r*.57],[-r*.68,r*.6]];
    this.poly(crown,face,'#353733',.55);
    this.poly([crown[0],crown[1],crown[2],crown[3],[r*.43,-r*.47],[-r*.39,-r*.26]],wet?'#827965':'#b7b4a7');
    this.circle(-r*.09,r*.16,r*.29,'#343632','#75776b',.62);
    this.line([[r*.31,r*.58],[r*.75,r*.82],[r*.79,r*.6]],'#626155',.53);
   }else if(!this.drawInternalHardware?.(p,heat,sump,c)){
    const point=[[-r,-r*.08],[-r*.64,-r*.57],[-r*.09,-r*.47],[r*.57,-r*.82],[r*.9,-r*.24],[r*.67,r*.51],[r*.05,r*.73],[-r*.53,r*.43]];
    this.poly(point,wet?'#686253':heat>.4?'#858075':'#898a81','#45453d',.48);
    this.poly([point[0],point[1],point[2],point[3],[r*.33,-r*.26],[-r*.14,r*.08]],wet?'#89816a':'#b6b2a4');
    if(r>3)this.line([[-r*.14,r*.08],[r*.33,-r*.26],[r*.52,-r*.34]],wet?'#615747':'#55564e',.48);
   }
   if(p.jammed){
    if(p.zone==='liner'){
     const side=Math.sign(p.edgeX-p.x);
     c.rotate(-p.a);
     this.line([[side*p.r*.46,-p.r*.58],[side*p.r*.88,-p.r*.22],[side*p.r*.91,p.r*.14]],
      `rgba(237,207,152,${.30+.68*p.rubbing})`,.8);
    }else this.line([[-p.r-2,-p.r-3],[p.r+2,-p.r-3]],'#d1b07c',1.1);
    if(this.mode==='damage')this.circle(0,0,p.r+4,null,'#cea96c',.6);
   }
   c.restore();
  }
  for(const mark of this.contactMarks){
   const {x,y,nx,ny,age,strength}=mark,fade=(1-age/.33)**1.5;
   const size=3+strength*6;
   c.save();c.globalAlpha=fade*.85;
   if(mark.jam){
    this.line([[x-size,y],[x-size,y-size],[x,y-size]],'#debd86',1);
    this.line([[x+size,y],[x+size,y+size],[x,y+size]],'#debd86',1);
   }else if(this.mode==='damage'){
    this.line([[x-ny*size*.52,y+nx*size*.52],[x+ny*size*.52,y-nx*size*.52]],'#ddc198',.85);
   }
   c.restore();
  }
  if(!this.reduced)for(const p of this.metalSparks){
   const hot=(1-p.age/p.life)**1.8,trail=.01*hot;
   this.line([[p.x-p.vx*trail,p.y-p.vy*trail],[p.x,p.y]],`rgba(233,156,79,${hot*.69})`,.83);
   this.circle(p.x,p.y,.36+hot*.3,`rgba(252,224,161,${hot})`);
  }
  c.restore();
 }
 drawEdgeContact(p){
  const {edgeX:x,edgeY:y}=p,dx=p.x-x,dy=p.y-y;
  const distance=Math.hypot(dx,dy);
  if(distance<.01)return;
  const nx=dx/distance,ny=dy/distance,tx=-ny,ty=nx;
  const length=clamp(p.r*.71,1.4,5.6),load=clamp(p.rubbing,0,1);
  // A burnished land on the actual fixed edge, visible even while inspection is paused.
  this.line([[x-tx*length,y-ty*length],[x+tx*length,y+ty*length]],'rgba(24,20,16,.74)',1.6);
  this.line([[x-tx*length+nx*.37,y-ty*length+ny*.37],[x+tx*length+nx*.37,y+ty*length+ny*.37]],
   `rgba(210,184,145,${.46+load*.43})`,.84+load*.34);
 }
 drawEdgeChips(m){
  const c=this.c;c.save();this.engineTransform();
  for(const chip of m.fragments.edgeChips){
   if(chip.damage<.12)continue;
   const scale=Math.sqrt(chip.damage),r=(chip.edge==='liner'||chip.edge==='head'?3:4.7)*scale;
   c.save();c.translate(chip.x,chip.y);c.rotate(Math.atan2(chip.ny,chip.nx));
   // Positive local X faces the cavity. The fracture opens into solid metal.
   this.poly([[.25,-r],[-r*.35,-r*.63],[-r*.69,-r*.31],[-r*.54,r*.17],[-r*.76,r*.49],[-r*.3,r*.81],[.2,r]],'#171c18');
   this.poly([[-r*.69,-r*.31],[-r*.54,r*.17],[-r*.76,r*.49],[-r*.3,r*.81],[-r*.43,r*.33]],'#707468');
   this.line([[.25,-r],[-r*.35,-r*.63],[-r*.69,-r*.31]],'#a5a798ad',.62);
   c.restore();
  }
  c.restore();
 }
 engine(m){super.engine(m);this.externalFluids(m);this.drawEdgeChips(m);this.drawInternal(m);}
 resetPlumes(){
  this.exhaustAcc=0;this.leakAcc=0;this.coolantAcc=0;this.steamAcc=0;this.mistAcc=0;
  this.radiatorDropAcc=0;this.radiatorSteamAcc=0;this.caseDropAcc=0;this.spillSmokeAcc=0;
  this.hoseDropAcc=0;this.hoseSteamAcc=0;
  this.sealDropAcc=[0,0];
 }
 reset(){super.reset();this.resetPlumes();this.contactMarks=[];this.metalSparks=[];}
}
Object.assign(root.Piston,{Renderer,EXHAUST_OUTLET,OUTLET_ANGLE,MUFFLER_BOUNDS,MUFFLER_DUCT});
})(window);
