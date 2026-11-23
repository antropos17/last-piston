/* Model-owned 2D contact physics and finite-volume transport. No renderer RNG.
 * Contact shapes are conservative discs/capsules, not deformable 3D solids.
 * World lengths are cutaway mm; dt is seconds. Fluid inventories remain in litres.
 */
(function(root){
'use strict';
const base=typeof module!=='undefined'&&module.exports?require('./ignition.js'):root.Piston;
const {TimingDrive,CHAIN_MESSAGES}=typeof module!=='undefined'&&module.exports?require('./timing-drive.js'):root.Piston;
const {OilPan,OIL_PAN}=typeof module!=='undefined'&&module.exports?require('./oil-pan.js'):root.Piston;
const {OilSplash}=typeof module!=='undefined'&&module.exports?require('./oil-splash.js'):root.Piston;
const {Engine:Prior,clamp,approach,pistonGeometry,TAU}=base;
const XS=[373,517,661,805],CAP=64;
const OIL_PICKUP=Object.freeze({x:361,y:539});
const SPILL_PIPE=Object.freeze({left:412,right:856,y:584,r:10});
const COOLANT_HOSE=Object.freeze({left:520,right:735,y:552,r:5});
const HOSE_RUPTURE=.64;
const CRANK_SEALS=[{x:285,y:462,side:-1,load:.090,label:'Передний'},
 {x:921,y:462,side:1,load:.124,label:'Задний'}];
const CRANK_SEAL_LIFT=.26,CRANK_SEAL_FILM_LIMIT=.024;
const crankSealOpening=wear=>clamp((wear-CRANK_SEAL_LIFT)/(1-CRANK_SEAL_LIFT),0,1);
const crankSealMessage=i=>`${CRANK_SEALS[i].label} сальник коленвала пропускает масло из-за давления картерных газов.`;
const HEAD_SEAL_WARP_MM=.055,CHAMBER_CLEARANCE_L=base.SPEC.displacement/4000/(base.SPEC.compression-1);
const BORE_OIL_LIMIT=.00045;
const FOULED_PLUG_CARBON=.34;
const plugFoulingMessage=id=>`Цилиндр ${id+1}: нагар на свече ослабил искру. Начались пропуски зажигания.`;
const HOT_DEPOSIT_C=610,PRE_IGNITION_ANGLE=TAU*2-.46,CROWN_CRACK_FATIGUE=.24;
const CROWN_BREACH_FATIGUE=.72;
const preIgnitionMessage=id=>`Цилиндр ${id+1}: раскалённый нагар воспламенил смесь до искры.`;
const crownCrackMessage=id=>`Цилиндр ${id+1}: от повторных ударов треснуло днище поршня.`;
const crownBreachMessage=id=>`Цилиндр ${id+1}: сквозной пробой в днище поршня. Газы прорываются в картер.`;
function crownOpening(contact){
 const fatigue=contact.crownFatigue??0;
 return fatigue<CROWN_BREACH_FATIGUE?0:.09+.91*clamp((fatigue-CROWN_BREACH_FATIGUE)/(1-CROWN_BREACH_FATIGUE),0,1);
}
// Axial positions of the two compression rings and the two oil-control rails.
const RING_HEIGHTS=Object.freeze([9,16,22,26.5]);
function hasRingFace(cy,shed,side,k){
 const d=cy.contact;
 if(d.ringBreakSide===side&&d.ringSeizures>=(k===0?2:3))return false;
 return k!==0||side<0||d.ringSeizures>=2||!(shed||cy.partWear.ringLand===1);
}
function ringOpening(d,first){
 const a=d.ringFaces?.[first]||0,b=d.ringFaces?.[first+1]||0;
 if(!a&&!b)return 0;
 // The second compression ring still throttles gas escaping past the first.
 return .16*(2*(.12+a)*(.12+b)/(.24+a+b)-.12);
}
const ringFractureMessage=(id,stage)=>`Цилиндр ${id+1}: ${stage===2?'разрушены компрессионные и маслосъёмное кольца':'сломалось компрессионное кольцо'}.`;
const headSealMessage=id=>`Цилиндр ${id+1}: повело ГБЦ, прокладка пропускает антифриз.`;
const hydrolockMessage=(id,bent)=>`Цилиндр ${id+1}: гидроудар${bent?', шатун погнуло':''}.`;
const SPILL_FILM_LIMIT=.035;
const PAN_BREACH_ENERGY_J=.032,PAN_BREACH_MIN_M2=.00035,PAN_BREACH_MAX_M2=.00052;
const PISTON_JET_PRESSURE=1.15,PISTON_JET_AREA=Math.PI*(.00042**2),PISTON_JET_ANGLE=-1.77;
// Normalized retained solids needed to close a nozzle throat.
const JET_DEPOSIT_MASS=.011,PISTON_JET_CLOG_WARNING=.55;
const JET_GRAVITY=9810;
const PICKUP_X=OIL_PICKUP.x+6,PICKUP_Y=OIL_PICKUP.y+4;
const PICKUP_SHARD_RADIUS=3.2;
const CROWN_EDGE_CLEARANCE=2;
const BEARING_CAPS=[307,445,589,733,871];
const RING_SKEW_LIMIT=.62;
const CASE_ENTRY=417;
// Lower skirt outline in cutaway mm, from the wrist-pin recess to the liner.
const SKIRT_LIP=[[0,49],[18.8,49],[24,60],[41.8,60],[46,56],[47,42]];
const BROKEN_LIP=[[0,49],[18.8,49],[25.1,55],[40.8,51],[47,42]];
const LINER_SCUFF_CAP=16;
const EDGE_CHIP_CAP=12;
// Equivalent loaded edge travel (mm), tuned for the simulator's time scale.
const SPALL_TRAVEL={liner:118,head:154,cap:95,case:132};
// Each entry fixes the collision radius and the mass of a 4 mm piece.
const SHARD_SHAPES={ring:[2.6,.006],rod:[8,.055],bearing:[5.2,.022],crown:[5.8,.028],
 ringLand:[3.1,.009],skirt:[4.2,.013],valve:[2.4,.016],edge:[1.65,.006]};
const FRAGMENT_KINDS=['metal',...Object.keys(SHARD_SHAPES)];
const finite=(v,lo,hi,f=lo)=>Number.isFinite(v)?clamp(v,lo,hi):f;
const AUX_FAILURES={
 waterPump:'Крыльчатка помпы повреждена. Циркуляция охлаждайки ослабла.',
 oilPickup:'Маслоприёмник треснул. Насос подсасывает воздух.',
 mufflerBaffle:'Перегородка глушителя сорвалась и частично перекрыла выпуск.',
 radiator:'Шов радиатора разошёлся. Охлаждайка вытекает.'
};
const AUX_PARTS=Object.keys(AUX_FAILURES);
const EXHAUST_SEAL_FAILURE='Фланец выпуска потерял уплотнение. Из стыка прорываются газы.';
const CYLINDER_PARTS={
 ringLand:{kind:'ringLand',zone:'chamber',message:'откололась кромка кольцевой канавки'},
 skirt:{kind:'skirt',zone:'liner',message:'откололся край задранной юбки поршня'},
 exhaustValve:{kind:'valve',zone:'chamber',message:'скол тарелки выпускного клапана, падает компрессия'}
};
const damageOpening=(wear,threshold)=>clamp(((wear??0)-threshold)/(1-threshold),0,1);
const pumpLoss=m=>Math.min(.88,.68*damageOpening(m.auxWear?.waterPump,.72)+.31*(m.corrosion??0)**2);
const pickupAir=m=>damageOpening(m.auxWear?.oilPickup,.62);
const CLEAN_MEDIA=.014,FILTER_CRACK_BAR=.78,BYPASS_RESISTANCE=.038,FILTER_CAPTURE=.9;
const filterDrop=(flow,media)=>flow*media<=FILTER_CRACK_BAR?flow*media:
 (flow+FILTER_CRACK_BAR/BYPASS_RESISTANCE)/(1/media+1/BYPASS_RESISTANCE);
class Circuit{
 constructor(kind){
  this.kind=kind;this.cap=kind==='oil'?[OIL_PAN.capacity,.10,.25,.32,.18,.40]:[1.6,1.6,.4,1.6,.3,.5];
  this.cells=this.cap.map((capacity,i)=>({capacity,litres:capacity,temp:kind==='oil'?96:90,phase:0,flow:0,bubbles:0}));
  this._delta=new Float64Array(6);this._energy=new Float64Array(6);this._flows=new Float64Array(6);this._gas=new Float64Array(6);
  this.q=0;this.pressure=0;this.filterLoad=0;this.bypass=0;this.vapour=0;this.transferred=0;
  this.oilFines=0;this.dustAccounted=0;this.filterDeltaP=0;this.filterFlow=0;this.filterBypassFlow=0;
  this.pickupClog=0;this.pickupCaptured=0;
  this.pan=kind==='oil'?new OilPan():null;this.inletAir=0;this.pumpAeration=0;
  this.spray=this.pan?new OilSplash():null;
  this.pistonJets=this.pan?XS.map(axis=>({x:axis+42,y:411,angle:PISTON_JET_ANGLE,
   endX:axis+42,endY:411,controlX:axis+42,controlY:411,flow:0,hitFlow:0,hit:false,phase:0,temp:96,clog:0})):null;
  if(this.pan)this.pan.fillTo(1);
  this.bypassFlow=0;this.bypassPhase=0;
 }
 get total(){return this.cells.reduce((a,c)=>a+c.litres,0)+(this.spray?.volume??0);}
 get finesConcentration(){return clamp(this.oilFines/Math.max(.05,this.total*.8),0,1);}
 get filterPressureLoss(){return Math.max(0,this.filterDeltaP-this.q*CLEAN_MEDIA);}
 get pickupRestriction(){return this.benchFaults?.has('pickup:clog')?Math.max(.94,this.pickupClog):this.pickupClog;}
 get filterRestriction(){return this.benchFaults?.has('filter:clog')?.86:this.filterLoad;}
 jetRestriction(i){return Math.max(this.pistonJets[i].clog,this.benchFaults?.has('jet:clog:'+i)?.92:0);}
 get pickupDelivery(){return 1-.82*this.pickupRestriction;}
 get foamDelivery(){return clamp(1-2.15*this.pumpAeration,.27,1);}
 get liquidDelivery(){return (1-.82*this.inletAir)*this.foamDelivery;}
 get pickupSubmerged(){return clamp((PICKUP_Y+.2-this.surfaceAt(PICKUP_X))/1.4,0,1);}
 surfaceAt(x){return this.pan&&x>=OIL_PAN.left&&x<=OIL_PAN.right?this.pan.surfaceAt(x):OIL_PAN.floor;}
 surfaceVelocityAt(x){return this.pan?.velocityAt(x)??0;}
 captureAtPickup(radius){
  // Coverage grows with the area presented to the screen by each chip.
  this.pickupClog=Math.min(1,this.pickupClog+radius*radius/64);
  this.pickupCaptured=Math.min(1e6,this.pickupCaptured+1);
 }
 setInventory(total,externalLoss=true){
  total=clamp(total,0,this.cap.reduce((a,b)=>a+b,0));
  const before=this.total;
  if(this.spray&&total<this.spray.volume)this.spray.limitVolume(total);
  let delta=total-this.total;
  if(total<before&&externalLoss&&this.spray)this.oilFines*=total/before;
  // Only change inventory to match the parent model. Recirculation cannot create oil.
  for(const i of [0,5,1,4,2,3]){const c=this.cells[i];if(delta<0){const v=Math.min(c.litres,-delta);c.litres-=v;delta+=v;}else{const v=Math.min(c.capacity-c.litres,delta);c.litres+=v;delta-=v;}}
  if(this.pan)this.pan.fillTo(this.cells[0].litres/this.cells[0].capacity);
 }
 stepPistonJets(dt,m,supply,fines){
  const gallery=this.cells[3],temp=gallery.temp;
  // Spring-loaded piston nozzles open above their gallery cracking pressure.
  // Orifice velocity is computed in SI; the cutaway uses millimetres.
  const head=Math.max(0,m.pressure-PISTON_JET_PRESSURE);
  const velocity=.72*Math.sqrt(2e5*head/865)/(1+clamp((85-temp)/65,0,1)*.48);
  const requested=velocity*PISTON_JET_AREA*60000;
  const feed=Math.min(requested,supply*.08),speed=requested>0?velocity*1000*feed/requested:0;
  const vx=Math.cos(PISTON_JET_ANGLE)*speed,vy=Math.sin(PISTON_JET_ANGLE)*speed;
  let jetFlow=0;
  for(let i=0;i<this.pistonJets.length;i++){
   const jet=this.pistonJets[i];
   if(feed>0&&fines>0){
    // Coarser fines lodge preferentially at the first turns off the left-fed
    // gallery; the residual fraction available for trapping drops downstream.
    const before=jet.clog,open=1-before;
    const deposit=Math.min(this.oilFines,open*JET_DEPOSIT_MASS,fines*feed*open*dt/60*.5*.58**i);
    this.oilFines-=deposit;jet.clog=Math.min(1,before+deposit/JET_DEPOSIT_MASS);
    if(before<PISTON_JET_CLOG_WARNING&&jet.clog>=PISTON_JET_CLOG_WARNING)m.emit?.('jetClog',i,jetClogMessage(i));
   }
   const open=1-this.jetRestriction(i),flow=feed*open;
   jetFlow+=flow;
   jet.temp=temp;jet.flow=flow;jet.hit=false;jet.hitFlow=0;
   if(flow<=0){
    jet.controlX=jet.endX=jet.x;jet.controlY=jet.endY=jet.y;
    continue;
   }
   jet.phase=(jet.phase+flow*dt*20)%1;
   const cy=m.cylinders[i],axis=XS[i];
   const g=pistonGeometry(cy.active?m.phase:cy.freeze,cy,axis);
   const ejected=cy.failure==='ejected',target=ejected?287:g.top+60.55;
   const travel=jet.y-target,discriminant=vy*vy-2*JET_GRAVITY*travel;
   let t=discriminant>=0?2*travel/(-vy+Math.sqrt(discriminant)):-vy/JET_GRAVITY;
   let blocked=false;
   if(cy.active&&t>0){
    const dx=g.crankX-axis,dy=g.crankY-g.pinY,rodLength2=dx*dx+dy*dy;
    for(let k=1;k<=8;k++){
     const at=t*k/8,x=jet.x+vx*at,y=jet.y+vy*at+JET_GRAVITY*at*at*.5;
     const u=clamp(((x-axis)*dx+(y-g.pinY)*dy)/rodLength2,0,1);
     if((x-axis-u*dx)**2+(y-g.pinY-u*dy)**2<42||
        (x-g.crankX)**2+(y-g.crankY)**2<18**2){t=at;blocked=true;break;}
    }
   }
   jet.controlX=jet.x+vx*t*.5;jet.controlY=jet.y+vy*t*.5;
   jet.endX=jet.x+vx*t;jet.endY=jet.y+vy*t+JET_GRAVITY*t*t*.5;
   if(blocked||ejected||discriminant<0||Math.abs(jet.endX-axis)>42)continue;
   jet.hit=true;
   // A smaller column breaks up sooner even with unchanged exit speed.
   jet.hitFlow=flow*clamp(1-travel/((18+speed*.045)*Math.sqrt(open)),.08,.95);
   this.spray.wetPistonJet(i,axis,jet.endX,jet.endY,jet.hitFlow*dt/60*.15);
  }
  return jetFlow;
 }
 step(dt,m,dust){
  const oil=this.kind==='oil',running=m.rpm>0,inventory=oil?m.oil:m.coolantLevel*6;
  this.setInventory(inventory);
  const wet=clamp(inventory/(oil?1.8:2),0,1),temp=oil?m.oilTemp:m.coolant;
  const thermostat=clamp((m.coolant-82)/13,0,1);
  const saturation=oil?0:m.coolantBoilingPoint();
  const vapour=oil
   ?Math.min(.7,clamp((m.oilTemp-145)/80+(1-wet)*.4,0,.7)+(running?.55*pickupAir(m)*wet:0))
   :clamp((temp-saturation)/10+m.gasket*.35,0,.85)*wet;
  this.vapour=approach(this.vapour,vapour,2,dt);
  const cold=oil?clamp((86-temp)/60,0,1):0;
  if(oil){
   const suspended=this.spray.volume;
   this.spray.step(dt,m,this);
   if(this.spray.volume!==suspended)this.setInventory(inventory,false);
   // The end-mounted engine rolls against the bench when it transmits torque.
   // Reciprocating imbalance adds a shorter pulse to that acceleration.
   const speed=clamp(m.rpm/6500,0,1),imbalance=(m.cylinders.length-m.activeCount)/3;
   const roll=running?.070*(m.shaftDriveNm??0):0;
   const shake=running?Math.sin(m.phase*2)*speed*speed*(15+70*imbalance+56*m.mountWear):0;
   this.pan.step(dt,clamp(roll+shake,-190,190),.36+cold*1.8);
   const air=running?1-this.pickupSubmerged:0;
   this.inletAir=approach(this.inletAir,air,air>this.inletAir?8:2.6,dt);
   // Surface froth can vent. Only air that enters the submerged intake
   // travels through the pump and weakens the delivered oil film.
   const mixed=running?this.pan.entrainedAirAt(PICKUP_X,PICKUP_Y)*this.pickupSubmerged:0;
   this.pumpAeration=approach(this.pumpAeration,mixed,mixed>this.pumpAeration?6:2.8,dt);
  }
  const aged=oil?(m.oilOxidation??0):0;
  const efficiency=wet*(1-this.vapour*.7)*(oil?this.pickupDelivery*this.liquidDelivery/(1+cold*.9+aged*.22):1-pumpLoss(m));
  let demand=running?(oil?clamp(m.rpm*.0045,0,27):clamp(m.rpm*.015,0,90))*efficiency:0;
  // The paper media and the spring-loaded bypass are parallel paths between
  // the same inlet and outlet. The valve only passes flow above its cracking pressure.
  const media=oil?CLEAN_MEDIA*(1+cold*16+aged*.35)/(1-this.filterRestriction*.96)**2:0;
  if(oil)demand/=1+.31*Math.max(0,filterDrop(demand,media)-demand*CLEAN_MEDIA);
  this.q=approach(this.q,demand,7,dt);
  this.pressure=oil?m.pressure:running?(.05+m.rpm*.00009)*efficiency:0;
  // Simultaneous finite-volume advection around a closed ring with thermostat bypass.
  const n=6,delta=this._delta,energy=this._energy,flows=this._flows,gas=this._gas;
  delta.fill(0);energy.fill(0);flows.fill(0);gas.fill(0);
  const edge=(a,b,q)=>{const ca=this.cells[a],cb=this.cells[b];const v=Math.min(q*dt/60,ca.litres*.48,Math.max(0,cb.capacity-cb.litres)+q*dt/60);if(v<=0)return 0;delta[a]-=v;delta[b]+=v;energy[a]-=v*ca.temp;energy[b]+=v*ca.temp;flows[a]+=v*60/dt;this.transferred+=v;
   if(!oil){const carried=v*ca.bubbles;gas[a]-=carried;gas[b]+=carried;}
   return v;
  };
  if(oil){
   if(running)for(let i=0;i<3;i++)edge(i,i+1,this.q);
   const delivered=Math.min(flows[0],flows[1],flows[2]),previousFlow=this.filterFlow;
   this.filterDeltaP=filterDrop(delivered,media);
   this.filterBypassFlow=clamp((this.filterDeltaP-FILTER_CRACK_BAR)/BYPASS_RESISTANCE,0,delivered);
   this.filterFlow=delivered-this.filterBypassFlow;
   this.bypass=delivered>0?this.filterBypassFlow/delivered:0;
   const produced=Math.max(0,finite(dust,0,1)-this.dustAccounted);
   this.dustAccounted+=produced;
   if(inventory>0){
    // Only newly generated fines enter the circuit, and only the portion
    // passing the media or bypass reaches the nozzle inlets.
    const throughMedia=Math.min(previousFlow,this.filterFlow);
    const caught=Math.min(Math.max(0,.86-this.filterLoad),this.oilFines*(1-Math.exp(-FILTER_CAPTURE*throughMedia*dt/(60*inventory))));
    this.filterLoad+=caught;this.oilFines+=produced*6-caught;
   }
   const fines=this.oilFines/Math.max(.05,inventory)*(1-FILTER_CAPTURE*(1-this.bypass));
   const gallery=this.cells[3],supply=Math.min(flows[2],gallery.litres*.48*60/dt);
   const beforeSpray=this.spray.volume,jetFlow=this.stepPistonJets(dt,m,supply,fines);
   const stayed=Math.max(0,this.spray.volume-beforeSpray),stayedFlow=stayed*60/dt;
   if(stayed>0){delta[3]-=stayed;energy[3]-=stayed*gallery.temp;flows[3]+=stayedFlow;this.transferred+=stayed;}
   if(running){
    // The nozzles and the bearings share the same outlet and return line.
    const bearingFlow=Math.max(0,supply-jetFlow);
    edge(3,4,bearingFlow);edge(3,5,Math.max(0,jetFlow-stayedFlow));
    edge(4,5,bearingFlow);edge(5,0,Math.max(0,supply-stayedFlow));
   }
   const unprimed=running?this.inletAir:1;
   if(unprimed>.002){
    const drainFraction=1-Math.exp(-dt*(.65-cold*.4)/(1+.22*aged)*unprimed),sump=this.cells[0];
    for(let i=3;i<n;i++){
     // Once the pump draws air, gravity return can briefly outrun feed.
     const room=Math.max(0,sump.capacity-sump.litres-delta[0]);
     edge(i,0,Math.min(room,Math.max(0,this.cells[i].litres+delta[i])*drainFraction)*60/dt);
    }
   }
  }
  else {
   this.bypass=1-thermostat;
   edge(0,1,this.q);edge(1,2,this.q);edge(2,3,this.q*thermostat);edge(3,4,this.q*thermostat);
   const bypassVolume=edge(2,4,this.q*(1-thermostat));
   this.bypassFlow=bypassVolume*60/dt;
   this.bypassPhase=(this.bypassPhase+bypassVolume/this.cells[2].capacity)%1;
   edge(4,5,this.q);edge(5,0,this.q);
  }
  for(let i=0;i<n;i++){
   const c=this.cells[i],before=c.litres;c.litres=clamp(before+delta[i],0,c.capacity);
   if(c.litres>1e-8)c.temp=clamp((before*c.temp+energy[i])/c.litres,24,260);
   const target=oil?temp+(i===4?8:0):i===3?temp-m.relay.fan*12:i===1?temp+7:temp;
   c.temp=approach(c.temp,target,.12,dt);c.flow=flows[i];c.phase=(c.phase+flows[i]*dt/(60*c.capacity))%1;
   if(oil)c.bubbles=approach(c.bubbles,clamp(this.vapour+this.inletAir*.65+this.pumpAeration*.82+clamp(1-c.litres/c.capacity,0,1)*.5,0,1),2,dt);
   else if(c.litres>1e-8){
    const wall=i===1?c.temp+Math.max(0,m.headTemp-m.coolant)*.24:c.temp;
    const superheat=clamp((wall-saturation)/24,0,.65);
    const entrainedAir=i===0&&running?clamp((.32-m.coolantLevel)*.75,0,.18):0;
    const source=superheat+entrainedAir+(i===1&&running?m.gasket*.28:0);
    const carried=clamp((before*c.bubbles+gas[i])/c.litres,0,1);
    const condensation=.65+clamp((saturation-c.temp)/32,0,1)*(i===3?3.5:1.1);
    c.bubbles=clamp(carried*Math.exp(-condensation*dt)+source*dt,0,1);
   }else c.bubbles=0;
  }
  this.setInventory(inventory,false); // remove floating-point drift and overflow only, never add beyond inventory.
 }
 snapshot(){
  const state={cells:this.cells.map(c=>({...c})),q:this.q,pressure:this.pressure,filterLoad:this.filterLoad,vapour:this.vapour,bypass:this.bypass,bypassPhase:this.bypassPhase};
  if(this.pan)Object.assign(state,{pickupClog:this.pickupClog,pickupCaptured:this.pickupCaptured,oilFines:this.oilFines,dustAccounted:this.dustAccounted,
   jetClogs:this.pistonJets.map(j=>j.clog),
   pan:this.pan.snapshot(),inletAir:this.inletAir,pumpAeration:this.pumpAeration,spray:this.spray.snapshot()});
  return state;
 }
 restore(s,total,dust=0){
  if(s&&Array.isArray(s.cells)&&s.cells.length===6)this.cells.forEach((c,i)=>{const d=s.cells[i]||{};c.litres=finite(d.litres,0,c.capacity,c.capacity);c.temp=finite(d.temp,24,260,90);c.phase=finite(d.phase,0,1);c.bubbles=finite(d.bubbles,0,1);});
  this.bypassPhase=finite(s?.bypassPhase,0,1);this.filterLoad=finite(s?.filterLoad,0,.86);
  if(this.kind==='oil'){
   this.pickupClog=finite(s?.pickupClog,0,1);
   this.pickupCaptured=Math.floor(finite(s?.pickupCaptured,0,1e6));
   this.oilFines=finite(s?.oilFines,0,6);
   this.dustAccounted=finite(s?.dustAccounted,0,1,dust);
   this.pistonJets.forEach((j,i)=>{j.clog=finite(s?.jetClogs?.[i],0,1);});
   this.inletAir=finite(s?.inletAir,0,1);
   this.pumpAeration=finite(s?.pumpAeration,0,1);
   this.spray.restore(s?.spray,total);
  }
  this.setInventory(total);
  this.pan?.restore(s?.pan);
 }
}
function writeGeometry(phase,i,x,d){
 const r=43,length=142,a=phase-(typeof i==='number'?base.FIRE[i]:i.offset);d.x=x;d.crankX=x+Math.sin(a)*r;d.crankY=460-Math.cos(a)*r;
 d.pinY=d.crankY-Math.sqrt(length*length-(d.crankX-x)**2);d.top=d.pinY-36;d.cycle=((a%(TAU*2))+TAU*2)%(TAU*2);return d;
}
// Earliest entry along the relative path of a circle and a fragment.
function circleEntry(x,y,dx,dy,r){
 const distance=x*x+y*y-r*r,travel=dx*dx+dy*dy,along=x*dx+y*dy;
 if(distance<0||along>=0||travel<1e-9)return Infinity;
 const disc=along*along-travel*distance;
 if(disc<=0)return Infinity;
 const t=distance/(-along+Math.sqrt(disc));
 return t<=1?t:Infinity;
}
class Fragments{
 skirtWedgeNm=0;
 constructor(seed=417,count=4){this.seed=seed>>>0;this.bodies=[];this.linerScuffs=[];this.edgeChips=[];this.rubByCylinder=new Float64Array(4);this.bearingWork=new Float64Array(4);this.nextId=1;this.impacts=0;this.jamCount=0;this.resistance=0;this.impactEnergy=0;this.dust=0;this.scrape=0;this.cooldown=0;this.events=[];this.oilSurface=548;this._moving=Array.from({length:count},()=>({}));this._previous=this._moving.map(()=>({}));this._frozen=this._moving.map(()=>({}));this._geo=Array(count);this.detached.length=this.crownDents.length=count;
  this._rotor={nx:0,ny:0,load:0};this._support={edge:'',x:0,y:0,strength:0};
  this._wedge={nx:0,ny:0,load:0,cylinder:-1};this._spalls=[];this._impactChips=[];this._grindChips=[];this._hit={};this.caseBreach=null;}
 random(){this.seed=(1664525*this.seed+1013904223)>>>0;return this.seed/4294967296;}
 add(cylinder,kind='metal',zone='case',x=null,y=null,radius=null){
  if(this.bodies.length>=CAP){this.dust=Math.min(1,this.dust+.0005);return null;}
  const [size,massAtFourMm]=Object.hasOwn(SHARD_SHAPES,kind)?SHARD_SHAPES[kind]:[2+this.random()*4,.006];
  const r=radius??size;
  const p={id:this.nextId++,cylinder:clamp(cylinder,0,3),kind,zone,x:x??XS[cylinder]+(this.random()-.5)*40,y:y??(zone==='chamber'?244:440),vx:(this.random()-.5)*150,vy:-20-this.random()*130,r,mass:massAtFourMm*(r/4),a:this.random()*TAU,w:(this.random()-.5)*9,heat:180,contacts:0,pinch:0,jammed:false,jamAge:0,jamWear:0,jamRadius:r,jamSlip:0,jamGrit:0,wearFace:0,rubbing:0,releaseCount:0,skew:0,jamEdge:'',edgeX:0,edgeY:0};
  this.bodies.push(p);return p;
 }
 get oilSurface(){return this._oilSurface;}
 set oilSurface(value){this._oilSurface=value;this._surfaceCircuit=null;}
 oilSurfaceAt(x){return this._surfaceCircuit?.surfaceAt(x)??this.oilSurface;}
 breakCylinder(i,m){
  const cy=m.cylinders[i];
  if(!cy||cy.active||!cy.failure)return;
  const x=XS[i],g=pistonGeometry(cy.freeze,cy,x),ejected=cy.failure==='ejected';
  const past=pistonGeometry(cy.freeze-m.shaftSpeed/240,cy,x);
  const pinV=(g.pinY-past.pinY)*240;
  const side=g.crankX<x?1:-1;
  const shankX=g.crankX+(x-g.crankX)*.19,shankY=g.crankY+(g.pinY-g.crankY)*.19;
  const rod=this.add(i,'rod',shankY<CASE_ENTRY+8?'liner':'case',shankX,shankY);
  const shell=this.add(i,'bearing','case',g.crankX+side*24,Math.max(CASE_ENTRY+5.2,g.crankY));
  if(rod)rod.vx=clamp((g.crankX-past.crankX)*240*.28,-165,165);
  if(shell)shell.vx=clamp((g.crankX-past.crankX)*240*.35+side*45,-220,220);
  const ux=(x-g.crankX)/142,uy=(g.pinY-g.crankY)/142;
  for(let j=0;j<(ejected?8:9);j++){
   const along=34+Math.floor(j/3)*9,across=(j%3-1)*9;
   const y=g.crankY+uy*along+ux*across,zone=y<CASE_ENTRY+6?'liner':'case';
   const shard=this.add(i,'metal',zone,clamp(g.crankX+ux*along-uy*across,x-42,x+42),y,j<3?2.6:null);
   if(shard){shard.vx+=across*6;shard.vy+=pinV*.18;}
  }
  this.add(i,'ring','chamber',x+42,Math.max(235,g.top-4));
  if(ejected)this.detached[i]={top:g.top,vy:clamp(pinV,-290,290)};
 }
 detached=XS.map(()=>null);
 crownDents=XS.map(()=>null);
 advanceDetached(i,h){
  const piston=this.detached[i];
  if(!piston)return;
  piston.vy=Math.min(500,piston.vy+720*h);
  piston.top+=piston.vy*h;
  if(piston.top<235){
   piston.top=235;piston.vy=Math.max(0,-piston.vy*.18);
  }
  if(piston.top<CASE_ENTRY)return;
  const crown=this.add(i,'crown','chamber',XS[i]+15,piston.top);
  if(crown)crown.vy=piston.vy*.8;
  this.detached[i]=null;
 }
 contact(p,nx,ny,depth,vx=0,vy=0,surface='',film=0,h=0){
  if(depth<=0)return;
  const rvx=p.vx-vx,rvy=p.vy-vy,vn=rvx*nx+rvy*ny;
  // Rewind a crossing to first touch and advance the rebound for the unused time.
  // An existing overlap (including a cocked ring) needs positional correction.
  const travel=-vn*h;
  const remaining=travel>p.r*.5&&depth<=travel?depth/-vn:0;
  if(remaining){p.x-=p.vx*remaining;p.y-=p.vy*remaining;depth=0;}
  p.x+=nx*(depth+.002);p.y+=ny*(depth+.002);
  if(vn<0){
   const inCase=p.zone==='case',immersed=inCase?clamp((p.y+p.r-this.oilSurfaceAt(p.x))/Math.max(1,2*p.r),0,1):0;
   const oil=surface?clamp(film/3,0,1):immersed;
   const impulse=-(1.18-.14*oil)*vn*p.mass;p.vx+=nx*impulse/p.mass;p.vy+=ny*impulse/p.mass;
   const tx=-ny,ty=nx,vt=rvx*tx+rvy*ty-(inCase||surface?p.w*p.r:0);
   // Bore contacts use the effective tangential mass of a disc (I = mr²/2).
   const limit=impulse*(.38-.22*oil),friction=clamp(-vt*p.mass/(surface?3:1),-limit,limit);
   p.vx+=tx*friction/p.mass;p.vy+=ty*friction/p.mass;
   p.w=clamp(p.w+(surface?-2:inCase?-.40:.14)*friction/(p.mass*p.r),-15,15);
   if(inCase)p.heat=Math.min(390,p.heat+.000008*Math.abs(friction*vt)/p.mass);
   const energy=.5*p.mass*(vn*.001)**2;this.impactEnergy+=energy;
   if(surface==='liner'&&energy>.0006&&Math.abs(vt)>75){
    const rub=clamp(Math.abs(friction*vt)*.00012*(1-.72*oil),0,.8);
    const from=p.y-Math.sign(rvy)*Math.min(9,Math.abs(rvy)*.006);
    this.markLiner(p.cylinder,-nx,clamp(Math.min(from,p.y)-.6,232,414),clamp(Math.max(from,p.y)+.6,232,414),rub,'strike');
   }
   if(surface==='crown'&&energy>.0015){
    const dent=clamp(Math.sqrt((energy-.0015)/.035),0,1);
    if(dent>(this.crownDents[p.cylinder]?.depth??0))
     this.crownDents[p.cylinder]={offset:clamp(p.x-nx*p.r-XS[p.cylinder],-44,44),depth:dent};
   }
   const brittle=p.kind==='crown'||p.kind==='skirt'||p.kind==='ringLand';
   if(inCase&&p.r>=3.8&&(brittle||p.kind==='metal')&&energy>(brittle?.018:.029)
     &&!this._impactChips.some(chip=>chip.body===p))this._impactChips.push({body:p,nx,ny,energy});
   if(-vn>40){
    this.impacts++;
    if(this.cooldown<=0){
     const spark=inCase&&immersed<.08&&p.kind!=='crown'&&p.kind!=='skirt'&&p.kind!=='ringLand'
      ?clamp((Math.abs(friction*vt)-.24)/3.4,0,1)*clamp((-vn-150)/240,0,1):0;
     this.events.push({type:'impact',cylinder:p.cylinder,level:clamp(-vn/500,.08,1),x:p.x-nx*p.r,y:p.y-ny*p.r,nx,ny,spark});
     this.cooldown=.07;
    }
   }
   this.scrape=Math.max(this.scrape,Math.min(1,Math.abs(vt)/400));
  }
  p.x+=p.vx*remaining;p.y+=p.vy*remaining;p.contacts++;
 }
 circle(p,x,y,r,vx,vy,journal=-1){
  const dx=p.x-x,dy=p.y-y,rr=p.r+r,d2=dx*dx+dy*dy;
  if(d2>=rr*rr)return 0;
  const d=Math.sqrt(d2);
  const nx=d?dx/d:0,ny=d?dy/d:-1,load=vx*nx+vy*ny;
  if(p.jammed){
   const overlap=clamp((rr-d)/2,0,1);
   const slip=d?Math.abs(vy*nx-vx*ny):Math.hypot(vx,vy);
   const wedge=this._wedge,opposed=-(nx*wedge.nx+ny*wedge.ny);
   // Spalling requires the rotor to drive into an opposing edge. Sliding
   // alone still abrades the fragment, but cannot break the support away.
   if(journal>=0&&load>12&&opposed>.28){
    const closing=(load-12)*opposed*overlap*(.6+.4*clamp(slip/150,0,1));
    if(closing>wedge.load){wedge.load=closing;wedge.cylinder=journal;}
   }
   return slip*overlap;
  }
  if(load>this._rotor.load){this._rotor.nx=nx;this._rotor.ny=ny;this._rotor.load=load;}
  this.contact(p,nx,ny,rr-d,vx,vy);
  return 0;
 }
 caseContact(p,nx,ny,depth,edge,x,y){
  // A heavy rod fragment can punch the thin sump floor on a direct hit.
  if(!this.caseBreach&&p.kind==='rod'&&ny===-1&&y===OIL_PAN.floor&&p.vy>0&&x>=OIL_PAN.left&&x<=OIL_PAN.right){
   const energy=.5*p.mass*(p.vy*.001)**2;
   if(energy>=PAN_BREACH_ENERGY_J)
    this.caseBreach={x,cylinder:p.cylinder,area:clamp(PAN_BREACH_MIN_M2+(energy-PAN_BREACH_ENERGY_J)*.018,PAN_BREACH_MIN_M2,PAN_BREACH_MAX_M2)};
  }
  const {load,nx:rx,ny:ry}=this._rotor;
  const opposition=-(nx*rx+ny*ry);
  if(load>12&&opposition>.28&&opposition>this._support.strength){
   const support=this._support;support.edge=edge;support.x=x;support.y=y;support.strength=opposition;
  }
  this.contact(p,nx,ny,depth);
 }
 capBox(p,x0,y0,x1,y1){
  const xx=clamp(p.x,x0,x1),yy=clamp(p.y,y0,y1),dx=p.x-xx,dy=p.y-yy,d2=dx*dx+dy*dy;
  if(d2>=p.r*p.r)return;
  if(d2>0){const d=Math.sqrt(d2);this.caseContact(p,dx/d,dy/d,p.r-d,'cap',xx,yy);}
  else{
   const ds=[p.x-x0,x1-p.x,p.y-y0,y1-p.y],i=ds.indexOf(Math.min(...ds));
   this.caseContact(p,[-1,1,0,0][i],[0,0,-1,1][i],p.r+ds[i],'cap',i===0?x0:i===1?x1:xx,i===2?y0:i===3?y1:yy);
  }
 }
 sweepCap(p,x,y,dx,dy,x0,y0,x1,y1){
  const hit=this._hit,r=p.r,endX=p.x,endY=p.y;
  if(Math.max(x,endX)<x0-r||Math.min(x,endX)>x1+r||Math.max(y,endY)<y0-r||Math.min(y,endY)>y1+r)return;
  const ox=x-clamp(x,x0,x1),oy=y-clamp(y,y0,y1);
  if(ox*ox+oy*oy<r*r)return;
  let tx=dx?(dx>0?x0-r-x:x1+r-x)/dx:-Infinity;
  let ty=dy?(dy>0?y0-r-y:y1+r-y)/dy:-Infinity;
  if((!dx&&(x<x0-r||x>x1+r))||(!dy&&(y<y0-r||y>y1+r)))return;
  let t=Math.max(tx,ty);
  if(t<0||t>=hit.t||t>1)return;
  let px=x+dx*t,py=y+dy*t,cx=clamp(px,x0,x1),cy=clamp(py,y0,y1);
  if((px<x0||px>x1)&&(py<y0||py>y1)){
   t=circleEntry(x-cx,y-cy,dx,dy,r);
   if(t>=hit.t||t>1)return;
   px=x+dx*t;py=y+dy*t;
  }
  const ux=px-cx,uy=py-cy,len=Math.hypot(ux,uy);
  if(len<.001)return;
  const nx=ux/len,ny=uy/len;
  // Keep the ordinary solver when it would resolve on the entry face.
  const ex=endX-clamp(endX,x0,x1),ey=endY-clamp(endY,y0,y1);
  if(ex*ex+ey*ey<r*r){
   if(ex||ey){if(ex*nx+ey*ny>0)return;}
   else{
    const near=Math.min(endX-x0,x1-endX,endY-y0,y1-endY);
    if((endX-x0===near&&nx<-.999)||(x1-endX===near&&nx>.999)||
      (endY-y0===near&&ny<-.999)||(y1-endY===near&&ny>.999))return;
   }
  }
  Object.assign(hit,{t,nx,ny,cx,cy,rx:0,ry:0,cap:true});
 }
 sweepRotor(p,x,y,dx,dy,cx,cy,rx,ry,r){
  const hit=this._hit,rr=p.r+r,ox=x-cx,oy=y-cy,vx=dx-rx,vy=dy-ry;
  if(Math.abs(ox)>rr+Math.abs(vx)||Math.abs(oy)>rr+Math.abs(vy))return;
  const endX=ox+vx,endY=oy+vy;
  if(endX*endX+endY*endY<rr*rr)return; // normal endpoint contact
  const t=circleEntry(ox,oy,vx,vy,rr);
  if(t>=hit.t||t>1)return;
  Object.assign(hit,{t,nx:(ox+vx*t)/rr,ny:(oy+vy*t)/rr,rx,ry,cap:false});
 }
 sweepCase(p,x,y,moving,previous,h){
  const hit=this._hit,dx=p.x-x,dy=p.y-y;
  hit.t=Infinity;
  for(let i=0;i<moving.length;i++){
   const g=previous[i],next=moving[i],rx=next.crankX-g.crankX,ry=next.crankY-g.crankY;
   this.sweepRotor(p,x,y,dx,dy,g.crankX,g.crankY,rx,ry,18);
   this.sweepRotor(p,x,y,dx,dy,XS[i]-(g.crankX-XS[i])*.75,460-(g.crankY-460)*.75,-rx*.75,-ry*.75,22);
  }
  for(const mid of BEARING_CAPS){
   this.sweepCap(p,x,y,dx,dy,mid-14,449,mid+14,454);
   this.sweepCap(p,x,y,dx,dy,mid-10,442,mid+10,478);
  }
  if(hit.t===Infinity)return;
  const {t,nx,ny,rx,ry}=hit;
  // Carry the point of impact with the rotating journal for the remainder
  // of this substep, rather than projecting it onto the far side.
  p.x=x+dx*t+rx*(1-t);p.y=y+dy*t+ry*(1-t);
  if(hit.cap)this.caseContact(p,nx,ny,.004,'cap',hit.cx,hit.cy);
  else this.contact(p,nx,ny,.004,rx/h,ry/h);
 }
 caseWalls(p){
  const support=this._support;support.edge='';support.strength=0;
  if(p.x-p.r<305)this.caseContact(p,1,0,305-p.x+p.r,'case',305,p.y);
  if(p.x+p.r>890)this.caseContact(p,-1,0,p.x+p.r-890,'case',890,p.y);
  if(p.y-p.r<417)this.caseContact(p,0,1,417-p.y+p.r,'case',p.x,417);
  if(p.y+p.r>548)this.caseContact(p,0,-1,p.y+p.r-548,'case',p.x,548);
  for(const x of BEARING_CAPS){
   if(Math.abs(p.x-x)>=p.r+14||p.y+p.r<442||p.y-p.r>478)continue;
   this.capBox(p,x-14,449,x+14,454);
   this.capBox(p,x-10,442,x+10,478);
  }
 }
 crankContacts(p,moving,previous,h){
  let slip=0;this._rotor.load=0;
  const wedge=this._wedge;
  wedge.load=0;wedge.cylinder=-1;wedge.nx=wedge.ny=0;
  if(p.jammed&&(p.jamEdge==='cap'||p.jamEdge==='case')){
   const dx=p.x-p.edgeX,dy=p.y-p.edgeY,r=Math.hypot(dx,dy);
   if(r>.001){wedge.nx=dx/r;wedge.ny=dy/r;}
  }
  for(let i=0;i<moving.length;i++){
   const g=moving[i],v1=previous[i],vx=(g.crankX-v1.crankX)/h,vy=(g.crankY-v1.crankY)/h;
   const x=XS[i]-(g.crankX-XS[i])*.75,y=460-(g.crankY-460)*.75;
   const rotorSlip=Math.max(this.circle(p,g.crankX,g.crankY,18,vx,vy,i),this.circle(p,x,y,22,-vx*.75,-vy*.75,i));
   // The loaded journal can belong to a different cylinder from the fragment.
   if(rotorSlip>0)this.bearingWork[i]+=Math.min(1,rotorSlip/150)*h;
   slip=Math.max(slip,rotorSlip);
  }
  return slip;
 }
 updatePinch(p,edge,h,x,y){
  p.pinch=edge?p.pinch+h:Math.max(0,p.pinch-h*.65);
  if(!edge||p.pinch<=(p.zone==='chamber'?.025:edge==='cap'?.027:.045))return;
  this.catchWedge(p,edge,x,y);
 }
 catchWedge(p,edge,x,y){
  p.jammed=true;p.pinch=0;p.jamAge=0;p.jamWear=0;p.vx=p.vy=p.w=0;
  p.jamRadius=p.r;p.jamSlip=0;p.jamGrit=0;p.jamEdge=edge;p.edgeX=x;p.edgeY=y;
  p.wearFace=((p.x<XS[p.cylinder]?Math.PI:0)-p.a+TAU*2)%TAU;
  this.events.push({type:'jam',cylinder:p.cylinder,level:p.zone==='chamber'?.65:.8,x:p.x,y:p.y,jamEdge:edge,edgeX:x,edgeY:y});
 }
 chamberContacts(p,cy,g,crownVelocity,h){
  const x=XS[p.cylinder],left=x-48,right=x+48,top=232;
  const bottom=cy.failure==='ejected'&&!this.detached[p.cylinder]?Infinity:Math.max(top+2*p.r+.05,g.top);
  const film=cy.contact.filmMicron;
  const free=p.kind!=='ring'&&bottom-top>2*p.r+3?h:0;
  if(p.x-p.r<left)this.contact(p,1,0,left-p.x+p.r,0,0,'liner',film,free);
  if(p.x+p.r>right)this.contact(p,-1,0,p.x+p.r-right,0,0,'liner',film,free);
  if(p.y-p.r<top)this.contact(p,0,1,top-p.y+p.r);
  const ring=p.kind==='ring',side=Math.sign(p.x-x),wall=side<0?left:right;
  const depth=p.y+p.r-bottom;
  if(depth>0){
   // The crown's edge moves the fragment toward the liner as the piston rises.
   const chamfer=ring&&crownVelocity<0&&bottom===g.top?clamp((Math.abs(p.x-x)-41)/3,0,1)*.33:0;
   this.contact(p,side*chamfer,-Math.sqrt(1-chamfer*chamfer),depth,0,crownVelocity,'crown',0,p.contacts?0:free);
   if(chamfer>0&&Math.abs(p.x-x)+p.r>48)this.contact(p,-side,0,Math.abs(p.x-x)+p.r-48,0,0,'liner',film);
  }
  if(p.y-p.r>=CASE_ENTRY){p.zone='case';p.skew=0;p.pinch=0;return;}
  const clearance=g.top-p.y-p.r;
  const cornerClearance=48-Math.abs(p.x-x)-p.r;
  const compressed=crownVelocity<0&&clearance<CROWN_EDGE_CLEARANCE;
  const atDeck=bottom-top<2*p.r+.85;
  const atWall=cornerClearance<.54;
  let edge='';
  if(ring){
   const play=clamp(((cy.contact.play??.04)-.04)/.61,0,1);
   const load=compressed&&(atWall||atDeck)?clamp(-crownVelocity/360,0,1):0;
   // Reverse friction reactions at the wall and crown cock the free fragment.
   const skew=side*(.35+.27*play)*load;
   p.skew=approach(p.skew,skew,load?90:8,h);
   if(load&&Math.abs(p.skew)>.093){
    if(atWall&&cornerClearance<.23+.6*Math.abs(p.skew))edge='liner';
    else if(atDeck)edge='head';
   }
  }else if(compressed){
   if(atDeck)edge='head';else if(atWall)edge='liner';
  }
  this.updatePinch(p,edge,h,edge==='liner'?wall:p.x,edge==='head'?top:p.y-.34*p.r*Math.sign(p.skew)*side);
 }
 scuffLiner(p,work){
  const offset=p.x-XS[p.cylinder];
  if(Math.abs(offset)+p.r<46)return;
  const side=Math.sign(offset),top=clamp(p.y-p.r*.55,232,414),bottom=clamp(p.y+p.r*.55,232,414);
  this.markLiner(p.cylinder,side,top,bottom,work*.004);
 }
 skirtContact(p,cy,top,velocity,projectOnly=false){
  if(p.y-p.r>top+60.2||cy.failure==='ejected'&&!this.detached[p.cylinder]){
   if(p.jammed&&!projectOnly)this.release(p);
   return;
  }
  const offset=p.x-XS[p.cylinder],u=Math.abs(offset),r=p.r;
  const profile=offset>0&&cy.partWear.skirt===1?BROKEN_LIP:SKIRT_LIP;
  let boundary=-Infinity,nx=0,ny=1;
  for(let i=1;i<profile.length;i++){
   const [a,ay]=profile[i-1],[b,by]=profile[i];
   if(u+r<a||u-r>b)continue;
   const slope=(by-ay)/(b-a);
   // Lowest point of this segment expanded by the chip radius, including its rounded ends.
   const x=clamp(u+r*slope/Math.hypot(1,slope),a,b),dx=u-x;
   const dy=Math.sqrt(Math.max(0,r*r-dx*dx)),y=top+ay+(x-a)*slope+dy;
   if(y>boundary){boundary=y;nx=Math.sign(offset)*dx/r;ny=dy/r;}
  }
  const depth=boundary-p.y,side=Math.sign(offset),wall=XS[p.cylinder]+side*48;
  if(p.jammed){
   if(projectOnly)return;
   if(depth<-.15||!cy.active){this.release(p);return;}
   if(velocity<=0||depth<=0)return;
   const dry=1-clamp(cy.contact.filmMicron/3,0,1);
   const yieldDepth=.18+r*(.09+.09*dry);
   const load=clamp(depth/yieldDepth,0,1)*Math.abs(nx);
   const force=load*(180+180*r)*(.38+.62*dry);
   const slip=Math.max(0,depth-yieldDepth),from=p.y;
   p.y+=slip;p.edgeY=p.y;p.rubbing=load;
   if(slip>0){
    const work=force*slip*.001;
    const turn=Math.sin(2*(side*.27-p.a))*.5*Math.min(1,slip/r);
    p.a=(p.a+turn+TAU)%TAU;
    this.markLiner(p.cylinder,side,from-.4,p.y+.4,work*.027,'wedge');
    p.heat=Math.min(390,p.heat+work*.16);
   }
   return force;
  }
  if(depth<=0)return;
  if(projectOnly){p.y=boundary;return;}
  const gap=48-u-r;
  if(cy.active&&velocity>0&&velocity>p.vy&&side*nx>.18&&
     depth*ny*side*nx>Math.max(0,gap)+.06){
   p.x=wall-side*r;
   this.catchWedge(p,'liner',wall,p.y);return;
  }
  this.contact(p,nx,ny,(boundary-p.y)*ny,0,velocity,'skirt',cy.contact.filmMicron);
 }
 markLiner(cylinder,side,top,bottom,wear,kind){
  if(bottom<=top||wear<=0)return;
  let mark=this.linerScuffs.find(m=>m.cylinder===cylinder&&m.side===side&&m.kind===kind
   &&(kind==='skew'||m.top<=bottom&&m.bottom>=top));
  if(!mark){
   if(kind!=='skew'&&this.linerScuffs.filter(m=>m.kind!=='skew').length>=LINER_SCUFF_CAP)return;
   mark={cylinder,side,top,bottom,depth:0};
   if(kind)mark.kind=kind;
   this.linerScuffs.push(mark);
  }
  mark.top=Math.min(mark.top,top);mark.bottom=Math.max(mark.bottom,bottom);
  mark.depth=Math.min(1,mark.depth+wear);
 }
 workEdge(p,cylinder,travel,nx,ny,level){
  const edge=p.jamEdge,x=p.edgeX,y=p.edgeY;
  let mark=this.edgeChips.find(m=>m.edge===edge&&Math.abs(m.x-x)<=4.5&&Math.abs(m.y-y)<=4.5&&m.nx*nx+m.ny*ny>.5);
  if(!mark){
   if(this.edgeChips.length>=EDGE_CHIP_CAP)return;
   mark={edge,cylinder,x,y,nx,ny,damage:0};this.edgeChips.push(mark);
  }
  if(mark.damage===1)return;
  mark.damage=Math.min(1,mark.damage+travel/SPALL_TRAVEL[edge]);
  if(mark.damage===1){
   mark.cylinder=cylinder;
   this._spalls.push({mark,level,distance:p.r+SHARD_SHAPES.edge[0]*1.5,heat:p.heat});
  }
 }
 finishSpalls(m){
  for(const {mark,level,distance,heat} of this._spalls){
   const {edge,cylinder,x,y,nx,ny}=mark,zone=edge==='cap'||edge==='case'?'case':'chamber';
   const r=SHARD_SHAPES.edge[0],cx=XS[cylinder];
   const left=zone==='case'?305:cx-48,right=zone==='case'?890:cx+48,top=zone==='case'?417:232;
   const bottom=zone==='case'?548:m.cylinders[cylinder].failure==='ejected'?415:Math.max(top+2*r+.05,this._geo[cylinder].top);
   const shard=this.add(cylinder,'edge',zone,clamp(x+nx*distance,left+r,right-r),clamp(y+ny*distance,top+r,bottom-r));
   if(shard){
    const speed=44+level*95,tangent=(this.random()-.5)*55;
    shard.vx=nx*speed-ny*tangent;shard.vy=ny*speed+nx*tangent;
    shard.heat=heat;
   }
   this.events.unshift({type:'edgeChip',edge,cylinder,x,y,nx,ny,level});
  }
  this._spalls.length=0;
 }
 finishImpactChips(){
  for(const {body:p,nx,ny,energy} of this._impactChips){
   if(!this.bodies.includes(p))continue;
   const mass=p.mass*.26,r=p.r*.5;
   p.mass-=mass;p.r*=Math.sqrt(.74);
   const distance=p.r+r+.1;
   const shard=this.add(p.cylinder,'metal','case',clamp(p.x+nx*distance,305+r,890-r),clamp(p.y+ny*distance,417+r,548-r),r);
   if(!shard)continue;
   shard.mass=mass;shard.heat=p.heat;
   const speed=Math.min(190,Math.sqrt(2*energy/mass)*75);
   shard.vx=p.vx*.65+nx*speed-ny*38;shard.vy=p.vy*.65+ny*speed+nx*38;
  }
  this._impactChips.length=0;
 }
 caseReleaseRoom(p,moving){
  const r=p.r+.12;
  for(let i=0;i<moving.length;i++){
   const {crankX:x,crankY:y}=moving[i],cx=XS[i]-(x-XS[i])*.75,cy=460-(y-460)*.75;
   if((p.x-x)**2+(p.y-y)**2<(18+r)**2||(p.x-cx)**2+(p.y-cy)**2<(22+r)**2)return false;
  }
  for(const x of BEARING_CAPS){
   if(Math.abs(p.x-x)<r+14&&(
    (p.x-clamp(p.x,x-14,x+14))**2+(p.y-clamp(p.y,449,454))**2<r*r||
    (p.x-clamp(p.x,x-10,x+10))**2+(p.y-clamp(p.y,442,478))**2<r*r))return false;
  }
  return true;
 }
 grindWedge(p,fitRadius,wearLimit,work){
  // Wear takes off fractions of a millimetre even when loading a partially
  // worn save. Releasing the friction lock does not resize the body.
  const progress=clamp((p.jamWear/wearLimit-.55)/.45,0,1);
  const target=p.jamRadius-(p.jamRadius-fitRadius)*progress;
  const former=p.mass;
  this.shrink(p,Math.max(target,p.r-Math.min(.055,work*.025)));
  if(p.zone!=='case'||!p.jamEdge)return;
  p.jamGrit+=(former-p.mass)*.78;
  const mass=.004;
  if(p.jamGrit<mass)return;
  p.jamGrit-=mass;
  const dx=p.x-p.edgeX,dy=p.y-p.edgeY,length=Math.hypot(dx,dy)||1,nx=dx/length,ny=dy/length;
  const side=nx<0?-1:1,tx=-ny*side,ty=nx*side,r=1.9;
  const offset=p.r+r+.22;
  this._grindChips.push({cylinder:p.cylinder,x:p.x+tx*offset+nx*.5,y:p.y+ty*offset+ny*.5,
   r,mass,vx:tx*32+nx*16,vy:ty*32+ny*16+22,heat:p.heat});
 }
 finishGrindChips(){
  for(const {cylinder,x,y,r,mass,vx,vy,heat} of this._grindChips){
   const shard=this.add(cylinder,'metal','case',clamp(x,305+r,890-r),clamp(y,417+r,548-r),r);
   if(shard)Object.assign(shard,{mass,vx,vy,heat});
  }
  this._grindChips.length=0;
 }
 shrink(p,radius){
  if(radius>=p.r)return;
  p.mass=Math.max(.002,p.mass*(radius/p.r)**2);p.r=radius;
 }
 release(p){
  p.jammed=false;p.jamAge=0;p.jamWear=0;p.jamGrit=0;p.releaseCount=Math.min(2,p.releaseCount+1);p.jamEdge='';p.edgeX=p.edgeY=0;
  if(p.zone!=='liner')this.dust=Math.min(1,this.dust+.006);
 }
 step(dt,m){
  this.cooldown=Math.max(0,this.cooldown-dt);this.scrape*=Math.exp(-dt*9);this.impactEnergy=0;this.rubByCylinder.fill(0);this.bearingWork.fill(0);let jamTorque=0;
  this.skirtWedgeNm=0;
  const oil=m.oilCircuit,sump=oil?.cells[0];
  this._oilSurface=OIL_PAN.floor-OIL_PAN.depth*(sump?Math.min(sump.litres,m.oil)/sump.capacity:clamp(m.oil/4.6,0,1));
  this._surfaceCircuit=oil;
  const suction=m.rpm>0&&this.oilSurfaceAt(PICKUP_X)<PICKUP_Y?clamp((sump?.flow??0)/14,0,1)*(oil?.pickupSubmerged??1):0;
  const contactFade=Math.exp(-dt*22),oilViscosity=1+clamp((100-m.oilTemp)/70,0,1);
  for(const p of this.bodies)p.rubbing*=contactFade;
  const count=Math.max(1,Math.ceil(dt*240)),h=dt/count,phase=m.phase;
  const airDrag=Math.exp(-h*.2),spinDrag=Math.exp(-h*.5);
  for(let n=0;n<count;n++){
   const a=phase-m.shaftSpeed*dt+(n+1)*h*m.shaftSpeed;
   const moving=this._moving,previous=this._previous,geo=this._geo;
   for(let i=0;i<moving.length;i++){
    writeGeometry(a,m.cylinders[i],XS[i],moving[i]);writeGeometry(a-m.shaftSpeed*h,m.cylinders[i],XS[i],previous[i]);
    geo[i]=m.cylinders[i].active?moving[i]:writeGeometry(m.cylinders[i].freeze,m.cylinders[i],XS[i],this._frozen[i]);
    this.advanceDetached(i,h);
    if(this.detached[i])geo[i].top=this.detached[i].top;
   }
   for(let body=0;body<this.bodies.length;body++){
    const p=this.bodies[body];
    p.contacts=0;p.heat=approach(p.heat,m.block,.2,h);
    const i=p.cylinder,cy=m.cylinders[i],g=geo[i];
    const crownVelocity=cy.active?(g.top-previous[i].top)/h:this.detached[i]?.vy??0;
    if(p.jammed&&p.zone==='liner'){
     const force=this.skirtContact(p,cy,g.top,crownVelocity)||0;
     if(force&&m.shaftSpeed>0){
      // Virtual work: axial drag (N) × piston travel (m/rad) = shaft torque (Nm).
      this.skirtWedgeNm+=force*crownVelocity*.001/(m.shaftSpeed*count);
      this.rubByCylinder[i]+=p.rubbing/count;
     }
     if(p.jammed)continue;
    }
    if(p.jammed){
     if(m.rpm>1)p.jamAge+=h;
     const chamberRing=p.zone==='chamber'&&p.kind==='ring';
     const tipReach=chamberRing?2*p.r*Math.sin(Math.abs(p.skew)):0;
     const clearance=g.top-p.y-p.r-tipReach;
     const wearLimit=180+p.jamRadius*30;
     const fitRadius=Math.max(1.4,p.jamRadius*.72);
     if(chamberRing&&crownVelocity>0&&clearance>0&&p.releaseCount<2){
      const availableSlip=Math.max(0,(p.jamRadius-p.r)*.65-p.jamSlip);
      const slip=Math.min(availableSlip,clearance,Math.max(0,p.jamWear/wearLimit-.5)*12*h);
      if(slip>0){
       p.y+=slip;p.jamSlip+=slip;p.a=(p.a+Math.sign(p.x-XS[i])*slip/p.r+TAU)%TAU;
       p.skew*=Math.max(0,1-slip/p.r);
       if(p.jamEdge==='liner')p.edgeY=p.y-.34*p.r*Math.abs(p.skew);
       this.scuffLiner(p,slip*5);
      }
      // A worn edge can leave the wedge only while the crown opens space for it.
      if(p.jamWear>=wearLimit&&p.r<=fitRadius+1e-8&&clearance-slip>.25){this.release(p);continue;}
     }
     if(!chamberRing&&p.releaseCount<2&&p.r<=fitRadius+1e-8&&p.jamWear>=wearLimit&&(
      p.zone==='case'?this.caseReleaseRoom(p,moving):crownVelocity>=0&&clearance>.25)){
      this.release(p);continue;
     }
     if(p.jammed){
      let abrasion=0;
      if(p.zone==='case'){
       abrasion=this.crankContacts(p,moving,previous,h);
       const wedge=this._wedge;
       if(m.rpm>1&&wedge.cylinder>=0){
        const wet=clamp((p.y+p.r-this.oilSurfaceAt(p.x))/(2*p.r),0,1);
        this.workEdge(p,wedge.cylinder,wedge.load*h*(1-.65*wet),wedge.nx,wedge.ny,clamp(.43+wedge.load/630,.43,1));
       }
      }
      else if(crownVelocity<0&&cy.failure!=='ejected'){
       // Normal load ramps up as the piston closes the clearance around the wedge.
       const squeeze=clamp(1-clearance/CROWN_EDGE_CLEARANCE,0,1);
       const boundary=1-clamp(cy.contact.filmMicron/1.35,0,1);
       abrasion=-crownVelocity*squeeze*(.62+.38*boundary);
       if(m.rpm>1&&abrasion>14&&(p.jamEdge==='liner'||p.jamEdge==='head')){
        const nx=p.jamEdge==='liner'?Math.sign(XS[i]-p.edgeX):0,ny=p.jamEdge==='head'?1:0;
        this.workEdge(p,i,(abrasion-14)*h,nx,ny,clamp(.43+abrasion/630,.43,1));
       }
      }
      if(abrasion<=0)continue;
      const rubbing=Math.min(1,abrasion/150);
      p.rubbing=Math.max(p.rubbing,rubbing);
      if(p.zone==='chamber')this.rubByCylinder[i]+=rubbing/count;
      jamTorque+=(p.kind==='rod'?3.5:1.2)*rubbing/count;
      p.heat=Math.min(390,p.heat+h*abrasion*.025);this.scrape=Math.max(this.scrape,rubbing*.45);
      this.dust=Math.min(1,this.dust+rubbing*h*.00025);
      // The chip only wears down when a moving surface works against the wedge.
      const work=abrasion*h;
      p.jamWear=Math.min(450,p.jamWear+work);
      if(chamberRing){
       this.scuffLiner(p,work);
       if(p.releaseCount<2)this.shrink(p,p.jamRadius-(p.jamRadius-fitRadius)*Math.min(1,p.jamWear/wearLimit));
       continue;
      }
      if(p.releaseCount<2)this.grindWedge(p,fitRadius,wearLimit,work);
      continue;
     }
    }
    const startX=p.x,startY=p.y,inCase=p.zone==='case',surface=inCase?this.oilSurfaceAt(p.x):0;
    const immersed=inCase?clamp((p.y+p.r-surface)/Math.max(1,2*p.r),0,1):0;
    const oilDrag=immersed>0?Math.exp(-immersed*oilViscosity*3*h):1;
    p.vy=(p.vy+620*h*(1-immersed*.22))*oilDrag;
    if(inCase&&p.vy>95&&p.y+p.r<=surface&&p.y+p.r+p.vy*h>surface){
     oil?.pan?.splash(p.x,Math.min(26,p.r*p.vy*.015));
    }
    const current=immersed>0?(oil?.surfaceVelocityAt(p.x)??0)*.26:0;
    p.vx=p.vx*airDrag*oilDrag+current*(1-oilDrag);
    if(suction>0&&immersed>.45&&p.r<=PICKUP_SHARD_RADIUS){
     const dx=PICKUP_X-p.x,dy=PICKUP_Y-p.y,distance=Math.abs(dx);
     if(distance<=9+p.r&&Math.abs(dy)<=p.r+.65&&p.vx*p.vx+p.vy*p.vy<140*140){
      m.oilCircuit.captureAtPickup(p.r);
      this.bodies.splice(body--,1);
      continue;
     }
     // Slow pan current carries wet chips along the floor. Near the screen,
     // the converging stream lifts them off the floor into the inlet.
     const coupling=suction*immersed*Math.min(1,2.6/p.r)*h;
     const drift=195+90*clamp(1-distance/75,0,1);
     p.vx+=clamp(dx*18,-drift,drift)*coupling;
     if(dy<0)p.vy-=820*clamp(1-distance/32,0,1)*coupling;
    }
    p.vy=clamp(p.vy,-850,850);p.vx=clamp(p.vx,-850,850);p.x+=p.vx*h;p.y+=p.vy*h;
    p.a=(p.a+p.w*h+TAU)%TAU;p.w=clamp(p.w*spinDrag*oilDrag,-15,15);
    if(p.zone==='chamber'){
     this.chamberContacts(p,cy,g,crownVelocity,h);
    }else if(p.zone==='liner'){
     const x=XS[i],edge=48-p.r;
     if(Math.abs(p.x-x)>edge)this.contact(p,Math.sign(x-p.x),0,Math.abs(p.x-x)-edge,0,0,'liner',cy.contact.filmMicron);
     this.skirtContact(p,cy,g.top,crownVelocity);
     if(p.y-p.r>=CASE_ENTRY){if(p.jammed)this.release(p);p.zone='case';}
    }else{
     this._rotor.load=0;
     this.sweepCase(p,startX,startY,moving,previous,h);
     this.caseWalls(p);
     const fixedContacts=p.contacts;
     this.crankContacts(p,moving,previous,h);
     // Only a rotor closing against an opposing static support can catch a chip.
     const support=this._support;
     if(p.contacts>fixedContacts)this.caseWalls(p);
     // Final projection prevents fast rotors pushing a fragment through the shell.
     p.x=clamp(p.x,305+p.r,890-p.r);p.y=clamp(p.y,417+p.r,548-p.r);
     // Multiple simultaneous projections must not impart positional travel
     // much larger than the allowed velocity can cover in this substep.
     const dx=p.x-startX,dy=p.y-startY,travel=Math.hypot(dx,dy),limit=1000*h+.6;
     if((p.kind==='metal'||Math.min(startY,p.y)-p.r<CASE_ENTRY+9)&&travel>limit){
      p.x=startX+dx*limit/travel;p.y=startY+dy*limit/travel;
     }
     this.updatePinch(p,m.shaftSpeed>0?support.edge:'',h,support.x,support.y);
    }
   }
   // Finite pair contacts: broad phase by distance; 64 bodies means at most 2016 pairs.
   this.bodies.sort((a,b)=>a.x-b.x);
   for(let i=0;i<this.bodies.length;i++)for(let j=i+1;j<this.bodies.length;j++){
    const p=this.bodies[i],q=this.bodies[j];if(q.x-p.x>18)break;if(p.zone!==q.zone||p.zone==='chamber'&&p.cylinder!==q.cylinder)continue;
    const dx=p.x-q.x,dy=p.y-q.y,rr=p.r+q.r;if(Math.abs(dx)>rr||Math.abs(dy)>rr)continue;
    const d=Math.hypot(dx,dy);if(d>=rr||d<.001)continue;
    const nearRoof=p.zone==='case'&&Math.min(p.y-p.r,q.y-q.r)<CASE_ENTRY+9;
    const nx=dx/d,ny=dy/d,penetration=nearRoof?Math.min(rr-d,1.5):rr-d,w1=p.jammed?0:1/p.mass,w2=q.jammed?0:1/q.mass,den=w1+w2;if(!den)continue;
    p.x+=nx*penetration*w1/den;q.x-=nx*penetration*w2/den;p.y+=ny*penetration*w1/den;q.y-=ny*penetration*w2/den;
    const vn=(p.vx-q.vx)*nx+(p.vy-q.vy)*ny;if(vn<0){const k=-vn*1.1/den;p.vx+=nx*k*w1;p.vy+=ny*k*w1;q.vx-=nx*k*w2;q.vy-=ny*k*w2;}
   }
  }
  // Pair separation and a moving crown cannot leave a chip beyond the cutaway walls.
  for(const p of this.bodies){
   if(p.zone==='case'){p.x=clamp(p.x,305+p.r,890-p.r);p.y=clamp(p.y,417+p.r,548-p.r);}
   else if(p.zone==='liner'){
    const x=XS[p.cylinder];p.x=clamp(p.x,x-48+p.r,x+48-p.r);p.y=Math.max(232+p.r,p.y);
    this.skirtContact(p,m.cylinders[p.cylinder],this._geo[p.cylinder].top,0,true);
    if(p.y-p.r>=CASE_ENTRY){if(p.jammed)this.release(p);p.zone='case';}
   }
   else{
    const i=p.cylinder,x=XS[i];
    const bottom=m.cylinders[i].failure==='ejected'&&!this.detached[i]?CASE_ENTRY+2*p.r:Math.max(232+2*p.r+.05,this._geo[i].top);
    p.x=clamp(p.x,x-48+p.r,x+48-p.r);p.y=clamp(p.y,232+p.r,bottom-p.r);
   }
  }
  this.finishSpalls(m);
  this.finishImpactChips();
  this.finishGrindChips();
  this.jamCount=0;for(const p of this.bodies)if(p.jammed)this.jamCount++;
  this.resistance=approach(this.resistance,Math.min(28,jamTorque+this.impactEnergy/Math.max(.001,dt)*.06),8,dt);
  if(this.events.length>12)this.events.length=12;
 }
 snapshot(){return {seed:this.seed,nextId:this.nextId,impacts:this.impacts,dust:this.dust,bodies:this.bodies.map(b=>({...b})),linerScuffs:this.linerScuffs.map(mark=>({...mark})),edgeChips:this.edgeChips.map(mark=>({...mark})),caseBreach:this.caseBreach&&{...this.caseBreach},detached:this.detached.map(p=>p&&{...p}),crownDents:this.crownDents.map(mark=>mark&&{...mark})};}
 static restore(s,count=4){const w=new Fragments(417,count);if(!s||typeof s!=='object')return w;w.seed=finite(s.seed,0,4294967295,417)>>>0;w.impacts=finite(s.impacts,0,1e12);w.dust=finite(s.dust,0,1);
  const hole=s.caseBreach;
  w.crownDents=w.crownDents.map((_,i)=>{
   const mark=s.crownDents?.[i];
   return Number.isFinite(mark?.offset)&&Number.isFinite(mark.depth)&&mark.depth>0
    ?{offset:clamp(mark.offset,-44,44),depth:clamp(mark.depth,0,1)}:null;
  });
  if(hole&&Number.isInteger(hole.cylinder)&&hole.cylinder>=0&&hole.cylinder<count&&Number.isFinite(hole.x)&&hole.x>=OIL_PAN.left&&hole.x<=OIL_PAN.right&&Number.isFinite(hole.area)&&hole.area>=PAN_BREACH_MIN_M2&&hole.area<=PAN_BREACH_MAX_M2)
   w.caseBreach={x:hole.x,cylinder:hole.cylinder,area:hole.area};
  w.detached=w.detached.map((_,i)=>Number.isFinite(s.detached?.[i]?.top)?{
   top:finite(s.detached[i].top,235,CASE_ENTRY),vy:finite(s.detached[i].vy,-290,500,0)
  }:null);
  const bodies=Array.isArray(s.bodies)?s.bodies.slice(0,CAP):[],usedIds=new Set();
  const validId=id=>Number.isInteger(id)&&id>0&&id<=1e9;
  let nextId=validId(s.nextId)?s.nextId:1;
  for(const d of bodies)if(validId(d?.id))nextId=Math.max(nextId,d.id+1);
  for(const d of bodies){if(!d||typeof d!=='object'||d.cylinder>=count)continue;const i=Math.floor(finite(d.cylinder,0,count-1)),zone=['chamber','liner'].includes(d.zone)?d.zone:'case',p=w.add(i,FRAGMENT_KINDS.includes(d.kind)?d.kind:'metal',zone);if(!p)break;
   p.id=validId(d.id)&&!usedIds.has(d.id)?d.id:nextId++;
   usedIds.add(p.id);
   for(const [k,lo,hi]of[['r',1.4,9],['mass',.002,.2],['a',0,TAU],['w',-15,15],['heat',24,390],['releaseCount',0,2]])p[k]=finite(d[k],lo,hi,p[k]);
   p.x=finite(d.x,zone==='case'?305+p.r:XS[i]-48+p.r,zone==='case'?890-p.r:XS[i]+48-p.r,XS[i]);p.y=finite(d.y,zone==='case'?417+p.r:232+p.r,zone==='case'?548-p.r:CASE_ENTRY+p.r,zone==='case'?520:240);
   p.vx=finite(d.vx,-850,850);p.vy=finite(d.vy,-850,850);p.jammed=zone!=='liner'&&d.jammed===true;p.jamAge=finite(d.jamAge,0,1e9);p.jamWear=finite(d.jamWear,0,450);p.pinch=finite(d.pinch,0,.06);p.rubbing=finite(d.rubbing,0,1);
   p.jamRadius=finite(d.jamRadius,p.r,9,p.r);p.jamSlip=finite(d.jamSlip,0,(p.jamRadius-p.r)*.65);p.wearFace=finite(d.wearFace,0,TAU);
   p.jamGrit=p.jammed&&zone==='case'?finite(d.jamGrit,0,.004):0;
   p.skew=p.kind==='ring'&&zone==='chamber'?finite(d.skew,-RING_SKEW_LIMIT,RING_SKEW_LIMIT,0):0;
   if(zone==='liner'&&d.jammed===true&&d.jamEdge==='liner'&&Math.abs(Math.abs(p.x-XS[i])+p.r-48)<.05){
    p.jammed=true;p.jamEdge='liner';p.edgeX=XS[i]+Math.sign(p.x-XS[i])*48;p.edgeY=p.y;
   }
   if(p.jammed){
    p.vx=p.vy=p.w=0;
    if(zone==='case'&&['cap','case'].includes(d.jamEdge)&&Number.isFinite(d.edgeX)&&Number.isFinite(d.edgeY)){
     p.jamEdge=d.jamEdge;p.edgeX=clamp(d.edgeX,305,890);p.edgeY=clamp(d.edgeY,417,548);
    }else if(zone==='chamber'&&['liner','head'].includes(d.jamEdge)&&Number.isFinite(d.edgeX)&&Number.isFinite(d.edgeY)){
     p.jamEdge=d.jamEdge;
     p.edgeX=p.jamEdge==='liner'?XS[i]+(d.edgeX<XS[i]?-48:48):clamp(d.edgeX,XS[i]-48,XS[i]+48);
     p.edgeY=p.jamEdge==='head'?232:clamp(d.edgeY,232,414);
    }
   }
  }
  let oldScuffs=0;
  for(const mark of Array.isArray(s.linerScuffs)?s.linerScuffs.slice(0,LINER_SCUFF_CAP+XS.length):[]){
   if(!mark||!Number.isInteger(mark.cylinder)||mark.cylinder<0||mark.cylinder>=count||![-1,1].includes(mark.side))continue;
   const top=finite(mark.top,232,414),bottom=finite(mark.bottom,top,414),depth=finite(mark.depth,0,1);
   if(bottom>top&&depth>0){
    if(mark.kind==='skew'){
     if(mark.side!==1||w.linerScuffs.some(s=>s.kind==='skew'&&s.cylinder===mark.cylinder))continue;
    }else if(oldScuffs>=LINER_SCUFF_CAP)continue;
    else oldScuffs++;
    const restored={cylinder:mark.cylinder,side:mark.side,top,bottom,depth};
    if(['skirt','skew','strike','wedge'].includes(mark.kind))restored.kind=mark.kind;
    w.linerScuffs.push(restored);
   }
  }
  for(const mark of Array.isArray(s.edgeChips)?s.edgeChips.slice(0,EDGE_CHIP_CAP):[]){
   if(!mark||!Object.hasOwn(SPALL_TRAVEL,mark.edge)||!Number.isInteger(mark.cylinder)||mark.cylinder<0||mark.cylinder>=count)continue;
   const {edge,cylinder}=mark,center=XS[cylinder],caseEdge=edge==='cap'||edge==='case';
   const nx=finite(mark.nx,-1,1,0),ny=finite(mark.ny,-1,1,0),length=Math.hypot(nx,ny);
   const damage=finite(mark.damage,0,1);
   if(length<.01||damage===0||!Number.isFinite(mark.x)||!Number.isFinite(mark.y))continue;
   const x=edge==='liner'?center+(mark.x<center?-48:48):clamp(mark.x,caseEdge?305:center-48,caseEdge?890:center+48);
   const y=edge==='head'?232:clamp(mark.y,caseEdge?417:232,caseEdge?548:414);
   // Coordinates already at a valid unit normal round-trip without drift.
   const k=Math.abs(length-1)<1e-9?1:length;
   w.edgeChips.push({edge,cylinder,x,y,nx:nx/k,ny:ny/k,damage});
  }
  w.seed=finite(s.seed,0,4294967295,417)>>>0;w.nextId=nextId;w.jamCount=w.bodies.filter(b=>b.jammed).length;return w;
 }
}
const PISTON_CLEARANCE_MM=.04,MAX_PISTON_PLAY_MM=.65;
const PISTON_COLD_FIT_MM=.145;
const COLLAR_REFERENCE_C=24,AL_EXPANSION=20.5e-6,LINER_EXPANSION=11.5e-6;
const CROWN_HEAT_CAPACITY=.16;
const CRANK_ROD_RATIO=base.SPEC.stroke/(2*base.SPEC.rod);
const BEARING_LOAD_N=34e5*Math.PI*(base.SPEC.bore/2000)**2;
const JOURNAL_RADIUS_M=.023;
const BEARING_SEAT_WORK_J=1600;
const BEARING_CLEARANCE_MM=.045,JOURNAL_CLEARANCE_GAIN_MM=.175,JOURNAL_SCORING_WORK_J=48000,ROD_IMPACT_CLEARANCE_MM=.080;
const MAIN_CLEARANCE_MM=.052,MAIN_CLEARANCE_WEAR_MM=.19,MAIN_WEAR_WARNING=.22;
const FUEL_CAPACITY=20;
const TEMPORARY_FAULTS=new Set(['pickup:clog','filter:clog','jet:clog','piston:heat']);
const SHARED_FAULTS=new Set(['pickup:clog','filter:clog','pan:break','radiator:break','waterPump:break','mufflerBaffle:break','exhaust:break','timing:skip','timing:break']);
const CYLINDER_FAULTS=new Set(['jet:clog','gasket:break','rings:break','plug:foul','piston:heat','skirt:break','exhaustValve:break','crown:break','rod:break']);
function benchFaultKey(part,action,cylinder){
 const fault=part+':'+action;
 if(SHARED_FAULTS.has(fault))return fault;
 if(CYLINDER_FAULTS.has(fault)&&Number.isInteger(cylinder)&&cylinder>=0&&cylinder<4)return fault+':'+cylinder;
 return null;
}
const BENCH_FAULT_KEYS=new Set([...SHARED_FAULTS,...[...CYLINDER_FAULTS].flatMap(fault=>[0,1,2,3].map(i=>fault+':'+i))]);
const mainBearingMessage=id=>`Коренной вкладыш ${id+1}: масляная плёнка сорвана, слой вкладыша стирается и растёт люфт коленвала.`;
const bearingWipeMessage=id=>`Цилиндр ${id+1}: прихват шатунного вкладыша, оторвался слой металла.`;
const bearingSpinMessage=id=>`Цилиндр ${id+1}: провернуло шатунный вкладыш.`;
const bearingRodFailureMessage=id=>`Цилиндр ${id+1}: обрыв шатуна после проворота вкладыша.`;
const CASE_BREACH_MESSAGE='Обломок шатуна пробил поддон картера. Вытекает масло.';
const SPILL_FIRE_MESSAGE='Масло из поддона загорелось на выпускной трубе.';
const HOSE_RUPTURE_MESSAGE='Огонь прожёг нижний шланг охлаждения. Вытекает антифриз.';
const SKIRT_FATIGUE_WORK_J=7000,SKIRT_CRACK_FATIGUE=.32;
const SKIRT_CHIP_FATIGUE=[.54,.73,.91],SKIRT_FLAKE_RADII=[2.45,2.68,2.89];
const PISTON_THERMAL_EVENTS={pistonSeize:'юбку поршня прихватило к гильзе.',pistonFree:'поршень остыл и освободился, задиры остались.',
 skirtCrack:'от повторного прихвата треснула юбка поршня.',skirtChip:'от юбки поршня отделился осколок.'};
const SKEW_EVENTS={skewSeize:'поршень заклинило от перекоса шатуна.',skewFree:'перекошенный поршень отпустило, задиры остались.'};
const jetClogMessage=id=>`Цилиндр ${id+1}: масляная форсунка засорилась.`;
function skirtClearance(d){
 const growth=base.SPEC.bore*(AL_EXPANSION*(d.skirtTemp-COLLAR_REFERENCE_C)-LINER_EXPANSION*(d.wallTemp-COLLAR_REFERENCE_C));
 return PISTON_COLD_FIT_MM+(d.play-PISTON_CLEARANCE_MM)*.4+.012*d.liner+.008*d.skirt-growth;
}
function initialSkirtTemp(d){return clamp(d.wallTemp+(d.crownTemp-d.wallTemp)*.45,35,310);}
class Engine extends Prior{
 #pistonMotion=this.cylinders.map(()=>({offset:0,velocity:0,seat:0}));
 #bearingLoaded=this.cylinders.map(()=>null);
 constructor(seed=7193, spec){
  super(seed,spec);this.oilCircuit=new Circuit('oil');this.oilCircuit.pistonJets.length=this.cylinders.length;this.oilCircuit.setInventory(this.oil);this.waterCircuit=new Circuit('water');
  this.fragments=new Fragments(seed^1234,this.cylinders.length);
  this.timingDrive=new TimingDrive();
  this.exhaust={pressure:0,leak:0,soot:0,manifold:165,resonator:70,tail:35,oil:0,ringOil:0,steam:0,coolantSteam:0,carbon:0,pulse:0,condensation:0,jetSpeed:0,
   flangeTemp:120,sealWear:0,jointGap:0};
  this.ringShed=this.cylinders.map(()=>false);this.collisionCooldown=0;
  this.auxWear={waterPump:0,oilPickup:0,mufflerBaffle:0,radiator:0};
  this.oilRunoff=0;this.coolantRunoff=0;this.radiatorRunoff=0;this.radiatorJetSpeed=0;
  this.caseLeakRate=0;
  this.exhaustSpill={oil:0,temp:this.ambient,soak:0,burning:false,smoke:0};
  this.coolantHose={damage:0,temp:this.ambient,runoff:0,jetSpeed:0};
  this.oilOxidation=0;
  this.bearingBoundaryNm=0;
  this.mainBearingDragNm=0;
  this.mainBearings=BEARING_CAPS.map(()=>({temp:this.oilTemp,wear:0,clearance:MAIN_CLEARANCE_MM,seat:0,offset:0}));
  this.hydraulicDragNm=0;
  this.preIgnitionDragNm=0;
  this.crankcasePressure=0;
  this.fuel=FUEL_CAPACITY;this.fuelDelivery=1;this.rpmLimit=base.RATING.limiter;this.corrosion=0;
  this.benchFaults=new Set();this.oilCircuit.benchFaults=this.benchFaults;
  this.mountWear=this.build.wear*.55;this.components.leftMount=this.build.wear*.4;this.components.rightMount=this.build.wear*.29;
  this.timingDrive.pinWear=this.build.wear*.48;this.timingDrive.guideWear=this.build.wear*.37;
  this.crankSeals=CRANK_SEALS.map(()=>({wear:0,film:0,flow:0}));
  for(const cy of this.cylinders){
   cy.partWear={ringLand:0,skirt:0,exhaustValve:0};
   cy.exhaustValveTemp=this.headTemp;
   cy.contact.play=PISTON_CLEARANCE_MM;
   cy.contact.bearingWipe=0;
   cy.contact.bearingGrip=1;cy.contact.bearingSpun=false;cy.contact.bearingSpinAngle=0;
   cy.contact.journalScoring=0;cy.contact.bearingClearance=BEARING_CLEARANCE_MM;cy.contact.rodFatigue=0;
   cy.contact.skirtTemp=initialSkirtTemp(cy.contact);
   cy.contact.clearance=skirtClearance(cy.contact);
   cy.contact.thermalSeized=false;cy.contact.thermalBind=0;cy.contact.thermalSide=1;
   cy.contact.skirtCycled=false;cy.contact.skirtFatigue=0;cy.contact.skirtSide=1;cy.contact.skirtChips=0;
   cy.contact.headWarp=0;cy.contact.headSeal=0;cy.contact.boreCoolant=0;cy.contact.boreCoolantFlow=0;
   cy.contact.plugWet=0;cy.contact.wetMisses=0;cy.contact.hydraulicHit=false;cy.contact.rodBend=0;
   cy.contact.skewScuff=0;cy.contact.skewBind=0;cy.contact.skewSeized=false;
   cy.contact.ringSeizures=0;cy.contact.ringBreakSide=1;cy.contact.boreOil=0;cy.contact.boreOilVapour=0;
   cy.contact.plugCarbon=0;cy.contact.crownCarbon=0;
   cy.contact.depositTemp=this.ambient;cy.contact.preIgnition=0;cy.contact.preIgnitionHits=0;cy.contact.crownFatigue=0;
   cy.contact.crownGasFlow=0;
   if(spec)cy.susceptibility*=.72+.56*this.random();
   if(this.build.wear){
    const w=this.build.wear;
    cy.wear=w;cy.compression=1-.76*w;cy.misfire=Math.max(0,(w-.35)*.72);
    const d=cy.contact;
    d.rings=w*(.36+.5*this.random());d.liner=w*.57;d.skirt=w*(.32+.46*this.random());d.bearing=w*(.37+.52*this.random());
    d.play+=d.skirt*.27;d.clearance=skirtClearance(d);d.bearingBasePlay=d.bearing*.14;d.bearingClearance+=d.bearingBasePlay;
    d.rodFatigue=d.bearingClearance>ROD_IMPACT_CLEARANCE_MM?w*.6:0;d.plugCarbon=w*.82;d.crownCarbon=w*.63;
   }
   cy.contact.ringFaces=Array(8).fill(0);cy.contact.ringGasLeft=cy.contact.ringGasRight=0;
  }
 }
 get clearanceLitres(){return CHAMBER_CLEARANCE_L*this.build.litres*2/this.cylinders.length;}
 emit(type,cylinder,message){super.emit(type,cylinder,message);if(type==='cylinder'&&this.fragments)this.fragments.breakCylinder(cylinder,this);}
 get pistonSpeed(){return 2*base.SPEC.stroke*.001*this.rpm/60;}
 get fuelOnReserve(){return this.fuel<=.08;}
 benchFaultOn(part,action,cylinder){return this.benchFaults.has(benchFaultKey(part,action,cylinder));}
 toggleBenchFault(part,action,cylinder){
  const key=benchFaultKey(part,action,cylinder);
  if(!key)return false;
  if(this.benchFaults.delete(key))return true;
  const fault=part+':'+action;
  if(CYLINDER_FAULTS.has(fault)&&!this.cylinders[cylinder]?.active)return false;
  if(!TEMPORARY_FAULTS.has(fault)&&!this.disturb(part,action,cylinder))return false;
  this.benchFaults.add(key);
  return true;
 }
 setBenchValue(key,value){
  if(!Number.isFinite(value))return false;
  switch(key){
   case 'oil':this.oil=clamp(value,0,4.6);this.oilCircuit.setInventory(this.oil);break;
   case 'coolantLevel':this.coolantLevel=clamp(value/6,0,1);this.waterCircuit.setInventory(this.coolantLevel*6);break;
   case 'fuel':this.fuel=clamp(value,0,FUEL_CAPACITY);break;
   case 'corrosion':this.corrosion=clamp(value/100,0,1);break;
   case 'rpmLimit':this.rpmLimit=clamp(value,1200,base.RATING.limiter);break;
   case 'coolant':this.coolant=this.sensor.coolant=clamp(value,24,160);break;
   case 'oilTemp':this.oilTemp=this.sensor.oil=clamp(value,24,220);break;
   default:return false;
  }
  return true;
 }
 disturb(part,action,id){
  const cy=Number.isInteger(id)?this.cylinders[id]:null;
  const d=cy?.active?cy.contact:null;
  switch(part+':'+action){
   case 'pickup:clog':
    this.oilCircuit.pickupClog=Math.max(this.oilCircuit.pickupClog,.94);
    this.emit('benchFault',-1,'Сетка маслоприёмника перекрыта.');
    break;
   case 'filter:clog':
    this.oilCircuit.filterLoad=Math.max(this.oilCircuit.filterLoad,.86);
    this.emit('benchFault',-1,'Масляный фильтр засорён. Следите за перепускным клапаном и давлением.');
    break;
   case 'pan:break':
    if(this.fragments.caseBreach)return false;
    this.fragments.caseBreach={x:704,y:OIL_PAN.floor,cylinder:1,area:PAN_BREACH_MIN_M2};
    this.emit('benchFault',-1,'Поддон пробит. Масло вытекает.');
    break;
   case 'radiator:break':case 'waterPump:break':case 'mufflerBaffle:break':
    if(this.auxWear[part]===1)return false;
    this.wearAuxPart(part,1);break;
   case 'exhaust:break':
    if(this.exhaust.sealWear===1)return false;
    this.exhaust.sealWear=1;this.updateExhaustGap();this.emit('exhaustSeal',-1,EXHAUST_SEAL_FAILURE);
    break;
   case 'timing:skip':
    if(this.timingDrive.broken||this.timingDrive.teethSkipped>=3)return false;
    this.timingDrive.skipTooth(this);this.refreshCycle();break;
   case 'timing:break':
    if(this.timingDrive.broken)return false;
    this.timingDrive.breakLink(this);this.refreshCycle();break;
   case 'jet:clog':
    if(!d||this.oilCircuit.pistonJets[id].clog>=.92)return false;
    this.oilCircuit.pistonJets[id].clog=.92;this.emit('jetClog',id,jetClogMessage(id));break;
   case 'gasket:break':
    if(!d||d.headSeal>=.83)return false;
    d.gasketPunctured=true;d.headSeal=.83;this.emit('benchFault',id,`Цилиндр ${id+1}: прокладка ГБЦ пробита на стенде.`);this.refreshCycle();break;
   case 'rings:break':
    if(!d||d.ringSeizures>=3)return false;
    d.ringSeizures=Math.max(1,d.ringSeizures);this.noteRingSeizure(cy);break;
   case 'plug:foul':
    if(!d||d.plugCarbon>=.88)return false;
    d.plugCarbon=.88;this.emit('plugFouling',id,plugFoulingMessage(id));break;
   case 'piston:heat':
    if(!d)return false;
    d.skirtTemp=Math.min(390,d.skirtTemp+95);
    d.crownTemp=Math.min(390,d.crownTemp+70);
    this.emit('benchFault',id,`Цилиндр ${id+1}: юбка и днище поршня нагреты.`);
    break;
   case 'skirt:break':case 'exhaustValve:break':
    if(!d||cy.partWear[part]===1)return false;
    this.wearCylinderPart(cy,part,1);break;
   case 'crown:break':
    if(!d||crownOpening(d))return false;
    d.crownFatigue=.91;this.emit('crownBreach',id,crownBreachMessage(id));this.refreshCycle();break;
   case 'rod:break':
    return this.failCylinder(cy,'rod',d?`Цилиндр ${id+1}: шатун оборван на стенде.`:undefined,true);
   default:return false;
  }
  return true;
 }
 failCylinder(cy,failure,message,manual){
  if(!cy)return false;
  const d=cy.contact;
  if(!failure&&(d.rodBend>.22||d.bearingSpun&&d.rodFatigue>.3)){
   failure='rod';
   message=`Цилиндр ${cy.id+1}: ${d.bearingSpun?'разрушение шатунного вкладыша':'сломался погнутый шатун'}.`;
  }
  return super.failCylinder(cy,failure,message,manual);
 }
 cylinderStress(cy,thermal,starvation){
  const d=cy.contact;
  const coolingLoss=Math.max(d.headSeal,d.rodBend);
  const jetRestriction=clamp(((this.oilCircuit?.jetRestriction(cy.id)??0)-.7)/.3,0,1);
  return 1+Math.min(1,thermal*coolingLoss*.56+starvation*jetRestriction*.38);
 }
 get power(){
  const sealed=super.power;
  const lost=this.cylinders.reduce((sum,c)=>c.active?sum+c.compression*(1-this.sparkEnergy(c))*.57:sum,0)/4;
  return (sealed-lost)*(this.timingDrive?.torqueFactor??1);
 }
 headSealedCompression(c){
  const d=c.contact;
  const breaks=Math.max(0,(d.ringSeizures??0)-1);
  return Math.max(c.last?.22:.1,c.compression*(1-.62*(d.headSeal??0))*(1-.10*(d.rodBend??0))*(1-(d.skewSeized?.34*d.skewBind:0))*(1-.28*breaks))*(1-.61*crownOpening(d))*(1-ringOpening(d,0)-ringOpening(d,4));
 }
 sparkEnergy(c){return 1-.89*clamp(((c.contact.plugCarbon??0)-FOULED_PLUG_CARBON)/(1-FOULED_PLUG_CARBON),0,1);}
 ignitionMissChance(c){
  const wet=c.misfire+(1-c.misfire)*.91*c.contact.plugWet;
  const plug=wet+(1-wet)*.8*(1-this.sparkEnergy(c));
  return plug+(1-plug)*.56*(1-this.fuelDelivery);
 }
 noteWetMiss(c,draw){if(draw<c.misfire+(1-c.misfire)*.91*c.contact.plugWet)c.contact.wetMisses=Math.min(1e12,c.contact.wetMisses+1);}
 preIgnitionAge(angle){return angle>=PRE_IGNITION_ANGLE?angle-PRE_IGNITION_ANGLE:angle+.46;}
 preIgnitionPressure(c,s){
  const level=c.contact?.preIgnition;
  if(!level||(s.stroke!==0&&s.angle<PRE_IGNITION_ANGLE))return;
  const age=this.preIgnitionAge(s.angle),volume=base.chamberVolume(s.angle).ratio;
  const rise=base.burnFraction(age*2.8)*Math.exp(-Math.max(0,age-.42)*1.15);
  return base.gasPressure(s.angle,this.throttle,c.compression,false)+(34+24*this.throttle)*level*rise/volume**1.28;
 }
 checkPreIgnition(c,angle,next){
  const d=c.contact;
  if(angle<Math.PI&&next>=Math.PI)d.preIgnition=0;
  if(d.preIgnition)return true;
  if(angle>=PRE_IGNITION_ANGLE||next<PRE_IGNITION_ANGLE||this.ignition!=='running'||this.overrun||this.revCut||
   this.throttle<.58||d.crownCarbon<=.38||d.depositTemp<HOT_DEPOSIT_C||d.boreCoolant>.003||this.timingDrive.broken)return false;
  if(this.timingDrive.teethSkipped){
   const valves=base.cycleState(this.timingDrive.valvePhase(this.phase),c);
   if(valves.intake>.05||valves.exhaust>.05)return false;
  }
  const hot=clamp((d.depositTemp-HOT_DEPOSIT_C)/205,0,1),load=clamp((this.throttle-.58)/.42,0,1);
  const level=clamp(.32+.32*hot+.36*load,.32,1);
  d.preIgnition=level;d.preIgnitionHits=Math.min(d.preIgnitionHits+1,1e9);
  const before=d.crownFatigue;
  d.crownFatigue=Math.min(1,before+.041*level**2*(.64+.55*hot));
  d.crownTemp=Math.min(390,d.crownTemp+2.4*level);
  this.preIgnitionDragNm=Math.max(this.preIgnitionDragNm,level*26);
  const x=XS[c.id]+d.ringBreakSide*29,y=pistonGeometry(this.phase,c,XS[c.id]).top;
  if(d.preIgnitionHits===1)this.emit('preIgnition',c.id,preIgnitionMessage(c.id));
  else this.events.push({type:'preIgnition',cylinder:c.id,time:this.time});
  Object.assign(this.events.at(-1),{x,y,nx:0,ny:1,angle:PRE_IGNITION_ANGLE,level});
  if(this.events.length>32)this.events.shift();
  if(before<CROWN_CRACK_FATIGUE&&d.crownFatigue>=CROWN_CRACK_FATIGUE)this.emit('crownCrack',c.id,crownCrackMessage(c.id));
  if(before<CROWN_BREACH_FATIGUE&&d.crownFatigue>=CROWN_BREACH_FATIGUE)this.emit('crownBreach',c.id,crownBreachMessage(c.id));
  return true;
 }
 advanceCrownDeposits(dt){
  this.preIgnitionDragNm*=Math.exp(-dt*13);
  const running=this.ignition==='running',heat=clamp((this.egt-460)/330,0,1)*clamp((this.throttle-.38)/.62,0,1);
  for(const c of this.cylinders){
   const d=c.contact;
   if(!running||!c.active)d.preIgnition=0;
   if(d.crownCarbon<=.04)continue;
   const glowing=running&&c.active&&!this.overrun&&!this.revCut?(c.lit||d.preIgnition?1:.47):0;
   const target=d.crownTemp+880*clamp((d.crownCarbon-.38)/.62,0,1)*heat*glowing;
   d.depositTemp=approach(d.depositTemp,target,target>d.depositTemp?.24:.46,dt);
  }
 }
 refreshCycle(){
  super.refreshCycle();
  for(const c of this.cylinders){
   if(!c.active||(c.cycle.stroke!==0&&c.cycle.stroke!==3))continue;
   const d=c.contact,breaks=Math.max(0,(d.ringSeizures??0)-1);
   if(!d.headSeal&&!breaks)continue;
   const retained=(1-.48*(d.headSeal??0))*(1-.18*breaks);
   c.chamberBar=1+(c.chamberBar-1)*retained;
   c.gasTorqueNm*=retained;
  }
  const drive=this.timingDrive;
  if(drive&&(drive.teethSkipped||drive.broken)){
   const phase=drive.valvePhase(this.phase);
   for(const c of this.cylinders){
    const valve=base.cycleState(phase,c);
    c.cycle.intake=valve.intake;c.cycle.exhaust=valve.exhaust;c.cycle.valveAngle=valve.angle;
    c.cycle.camAngle=this.camAngle=valve.camAngle;
    c.chamberBar=1+(c.chamberBar-1)*drive.torqueFactor;
    c.gasTorqueNm*=drive.torqueFactor;
   }
  }
  const receiver=1+(this.crankcasePressure??0);
  const exhaustBar=1+(this.exhaust?.pressure??0)*.01;
  for(const c of this.cylinders){
   const s=c.cycle;
   // Signed swept flow in L/s, positive into the bore. Use actual cam lift
   // so an open valve can carry reverse flow after a timing fault.
   const swept=c.active?s.litresPerRadian*this.rpm*TAU/60:0;
   s.intakeLps=swept*s.intake;
   s.exhaustLps=swept*s.exhaust;
   if(c.active&&this.rpm>0&&(s.intake>0||s.exhaust>0)){
    const port=s.intake>0?(this.manifoldBar??.35):exhaustBar;
    const flow=s.intake>0?s.intakeLps:s.exhaustLps;
    const loss=clamp(flow*Math.abs(flow)*.000007,-.24,.24);
    c.chamberBar+=(port-loss-c.chamberBar)*Math.max(s.intake,s.exhaust);
    c.gasTorqueNm=(c.chamberBar-1)*100*s.litresPerRadian;
   }
   const d=c.contact,crown=crownOpening(d),left=ringOpening(d,0),right=ringOpening(d,4);
   const opening=crown+left+right,pressure=c.chamberBar,head=pressure-receiver;
   d.crownGasFlow=d.ringGasLeft=d.ringGasRight=0;
   if(!c.active||!opening||this.rpm<=1||head<=0)continue;
   // The chamber spends more time discharging at low shaft speed.
   const dwell=clamp(1400/this.rpm,.42,2);
   const retained=Math.exp(-1.85*opening*dwell*Math.sqrt(head/(head+5)));
   c.chamberBar=receiver+head*retained;
   c.gasTorqueNm*=(c.chamberBar-1)/(pressure-1);
   // Orifice estimate in g/s, using average driving pressure and a 36 mm² maximum opening.
   const meanHead=head*(1+retained)*.5;
   const gasTemperature=d.crownTemp+273+(c.lit&&c.cycle.stroke===0?320:0);
   const density=(receiver+meanHead)*1e5/(287*gasTemperature);
   const flux=.69*36e-3*Math.sqrt(2*meanHead*1e5*density);
   d.crownGasFlow=flux*crown;d.ringGasLeft=flux*left;d.ringGasRight=flux*right;
  }
 }
 oilPressureTarget(){
  const pressure=super.oilPressureTarget()*(1-.57*pickupAir(this))*(this.oilCircuit?.pickupDelivery??1)*(this.oilCircuit?.liquidDelivery??1);
  return Math.max(0,pressure-(this.oilCircuit?.filterPressureLoss??0));
 }
 coolantBoilingPoint(){
  const boiling=super.coolantBoilingPoint(),vent=Math.max(damageOpening(this.auxWear?.radiator,.82),
   damageOpening(this.coolantHose?.damage,HOSE_RUPTURE));
  return boiling-(boiling-108)*vent*.86;
 }
 advanceRadiatorLeak(dt){
  const opening=damageOpening(this.auxWear.radiator,.82),radiator=this.waterCircuit.cells[3];
  const wet=clamp(Math.min(radiator.litres/radiator.capacity,this.coolantLevel/.18),0,1);
  const expansion=clamp((this.coolant-65)*.019,0,1.18)*(1-.77*opening)*wet;
  const head=expansion+wet*(.29*this.waterCircuit.pressure+.018*wet);
  // Bernoulli velocity in m/s and an effective fissure area in m².
  this.radiatorJetSpeed=opening>0?Math.sqrt(2e5*head/1040):0;
  const leak=Math.min(this.coolantLevel*6,.0064*opening*wet*this.radiatorJetSpeed*dt);
  this.coolantLevel=Math.max(0,this.coolantLevel-leak/6);
  this.radiatorRunoff=leak/dt;
 }
 advanceCaseLeak(dt){
  this.caseLeakRate=0;
  const hole=this.fragments.caseBreach;
  if(!hole)return;
  const oil=this.oilCircuit,head=Math.max(0,(OIL_PAN.floor-oil.surfaceAt(hole.x))*.001);
  // The open sump drains under its local oil head, even with the key off.
  const lost=Math.min(this.oil,oil.cells[0].litres,.64*hole.area*Math.sqrt(2*9.81*head)*1000*dt);
  this.oil-=lost;this.caseLeakRate=lost/dt;
 }
 advanceCrankSeals(dt){
  const gasInflow=this.cylinders.reduce((sum,{contact:d})=>sum+d.crownGasFlow+d.ringGasLeft+d.ringGasRight,0);
  const vent=1+this.crankSeals.reduce((sum,s)=>sum+.47*crankSealOpening(s.wear),0);
  this.crankcasePressure=approach(this.crankcasePressure,clamp(gasInflow*.036/vent,0,.65),5,dt);
  const pressure=this.crankcasePressure,speed=clamp(this.rpm/1100,0,1);
  let sump=Math.max(0,this.oilCircuit.cells[0].litres-this.caseLeakRate*dt);
  for(let i=0;i<CRANK_SEALS.length;i++){
   const s=this.crankSeals[i],lip=CRANK_SEALS[i];
   const before=s.wear;
   s.wear=Math.min(1,before+Math.max(0,pressure-lip.load)*.61*dt);
   if(before<=CRANK_SEAL_LIFT&&s.wear>CRANK_SEAL_LIFT)this.emit(i===0?'frontCrankSeal':'rearCrankSeal',-1,crankSealMessage(i));
   const opening=crankSealOpening(s.wear);
   const head=Math.max(0,pressure-.020)+.006*speed*opening;
   const splash=clamp(sump/.68,0,1)*speed;
   // Oil reaches the lip as splash, then escapes through the lifted seal.
   const rate=.021*opening*Math.sqrt(2e5*head/865)*splash;
   const lost=Math.min(this.oil,sump,rate*dt);
   this.oil-=lost;sump-=lost;s.flow=lost/dt;
   s.film=Math.min(CRANK_SEAL_FILM_LIMIT,s.film*Math.exp(-dt*.87)+lost*.37);
  }
 }
 advanceExhaustSpill(dt){
  const s=this.exhaustSpill,hole=this.fragments.caseBreach;
  s.temp=approach(s.temp,this.ambient+(this.exhaust.manifold-this.ambient)*.93,.22,dt);
  if(!hole||hole.x<SPILL_PIPE.left||hole.x>SPILL_PIPE.right)return;
  // Only the part of the falling oil held on the pipe feeds the surface film.
  // The excess runs off and was already debited from the sump.
  s.oil=Math.min(SPILL_FILM_LIMIT,s.oil+this.caseLeakRate*.34*dt);
  const warm=clamp((s.temp-165)/230,0,1),hot=clamp((s.temp-375)/100,0,1);
  s.soak=approach(s.soak,s.oil>.0015?hot:0,1.35,dt);
  if(s.burning){
   if(s.oil<.0008||s.temp<190)s.burning=false;
  }else if(s.soak>.57&&s.oil>.002){
   s.burning=true;
   this.emit('spillFire',hole.cylinder,SPILL_FIRE_MESSAGE);
  }
  const evaporation=Math.min(s.oil,(.011*warm+(s.burning?.024:0))*Math.sqrt(s.oil/SPILL_FILM_LIMIT)*dt);
  s.oil-=Math.min(s.oil,evaporation+.025*s.oil*dt);
  s.smoke=approach(s.smoke,clamp(evaporation/(dt*.019),0,1),5,dt);
 }
 advanceCoolantHose(dt){
  const h=this.coolantHose,hole=this.fragments.caseBreach,s=this.exhaustSpill;
  const exposed=s.burning&&hole&&hole.x>=COOLANT_HOSE.left&&hole.x<=COOLANT_HOSE.right;
  h.temp=approach(h.temp,exposed?280+90*clamp(s.oil/.018,0,1):Math.max(this.ambient,this.coolant-15),exposed?1.8:.6,dt);
  if(exposed){
   const before=h.damage;
   h.damage=Math.min(1,before+.18*clamp((h.temp-155)/175,0,1)*dt);
   if(before<=HOSE_RUPTURE&&h.damage>HOSE_RUPTURE)this.emit('coolantHose',hole.cylinder,HOSE_RUPTURE_MESSAGE);
  }
  const opening=damageOpening(h.damage,HOSE_RUPTURE);
  h.runoff=0;h.jetSpeed=0;
  if(!opening||this.coolantLevel<=0)return;
  // The low hose can drain by gravity. Pump head and trapped expansion
  // pressure add to the discharge until the system vents and runs low.
  const wet=clamp(this.coolantLevel/.24,0,1);
  const pressure=wet*(.025+.18*this.waterCircuit.pressure
   +clamp((this.coolant-60)*.019,0,1.1)*(1-.82*opening));
  h.jetSpeed=Math.sqrt(2e5*pressure/1040);
  const volume=this.coolantLevel*6,lost=Math.min(volume,.036*opening*wet*h.jetSpeed*dt);
  this.coolantLevel=(volume-lost)/6;h.runoff=lost/dt;
 }
 advanceHeadGaskets(dt,previousPhase=this.phase){
  const cycling=this.rpm>0;
  this.hydraulicDragNm*=Math.exp(-dt*13);
  const hot=clamp((this.headTemp-140)/45,0,1);
  const gradient=clamp((this.headTemp-this.waterCircuit.cells[1].temp-27)/35,0,1);
  const dry=clamp((.66-this.coolantLevel)/.52,0,1);
  const heatStress=Math.max(dry,clamp((this.headTemp-177)/45,0,1));
  let expelled=0;
  for(const c of this.cylinders){
   const d=c.contact;
   d.boreCoolantFlow=0;
   if(!c.active)continue;
   if(cycling&&this.ignition==='running'){
    d.headWarp=Math.min(.36,d.headWarp+.12*hot*gradient*heatStress*c.susceptibility*dt);
    const gap=clamp((d.headWarp-HEAD_SEAL_WARP_MM)/.11,0,1),before=d.headSeal;
    d.headSeal=Math.min(1,before+gap*(.10+.22*this.throttle)*dt);
    if(before===0&&d.headSeal>0)this.emit('headSeal',c.id,headSealMessage(c.id));
   }
   if(d.headSeal<=0)continue;
   const parked=!cycling&&this.ignition==='off'&&c.cycle.exhaust<.08;
   if(parked||cycling&&c.cycle.intake>.01){
    const wet=clamp(this.coolantLevel/.21,0,1),head=parked?.18+clamp((this.coolant-40)/95,0,.68):Math.max(0,1+this.coolantPressure-c.chamberBar);
    const capacity=this.clearanceLitres*(parked?Math.min(1.45,base.chamberVolume(c.cycle.angle).ratio):1.45);
    const inflow=(parked?.030:.067*c.cycle.intake)*d.headSeal*wet*Math.sqrt(head);
    const charge=Math.min(this.coolantLevel*6,Math.max(0,capacity-d.boreCoolant),inflow*dt);
    this.coolantLevel=Math.max(0,this.coolantLevel-charge/6);
    d.boreCoolant+=charge;d.boreCoolantFlow=charge/dt;
   }
   const wetPlug=clamp(d.boreCoolant/.009+d.boreCoolantFlow*8,0,1);
   d.plugWet=approach(d.plugWet,wetPlug,wetPlug>d.plugWet?3.8:.37,dt);
   if(!cycling)continue;
   this.checkHydraulicCompression(c,previousPhase);
   if(c.cycle.exhaust>.01){
    const hotBore=clamp((d.wallTemp-65)/60,0,1);
    const steam=Math.min(d.boreCoolant,.048*c.cycle.exhaust*hotBore*dt);
    d.boreCoolant-=steam;expelled+=steam;
   }
  }
  this.exhaust.coolantSteam=approach(this.exhaust.coolantSteam,clamp(expelled/(dt*.004),0,1),3.3,dt);
 }
 checkHydraulicCompression(c,previousPhase){
  const d=c.contact,angle=c.cycle.angle,before=base.cycleState(previousPhase,c);
  const crossedTop=before.stroke===3&&c.cycle.stroke===0;
  if(c.cycle.stroke!==3&&!crossedTop){d.hydraulicHit=false;return;}
  if(d.hydraulicHit||d.boreCoolant<=this.clearanceLitres)return;
  const volume=this.clearanceLitres*(crossedTop?1:base.chamberVolume(angle).ratio);
  if(d.boreCoolant<volume)return;
  const excess=clamp((d.boreCoolant/this.clearanceLitres-1)/.45,0,1);
  const level=clamp(.31+excess*.48+this.rpm/8500,.31,1);
  d.hydraulicHit=true;
  const bent=level>.40;
  if(bent)d.rodBend=Math.min(2.5,d.rodBend+1.38*(level-.40));
  this.hydraulicDragNm=Math.max(this.hydraulicDragNm,level*35);
  // A pressure pulse forces some trapped liquid back across the split seal.
  const returned=Math.min(d.boreCoolant-this.clearanceLitres*.81,(1-this.coolantLevel)*6);
  d.boreCoolant-=returned;this.coolantLevel+=returned/6;
  this.emit('hydrolock',c.id,hydrolockMessage(c.id,bent));
  const g=pistonGeometry(this.phase,c,XS[c.id]);
  Object.assign(this.events.at(-1),{level,bent,x:XS[c.id],y:g.top,nx:0,ny:1});
 }
 integrateShaft(dt,t){
  super.integrateShaft(dt,t);
  // Four-stroke mean pump torque: gauge kPa × swept litres per 720°.
  const pumpedLitres=base.SPEC.displacement*.001*(this.build.litres/2)*this.activeCount/this.cylinders.length;
  const exhaustDrag=(this.exhaust?.pressure||0)*pumpedLitres/(2*TAU);
  const loss=Math.min(this.activeCount===1?3.2:28,(this.fragments?.resistance||0)+(this.fragments?.skirtWedgeNm||0)+exhaustDrag+
   (this.timingDrive?.dragNm||0)+(this.skirtBoundaryNm||0)+(this.bearingBoundaryNm||0)+(this.mainBearingDragNm||0)+(this.hydraulicDragNm||0)+(this.preIgnitionDragNm||0));
  this.rpm=Math.max(380,this.rpm-loss/this.shaftInertia*dt*60/TAU);
  this.shaftDriveNm-=loss;this.netTorqueNm-=loss;
 }
 advanceThermal(dt,t,active){
  // The parent thermal step exchanges heat using the coolant inventory. Reduced pump
  // flow leaves part of that heat in the casting instead of transferring it to the coolant.
  const retained=Math.max(-12,(this.block-this.coolant)*2.3*Math.max(.06,this.coolantLevel))*pumpLoss(this)*.8;
  super.advanceThermal(dt,t*this.fuelDelivery,active);
  const elapsed=dt*(this.profile==='stress'?8:1),gaslock=(this.waterCircuit?.vapour??0)*.85;
  this.block=clamp(this.block+(retained/35+gaslock*t*.6)*elapsed,45,265);
  if(retained!==0)this.coolant=clamp(this.coolant-retained*elapsed/24,35,170);
  this.oilTemp=clamp(this.oilTemp+(this.fragments?.resistance??0)*this.rpm/9550*elapsed/80,35,245);
 }
 advanceAuxWear(dt){
  if(this.ignition!=='running')return;
  const elapsed=dt*(this.profile==='stress'?8:.08);
  const speed=clamp((this.rpm-650)/5000,0,1);
  const vibration=clamp(this.mountWear*.4+(this.cylinders.length-this.activeCount)*.22,0,1);
  const lowOil=clamp((1.8-this.oil)/1.8,0,1),debris=clamp(this.fragments.dust/.025,0,1);
  const coolantHeat=clamp((this.coolant-85)/27,0,1);
  const pumpLoad=clamp((this.coolant-92)/38,0,1)*speed+this.waterCircuit.vapour*.85+vibration*.33+this.corrosion*speed*.4;
  const pickupLoad=vibration*(.3+.7*debris)*(.28+.72*lowOil);
  const baffleLoad=clamp((this.exhaust.resonator-200)/230,0,1)*(.18+speed*.37)
   +vibration*.36*clamp((this.exhaust.manifold-350)/240,0,1);
  const radiatorLoad=(vibration*.3+this.waterCircuit.pressure*.24+this.corrosion*.47)*coolantHeat;
  this.wearAuxPart('waterPump',pumpLoad*.014*elapsed);
  this.wearAuxPart('oilPickup',pickupLoad*.017*elapsed);
  this.wearAuxPart('mufflerBaffle',baffleLoad*.010*elapsed);
  this.wearAuxPart('radiator',radiatorLoad*.019*elapsed);
 }
 wearAuxPart(part,amount){
  const before=this.auxWear[part];
  if(before===1)return;
  this.auxWear[part]=Math.min(1,before+amount);
  if(this.auxWear[part]===1)this.emit(part,-1,AUX_FAILURES[part]);
 }
 advanceCylinderParts(dt){
  const speed=clamp((this.rpm-380)/3800,0,1);
  const hotGas=Math.max(0,this.egt-this.headTemp)*(.22+.42*this.throttle)*(.86+.14*speed);
  const running=this.ignition==='running',exposure=dt*this.agingScale*(.15+.85*this.throttle);
  const highSpeed=clamp((this.rpm-6200)/235,0,1);
  let sealChanged=false;
  for(const cy of this.cylinders){
   const loaded=running&&cy.active;
   // Lumped valve-face temperature. The seat rejects heat into the head,
   // while hot exhaust increases the temperature of a firing cylinder's valve.
   cy.exhaustValveTemp=approach(cy.exhaustValveTemp,this.headTemp+(loaded?hotGas:0),.095,dt);
   const d=cy.contact;
   if(this.ignition==='off'){
    d.crownTemp=approach(d.crownTemp,Math.max(35,this.block),.055,dt);
    d.bearingTemp=approach(d.bearingTemp,Math.max(35,this.oilTemp),.045,dt);
   }
   if(!loaded)continue;
   const wear=cy.partWear,elapsed=exposure*cy.susceptibility;
   const boundary=clamp((1.35-d.filmMicron)/1.35,0,1);
   const crownHeat=clamp((d.crownTemp-205)/50,0,1);
   const ringFlutter=this.ringShed[cy.id]?highSpeed:0;
   const dryWall=boundary*clamp((d.wallTemp-105)/70,0,1);
   this.wearCylinderPart(cy,'ringLand',elapsed*.045*(crownHeat*ringFlutter+dryWall*.42));
   this.wearCylinderPart(cy,'skirt',elapsed*.12*boundary*(.16+.84*speed)*clamp((d.wallTemp-100)/80,0,1));
   this.wearCylinderPart(cy,'exhaustValve',elapsed*.0045*(.30+.7*speed)*clamp((cy.exhaustValveTemp-485)/135,0,1));
   if(wear.skirt===1){
    // A damaged skirt drags against the liner whenever the oil film collapses.
    const sliding=boundary*(.12+.88*speed);
    d.liner=Math.min(1,d.liner+sliding*dt*.003);
    d.skirt=Math.min(1,d.skirt+sliding*dt*.004);
    d.wallTemp=clamp(d.wallTemp+dt*sliding*2.8,35,310);
   }
   const sealLoss=(wear.ringLand===1?.13:0)+(wear.exhaustValve===1?.18:0);
   if(sealLoss>0){
    cy.compression=Math.max(cy.last?.22:.1,cy.compression*(1-sealLoss));
    sealChanged=true;
   }
  }
  if(sealChanged)this.refreshCycle();
 }
 wearCylinderPart(cy,part,amount){
  const before=cy.partWear[part];
  if(before===1||amount<=0)return;
  cy.partWear[part]=Math.min(1,before+amount);
  if(cy.partWear[part]<1)return;
  const {kind,zone,message}=CYLINDER_PARTS[part],x=XS[cy.id];
  const top=pistonGeometry(this.phase,cy,x).top;
  const origin=part==='skirt'?[x+39,top+62]:part==='exhaustValve'?[x+24,235]:
   [x+40,Math.max(236,top-3.3)];
  const shard=this.fragments.add(cy.id,kind,zone,...origin);
  if(shard){
   shard.vy=part==='ringLand'?shard.vy:Math.abs(shard.vy)*.55;
   shard.heat=clamp(part==='exhaustValve'?cy.exhaustValveTemp:part==='skirt'?cy.contact.wallTemp:cy.contact.crownTemp,24,390);
  }
  this.emit(part,cy.id,`Цилиндр ${cy.id+1}: ${message}.`);
 }
 ageOil(dt){
  if(this.ignition!=='running'||this.oil<.01)return;
  const hot=clamp((this.oilTemp-100)/85,0,1);
  const blowby=this.cylinders.reduce((sum,cy)=>{
   if(!cy.active)return sum;
   return sum+(1-cy.compression)*.25+cy.partWear.ringLand*.18;
  },0);
  const particles=clamp(this.fragments.dust/.04,0,1);
  const contamination=clamp((blowby*.65+particles*.35)*this.throttle,0,1);
  // Oxidation accumulates under heat and contamination. A cool sump still
  // contains the same degraded oil after shutdown.
  const exposure=dt*(this.profile==='stress'?8:1)*(hot*hot*.0016+contamination*.0012);
  this.oilOxidation=Math.min(1,this.oilOxidation+exposure*(1-this.oilOxidation));
 }
 advanceExhaustJoint(dt){
  const e=this.exhaust,previous=e.manifold-e.flangeTemp;
  e.manifold=approach(e.manifold,this.headerTemp,.12,dt);
  const temperature=this.ambient+.64*(e.manifold-this.ambient)+.12*(e.resonator-this.ambient);
  e.flangeTemp=approach(e.flangeTemp,temperature,.095,dt);
  if(e.sealWear<1){
   const hot=clamp((e.flangeTemp-315)/150,0,1);
   // Relative travel follows metal expansion on both heating and cooling.
   // Exhaust pulses and worn mounts add small sliding loads during operation.
   const travel=Math.abs(e.manifold-e.flangeTemp-previous)*.0015;
   const moving=this.ignition==='running'?clamp((this.recoil*.6+e.pulse*.4)*(.22+.78*this.mountWear),0,1):0;
   const exposure=(travel*.038+dt*hot*.010+dt*moving*.004)*hot;
   e.sealWear=Math.min(1,e.sealWear+exposure*this.agingScale);
   if(e.sealWear===1)this.emit('exhaustSeal',-1,EXHAUST_SEAL_FAILURE);
  }
  this.updateExhaustGap();
 }
 updateExhaustGap(){
  const e=this.exhaust,wear=e.sealWear,structure=this.components.exhaust;
  // Equivalent contact travel, in millimetres. Compression in the bolted
  // joint absorbs distortion until the gasket loses enough of its thickness.
  const preload=.55*(1-.76*wear);
  const warped=Math.abs(e.manifold-e.flangeTemp)*.0015;
  const pulses=this.ignition==='running'?e.pulse*.036+e.pressure*.003:0;
  const sealGap=Math.max(0,warped+pulses+.18*wear*wear-preload);
  e.jointGap=clamp(sealGap+.52*damageOpening(structure,.72),0,1.2);
  e.leak=.65*structure+.32*(1-structure)*clamp(sealGap/.7,0,1);
 }
 skirtContactPoint(cy){
  const x=XS[cy.id],phase=cy.active?this.phase:cy.freeze;
  const g=pistonGeometry(phase,cy,x);
  return {x:x+48*cy.contact.thermalSide,y:clamp(g.top+50,232,414)};
 }
 pistonSkewAngle(cy){
  return -Math.atan(cy.contact.rodBend/base.SPEC.rod)*(.98+.19*Math.sin(cy.cycle.angle));
 }
 skewContactPoint(cy){
  const x=XS[cy.id],g=pistonGeometry(cy.active?this.phase:cy.freeze,cy,x);
  return {x:x+48,y:clamp(g.top+52,232,414)};
 }
 advanceSkewContact(dt,cy){
  const d=cy.contact;
  if(!d.rodBend)return;
  if(!cy.active){d.skewBind=0;d.skewSeized=false;return;}
  const moving=this.ignition==='running'&&this.rpm>1;
  const interference=Math.max(0,Math.abs(this.pistonSkewAngle(cy))*28-d.clearance*.5+.045*d.skewScuff);
  const bite=clamp((d.skewScuff-.27)/.38,0,1)*clamp(interference/.095,0,1)*(.11+.89*this.throttle);
  d.skewBind=approach(d.skewBind,moving?bite:0,3.5,dt);
  let event;
  if(d.skewSeized&&d.skewBind<.18){d.skewSeized=false;event='skewFree';}
  else if(!d.skewSeized&&moving&&d.skewBind>.58){d.skewSeized=true;event='skewSeize';}
  const {x,y}=this.skewContactPoint(cy);
  if(event){
   this.emit(event,cy.id,`Цилиндр ${cy.id+1}: ${SKEW_EVENTS[event]}`);
   Object.assign(this.events.at(-1),{x,y,nx:-1,ny:0,level:d.skewBind});
  }
  if(!moving||!interference)return;
  const angle=cy.cycle.angle,sin=Math.sin(angle),ratio=CRANK_ROD_RATIO*sin;
  const travel=base.SPEC.stroke/2000*Math.abs(sin*(1+CRANK_ROD_RATIO*Math.cos(angle)/Math.sqrt(1-ratio*ratio)));
  const dry=clamp(1-d.filmMicron/2.1,0,1);
  const friction=Math.min(850,interference*5100)*(.07+.17*dry)*(d.skewSeized?1+1.85*d.skewBind:1);
  const torque=friction*travel,work=torque*this.rpm*TAU/60*dt;
  this.skirtBoundaryNm+=torque;
  d.wallTemp=Math.min(310,d.wallTemp+work*.63/520);
  d.skirtTemp=Math.min(310,d.skirtTemp+work*.37/430);
  const wear=work/6800;
  d.skewScuff=Math.min(1,d.skewScuff+wear);
  d.liner=Math.min(1,d.liner+wear*.15);d.skirt=Math.min(1,d.skirt+wear*.21);
  this.fragments.dust=Math.min(1,this.fragments.dust+wear*.0007);
  this.fragments.markLiner(cy.id,1,Math.max(232,y-13),Math.min(414,y+5),wear*.8,'skew');
 }
 advancePistonThermal(dt,cy){
  const d=cy.contact,jet=this.oilCircuit.pistonJets?.[cy.id];
  if(cy.active&&jet?.hitFlow>0){
   // Heat removed at the undercrown returns with the oil. Mass flow is kg/s.
   const feedTemp=jet.temp??this.oilCircuit.cells[3].temp;
   const transferKW=jet.hitFlow*.86/60*1.95*.52*(d.crownTemp-feedTemp);
   const energy=transferKW*dt;
   d.crownTemp=clamp(d.crownTemp-energy/CROWN_HEAT_CAPACITY,35,390);
   this.oilTemp=clamp(this.oilTemp+energy/(8+8*clamp(this.oil/4.6,0,1)),24,245);
  }
  // Hot gas leaking through the ring pack heats the piston below the crown.
  if(cy.active&&this.ignition==='running'&&d.ringSeizures>1)
   d.skirtTemp=Math.min(310,d.skirtTemp+.06*(d.ringSeizures-1)*Math.max(0,cy.chamberBar-1)*dt);
  d.skirtTemp=approach(d.skirtTemp,initialSkirtTemp(d),.22,dt);
  d.clearance=skirtClearance(d);
  if(!cy.active){d.thermalBind=0;d.thermalSeized=false;return;}
  const sliding=this.ignition==='running'&&this.rpm>1100;
  const interference=clamp(-d.clearance/.076,0,1);
  d.thermalBind=approach(d.thermalBind,interference,interference>d.thermalBind?5:7,dt);
  let event;
  if(d.thermalSeized){
   if(d.clearance>.012&&d.thermalBind<.035){
    d.thermalSeized=false;d.skirtCycled||=d.skirtFatigue>0;event='pistonFree';
   }
  }else if(sliding&&d.thermalBind>.075&&(jet?.hitFlow??0)<.24&&this.throttle>.52){
   const thrust=Math.sin(cy.cycle.angle)*(cy.chamberBar-1);
   d.thermalSide=thrust<0?-1:1;
   d.thermalSeized=true;event='pistonSeize';
  }
  if(event){
   this.emit(event,cy.id,`Цилиндр ${cy.id+1}: ${PISTON_THERMAL_EVENTS[event]}`);
   Object.assign(this.events.at(-1),this.skirtContactPoint(cy),{nx:-d.thermalSide,ny:0,level:d.thermalBind});
  }
  if(!d.thermalSeized||!sliding||interference<=0)return;
  const a=cy.cycle.angle,sin=Math.sin(a),cos=Math.cos(a),ratio=CRANK_ROD_RATIO*sin;
  const omega=this.rpm*TAU/60;
  const travel=base.SPEC.stroke/2000*Math.abs(sin*(1+CRANK_ROD_RATIO*cos/Math.sqrt(1-ratio*ratio)));
  const squeeze=clamp(1-d.filmMicron/2.4,0,1),force=interference*(760+950*interference)*(.10+.13*squeeze);
  const work=force*omega*travel*dt;
  this.skirtBoundaryNm+=force*travel;
  d.skirtTemp=Math.min(310,d.skirtTemp+work*.56/430);
  d.wallTemp=Math.min(310,d.wallTemp+work*.44/520);
  const wear=work/18000;
  d.skirt=Math.min(1,d.skirt+wear*.32);d.liner=Math.min(1,d.liner+wear*.29);
  this.fragments.dust=Math.min(1,this.fragments.dust+wear*.003);
  const {y}=this.skirtContactPoint(cy);
  this.fragments.markLiner(cy.id,d.thermalSide,Math.max(232,y-11),Math.min(414,y+9),wear,'skirt');
  this.advanceSkirtFatigue(cy,work);
  d.clearance=skirtClearance(d);
 }
 noteRingSeizure(cy){
  const d=cy.contact;
  if(d.ringSeizures===3)return;
  const stage=++d.ringSeizures-1;
  if(stage===0)return;
  if(stage===1)d.ringBreakSide=d.skewSeized?1:d.thermalSide;
  const side=d.ringBreakSide,x=XS[cy.id]+side*41,g=pistonGeometry(this.phase,cy,XS[cy.id]);
  const shard=this.fragments.add(cy.id,'ring','chamber',x,Math.max(236,g.top-4),1.65);
  if(shard)shard.vx=-side*Math.abs(shard.vx);
  if(stage===2)this.fragments.add(cy.id,'ring','case',XS[cy.id]+side*42,clamp(g.top+64,425,474),1.65);
  this.ringShed[cy.id]=true;
  this.emit('ringFracture',cy.id,ringFractureMessage(cy.id,stage));
  Object.assign(this.events.at(-1),{stage,x,y:g.top+9,nx:-side,ny:0});
  this.refreshCycle();
 }
 advanceRingOil(dt){
  let expelled=0;
  // Hot running sheds more residue at the exposed plug tip. EGT is a proxy here.
  const plugRetention=1-.88*clamp((this.egt-450)/170,0,1);
  if(this.ignition==='running')for(const cy of this.cylinders){
   const d=cy.contact,breaks=d.ringSeizures-1;
   if(!cy.active||breaks<=0)continue;
   // Draw from the wall film on intake, burn on a firing stroke and clear through the exhaust valve.
   const wet=clamp(this.oil/.45,0,1)*clamp(.3+d.filmMicron/2,0,1);
   const vacuum=clamp(1-this.manifoldBar,0,1),speed=clamp(this.rpm/1000,.35,2.8);
   const pumped=(breaks===1?.0015:.0042)*wet*speed*(.55+vacuum)*cy.cycle.intake*dt;
   const charge=Math.min(this.oil,Math.max(0,BORE_OIL_LIMIT-d.boreOil-d.boreOilVapour),pumped);
   this.oil-=charge;d.boreOil+=charge;
   if(cy.lit&&cy.cycle.stroke===0){
    const burnt=d.boreOil*(1-Math.exp(-dt*24));
    d.boreOil-=burnt;d.boreOilVapour+=burnt;this.burnedOil+=burnt;
    const before=d.plugCarbon;
    d.plugCarbon=Math.min(1,before+burnt*plugRetention/.019);
    d.crownCarbon=Math.min(1,d.crownCarbon+burnt/.029);
    if(before<FOULED_PLUG_CARBON&&d.plugCarbon>=FOULED_PLUG_CARBON)this.emit('plugFouling',cy.id,plugFoulingMessage(cy.id));
   }
   const out=d.boreOilVapour*(1-Math.exp(-dt*26*cy.cycle.exhaust));
   d.boreOilVapour-=out;expelled+=out;
  }
  this.exhaust.ringOil=approach(this.exhaust.ringOil,clamp(expelled/(dt*.00065),0,1),2.8,dt);
 }
 advanceRingScoring(previousPhase){
  const arc=(this.phase-previousPhase+2*TAU)%(2*TAU);
  if(!arc)return;
  for(const scar of this.fragments.linerScuffs){
   if(scar.kind&&scar.kind!=='wedge'&&scar.kind!=='strike')continue;
   const i=scar.cylinder,cy=this.cylinders[i],d=cy.contact;
   if(!cy.active)continue;
   const from=pistonGeometry(previousPhase,cy).top,to=pistonGeometry(this.phase,cy).top;
   // A step may cross a dead centre and return to the same height.
   const angle=previousPhase-cy.offset,turn=(Math.floor(angle/Math.PI)+1)*Math.PI;
   const mid=turn<angle+arc?pistonGeometry(turn+cy.offset,cy).top:to;
   const rate=scar.depth*(.32+.68*clamp(1-d.filmMicron/3,0,1))*.00085;
   for(let k=0;k<RING_HEIGHTS.length;k++){
    if(!hasRingFace(cy,this.ringShed[i],scar.side,k))continue;
    const lo=scar.top-RING_HEIGHTS[k],hi=scar.bottom-RING_HEIGHTS[k];
    const a=clamp(from,lo,hi),b=clamp(mid,lo,hi),c=clamp(to,lo,hi);
    const face=(scar.side<0?0:4)+k;
    d.ringFaces[face]=Math.min(1,d.ringFaces[face]+rate*(Math.abs(b-a)+Math.abs(c-b)));
   }
  }
 }
 advanceSkirtFatigue(cy,work){
  const d=cy.contact,before=d.skirtFatigue;
  // The first scuff leaves a stress riser. Once the skirt unloads, the next
  // interference cycle can propagate a crack with further sliding work.
  d.skirtFatigue=Math.min(d.skirtCycled?1:SKIRT_CRACK_FATIGUE*.8,before+work/SKIRT_FATIGUE_WORK_J);
  if(before<SKIRT_CRACK_FATIGUE&&d.skirtFatigue>=SKIRT_CRACK_FATIGUE){
   d.skirtSide=d.thermalSide;
   this.emit('skirtCrack',cy.id,`Цилиндр ${cy.id+1}: ${PISTON_THERMAL_EVENTS.skirtCrack}`);
  }
  const threshold=SKIRT_CHIP_FATIGUE[d.skirtChips];
  if(threshold===undefined||d.skirtFatigue<threshold||this.fragments.bodies.length>=CAP)return;
  // The flake starts at the skirt edge and falls along the liner.
  const r=SKIRT_FLAKE_RADII[d.skirtChips],x=XS[cy.id]+39*d.skirtSide;
  const top=pistonGeometry(this.phase,cy,XS[cy.id]).top;
  const shard=this.fragments.add(cy.id,'skirt','liner',x,top+62);
  this.fragments.shrink(shard,r);shard.jamRadius=r;
  shard.heat=d.skirtTemp;shard.vy=Math.abs(shard.vy)*.55;
  d.skirtChips++;
  d.play=Math.min(MAX_PISTON_PLAY_MM,d.play+.003);
  this.emit('skirtChip',cy.id,`Цилиндр ${cy.id+1}: ${PISTON_THERMAL_EVENTS.skirtChip}`);
  this.events.at(-1).fragmentId=shard.id;
 }
 advancePistonContact(dt,cy,rubbing){
  if(!cy.active||this.rpm<=1)return;
  const d=cy.contact,dry=clamp((1.35-d.filmMicron)/1.35,0,1);
  const loose=(d.play-PISTON_CLEARANCE_MM)/(MAX_PISTON_PLAY_MM-PISTON_CLEARANCE_MM);
  let skirtWork=0;
  if(dry>0&&this.ignition==='running'){
   const angle=cy.cycle.angle,speed=clamp(this.rpm/6500,0,1),sin=Math.sin(angle),cos=Math.cos(angle);
   const obliquity=CRANK_ROD_RATIO*sin,rodProjection=Math.sqrt(1-obliquity*obliquity);
   // The angled rod transfers gas thrust and reciprocating inertia onto the skirt.
   // Scale both the side force and the sliding velocity to bounded wear rates.
   const axial=(cy.chamberBar-1)/34-.22*cos*speed*speed;
   const thrust=clamp(Math.abs(sin*axial)/rodProjection,0,1);
   const travel=Math.abs(sin*(1+CRANK_ROD_RATIO*cos/rodProjection))*speed;
   // Sliding power is tangential force times actual piston speed, with the
   // boundary fraction set by oil film. The bore takes most of this heat.
   const omega=this.rpm*TAU/60,r=base.SPEC.stroke/2000;
   const force=Math.abs(obliquity/rodProjection*axial*34e5)*Math.PI*(base.SPEC.bore/2000)**2;
   const slidingSpeed=omega*r*Math.abs(sin*(1+CRANK_ROD_RATIO*cos/rodProjection));
   const watts=Math.min(2600,force*slidingSpeed*dry*(.085+.055*loose));
   this.skirtBoundaryNm=(this.skirtBoundaryNm??0)+watts/omega;
   d.wallTemp=Math.min(310,d.wallTemp+watts*dt*.72/520);
   skirtWork=dt*this.agingScale*dry*thrust*travel*(1+.55*loose);
  }
  const chipWork=dt*rubbing*(.45+.55*dry);
  if(skirtWork+chipWork<=0)return;
  const hot=clamp((d.wallTemp-115)/132,0,1);
  const stress=clamp(d.liner*.52+d.skirt*.24+loose*.35+hot*.45-.09,0,1);
  d.play=Math.min(MAX_PISTON_PLAY_MM,d.play+skirtWork*.009+chipWork*.024);
  d.liner=Math.min(1,d.liner+skirtWork*.011+chipWork*.016);
  // A hot, already scored surface concentrates alternating loads at a crack tip.
  d.crack=Math.min(1,d.crack+(skirtWork*.021+chipWork*.070)*stress);
 }
 advancePistonSlap(dt,cy){
  const motion=this.#pistonMotion[cy.id],d=cy.contact,excess=d.play-PISTON_CLEARANCE_MM;
  if(!cy.active||this.ignition!=='running'||this.rpm<=1||excess<=0){
   motion.offset=motion.velocity=motion.seat=0;
   return;
  }
  const angle=cy.cycle.angle,speed=clamp(this.rpm/6500,0,1),sin=Math.sin(angle);
  const obliquity=CRANK_ROD_RATIO*sin,rod=Math.sqrt(1-obliquity*obliquity);
  const axial=(cy.chamberBar-1)/34-.22*Math.cos(angle)*speed*speed;
  // Side force carries the skirt across the clearance. Squeeze damping
  // slows lateral travel and absorbs part of the impact at the liner.
  const film=clamp(d.filmMicron/4,0,1),drag=12+48*film;
  const terminal=3600*clamp(sin*axial/rod,-1,1)/drag;
  const deltaV=motion.velocity-terminal,decay=Math.exp(-drag*dt);
  const travel=terminal*dt+deltaV*(1-decay)/drag,position=motion.offset+travel,halfGap=d.play*.5;
  if(Math.abs(position)<halfGap){
   motion.offset=position;motion.velocity=terminal+deltaV*decay;
   return;
  }
  const side=Math.sign(position),crossed=motion.seat===-side;
  const start=motion.offset;
  motion.offset=side*halfGap;motion.velocity=0;motion.seat=side;
  if(!crossed)return;
  const fraction=travel?clamp((motion.offset-start)/travel,0,1):0;
  const impactSpeed=Math.abs(terminal+deltaV*Math.exp(-drag*dt*fraction));
  const level=clamp(Math.sqrt(excess/.085)*clamp(impactSpeed/9,0,1)*(1-.56*film)*(.6+.4*speed),0,1);
  if(level<.035)return;
  const x=XS[cy.id],p=pistonGeometry(this.phase,cy,x);
  this.events.push({type:'pistonSlap',cylinder:cy.id,time:this.time,level,x:x+side*48,y:p.top+47,nx:-side,ny:0});
  if(this.events.length>32)this.events.shift();
 }
 advanceMainBearings(dt,bearingLubrication){
  this.mainBearingDragNm=0;
  const running=this.ignition==='running'&&this.rpm>1,speed=clamp(this.rpm/6500,0,1);
  const required=.71+.83*speed+.31*this.throttle;
  const delivery=clamp(Math.min(this.pressure/required,bearingLubrication/(.18+.59*speed)),0,1);
  const leaking=this.crankSeals.some(s=>crankSealOpening(s.wear)>0);
  const reserve=leaking?clamp((2.4-this.oil)/1.4,0,1):0;
  const filmLoss=reserve*clamp((.58-delivery)/.58,0,1);
  const cooling=this.oilCircuit.cells[4].temp*delivery+this.block*(1-delivery);
  const radians=this.rpm*TAU/60*dt;
  let strongest=null;
  for(let i=0;i<this.mainBearings.length;i++){
   const b=this.mainBearings[i];
   b.temp=approach(b.temp,running?cooling:this.block,running?.026+.29*delivery:.044,dt);
   if(!running){b.seat=0;b.offset=approach(b.offset,0,8,dt);continue;}
   const left=this.cylinders[i-1],right=this.cylinders[i];
   const pressure=Math.max(0,(left?.chamberBar??1)-1)+Math.max(0,(right?.chamberBar??1)-1);
   const gasLoad=clamp(pressure/23,0,1);
   const radial=.10+(.20*this.throttle+.50*gasLoad)*(left?.active||right?.active?1:.38)+.21*speed**2;
   const hot=clamp((b.temp-112)/67,0,1),contact=filmLoss*(.39+.61*hot);
   const drag=Math.min(2.2,(.39+3.8*radial)*contact*(1+.38*b.wear));
   const work=drag*radians;
   b.temp=Math.min(285,b.temp+work*.72/12);
   this.mainBearingDragNm+=drag;
   const before=b.wear;
   b.wear=Math.min(1,b.wear+work*(.20+.80*hot)/3300);
   b.clearance=MAIN_CLEARANCE_MM+MAIN_CLEARANCE_WEAR_MM*b.wear;
   if(before<MAIN_WEAR_WARNING&&b.wear>=MAIN_WEAR_WARNING){
    this.emit('mainBearingWear',-1,mainBearingMessage(i));
    this.events.at(-1).bearing=i;
   }
   // The journal changes seats when the neighboring throws load and unload it.
   const seating=.024+.071*speed;
   const loaded=gasLoad>seating*(b.seat>0?.51:1),rebound=b.seat===-1&&loaded;
   b.seat=loaded?1:-1;
   const travel=(b.clearance-MAIN_CLEARANCE_MM)*.5;
   b.offset=approach(b.offset,b.seat*travel,29,dt);
   if(!rebound||travel<.008||this.throttle<.15)continue;
   const level=clamp(Math.sqrt(travel/.095)*(.32+.68*filmLoss)*this.throttle*(.54+.46*gasLoad),0,1);
   if(level>.035&&(!strongest||level>strongest.level))strongest={type:'mainBearingKnock',cylinder:-1,bearing:i,time:this.time,level,x:BEARING_CAPS[i],y:460,nx:0,ny:1};
  }
  if(strongest){
   this.events.push(strongest);
   if(this.events.length>32)this.events.shift();
  }
 }
 advanceBearingContact(dt,cy,bearingLubrication){
  const d=cy.contact;
  if(cy.active&&d.bearingSpun&&this.rpm>1)
   d.bearingSpinAngle=(d.bearingSpinAngle+this.rpm*TAU/60*.84*dt)%TAU;
  if(!cy.active||this.ignition!=='running'||this.rpm<=1){
   this.#bearingLoaded[cy.id]=null;return;
  }
  const speed=clamp(this.rpm/6500,0,1);
  const neededPressure=1.2+speed*(.9+1.1*this.engineLoad);
  const pressureLoss=clamp(1-this.pressure/neededPressure,0,1);
  const filmLoss=.6*pressureLoss+.4*(1-bearingLubrication*(d.bearingSpun?.42:1));
  const supplyLoss=clamp(1-this.oilCircuit.pickupDelivery*this.oilCircuit.foamDelivery+this.oilCircuit.filterPressureLoss/neededPressure,0,1);
  const angle=cy.cycle.angle,axial=(cy.chamberBar-1)/34-.22*Math.cos(angle)*speed*speed;
  // A starved gallery loses both film strength and the oil's ability to carry heat away.
  const work=dt*Math.min(supplyLoss,filmLoss)*this.engineLoad*speed;
  d.bearingTemp=clamp(d.bearingTemp+work*(34+50*d.bearing),35,290);
  const hot=clamp((d.bearingTemp-114)/90,0,1);
  d.bearing=Math.min(1,d.bearing+work*(1+.25*this.agingScale)*(.013+.014*hot));
  this.advanceBearingWipe(dt,cy,filmLoss,axial);
  const wasLoaded=this.#bearingLoaded[cy.id];
  const loaded=axial>(wasLoaded?.13:.265);
  this.#bearingLoaded[cy.id]=loaded;
  const extraPlay=(d.bearingClearance-BEARING_CLEARANCE_MM)/JOURNAL_CLEARANCE_GAIN_MM;
  const clearance=Math.max(0,d.bearing-.045+(d.bearingSpun?.09+.23*extraPlay:0));
  if(!loaded||wasLoaded!==false||!clearance||this.engineLoad<.16)return;
  // Once unloaded, the clearance can be taken up again as compression loads the rod.
  const level=clamp(Math.sqrt(clearance/.24)*(.30+.70*filmLoss)*this.engineLoad*(.5+.5*speed)*(d.bearingSpun?1.24:1),0,1);
  if(level<.035)return;
  if(d.bearingSpun&&this.advanceRodFatigue(cy,level,speed))return;
  const p=pistonGeometry(this.phase,cy,XS[cy.id]),nx=(p.crankX-p.x)/base.SPEC.rod;
  const ny=(p.crankY-p.pinY)/base.SPEC.rod;
  this.events.push({type:'bearingKnock',cylinder:cy.id,time:this.time,level,x:p.crankX+nx*18,y:p.crankY+ny*18,nx,ny});
  if(this.events.length>32)this.events.shift();
 }
 advanceBearingWipe(dt,cy,filmLoss,axial){
  const d=cy.contact,wipe=d.bearingWipe;
  const boundary=clamp((filmLoss-.34)/.66,0,1);
  const softening=clamp((d.bearingTemp-122)/55,0,1);
  const scoring=clamp((d.bearing-.08)/.26,0,1);
  const metalContact=boundary*softening*clamp(.26*scoring+1.34*wipe,0,1);
  if(!metalContact&&!d.bearingSpun)return;
  // Radial rod load acts on the rotating journal. Joules of friction heat
  // also remove material, so a wiped layer grows faster than a scored one.
  const radialLoad=BEARING_LOAD_N*Math.abs(axial);
  const dragNm=Math.min(d.bearingSpun?10:8,radialLoad*JOURNAL_RADIUS_M*(.08*metalContact+(d.bearingSpun?.023:0)));
  const rotation=this.rpm*TAU/60*dt,workJ=dragNm*rotation;
  this.bearingBoundaryNm+=dragNm;
  d.bearingTemp=Math.min(290,d.bearingTemp+workJ*.58/180);
  if(wipe===1){
   if(d.bearingSpun){
    d.bearing=Math.min(1,d.bearing+workJ/42000);
    const loss=Math.min(1-d.journalScoring,workJ*(.45+.55*filmLoss)/JOURNAL_SCORING_WORK_J);
    d.journalScoring+=loss;
    d.bearingClearance=BEARING_CLEARANCE_MM+(d.bearingBasePlay||0)+JOURNAL_CLEARANCE_GAIN_MM*d.journalScoring;
    this.fragments.dust=Math.min(1,this.fragments.dust+loss*.004);
   }
   else this.advanceBearingSeat(cy,dragNm,rotation);
   return;
  }
  const workLimit=9500/(.75+.25*this.agingScale);
  const liningLost=clamp(workJ*(.35+.65*softening)/workLimit,0,1-wipe);
  d.bearingWipe=Math.min(1,wipe+liningLost);
  this.fragments.dust=Math.min(1,this.fragments.dust+liningLost*.003);
  if(d.bearingWipe<1)return;
  const g=pistonGeometry(this.phase,cy,XS[cy.id]);
  // A sliver leaves at the cap split, outside the journal's swept disc.
  const nx=-(g.crankY-g.pinY)/base.SPEC.rod,ny=(g.crankX-g.x)/base.SPEC.rod;
  const x=g.crankX+nx*22,y=clamp(g.crankY+ny*22,420,545);
  const p=this.fragments.add(cy.id,'bearing','case',x,y);
  if(p){
   this.fragments.shrink(p,2.7);p.jamRadius=p.r;p.heat=d.bearingTemp;
   p.vx=nx*46;p.vy=ny*46+15;
  }
  this.emit('bearingWipe',cy.id,bearingWipeMessage(cy.id));
  Object.assign(this.events.at(-1),{x,y,nx,ny,level:.86});
 }
 advanceBearingSeat(cy,dragNm,rotation){
  const d=cy.contact,softSeat=clamp((d.bearingTemp-145)/75,0,1);
  // Journal traction works against the shell's press fit. Only excess
  // torque on a hot, wiped bearing can progressively loosen its seat.
  const holdingNm=(3.6+2.6*d.bearingGrip)*(1-.48*softSeat);
  const slipWork=Math.max(0,dragNm-holdingNm)*rotation*softSeat;
  d.bearingGrip=Math.max(0,d.bearingGrip-slipWork/BEARING_SEAT_WORK_J);
  if(d.bearingGrip>0||slipWork===0)return;
  d.bearingSpun=true;d.bearingSpinAngle=rotation%TAU;
  const g=pistonGeometry(this.phase,cy,XS[cy.id]);
  const nx=(g.crankX-g.x)/base.SPEC.rod,ny=(g.crankY-g.pinY)/base.SPEC.rod;
  this.emit('bearingSpin',cy.id,bearingSpinMessage(cy.id));
  Object.assign(this.events.at(-1),{x:g.crankX,y:g.crankY,nx,ny,level:1});
 }
 advanceRodFatigue(cy,impact,speed){
  const d=cy.contact;
  const play=clamp((d.bearingClearance-ROD_IMPACT_CLEARANCE_MM)/.140,0,1);
  const cylinderLoad=this.engineLoad*4/this.activeCount;
  const load=clamp((cylinderLoad-.48)/.52,0,1)*clamp((this.throttle-.42)/.58,0,1);
  if(play===0||load===0)return false;
  // The rod picks up the growing gap with a blow each time the load returns.
  d.rodFatigue=Math.min(1,d.rodFatigue+.062*play*play*load*impact*(.45+.55*speed)*cy.susceptibility);
  if(d.rodFatigue<1||!this.failCylinder(cy,'rod',bearingRodFailureMessage(cy.id)))return false;
  cy.lit=false;cy.pulse=cy.misfire=0;
  const survivor=this.activeCount===1?this.cylinders.find(c=>c.active):null;
  if(survivor)survivor.last=true;
  this.refreshCycle();
  return true;
 }
 applyEdgeChip(e){
  const bearing=e.edge==='cap'||e.edge==='case',d=this.cylinders[e.cylinder]?.contact;
  if(d){
   const level=clamp(e.level,0,1);
   if(bearing)d.bearing=Math.min(1,d.bearing+level*.045);
   else{
    d.liner=Math.min(1,d.liner+level*.028);
    d.skirt=Math.min(1,d.skirt+level*.018);
    d.crack=Math.min(1,d.crack+level*.02);
   }
  }
  const part={cap:'крышки подшипника',case:'картера',liner:'гильзы',head:'головки цилиндра'}[e.edge];
  this.events.push({...e,time:this.time,message:`Осколок выбил кромку ${part}`});
  if(this.events.length>32)this.events.shift();
 }
 step(dt,g=0,b=0){if(!Number.isFinite(dt)||dt<=0)return;dt=Math.min(dt,.05);
  const coolantBefore=this.coolantLevel,previousPhase=this.phase;
  const rail=clamp((this.fuel-.08)/.72,0,1);
  this.fuelDelivery=approach(this.fuelDelivery,.035+.965*rail,4,dt);
  super.step(dt,g,b);
  // The pedal outruns the intake on a snap opening, but tracks it on a slow sweep.
  const demand=this.gasCommand-this.throttle;
  if(demand<.07||this.ignition!=='running')this.tipInLatched=false;
  if(!this.tipInLatched&&this.ignition==='running'&&this.gasCommand>.32&&demand>.21){
   this.tipInLatched=true;
   if(!this.revCut&&!this.overrun&&this.fuelDelivery>.12){
    const level=clamp(.32+demand*.84,0,1)*this.fuelDelivery*(.55+.45*this.activeCount/this.cylinders.length);
    this.events.push({type:'tipIn',level,time:this.time});
    if(this.events.length>32)this.events.shift();
   }
  }
  if(this.ignition==='running'){
   this.fuelLh*=this.fuelDelivery;
   this.fuel=Math.max(0,this.fuel-this.fuelLh*dt/3600);
  }
  const runoff=this.film*(1-Math.exp(-dt*(.045+clamp((this.oilTemp-65)/150,0,1)*.19)));
  this.film-=runoff;this.oilRunoff=runoff/dt+this.leakRate*.30;
  const liquidFraction=1-clamp((this.coolant-100)/26,0,1);
  this.coolantRunoff=Math.max(0,coolantBefore-this.coolantLevel)*6/dt*liquidFraction*clamp(this.gasket*3,0,1);
  this.advanceRadiatorLeak(dt);
  this.oilCircuit.setInventory(this.oil);
  const previousBreach=this.fragments.caseBreach;
  this.advanceRingScoring(previousPhase);
  this.fragments.step(dt,this);
  const hole=this.fragments.caseBreach;
  if(hole&&!previousBreach){
   this.emit('caseBreach',hole.cylinder,CASE_BREACH_MESSAGE);
   Object.assign(this.events.at(-1),{x:hole.x,y:OIL_PAN.floor,nx:0,ny:-1,level:1});
  }
  this.advanceCaseLeak(dt);
  this.advanceExhaustSpill(dt);
  this.advanceCoolantHose(dt);
  this.advanceHeadGaskets(dt,previousPhase);
  this.advanceRingOil(dt);
  this.advanceCrownDeposits(dt);
  this.advanceCrankSeals(dt);
  this.oilCircuit.step(dt,this,this.fragments.dust);this.waterCircuit.step(dt,this,0);this.collisionCooldown=Math.max(0,this.collisionCooldown-dt);
  const ratio=this.timingDrive.torqueFactor;
  this.timingDrive.step(dt,this);
  if(ratio!==this.timingDrive.torqueFactor)this.refreshCycle();
  if(this.fragments.events.length){
   const ev=this.fragments.events.splice(0);
   for(const e of ev)if(e.type==='edgeChip')this.applyEdgeChip(e);
   if(this.collisionCooldown<=0){
    const e=ev.find(x=>x.type==='jam')||ev.find(x=>x.type==='impact');
    if(e){
     this.events.push({...e,time:this.time,message:e.type==='jam'?'Осколок зажат между деталями':'Удар осколка внутри блока'});
     if(this.events.length>32)this.events.shift();
     this.collisionCooldown=.09;
    }
   }
  }
  const bearing=this.oilCircuit.cells[4],filmQuality=1-.86*this.oilCircuit.pumpAeration;
  const bearingCooling=Math.min(.16,bearing.flow*.006)*filmQuality;
  const bearingLubrication=clamp(bearing.flow/8,0,1)*filmQuality;
  this.skirtBoundaryNm=0;this.bearingBoundaryNm=0;
  this.advanceMainBearings(dt,bearingLubrication);
  for(const cy of this.cylinders){if(!this.ringShed[cy.id]&&cy.active&&cy.wear>.46+.52*this.build.wear){this.ringShed[cy.id]=true;const g=pistonGeometry(this.phase,cy,XS[cy.id]);this.fragments.add(cy.id,'ring','chamber',XS[cy.id]+44,Math.max(235,g.top-6));}
   if(cy.active&&this.benchFaultOn('piston','heat',cy.id)){
    const d=cy.contact;
    d.skirtTemp+=Math.min(dt*55,Math.max(0,260-d.skirtTemp));
    d.crownTemp+=Math.min(dt*38,Math.max(0,320-d.crownTemp));
   }
   const rubbing=this.fragments.rubByCylinder[cy.id];
   if(bearingCooling>0)cy.contact.bearingTemp=approach(cy.contact.bearingTemp,bearing.temp,bearingCooling*(cy.contact.bearingSpun?.42:1),dt);
   const bearingWork=Math.min(dt,this.fragments.bearingWork[cy.id]);
   if(bearingWork>0&&this.rpm>0){
    cy.contact.bearing=clamp(cy.contact.bearing+bearingWork*(.006+.018*(1-bearingLubrication)),0,1);
    cy.contact.bearingTemp=clamp(cy.contact.bearingTemp+bearingWork*14,35,290);
   }
   this.advanceBearingContact(dt,cy,bearingLubrication);
   if(cy.active&&rubbing&&this.rpm>0){
    cy.contact.wallTemp=clamp(cy.contact.wallTemp+rubbing*dt*12,35,310);
    cy.contact.liner=clamp(cy.contact.liner+rubbing*dt*.0008,0,1);cy.contact.rings=clamp(cy.contact.rings+rubbing*dt*.0004,0,1);cy.compression=Math.max(cy.last?.22:.1,cy.compression*(1-rubbing*.015));
   }
   this.advancePistonContact(dt,cy,rubbing);
   const seized=cy.contact.thermalSeized||cy.contact.skewSeized;
   this.advancePistonThermal(dt,cy);
   this.advanceSkewContact(dt,cy);
   if(!seized&&(cy.contact.thermalSeized||cy.contact.skewSeized))this.noteRingSeizure(cy);
   this.advancePistonSlap(dt,cy);
  }
  const e=this.exhaust,on=this.ignition==='running';e.pulse=approach(e.pulse,on?this.exhaustPulse:0,14,dt);
  this.advanceExhaustJoint(dt);
  const tailFlow=on?clamp(this.flowGps*(1-e.leak)/60,0,1):0;
  const obstruction=damageOpening(this.auxWear.mufflerBaffle,.85);
  e.pressure=approach(e.pressure,on?(this.flowGps*.052+e.pulse*2.3)*(1-e.leak*.7)+obstruction*tailFlow*5.5:0,9,dt);
  e.resonator=approach(e.resonator,this.ambient+(e.manifold-this.ambient)*(.18+.47*tailFlow+.12*obstruction*tailFlow),.04+.1*tailFlow,dt);
  e.tail=approach(e.tail,this.ambient+(e.resonator-this.ambient)*(.24+.4*tailFlow),.04+.09*tailFlow,dt);
  const firing=on&&!this.overrun&&!this.revCut,load=this.engineLoad;
  const leakingRings=this.cylinders.reduce((sum,cy)=>cy.active?sum+(.22*(1-cy.compression)+.42*cy.contact.rings+.19*cy.partWear.ringLand):sum,0)/Math.max(1,this.activeCount);
  e.oil=approach(e.oil,firing?clamp(leakingRings*(.39+.79*load),0,.8)*clamp(this.oil/.4,0,1):0,9,dt);
  e.steam=approach(e.steam,on?Math.max(e.coolantSteam,firing?this.gasket*this.coolantLevel*(.35+.65*load):0):0,8,dt);
  e.carbon=approach(e.carbon,firing?clamp((.95-this.lambda)*2.3*load+this.unburnt*.32,0,.32)*this.fuelDelivery:0,12,dt);
  e.soot=Math.min(1,e.soot+(e.carbon*.002+e.oil*.0006)*tailFlow*dt);
  // Water from combustion forms droplets near a cold outlet. Jet speed uses
  // mass flow, hot-gas density and the outlet area of a 58 mm pipe.
  e.condensation=firing?clamp((52-e.tail)/26,0,1)*clamp((33-this.ambient)/22,.05,1):0;
  const density=101325/(287*(273.15+e.tail));
  e.jetSpeed=on?this.flowGps*.001*(1-e.leak)/(density*Math.PI*.029**2)*(1-.39*obstruction):0;
  this.advanceAuxWear(dt);
  this.advanceCylinderParts(dt);
  this.ageOil(dt);
 }
 snapshot(){
  const d=super.snapshot();
  return {...d,version:7,cylinders:d.cylinders.map(c=>({...c,contact:{...c.contact,ringFaces:c.contact.ringFaces.slice()},partWear:{...c.partWear}})),
   fragments:this.fragments.snapshot(),oilCircuit:this.oilCircuit.snapshot(),waterCircuit:this.waterCircuit.snapshot(),
   timingDrive:this.timingDrive.snapshot(),
   exhaust:{...this.exhaust},exhaustSpill:{...this.exhaustSpill},
   coolantHose:{damage:this.coolantHose.damage,temp:this.coolantHose.temp},crankSeals:this.crankSeals.map(s=>({wear:s.wear,film:s.film})),
   mainBearings:this.mainBearings.map(b=>({temp:b.temp,wear:b.wear})),
   ringShed:this.ringShed.slice(),auxWear:{...this.auxWear},oilOxidation:this.oilOxidation,
   bench:{fuel:this.fuel,rpmLimit:this.rpmLimit,corrosion:this.corrosion,faults:[...this.benchFaults]}};
 }
 static restore(d){const e=new Engine(7193,d?.build);if(!d||![1,2,3,4,5,6,7].includes(d.version)||!base.validBank(d))return e;Object.assign(e,Prior.restore({...d,version:Math.min(d.version,6)}));
  e.fragments=Fragments.restore(d.fragments,e.cylinders.length);e.oilCircuit=new Circuit('oil');e.waterCircuit=new Circuit('water');e.oilCircuit.pistonJets.length=e.cylinders.length;e.oilCircuit.restore(d.oilCircuit,e.oil,e.fragments.dust);e.waterCircuit.restore(d.waterCircuit,e.coolantLevel*6);
  e.cylinders.forEach((cy,i)=>{if(cy.active||cy.failure!=='ejected')e.fragments.detached[i]=null;});
  if(Array.isArray(d.bench?.faults)){
   for(const key of d.bench.faults.slice(0,BENCH_FAULT_KEYS.size))if(BENCH_FAULT_KEYS.has(key)&&!(Number(key.split(':')[2])>=e.cylinders.length))e.benchFaults.add(key);
  }
  e.oilCircuit.benchFaults=e.benchFaults;
  e.timingDrive=TimingDrive.restore(d.timingDrive);
  e.fuel=finite(d.bench?.fuel,0,FUEL_CAPACITY,FUEL_CAPACITY);
  e.fuelDelivery=.035+.965*clamp((e.fuel-.08)/.72,0,1);
  e.rpmLimit=finite(d.bench?.rpmLimit,1200,base.RATING.limiter,base.RATING.limiter);
  e.corrosion=finite(d.bench?.corrosion,0,1);
  e.refreshCycle();e.timingDrive.camAngle=e.camAngle;
  e.oilOxidation=finite(d.oilOxidation,0,1,e.oilCircuit.filterLoad*.55);
  for(const k of ['manifold','resonator','tail'])e.exhaust[k]=finite(d.exhaust?.[k],24,900,e.exhaust[k]);e.exhaust.soot=finite(d.exhaust?.soot,0,1);e.ringShed=e.cylinders.map((c,i)=>d.ringShed?.[i]===true||!c.active);
  const spill=e.exhaustSpill,storedSpill=d.exhaustSpill,hole=e.fragments.caseBreach;
  spill.temp=finite(storedSpill?.temp,24,850,e.ambient);
  if(hole&&hole.x>=SPILL_PIPE.left&&hole.x<=SPILL_PIPE.right){
   spill.oil=finite(storedSpill?.oil,0,SPILL_FILM_LIMIT);
   spill.soak=finite(storedSpill?.soak,0,1);
   spill.burning=storedSpill?.burning===true&&spill.oil>=.0008&&spill.temp>=190;
   spill.smoke=finite(storedSpill?.smoke,0,1);
  }
  if(hole&&hole.x>=COOLANT_HOSE.left&&hole.x<=COOLANT_HOSE.right){
   e.coolantHose.damage=finite(d.coolantHose?.damage,0,1);
   e.coolantHose.temp=finite(d.coolantHose?.temp,24,420,e.ambient);
  }
  for(let i=0;i<e.crankSeals.length;i++){
   const s=e.crankSeals[i],stored=d.crankSeals?.[i];
   s.wear=finite(stored?.wear,0,1);
   s.film=crankSealOpening(s.wear)?finite(stored?.film,0,CRANK_SEAL_FILM_LIMIT):0;
  }
  for(let i=0;i<e.mainBearings.length;i++){
   const b=e.mainBearings[i],stored=d.mainBearings?.[i];
   b.temp=finite(stored?.temp,24,285,e.oilTemp);
   b.wear=finite(stored?.wear,0,1);
   b.clearance=MAIN_CLEARANCE_MM+MAIN_CLEARANCE_WEAR_MM*b.wear;
  }
  e.exhaust.flangeTemp=finite(d.exhaust?.flangeTemp,24,900,e.ambient+.64*(e.exhaust.manifold-e.ambient)+.12*(e.exhaust.resonator-e.ambient));
  e.exhaust.sealWear=finite(d.exhaust?.sealWear,0,1);e.updateExhaustGap();
  for(const part of AUX_PARTS)e.auxWear[part]=finite(d.auxWear?.[part],0,1);
  for(const cy of e.cylinders){
   const saved=d.cylinders[cy.id];
   cy.partWear={ringLand:0,skirt:0,exhaustValve:0};
   for(const part of Object.keys(CYLINDER_PARTS))cy.partWear[part]=finite(saved?.partWear?.[part],0,1);
   cy.exhaustValveTemp=finite(saved?.exhaustValveTemp,24,950,e.headTemp);
   cy.contact.play=finite(saved?.contact?.play,PISTON_CLEARANCE_MM,MAX_PISTON_PLAY_MM);
   cy.contact.bearingWipe=finite(saved?.contact?.bearingWipe,0,1);
   const contact=cy.contact,stored=saved?.contact;
   contact.bearingGrip=contact.bearingWipe===1?finite(stored?.bearingGrip,0,1,1):1;
   contact.bearingSpun=contact.bearingGrip===0&&stored?.bearingSpun===true;
   contact.bearingSpinAngle=contact.bearingSpun?finite(stored?.bearingSpinAngle,0,TAU)%TAU:0;
   contact.journalScoring=contact.bearingSpun?finite(stored?.journalScoring,0,1):0;
   contact.bearingBasePlay=finite(stored?.bearingBasePlay,0,e.build.wear*.14);
   contact.bearingClearance=BEARING_CLEARANCE_MM+contact.bearingBasePlay+JOURNAL_CLEARANCE_GAIN_MM*contact.journalScoring;
   contact.rodFatigue=contact.bearingClearance>ROD_IMPACT_CLEARANCE_MM?finite(stored?.rodFatigue,0,1):0;
   contact.skirtTemp=finite(stored?.skirtTemp,35,310,initialSkirtTemp(contact));
   contact.clearance=skirtClearance(contact);
   contact.thermalBind=finite(stored?.thermalBind,0,1);
   contact.thermalSeized=cy.active&&stored?.thermalSeized===true&&contact.clearance<=.012;
   contact.thermalSide=stored?.thermalSide===-1?-1:1;
   contact.skirtCycled=stored?.skirtCycled===true;
   contact.skirtFatigue=finite(stored?.skirtFatigue,0,contact.skirtCycled?1:SKIRT_CRACK_FATIGUE*.8);
   contact.skirtSide=stored?.skirtSide===-1?-1:1;
   const possible=SKIRT_CHIP_FATIGUE.filter(threshold=>contact.skirtFatigue>=threshold).length;
   contact.skirtChips=Math.floor(finite(stored?.skirtChips,0,possible));
   contact.headWarp=finite(stored?.headWarp,0,.36);
   contact.gasketPunctured=stored?.gasketPunctured===true||e.benchFaultOn('gasket','break',cy.id);
   contact.headSeal=contact.gasketPunctured||contact.headWarp>HEAD_SEAL_WARP_MM?finite(stored?.headSeal,0,1):0;
   contact.boreCoolant=contact.headSeal>0?finite(stored?.boreCoolant,0,e.clearanceLitres*1.45):0;
   contact.boreCoolantFlow=0;
   contact.plugWet=contact.headSeal>0?finite(stored?.plugWet,0,1):0;
   contact.wetMisses=contact.headSeal>0?Math.floor(finite(stored?.wetMisses,0,1e12)):0;
   contact.rodBend=contact.headSeal>0?finite(stored?.rodBend,0,2.5):0;
   contact.hydraulicHit=contact.headSeal>0&&stored?.hydraulicHit===true;
   contact.skewScuff=contact.rodBend>0?finite(stored?.skewScuff,0,1):0;
   contact.skewBind=contact.rodBend>0?finite(stored?.skewBind,0,1):0;
   contact.skewSeized=cy.active&&contact.skewScuff>.27&&contact.skewBind>.17&&stored?.skewSeized===true;
   contact.ringSeizures=Math.floor(finite(stored?.ringSeizures,0,3));
   contact.ringBreakSide=stored?.ringBreakSide===-1?-1:1;
   contact.ringFaces=Array.from({length:8},(_,i)=>finite(stored?.ringFaces?.[i],0,1));
   contact.ringGasLeft=contact.ringGasRight=0;
   contact.boreOil=contact.ringSeizures>1?finite(stored?.boreOil,0,BORE_OIL_LIMIT):0;
   contact.boreOilVapour=contact.ringSeizures>1?finite(stored?.boreOilVapour,0,BORE_OIL_LIMIT-contact.boreOil):0;
   contact.plugCarbon=contact.ringSeizures>1?finite(stored?.plugCarbon,0,1):0;
   contact.crownCarbon=contact.ringSeizures>1?finite(stored?.crownCarbon,0,1):0;
   contact.depositTemp=contact.crownCarbon>.04?finite(stored?.depositTemp,24,1270,e.ambient):e.ambient;
   contact.preIgnition=0;
   contact.preIgnitionHits=contact.crownCarbon>.38?Math.floor(finite(stored?.preIgnitionHits,0,1e9)):0;
   contact.crownFatigue=finite(stored?.crownFatigue,0,Math.min(1,.05*contact.preIgnitionHits));
   contact.crownGasFlow=0;
   if(contact.ringSeizures>1)e.ringShed[cy.id]=true;
  }
  if(e.cylinders.some(c=>c.contact.headSeal>0||c.contact.ringSeizures>1||c.contact.ringFaces.some(Boolean)))e.refreshCycle();
  if(Array.isArray(d.log)){
   for(const event of d.log.slice(0,12)){
    if(!event||!Number.isFinite(event.time)||event.time<0||event.time>e.time)continue;
    if(event.type==='benchFault'&&typeof event.message==='string')
     e.log.push({type:'benchFault',cylinder:[0,1,2,3].includes(event.cylinder)?event.cylinder:-1,time:event.time,message:event.message.slice(0,160)});
    if(Object.hasOwn(AUX_FAILURES,event.type)&&e.auxWear[event.type]===1)
     e.log.push({type:event.type,cylinder:-1,time:event.time,message:AUX_FAILURES[event.type]});
    if(event.type==='exhaustSeal'&&e.exhaust.sealWear===1)
     e.log.push({type:event.type,cylinder:-1,time:event.time,message:EXHAUST_SEAL_FAILURE});
    const drive=e.timingDrive;
    if((event.type==='chainGuide'&&drive.guideWear===1)||(event.type==='chainSkip'&&drive.teethSkipped>0)||(event.type==='chainBreak'&&drive.broken))
     e.log.push({type:event.type,cylinder:-1,time:event.time,message:CHAIN_MESSAGES[event.type]});
    const cy=e.cylinders[event.cylinder];
    if(Number.isInteger(event.cylinder)&&cy&&Object.hasOwn(PISTON_THERMAL_EVENTS,event.type)){
     const contact=cy.contact,retain=event.type==='skirtCrack'?contact.skirtFatigue>=SKIRT_CRACK_FATIGUE:
      event.type==='skirtChip'?contact.skirtChips>0:
      contact.thermalSeized||e.fragments.linerScuffs.some(mark=>mark.cylinder===cy.id&&mark.kind==='skirt');
     if(retain)e.log.push({type:event.type,cylinder:cy.id,time:event.time,message:`Цилиндр ${cy.id+1}: ${PISTON_THERMAL_EVENTS[event.type]}`});
    }
    if(event.type==='bearingWipe'&&Number.isInteger(event.cylinder)&&cy?.contact.bearingWipe===1)
     e.log.push({type:event.type,cylinder:cy.id,time:event.time,message:bearingWipeMessage(cy.id)});
    if(event.type==='bearingSpin'&&Number.isInteger(event.cylinder)&&cy?.contact.bearingSpun)
     e.log.push({type:event.type,cylinder:cy.id,time:event.time,message:bearingSpinMessage(cy.id)});
    if(event.type==='caseBreach'&&cy&&e.fragments.caseBreach?.cylinder===event.cylinder)
     e.log.push({type:event.type,cylinder:cy.id,time:event.time,message:CASE_BREACH_MESSAGE});
    if(event.type==='spillFire'&&cy&&e.fragments.caseBreach?.cylinder===event.cylinder)
     e.log.push({type:event.type,cylinder:cy.id,time:event.time,message:SPILL_FIRE_MESSAGE});
    if(event.type==='coolantHose'&&cy&&e.coolantHose.damage>HOSE_RUPTURE&&e.fragments.caseBreach?.cylinder===event.cylinder)
     e.log.push({type:event.type,cylinder:cy.id,time:event.time,message:HOSE_RUPTURE_MESSAGE});
    if(event.type==='headSeal'&&Number.isInteger(event.cylinder)&&cy?.contact.headSeal>0)
     e.log.push({type:event.type,cylinder:cy.id,time:event.time,message:headSealMessage(cy.id)});
    if(event.type==='hydrolock'&&Number.isInteger(event.cylinder)&&cy?.contact.headSeal>0){
     const bent=event.bent===true&&cy.contact.rodBend>0;
     e.log.push({type:event.type,cylinder:cy.id,time:event.time,bent,message:hydrolockMessage(cy.id,bent)});
    }
    if(Number.isInteger(event.cylinder)&&cy?.contact.skewScuff>.27&&Object.hasOwn(SKEW_EVENTS,event.type))
     e.log.push({type:event.type,cylinder:cy.id,time:event.time,message:`Цилиндр ${cy.id+1}: ${SKEW_EVENTS[event.type]}`});
    if(event.type==='ringFracture'&&Number.isInteger(event.cylinder)&&cy&&[1,2].includes(event.stage)&&cy.contact.ringSeizures>event.stage)
     e.log.push({type:event.type,cylinder:cy.id,time:event.time,stage:event.stage,message:ringFractureMessage(cy.id,event.stage)});
    if(event.type==='plugFouling'&&Number.isInteger(event.cylinder)&&cy?.contact.plugCarbon>=FOULED_PLUG_CARBON)
     e.log.push({type:event.type,cylinder:cy.id,time:event.time,message:plugFoulingMessage(cy.id)});
    if(event.type==='preIgnition'&&Number.isInteger(event.cylinder)&&cy?.contact.preIgnitionHits>0)
     e.log.push({type:event.type,cylinder:cy.id,time:event.time,message:preIgnitionMessage(cy.id)});
    if(event.type==='crownCrack'&&Number.isInteger(event.cylinder)&&cy?.contact.crownFatigue>=CROWN_CRACK_FATIGUE)
     e.log.push({type:event.type,cylinder:cy.id,time:event.time,message:crownCrackMessage(cy.id)});
    if(event.type==='crownBreach'&&Number.isInteger(event.cylinder)&&cy&&crownOpening(cy.contact))
     e.log.push({type:event.type,cylinder:cy.id,time:event.time,message:crownBreachMessage(cy.id)});
    if(event.type==='frontCrankSeal'||event.type==='rearCrankSeal'){
     const index=event.type==='frontCrankSeal'?0:1;
     if(crankSealOpening(e.crankSeals[index].wear))e.log.push({type:event.type,cylinder:-1,time:event.time,message:crankSealMessage(index)});
    }
    if(event.type==='mainBearingWear'&&Number.isInteger(event.bearing)&&e.mainBearings[event.bearing]?.wear>=MAIN_WEAR_WARNING)
     e.log.push({type:event.type,cylinder:-1,bearing:event.bearing,time:event.time,message:mainBearingMessage(event.bearing)});
    if(event.type==='jetClog'&&Number.isInteger(event.cylinder)&&cy&&e.oilCircuit.pistonJets[cy.id].clog>=PISTON_JET_CLOG_WARNING)
     e.log.push({type:event.type,cylinder:cy.id,time:event.time,message:jetClogMessage(cy.id)});
    if(Object.hasOwn(CYLINDER_PARTS,event.type)&&Number.isInteger(event.cylinder)&&cy?.partWear[event.type]===1)
     e.log.push({type:event.type,cylinder:cy.id,time:event.time,message:`Цилиндр ${cy.id+1}: ${CYLINDER_PARTS[event.type].message}.`});
   }
   e.log.sort((a,b)=>b.time-a.time);e.log.length=Math.min(12,e.log.length);
  }
  const count=e.cylinders.length;
  e.oilCircuit.spray.films=e.oilCircuit.spray.films.filter(p=>p.cylinder<count);
  e.events=[];return e;
 }
}
const api={...base,Engine,Circuit,Fragments,FRAGMENT_CAP:CAP,OIL_PICKUP,OilPan,OIL_PAN,SPILL_PIPE,COOLANT_HOSE,HOSE_RUPTURE,CRANK_SEALS,crankSealOpening,BEARING_CAPS,MAIN_WEAR_WARNING,PISTON_JET_CLOG_WARNING,SKIRT_CRACK_FATIGUE,CHAMBER_CLEARANCE_L,FOULED_PLUG_CARBON,HOT_DEPOSIT_C,CROWN_CRACK_FATIGUE,crownOpening,RING_HEIGHTS,hasRingFace,writeGeometry};if(typeof module!=='undefined'&&module.exports)module.exports=api;else Object.assign(root.Piston,api);
})(typeof globalThis!=='undefined'?globalThis:this);
