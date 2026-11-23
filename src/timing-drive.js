/* Lumped timing-chain spans, hydraulic tensioner and joint wear.
 * Span travel is in cutaway mm, feed pressure in bar and shaft drag in Nm.
 */
(function(root){
'use strict';
const {clamp,approach,TAU}=typeof module!=='undefined'&&module.exports?require('./simulation.js'):root.Piston;
const CYCLE=TAU*2, CAM_TEETH=24, TOOTH=CYCLE/CAM_TEETH;
const wrap=phase=>(phase%CYCLE+CYCLE)%CYCLE;
const messages={
 chainGuide:'Протёрлась направляющая цепи ГРМ. Цепь бьёт по корпусу.',
 chainSkip:'Цепь ГРМ перескочила на зуб. Сместились фазы клапанов.',
 chainBreak:'Лопнуло звено цепи ГРМ. Распредвалы остановились.'
};
const safe=(v,lo,hi)=>Number.isFinite(v)?clamp(v,lo,hi):lo;
class TimingDrive{
 constructor(){
  this.tensionerPressure=0;this.tensionerTravel=0;this.stretch=0;
  this.pinWear=0;this.guideWear=0;this.fatigue=0;this.teethSkipped=0;
  this.slack=0;this.slackVelocity=0;this.tight=0;this.tightVelocity=0;
  this.camAngle=0;this.temperature=78;this.dragNm=0;this.engagementLoss=0;
  this.rattleCooldown=0;this.broken=false;this.brokenCamPhase=0;this.breakCrankPhase=0;this.gap=0;
 }
 valvePhase(crank){
  return this.broken?this.brokenCamPhase:crank-this.teethSkipped*TOOTH;
 }
 get torqueFactor(){
  // Last Piston keeps firing at reduced output with a failed timing drive.
  return this.broken?.36:1-.11*this.teethSkipped;
 }
 skipTooth(m){
  this.teethSkipped++;this.engagementLoss=0;
  m.emit('chainSkip',-1,messages.chainSkip);
 }
 breakLink(m){
  this.brokenCamPhase=wrap(this.valvePhase(m.phase));this.breakCrankPhase=wrap(m.phase);
  this.fatigue=1;this.broken=true;this.camAngle=this.brokenCamPhase*.5;
  m.emit('chainBreak',-1,messages.chainBreak);
 }
 step(dt,m){
  const oil=m.oilCircuit, speed=clamp(m.rpm/6500,0,1.05), spinning=m.rpm>1;
  const feed=spinning&&m.oil>.015?clamp(m.pressure*(1-.62*(oil?.vapour??0)),0,6):0;
  const fill=feed>this.tensionerPressure, leakage=.76+this.guideWear*1.35+Math.max(0,m.oilTemp-120)*.016;
  this.tensionerPressure=approach(this.tensionerPressure,feed,fill?9:leakage,dt);
  this.rattleCooldown=Math.max(0,this.rattleCooldown-dt);
  this.camAngle=wrap(this.valvePhase(m.phase))*.5;
  if(this.broken){
   this.gap=approach(this.gap,1,spinning?4:1.5,dt);
   this.slack=approach(this.slack,0,5,dt);this.tight=approach(this.tight,0,5,dt);
   this.dragNm=approach(this.dragNm,0,4,dt);
  }
  const oilFilm=clamp(feed/(1.08+.56*speed),0,1)*clamp(1-(m.oilTemp-160)*.007,.26,1);
  const room=4.5-2.2*this.guideWear;
  const hydraulic=clamp(this.tensionerPressure/1.6,0,1);
  const takeup=(1.2+6.5*hydraulic)*(1-.52*this.guideWear);
  this.tensionerTravel=approach(this.tensionerTravel,Math.min(takeup,1+this.stretch*375+hydraulic*2),9,dt);
  const free=clamp((this.stretch*440-this.tensionerTravel)*.78+1.9*this.guideWear,0,12);
  let strike=0,contact=0,crankExcitation=0;
  if(!this.broken){
   const count=Math.ceil(dt*240),h=dt/count;
   const stiffness=520+540*hydraulic, damping=7+18*hydraulic;
   const valveLoad=(.3+.7*speed)*(.73+.27*m.engineLoad);
   for(let n=1;n<=count;n++){
    const phase=m.phase-m.shaftSpeed*(dt-n*h)-this.teethSkipped*TOOTH;
    crankExcitation=spinning?Math.sin(phase*2-.4)+.27*Math.sin(phase*4+.6):0;
    const wave=crankExcitation*valveLoad*(1+free*.33);
    this.slackVelocity+=(stiffness*(free*.64+wave*2.1-this.slack)-damping*this.slackVelocity)*h;
    this.slack+=this.slackVelocity*h;
    this.tightVelocity+=(1060*(wave*.45-this.tight)-26*this.tightVelocity)*h;
    this.tight=clamp(this.tight+this.tightVelocity*h,-2.4,2.4);
    if(this.slack>room){
     strike=Math.max(strike,this.slackVelocity);
     contact+=Math.max(0,this.slackVelocity)*h;
     this.slack=room;this.slackVelocity=Math.min(0,-this.slackVelocity*.29);
    }else if(this.slack< -4){
     this.slack=-4;this.slackVelocity=Math.max(0,-this.slackVelocity*.2);
    }
   }
   const dry=1-oilFilm,hot=clamp((this.temperature-120)/92,0,1);
   const dirt=clamp((oil?.finesConcentration??0)*.69+(m.oilOxidation??0)*.3,0,1);
   const extraDrag=clamp((Math.max(0,this.pinWear-.06)*.68*dry+contact*6.5)*speed,0,1.8);
   this.dragNm=approach(this.dragNm,extraDrag,12,dt);
   if(spinning){
    const elapsed=dt*m.agingScale*speed;
    this.pinWear=clamp(this.pinWear+elapsed*(.000010+dry*(.0034+.0058*hot)+dirt*.0009)*(1+.17*free),0,1);
    this.stretch=this.pinWear*.026;
    const previousGuide=this.guideWear;
    this.guideWear=clamp(this.guideWear+elapsed*(dry*.0053+contact*(.018+.046*dry)),0,1);
    if(previousGuide<1&&this.guideWear===1)m.emit('chainGuide',-1,messages.chainGuide);
    if(strike>13&&this.rattleCooldown===0){
     const level=clamp(strike/90*(.4+.6*this.guideWear),.05,.74);
     m.events.push({type:'chainRattle',cylinder:-1,time:m.time,x:271,y:310,nx:-1,ny:0,level});
     if(m.events.length>32)m.events.shift();
     this.rattleCooldown=.13;
    }
    const unloading=free>2.4&&this.pinWear>.50&&this.guideWear>.47&&crankExcitation<-.24;
    this.engagementLoss=clamp(this.engagementLoss+(unloading?elapsed*(.18+free*.054):-dt*.11),0,1);
    if(this.engagementLoss===1&&this.teethSkipped<3)this.skipTooth(m);
    const tired=Math.max(0,(this.pinWear-.63)/.37),severity=.24+.76*this.guideWear;
    this.fatigue=clamp(this.fatigue+elapsed*tired*tired*(.013+.060*dry+contact*.06)*severity,0,1);
    if(this.fatigue===1)this.breakLink(m);
   }
  }
  const bath=m.oilTemp*.65+m.headTemp*.35, heatKW=this.dragNm*m.rpm*TAU/60000;
  this.temperature=clamp(approach(this.temperature,bath,.045+.16*oilFilm,dt)+heatKW*dt/.20,24,290);
 }
 snapshot(){
  return {pinWear:this.pinWear,guideWear:this.guideWear,fatigue:this.fatigue,
   teethSkipped:this.teethSkipped,broken:this.broken,brokenCamPhase:this.brokenCamPhase,
   breakCrankPhase:this.breakCrankPhase,temperature:this.temperature,tensionerPressure:this.tensionerPressure};
 }
 static restore(data){
  const d=new TimingDrive();
  if(!data||typeof data!=='object')return d;
  for(const key of ['pinWear','guideWear','fatigue'])d[key]=safe(data[key],0,1);
  d.stretch=d.pinWear*.026;d.teethSkipped=Math.floor(safe(data.teethSkipped,0,3));
  d.broken=data.broken===true&&d.fatigue===1;
  d.brokenCamPhase=safe(data.brokenCamPhase,0,CYCLE);d.breakCrankPhase=safe(data.breakCrankPhase,0,CYCLE);
  d.gap=d.broken?1:0;
  d.temperature=Number.isFinite(data.temperature)?clamp(data.temperature,24,290):d.temperature;
  d.tensionerPressure=safe(data.tensionerPressure,0,6);
  return d;
 }
}
const api={TimingDrive,CHAIN_MESSAGES:messages};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else Object.assign(root.Piston,api);
})(typeof globalThis!=='undefined'?globalThis:this);
