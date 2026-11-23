/* Original SVG hardware, rasterized once. Analogue flow belongs to the model.
 * Engine parts move in engine space; radiator and hoses stay on the test stand.
 */
(function(root){
'use strict';
const {Renderer:Base,clamp,TAU,pistonGeometry,EXHAUST_OUTLET,OUTLET_ANGLE,MUFFLER_BOUNDS,MUFFLER_DUCT,CRANK_SEALS,crankSealOpening,BEARING_CAPS,MAIN_WEAR_WARNING}=root.Piston;
function measurePath(points){
 const lengths=new Float64Array(points.length);let total=0;
 for(let i=1;i<points.length;i++){total+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);lengths[i]=total;}
 return {points,lengths,total};
}
function samplePath(route,u,out=[0,0,0]){
 const d=clamp(u,0,1)*route.total,ps=route.points,ls=route.lengths;
 for(let i=1;i<ps.length;i++)if(d<=ls[i]||i===ps.length-1){const len=ls[i]-ls[i-1],t=(d-ls[i-1])/Math.max(len,1e-9);out[0]=ps[i-1][0]+(ps[i][0]-ps[i-1][0])*t;out[1]=ps[i-1][1]+(ps[i][1]-ps[i-1][1])*t;out[2]=Math.atan2(ps[i][1]-ps[i-1][1],ps[i][0]-ps[i-1][0]);return out;}
 out[0]=ps[0]?.[0]||0;out[1]=ps[0]?.[1]||0;out[2]=0;return out;
}
function roundedHose(points,radius){
 const curve=[points[0]];
 for(let i=1;i<points.length-1;i++){
  const [x,y]=points[i],a=points[i-1],b=points[i+1];
  const before=Math.hypot(a[0]-x,a[1]-y),after=Math.hypot(b[0]-x,b[1]-y);
  if(!before||!after)continue;
  const d=Math.min(radius,before*.4,after*.4);
  const from=[x+(a[0]-x)*d/before,y+(a[1]-y)*d/before];
  const to=[x+(b[0]-x)*d/after,y+(b[1]-y)*d/after];
  curve.push(from);
  for(let j=1;j<=4;j++){
   const t=j/4,s=1-t;
   curve.push([from[0]*s*s+2*x*s*t+to[0]*t*t,from[1]*s*s+2*y*s*t+to[1]*t*t]);
  }
 }
 curve.push(points[points.length-1]);return curve;
}
class Atlas{
 constructor(){this.parts=new Map();this.failed=[];this.bytes=0;this.promise=Promise.all(Object.entries(root.Piston.MECHANICAL_SVG||{}).map(async([id,svg])=>{
  const img=new Image();await new Promise(resolve=>{img.onload=resolve;img.onerror=()=>{this.failed.push(id);resolve();};img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);});
  if(!img.naturalWidth)return;
  const canvas=document.createElement('canvas');canvas.width=img.naturalWidth*2;canvas.height=img.naturalHeight*2;
  canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);this.bytes+=canvas.width*canvas.height*4;this.parts.set(id,canvas);
 }));}
 draw(c,id,x,y,w,h){const cv=this.parts.get(id);if(!cv)return false;c.drawImage(cv,x,y,w,h);return true;}
}
let atlas,mufflerRoute;
const JAM_ZOOM=3;
const SEAL_ZOOM=2.5;
const MAIN_BEARING_ZOOM=2.8;
const PARTS={radiator:{x:136,y:339,z:2.12,label:'РАДИАТОР / ВЕНТИЛЯТОР'},filter:{x:274,y:499,z:2.5,label:'ФИЛЬТР / МАСЛЯНАЯ МАГИСТРАЛЬ'},pump:{x:251,y:305,z:2.15,label:'ПОМПА / ТЕРМОСТАТ'},exhaust:{x:1027,y:302,z:2.25,label:'ВЫПУСК / РАЗРЕЗ ГЛУШИТЕЛЯ'},sump:{x:595,y:473,z:2.1,label:'КАРТЕР / КОНТАКТЫ ОСКОЛКОВ'},timing:{x:240,y:293,z:1.76,label:'ЦЕПЬ ГРМ'}};
class Renderer extends Base{
 constructor(canvas){super(canvas);mufflerRoute??=measurePath(MUFFLER_DUCT);this.atlas=atlas||(atlas=new Atlas());this.partFocus=null;this.jamFocus=null;this.thermalFocus=false;this.bearingFocus=false;this.flowPoint=[0,0,0];this.inspectLabels=true;this.atlas.promise.then(()=>{if(this.currentModel)this.render(this.currentModel);});}
 setFocus(i){
  this.partFocus=null;this.thermalFocus=false;this.bearingFocus=false;
  const cylinder=clamp(i,0,(this.currentModel?.cylinders.length??4)-1);
  const wedges=this.currentModel?.fragments.bodies.filter(p=>p.jammed&&p.zone!=='case'&&p.cylinder===cylinder);
  const jam=wedges?.find(p=>p.kind==='ring')??wedges?.[0];
  const selectedJam=this.jamFocus;
  const inspectSkirt=selectedJam?.jammed&&selectedJam.zone==='chamber'&&selectedJam.cylinder===cylinder&&this.currentModel?.cylinders[cylinder].contact.skewSeized;
  if(jam&&!inspectSkirt){this.focus=cylinder;this.lookAtJam(jam);return;}
  this.jamFocus=null;
  const thermal=this.thermalPoint(cylinder),contact=thermal??this.bearingPoint(cylinder);
  if(contact){
   this.focus=cylinder;this.thermalFocus=!!thermal;this.bearingFocus=!thermal;
   this.lookAt({...this.world(contact.x,contact.y),z:JAM_ZOOM});
  }else super.setFocus(cylinder);
 }
 thermalPoint(i){
  const m=this.currentModel,cy=m?.cylinders[i];
  if(!cy?.active)return null;
  if(cy.contact.skewSeized)return m.skewContactPoint(cy);
  return cy.contact.thermalSeized?m.skirtContactPoint(cy):null;
 }
 bearingPoint(i){
  const m=this.currentModel,cy=m?.cylinders[i];
  if(!cy?.contact.bearingSpun||!cy.active&&!(cy.failure==='rod'&&cy.contact.rodFatigue>=1))return null;
  const {crankX:x,crankY:y}=pistonGeometry(m.phase,cy,373+144*i);
  return {x,y};
 }
 setPart(id){
  if(!PARTS[id])return;
  const inspectFault=id==='sump'&&this.partFocus===id&&this.jamFocus?.jammed&&(this.breachView()||this.sealView()||this.mainBearingView());
  const nextSeal=id==='sump'&&!this.jamFocus&&this.zoom===JAM_ZOOM&&this.breachView()&&this.sealView();
  const nextBearing=id==='sump'&&!this.jamFocus&&this.zoom===SEAL_ZOOM&&this.mainBearingView();
  this.partFocus=id;this.thermalFocus=false;this.bearingFocus=false;
  const jam=id==='sump'&&this.currentModel?.fragments.bodies.find(p=>p.jammed&&p.zone==='case');
  if(jam&&!inspectFault&&!nextSeal&&!nextBearing)this.lookAtJam(jam);
  else{this.jamFocus=null;this.lookAt(nextSeal||nextBearing||this.breachView()||this.sealView()||this.mainBearingView()||PARTS[id]);}
 }
 breachView(){
  const hole=this.currentModel?.fragments.caseBreach;
  return this.partFocus==='sump'&&hole?{...this.world(hole.x,558),z:JAM_ZOOM}:null;
 }
 sealView(){
  const seals=this.currentModel?.crankSeals;
  if(this.partFocus!=='sump'||!seals)return null;
  const id=seals[1].wear>seals[0].wear?1:0;
  if(!crankSealOpening(seals[id].wear))return null;
  const s=CRANK_SEALS[id];
  return {...this.world(s.x+s.side*12,s.y+29),z:SEAL_ZOOM};
 }
 mainBearingView(){
  const bearings=this.currentModel?.mainBearings;
  if(this.partFocus!=='sump'||!bearings)return null;
  const i=bearings.reduce((best,b,i)=>b.wear>bearings[best].wear?i:best,0);
  return bearings[i].wear>=MAIN_WEAR_WARNING?{...this.world(BEARING_CAPS[i],460),z:MAIN_BEARING_ZOOM}:null;
 }
 setGeneral(){this.partFocus=null;this.jamFocus=null;this.thermalFocus=false;this.bearingFocus=false;super.setGeneral();}
 lookAtJam(p){
  this.jamFocus=p;this.thermalFocus=false;this.bearingFocus=false;
  this.lookAt({...this.world(p.x,p.y),z:JAM_ZOOM});
 }
 updateCamera(now){
  const dt=clamp(now-(this.lastCameraUpdate??now),0,64);
  this.lastCameraUpdate=now;
  if(!this.jamFocus&&!this.thermalFocus&&!this.bearingFocus)return super.updateCamera(now);
  const p=this.jamFocus??(this.bearingFocus?this.bearingPoint(this.focus):this.thermalPoint(this.focus));
  if(!p||this.jamFocus&&!p.jammed){
   this.jamFocus=null;this.thermalFocus=false;this.bearingFocus=false;
   if(this.partFocus==='sump')this.lookAt(this.breachView()??this.sealView()??this.mainBearingView()??PARTS.sump);
   else super.setFocus(this.focus);
   return true;
  }
  // The marker and the camera share the mechanical cut plane and the engine pose.
  const to=this.world(p.x,p.y);
  if(this.cameraMove){Object.assign(this.cameraMove.to,to);return super.updateCamera(now);}
  const dx=to.x-this.camera.x,dy=to.y-this.camera.y;
  if(dx===0&&dy===0)return false;
  // Keep the inspection stable through mount recoil and rapid crank movement.
  if(Math.hypot(dx,dy)<.08)Object.assign(this.camera,to);
  else{
   const follow=1-Math.exp(-dt/92);
   this.camera.x+=dx*follow;this.camera.y+=dy*follow;
  }
  return true;
 }
 pipe(path,cell,color,width=10,flow=cell.flow,phase=cell.phase){
  const c=this.c,fill=clamp(cell.litres/cell.capacity,0,1),water=color!=='#877455'&&color!=='#8b7652';
  const route=measurePath(roundedHose(path,width*1.7)),points=route.points;
  // The jacket stays opaque in the general view. Inspection exposes a
  // longitudinal section so the liquid and arrows remain legible.
  const section=water?this.partFocus==='radiator'||this.partFocus==='pump'||this.mode==='thermal':this.partFocus==='filter'||this.mode==='oil';
  this.line(points,'#151815',width+2.7);
  this.line(points,water?'#303530':'#494136',width+.75);
  this.line(points,water?'#262b26':'#322d24',width);
  c.save();
  if(water&&!section){
   c.translate(-.75,-1.15);
   this.line(points,'rgba(165,169,153,.24)',Math.max(1,width*.32));
   this.line(points,'rgba(206,210,193,.12)',.65);
   c.translate(.75,1.15);
  }
  if(fill>.005&&(section||!water)){
   const wet=fill>.995?points:points.filter((p,i)=>route.lengths[i]<route.total*fill);
   if(wet!==points){const [x,y]=samplePath(route,fill,this.flowPoint);wet.push([x,y]);}
   this.line(wet,water?'#335d51':this.oilColor(this.currentModel,.52),Math.max(1,width-(section?2.6:4.5)));
   this.line(wet,water?'rgba(158,196,177,.36)':this.oilColor(this.currentModel,.95,.62),Math.max(.65,width*.14));
   if(section&&flow>.005&&!this.reduced){
    const count=Math.min(5,Math.max(2,Math.ceil(route.total/52)));
    for(let j=0;j<count;j++){
     const u=(phase+j/count)%1;if(u>fill)continue;
     const [x,y,angle]=samplePath(route,u,this.flowPoint);
     c.save();c.translate(x,y);c.rotate(angle);
     if(cell.bubbles>.08&&j%2===0)this.ellipse(0,0,1.15+cell.bubbles*1.8,width*.14,null,water?'rgba(198,223,216,.62)':'rgba(224,188,137,.63)',.65);
     else this.line([[-width*.2,-width*.09],[1,width*.02],[-width*.2,width*.13]],water?'#9cbeb0':'#c6ac82',.65);
     c.restore();
    }
   }
  }
  if(width>5&&route.total>24)for(const u of [3/route.total,1-3/route.total]){
   const [x,y,angle]=samplePath(route,u,this.flowPoint);
   c.save();c.translate(x,y);c.rotate(angle);
   this.rr(-2.8,-width*.64,5.6,width*1.28,.65,'#77786b','#3f443b',.5);
   this.line([[-2.1,-width*.57],[-2.1,width*.5]],'#a7aa9e',.6);
   this.line([[1,-width*.53],[1,width*.50]],'#53574c',.7);
   this.rr(-3,-width*.69,7.4,2.6,.5,'#76796c');
   this.line([[-2.5,-width*.68],[3.6,-width*.68]],'#b3b5a7',.57);
   this.line([[2.1,-width*.68],[2.1,-width*.68+2.2]],'#3a4037',.62);
   c.restore();
  }
  c.restore();
 }
 relay(m){
  const r=m.relay;
  this.bake('cooling-relay','sealed',[35,133,77,90],()=>{
   this.rr(42,143,59,41,4,'#373730','#777261',.9);
   this.rr(46,145,51,30,2.3,'#262722','#59574c',.9);
   this.rr(54,175,36,11,2.5,'#465047','#767a69',.7);
   this.line([[47,148],[95,148]],'#6b6859',.75);
   for(const x of [49,94])this.bolt(x,157,2.4);
   this.line([[61,185],[61,198],[56,211]],'#916c4f',2.2);
   this.line([[83,185],[83,198],[73,211]],'#606258',2.1);
   this.rr(49,206,29,6,1.3,'#373830','#666456',.65);
  });
  if(r.closed){
   const burnt=clamp((r.contactTemp-65)/120,0,1);
   this.rr(85,154,5.3,2.3,.65,`rgba(200,165,105,${.56+burnt*.4})`);
  }
  this.radiator(m);
 }
 radiator(m){
  if(!this.atlas.parts.has('radiator-core')||!this.atlas.parts.has('fan-rotor')){super.radiator(m);return;}
  const c=this.c,x=83,y=347,r=57;
  this.bake('radiator-shroud','mounted',[18,199,148,286],()=>{
   const q=this.c,shroud=q.createLinearGradient(34,210,150,457);
   shroud.addColorStop(0,'#444842');shroud.addColorStop(.45,'#2c312c');shroud.addColorStop(1,'#20241f');
   this.poly([[35,212],[152,221],[163,430],[153,458],[37,462]],shroud);
   this.line([[151,223],[161,426],[153,453]],'#3c4039',.65);
   for(const dx of [41,128]){
    this.rr(dx-7,455,14,23,1.2,'#30362f');
    this.poly([[dx-8,466],[dx+12,466],[dx+10,478],[dx-6,478]],'#343a33');
    this.rr(dx-9,468,18,4,1,'#1d221d');
    this.rr(dx-12,473,24,4,1,'#53574d');
    this.bolt(dx,464,2.1);this.bolt(dx-6,474,1.55);
   }
   this.rr(29,278,125,138,11,shroud);
   this.circle(x,y,r+4,'#343831');
   this.circle(x,y,r+1,'#1b1f1b');
   const deep=q.createRadialGradient(x-12,y-8,8,x,y,r+1);
   deep.addColorStop(0,'#171a17');deep.addColorStop(.66,'#202520');deep.addColorStop(1,'#101310');
   this.circle(x,y,r,deep);
  });
  if(m.relay.fan>.27&&!this.reduced){
   this.circle(x,y,r-5,'rgba(116,114,102,.12)','#45483e',1.1);
   this.circle(x,y,r-10,null,'rgba(139,137,120,.23)',1.2);
  }
  c.save();c.translate(x,y);c.rotate(m.fanAngle||0);
  c.globalAlpha=1-m.relay.fan*.37;
  this.atlas.draw(c,'fan-rotor',-r,-r,r*2,r*2);c.restore();
  // Only the side of the shroud exposed by the section is visible through the core.
  this.bake('radiator-face','section',[20,204,138,265],()=>{
   const q=this.c,cut=new Path2D();
   cut.moveTo(x,y-r);cut.arc(x,y,r,-Math.PI/2,Math.PI/2);
   cut.lineTo(x-13,y+r-4);cut.lineTo(x-13,y-r+4);cut.closePath();
   const layer=new Path2D();layer.rect(21,206,134,261);layer.addPath(cut);
   q.save();q.clip(layer,'evenodd');
   this.atlas.draw(q,'radiator-core',22,207,135,259);
   // Subdue fin contrast behind the lip without laying colour over the fan opening.
   const shade=q.createLinearGradient(46,232,129,440);
   shade.addColorStop(0,'rgba(45,49,43,.12)');shade.addColorStop(.38,'rgba(43,48,44,.22)');
   shade.addColorStop(1,'rgba(25,29,26,.46)');
   q.globalCompositeOperation='source-atop';q.fillStyle=shade;q.fillRect(22,207,135,259);q.restore();
   q.strokeStyle='#373a31';q.lineWidth=2;q.stroke(cut);
   q.beginPath();q.arc(x,y,r-.7,-1.44,.98);
   q.strokeStyle='rgba(170,167,147,.58)';q.lineWidth=.68;q.stroke();
   for(const py of [265,431]){
    this.rr(136,py-8,16,15.3,2.8,'#383d36');
    this.line([[139.5,py-6],[148,py-6]],'rgba(156,158,143,.53)',.7);
    this.line([[139.5,py+5],[148,py+5]],'#242922',.72);
   }
  });
  if(m.corrosion>.02){
   c.save();
   c.globalAlpha=m.corrosion*.72;
   // Rust grows from the steel seams and mounting points of the cooler.
   for(let i=0;i<32;i++){
    const x=25+(i*29%13)+(i%2?116:0),y=218+(i*47%233);
    this.ellipse(x,y,.8+(i%4)*.45,1+(i%3)*.6,i%3?'#8b5231':'#62351e');
   }
   c.restore();
  }
 }
 externalFluids(m){
  super.externalFluids(m);const c=this.c;
  c.save();this.engineTransform();
  // Keep transparent runs visible at actual inventory, including empty dry tubing.
  this.atlas.draw(c,'filter-cutaway',235,528,45,55);
  const circuit=m.oilCircuit,dirt=clamp(circuit.filterRestriction/.86,0,1),bypass=clamp(circuit.bypass,0,1);
  for(const x of [246,261]){
   if(dirt>.01){
    const grit=c.createLinearGradient(0,543,0,570);
    grit.addColorStop(0,`rgba(46,33,20,${dirt*.94})`);grit.addColorStop(.55,`rgba(58,40,22,${dirt*.76})`);
    grit.addColorStop(1,`rgba(44,31,19,${dirt*.42})`);
    this.rr(x,543,7.3,27,.5,grit);
    for(let i=0;i<Math.ceil(dirt*9);i++)this.ellipse(x+.5+(i*13%17)*.39,544+(i*31%24),.48+(i%4)*.14,.51,'#37291e');
   }
   if(this.partFocus==='filter'&&this.mode==='oil'&&circuit.filterFlow>.02&&!this.reduced){
    const phase=circuit.cells[2].phase,side=x<250?1:-1;
    for(let i=0;i<3;i++){
     const u=(phase+i/3)%1;
     this.ellipse(x+(side>0?8*u:7.2-8*u),548+i*7,.62,.45,this.oilColor(m,.9,.53));
    }
   }
  }
  this.rr(253,572,9,1.8,.62,'#26231c','#897b64',.45);
  this.rr(253.7,572.2+bypass*2.6,7.6,1.2,.45,'#b8a488');
  // Work light on the exposed pump and thermostat faces over their cast housings.
  const pumpReady=this.atlas.parts.has('pump-cutaway'),thermostatReady=this.atlas.parts.has('thermostat-cutaway');
  if(pumpReady||thermostatReady)this.bake('cooling-housings',`${pumpReady}:${thermostatReady}`,[236,232,62,197],()=>{
   const q=this.c;
   this.atlas.draw(q,'pump-cutaway',247,379,49,49);
   this.atlas.draw(q,'thermostat-cutaway',237,233,48,48);
   q.globalCompositeOperation='source-atop';
   for(const [start,end] of [[233,281],[379,428]]){
    const shade=q.createLinearGradient(247,start,283,end);
    shade.addColorStop(0,'rgba(54,57,53,.1)');shade.addColorStop(.47,'rgba(51,55,51,.18)');
    shade.addColorStop(1,'rgba(27,31,28,.51)');
    q.fillStyle=shade;q.fillRect(237,start,60,end-start);
   }
  });
  const pumpWear=m.auxWear?.waterPump||0,pumpFailed=pumpWear>=1;
  c.save();c.translate(271.5,403.5);c.rotate(m.phase*.5);
  if(pumpFailed){
   c.beginPath();c.rect(-16,-16,32,32);c.moveTo(0,-5);c.arc(0,0,13,-1.77,-.72);c.closePath();c.clip('evenodd');
  }
  this.atlas.draw(c,'pump-impeller',-16,-16,32,32);
  if(pumpWear>.28)for(const [x,y] of [[-7,2],[-4,-8],[6,7],[8,-3]]){
   this.ellipse(x,y,.45+pumpWear*.7,.32+pumpWear*.38,'#39464a');
   this.line([[x-.3,y+.49],[x+.6,y+.39]],`rgba(212,200,158,${pumpWear*.63})`,.42);
  }
  c.restore();
  if(pumpFailed){
   this.poly([[281,410],[283,406],[285,407],[284,412]],'#776648','#bfaa83',.52);
   this.line([[260,412],[263,416],[271,420]],'rgba(208,182,132,.5)',.75);
  }
  const q=m.waterCircuit.q;
  if(this.partFocus==='pump'&&q>.5&&!this.reduced){
   const phase=m.waterCircuit.cells[5].phase*TAU;
   c.beginPath();
   for(let i=0;i<3;i++){
    const a=phase+i*TAU/3;
    c.moveTo(271.5+17*Math.cos(a),403.5+17*Math.sin(a));
    c.arc(271.5,403.5,17,a,a+.22+clamp(q/180,0,.4));
   }
   c.strokeStyle=`rgba(154,222,192,${clamp(q/80,.15,.55)})`;c.lineWidth=1;c.stroke();
  }
  const open=clamp((m.coolant-82)/13,0,1);this.line([[254,253-open*6],[270,253-open*6]],'#ceb887',2.3);
  c.restore();
  // Clear inspection window: liquid meniscus, gas headspace, dry-level scale.
  const tank=m.waterCircuit.cells[0],level=tank.litres/tank.capacity,y=213-level*30;
  this.rr(178,168,41,48,4,'#333832','#6d7365',.72);
  c.save();this.rr(180,170,37,44,2.7,'#2d322c');c.clip();
  const liquid=c.createLinearGradient(180,y,217,215);
  liquid.addColorStop(0,'#587466');liquid.addColorStop(.35,'#3c594b');liquid.addColorStop(1,'#222e26');
  if(level>.005){
   c.beginPath();c.moveTo(179,y-.55);c.quadraticCurveTo(197,y+.35,218,y-.55);
   c.lineTo(218,215);c.lineTo(179,215);c.closePath();c.fillStyle=liquid;c.fill();
   this.line([[181,y-.28],[197,y],[216,y-.28]],'rgba(179,207,192,.62)',.65);
  }
  if(level>.05&&tank.bubbles>.04)for(let i=0;i<6;i++){const phase=(tank.phase+i*.173)%1;this.ellipse(184+(i%4)*8,213-phase*30*level,.55+phase*.38,1.25,null,'rgba(198,220,219,.6)',.55);}
  const glass=c.createLinearGradient(180,0,217,0);
  glass.addColorStop(0,'rgba(202,208,194,.19)');glass.addColorStop(.1,'rgba(202,208,194,.05)');
  glass.addColorStop(.44,'rgba(202,208,194,.015)');glass.addColorStop(1,'rgba(12,15,13,.35)');
  c.fillStyle=glass;c.fillRect(180,170,37,44);
  c.restore();this.line([[182,174],[182,205]],'rgba(202,213,197,.24)',.85);
  for(let j=0;j<5;j++)this.line([[213,175+j*8],[217,175+j*8]],'#8d9f90',.55);
  const radiatorWear=m.auxWear?.radiator||0;
  if(radiatorWear>.14){
   this.line([[139,418],[145,422],[149,431],[153,436]],`rgba(166,155,99,${radiatorWear*.72})`,1.3);
   this.fracture([[143,423],[147,426],[146,429],[152,432],[153,435]],radiatorWear,1.15+radiatorWear*.8);
   if(m.radiatorRunoff>.001){
    const wet=clamp(m.radiatorRunoff/.06,0,1);
    this.line([[147,428],[151,431],[152,434]],`rgba(143,181,153,${.25+wet*.56})`,.85+wet*.7);
    this.ellipse(151,431,.52+wet*.48,.56,`rgba(202,225,195,${wet*.7})`);
   }
  }
 }
 exhaust(m){
  super.exhaust(m);const c=this.c,e=m.exhaust;
  this.atlas.draw(c,'muffler-cutaway',...MUFFLER_BOUNDS);
  const baffleWear=m.auxWear?.mufflerBaffle||0,shellHeat=clamp((e.resonator-95)/360,0,1);
  this.bake('muffler-section',Math.floor(baffleWear*24)+':'+Math.floor(shellHeat*16),[989,293,132,68],()=>{
   const q=this.c,lining=q.createLinearGradient(0,296,0,357);
   lining.addColorStop(0,'#302d27');lining.addColorStop(.3,'#292821');lining.addColorStop(.8,'#23231e');lining.addColorStop(1,'#151613');
   q.save();this.rr(989,296,131,62,8,lining,'#8d897c',.65);q.clip();
   // Packing wraps a continuous perforated tube rather than blocking gas flow.
   for(const y of [296,350]){
    this.rr(991,y,127,7,.6,'#4a453a');
    for(let i=0;i<53;i++){
     const x=992+i*2.37,base=y+1+((i*17)%37)*.1;
     this.line([[x,base+1.7],[x+1.3,base-.5],[x+3.5,base+.85]],i%3===0?'#797265':'#5d584c',.42);
    }
   }
   const bend=clamp((baffleWear-.34)/.66,0,1)*8;
   for(const x of [1014,1051,1089]){
    const offset=x===1051?bend:0,baffle=[[x,302],[x+offset*.74,315],[x+offset,327],[x+offset*.55,338],[x,350]];
    this.line(baffle,'#292924',5.6);this.line(baffle,'#6b6a5f',2.35);
    this.line([[x-3,303],[x+3,303]],'#8e887b',.7);
    this.line([[x-4,349],[x+3,349]],'#555246',.7);
   }
   const duct=q.createLinearGradient(0,305,0,348);
   for(const [at,color] of [[0,'#6d685a'],[.18,'#969082'],[.26,'#645f53'],[.53,'#393832'],[.79,'#504c41'],[.91,'#777365'],[1,'#555548']])duct.addColorStop(at,color);
   this.line(mufflerRoute.points,'#28251f',36);
   this.line(mufflerRoute.points,duct,32.8);
   const inside=q.createLinearGradient(0,312,0,344);
   inside.addColorStop(0,'#191814');inside.addColorStop(.48,'#121310');inside.addColorStop(1,'#0c0e0c');
   this.line(mufflerRoute.points,inside,19.5);
   if(shellHeat>.015)this.line(mufflerRoute.points,`rgba(141,80,55,${shellHeat*.51})`,26);
   for(let i=1;i<23;i++){
    const [x,y]=samplePath(mufflerRoute,i/23,this.flowPoint);
    for(const dy of [-11.2,9.4]){
     this.ellipse(x,y+dy,1.14,.72,'#20211b');
     this.line([[x-.72,y+dy+.6],[x+.5,y+dy+.6]],'rgba(164,149,127,.52)',.38);
    }
   }
   if(baffleWear>=1){
    this.fracture([[1047,303],[1052,306],[1052,310],[1057,313]],1,.9);
    this.poly([[1064,347],[1070,347],[1068,343]],'#645b4c');
    this.line([[1064,347],[1068,343]],'#9b8c76',.6);
   }
   q.restore();
   this.line([[995,296.7],[1109,296.7]],'rgba(192,187,170,.67)',.72);
   this.line([[994,357.3],[1112,357.3]],'rgba(79,76,66,.68)',.82);
  });
  if(this.partFocus==='exhaust'&&m.ignition==='running'&&!m.overrun&&e.pulse>.03&&!this.reduced){
   const pulse=e.pulse*(1-e.leak)*(1-baffleWear*.26);
   for(let i=0;i<3;i++){
    const u=((m.phase/TAU+i/3)%1)*.8+.09,p=samplePath(mufflerRoute,u,this.flowPoint);
    c.save();c.translate(p[0],p[1]);c.rotate(p[2]);
    this.ellipse(0,0,2.2+pulse*3,1.02,`rgba(209,174,133,${.08+pulse*.4})`);
    c.restore();
   }
  }
  const soot=clamp(e.soot+e.oil*.3,0,1);
  c.save();c.translate(...EXHAUST_OUTLET);c.rotate(OUTLET_ANGLE);
  c.beginPath();c.ellipse(0,0,8.7,22.8,0,0,TAU);c.clip();
  c.globalAlpha=.68+.32*soot;c.drawImage(this.sootPatch,-11,-26,21,55);
  this.ellipse(.82,.95,5.3+1.4*soot,17.6+2.1*soot,'#100f0d');c.restore();
 }
 drawInternalHardware(p,heat,sump,c){
  const r=p.r,wet=p.zone==='case'&&p.y>sump,edge=heat>.35?'#aa917a':'#a7a79b';
  if(p.kind==='ringLand'){
   this.poly([[-r,-.3*r],[-.62*r,-.73*r],[.71*r,-.48*r],[r,-.06*r],[.55*r,.49*r],[-.42*r,.62*r]],wet?'#615c50':'#76766c');
   this.poly([[-r,-.3*r],[-.62*r,-.73*r],[.71*r,-.48*r],[.32*r,-.14*r]],'#939083');
   this.line([[-.79*r,-.43*r],[-.58*r,-.68*r],[.28*r,-.52*r]],edge,.48);
   this.line([[-.64*r,-.31*r],[.56*r,-.1*r]],'#4b4a40',.67);
  }else if(p.kind==='skirt'){
   c.beginPath();c.moveTo(-r,-.17*r);c.quadraticCurveTo(-.18*r,-.95*r,r,-.34*r);
   c.lineTo(.61*r,.48*r);c.quadraticCurveTo(.02*r,.09*r,-.86*r,.43*r);c.closePath();
   c.fillStyle=wet?'#6b6251':'#838479';c.fill();
   this.line([[-.86*r,-.21*r],[-.41*r,-.45*r],[.21*r,-.51*r],[.62*r,-.42*r]],edge,.47);
   this.line([[-.64*r,.26*r],[-.20*r,.14*r],[.44*r,.25*r]],'#59594f',.55);
  }else if(p.kind==='valve'){
   this.poly([[-.65*r,-.62*r],[.48*r,-.56*r],[r,.03*r],[.19*r,.68*r],[-.83*r,.37*r]],'#6a6256');
   this.poly([[-.65*r,-.62*r],[.48*r,-.56*r],[.79*r,-.18*r],[.17*r,-.05*r]],'#8a7b6b');
   this.line([[-.76*r,.29*r],[.22*r,.54*r],[.85*r,.03*r]],'#a1896c',.55);
  }else if(p.kind==='bearing'){
   // Two layers on the torn half-shell: steel backing and the softer bearing surface.
   c.beginPath();c.arc(0,0,r,.23,3.27);c.arc(0,0,r*.58,3.27,.23,true);c.closePath();
   c.fillStyle=wet?'#6a5f4e':'#8f775d';c.fill();
   c.beginPath();c.arc(0,0,r*.65,.37,3.13);c.strokeStyle=wet?'#97896e':'#ae9e83';c.lineWidth=.7;c.stroke();
   c.beginPath();c.arc(0,0,r*.95,1.2,2.87);c.strokeStyle=edge;c.lineWidth=.48;c.stroke();
   this.line([[-r*.23,r*.6],[-r*.3,r*.88]],'#5b4a3b',.85);
  }else if(p.kind==='crown'){
   this.poly([[-r,-r*.26],[-r*.52,-r*.65],[r*.78,-r*.48],[r,r*.08],[r*.31,r*.74],[-r*.04,r*.49],[-r*.63,r*.83]],wet?'#777366':'#8d8f83');
   this.poly([[-r,-r*.26],[-r*.52,-r*.65],[r*.78,-r*.48],[r,r*.08],[r*.2,-r*.08],[-r*.32,r*.08]],heat>.35?'#68594c':'#585c53');
   this.line([[-r*.46,-r*.62],[r*.48,-r*.51]],edge,.63);
  }else return false;
  return true;
 }
 drawInternal(m){
  super.drawInternal(m);
  if(this.zoom<=1||this.partFocus&&this.partFocus!=='sump')return;
  const selected=this.jamFocus?.jammed?this.jamFocus:null;
  const c=this.c;c.save();this.engineTransform();
  for(const p of m.fragments.bodies){
   if(!p.jammed)continue;
   const inFocus=this.partFocus==='sump'?p.zone==='case':p.zone!=='case'&&p.cylinder===this.focus;
   if(selected?p!==selected:!inFocus)continue;
   const {x,y,r}=p,b=r+4,k=2.5;
   for(const side of [-1,1]){
    const yy=y+b*side,tip=yy-k*side;
    const mark=[[x-b,tip],[x-b,yy],[x+b,yy],[x+b,tip]];
    this.line(mark,'#172128',2.8);this.line(mark,'#f0cf96',1.15);
   }
  }
  const hot=this.thermalFocus&&this.thermalPoint(this.focus);
  if(hot){
   const {x,y}=hot;
   for(const side of [-1,1]){
    const edge=x+side*5,mark=[[edge,y-8],[edge+side*2,y-8],[edge+side*2,y+8],[edge,y+8]];
    this.line(mark,'#172128',2.7);this.line(mark,'#f0cf96',1.05);
   }
  }
  const spun=this.bearingFocus&&this.bearingPoint(this.focus);
  if(spun){
   const {x,y}=spun;
   for(const side of [-1,1]){
    const edge=x+side*25,tip=edge-side*3,mark=[[tip,y-9],[edge,y-9],[edge,y+9],[tip,y+9]];
    this.line(mark,'#172128',2.8);this.line(mark,'#f0cf96',1.15);
   }
  }
  c.restore();
 }
 drawFocusLabel(){
  if(this.thermalFocus&&this.thermalPoint(this.focus)){
   const note=this.currentModel.cylinders[this.focus].contact.skewSeized?'клин юбки от перекоса':'прихват юбки';
   this.focusLabel('Цилиндр '+(this.focus+1)+' · '+note+'  /  ×'+JAM_ZOOM);
   return;
  }
  if(this.jamFocus?.jammed){
   const label=this.partFocus==='sump'?'Картер':'Цилиндр '+(this.focus+1);
   this.focusLabel(label+' · клин  /  ×'+JAM_ZOOM);
   return;
  }
  if(this.bearingFocus&&this.bearingPoint(this.focus)){
   const damage=this.currentModel.cylinders[this.focus].active?'проворот вкладыша':'обрыв шатуна';
   this.focusLabel('Цилиндр '+(this.focus+1)+' · '+damage+'  /  ×'+JAM_ZOOM);
   return;
  }
  if(!this.partFocus){super.drawFocusLabel();return;}
  if(this.zoom===JAM_ZOOM&&this.breachView()){
   this.focusLabel('Картер · пробоина  /  ×'+JAM_ZOOM);
   return;
  }
  if(this.zoom===SEAL_ZOOM&&this.sealView()){
   this.focusLabel('Картер · сальник коленвала  /  ×'+SEAL_ZOOM);
   return;
  }
  if(this.zoom===MAIN_BEARING_ZOOM&&this.mainBearingView()){
   this.focusLabel('Картер · коренной вкладыш  /  ×'+MAIN_BEARING_ZOOM);
   return;
  }
  const focus=PARTS[this.partFocus];
  this.focusLabel(focus.label+'  /  ×'+focus.z);
 }
 reset(){super.reset();this.partFocus=null;this.jamFocus=null;this.thermalFocus=false;this.bearingFocus=false;}
}
Object.assign(root.Piston,{Renderer,measurePath,samplePath,PARTS});
})(window);
