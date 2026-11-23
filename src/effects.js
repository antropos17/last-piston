/* Cached mechanical surfaces + half-resolution atmospheric pass.
   Static material details are baked once; moving assemblies keep their geometry. */
(function(root){
'use strict';
const {Renderer:Cutaway,clamp,TAU,pistonGeometry,burnFraction,BURN_ANGLE,SKIRT_CRACK_FATIGUE,CROWN_CRACK_FATIGUE,HOT_DEPOSIT_C,crownOpening}=root.Piston;
const X=[373,517,661,805],BEARINGS=[307,445,589,733,871];
const CAM_AXIS=[148,157],VALVE_SEAT=220,VALVE_ANGLE=.22,CAM_RADIUS=7;
const PISTON_SCALE=1.045;
const CAM_LOBE=Array.from({length:48},(_,i)=>{
 const a=i/48*TAU,r=CAM_RADIUS+7.65*Math.max(0,Math.sin(a))**6;
 return [Math.cos(a)*r,Math.sin(a)*r];
});
const CAM_FACE=CAM_LOBE.map(([x,y])=>[x*.8,y*.85]);
const SMOKE_LEFT=-160,SMOKE_RIGHT=1360,SMOKE_WIDTH=(SMOKE_RIGHT-SMOKE_LEFT)/2;
const noise=n=>{const v=Math.sin(n*127.1+31.7)*43758.5453;return v-Math.floor(v);};
class Renderer extends Cutaway{
 constructor(canvas){super(canvas);this.cache=new Map();this.cacheHits=0;this.cacheMisses=0;this.patterns=new WeakMap();this.performanceMode='auto';this.pixelRatioLimit=1.5;this.renderCost=0;this.smokeLayer=document.createElement('canvas');this.smokeLayer.width=SMOKE_WIDTH;this.smokeLayer.height=340;this.smokeContext=this.smokeLayer.getContext('2d');this.visibleSmoke=[];this.extraSmoke=0;this.effectsClock=0;this.resize();}
 resize(){const box=this.canvas.getBoundingClientRect(),limit=this.pixelRatioLimit||1.5;const dpr=Math.min(devicePixelRatio||1,limit);this.canvas.width=Math.max(1,Math.round(box.width*dpr));this.canvas.height=Math.max(1,Math.round(box.height*dpr));this.scale=Math.min(this.canvas.width/1200,this.canvas.height/680);this.sy=this.scale;this.offsetX=(this.canvas.width-this.scale*1200)/2;this.offsetY=(this.canvas.height-this.scale*680)/2;this.quality=this.performanceMode==='eco'?.5:box.width<600?.7:1;}
 setPerformance(mode){this.performanceMode=['auto','high','eco'].includes(mode)?mode:'auto';this.pixelRatioLimit=mode==='high'?2:mode==='eco'?1:1.5;this.resize();}
 bake(slot,key,bounds,draw,scale=this.performanceMode==='high'||this.zoom>1?1.5:1){
  key+=':'+scale;let entry=this.cache.get(slot);
  if(!entry||entry.key!==key){const [x,y,w,h]=bounds;const cv=entry?.canvas||document.createElement('canvas');cv.width=Math.ceil(w*scale);cv.height=Math.ceil(h*scale);const cc=cv.getContext('2d');cc.setTransform(scale,0,0,scale,-x*scale,-y*scale);const saved=this.c;this.c=cc;try{draw();}finally{this.c=saved;}entry={canvas:cv,key,bounds};this.cache.set(slot,entry);this.cacheMisses++;}else this.cacheHits++;
  const [x,y,w,h]=bounds;this.c.drawImage(entry.canvas,x,y,w,h);
 }
 texture(x,y,w,h,alpha=.5){const c=this.c;let pattern=this.patterns?.get(c);if(!pattern){pattern=c.createPattern(this.castTexture,'repeat');this.patterns?.set(c,pattern);}c.save();c.globalAlpha=alpha;c.fillStyle=pattern;c.fillRect(x,y,w,h);c.restore();}
 background(m){
  this.bake('background','fixed',[SMOKE_LEFT,0,SMOKE_RIGHT-SMOKE_LEFT,680],()=>super.background(m,SMOKE_LEFT,SMOKE_RIGHT),1);
 }
 block(m){const key=this.mode+':'+Math.floor(m.damage*14)+':'+m.cylinders.map(c=>Math.floor(Math.max(c.contact.liner,c.wear*.22)*24)).join(',');this.bake('block',key,[270,193,694,371],()=>super.block(m));}
 headCasting(m){this.bake('head-casting',m.gasket>.15,[275,148,684,86],()=>this.uncachedHeadCasting(m));}
 pulley(x,y,r,phase){
  const c=this.c;c.save();c.translate(x,y);
  this.bake('pulley-base'+r,'fixed',[-r-2,-r-2,r*2+4,r*2+4],()=>{
   const dish=this.c.createLinearGradient(-r*.7,-r,r*.4,r);
   dish.addColorStop(0,'#b1afa1');dish.addColorStop(.32,'#797b71');dish.addColorStop(.72,'#3a3b34');dish.addColorStop(1,'#747369');
   this.circle(0,0,r,'#26241f','#45433b',1.8);
   this.circle(0,0,r-2,null,'#a19d8d',.7);
   this.circle(0,0,r-5,dish,'#24231e',1.3);
   this.circle(0,0,r-7,null,'rgba(235,224,200,.28)',.7);
   this.circle(0,1,r*.36,'#302f28','#837e6f',1.1);
  });
  c.rotate(phase);
  this.bake('pulley-face'+r,'fixed',[-r,-r,r*2,r*2],()=>{
   for(let j=0;j<6;j++){
    this.c.save();this.c.rotate(j*TAU/6);
    this.ellipse(.9,-r*.57,4.6,r*.23,'#b9b4a5');
    this.ellipse(0,-r*.57,4.2,r*.23,'#24231e');
    this.ellipse(-.7,-r*.57,2.5,r*.19,'#39382f');
    this.c.restore();
   }
   this.circle(0,0,r*.26,this.metal(-r*.26,r*.52),'#1b252a',1);
   this.circle(0,0,r*.2,null,'#b1bcb5',.65);
   this.bolt(0,0,Math.max(2,r*.13));
  });c.restore();
 }
 pistonSurface(x,top,cy,ringShed){
  const d=cy.contact,ringWear=Math.floor(d.rings*12)/12;
  const part=cy.partWear;
  const fatigue=d.skirtFatigue>=SKIRT_CRACK_FATIGUE?Math.ceil(d.skirtFatigue*30):0,chips=d.skirtChips||0;
  const side=(d.skirtSide||d.thermalSide)===-1?-1:1;
  const key=[Math.floor(d.skirt*22),Math.floor(cy.wear*7),Math.floor(d.crown*10),cy.active,ringWear,ringShed,
   Math.floor((part?.ringLand||0)*8),Math.floor((part?.skirt||0)*8),fatigue,chips,fatigue||chips?side:0,d.ringSeizures*d.ringBreakSide,
   d.ringFaces.map(w=>Math.round(w*24)).join(','),Math.ceil(d.crownCarbon*15),d.crownFatigue>=CROWN_CRACK_FATIGUE?Math.ceil(d.crownFatigue*30):0,Math.ceil(crownOpening(d)*18)].join(':');
  const c=this.c;c.save();c.translate(x,top);c.scale(PISTON_SCALE,1);
  this.bake('piston'+cy.id,key,[-50,-13,101,84],()=>this.uncachedPistonSurface(0,0,36,cy,ringShed,ringWear,fatigue/30,chips,side));
  c.restore();
 }
 rod(x1,y1,x2,y2,damage=0,broken=false,bend=0){
  const c=this.c,len=Math.hypot(x2-x1,y2-y1);
  if(len<45){super.rod(x1,y1,x2,y2,damage,broken,bend);return;}
  c.save();c.translate(x1,y1);c.rotate(-Math.atan2(x2-x1,y2-y1));
  const wear=Math.floor(damage*6);
  this.bake('rod'+wear,Math.round(len)+':'+wear+':'+broken+':'+bend,[-26,-6,52,Math.ceil(len)+32],()=>super.rod(0,0,0,len,damage,broken,bend));
  c.restore();
 }
 damages(m){const key=this.mode+':'+Math.floor(m.gasket*16)+':'+m.cylinders.map(c=>c.active+':'+Math.floor(c.contact.crack*20)+':'+Math.floor(c.contact.bearing*10)+':'+Math.floor(c.contact.liner*10)).join('|');this.bake('damage',key,[270,208,680,364],()=>super.damages(m));}
 drawSmoke(front){
  const {x,y,z}=this.camera,viewLeft=Math.max(SMOKE_LEFT,x-600/z),viewRight=Math.min(SMOKE_RIGHT,x+600/z);
  const viewTop=Math.max(0,y-340/z),viewBottom=Math.min(680,y+340/z);
  const visible=this.visibleSmoke;
  visible.length=0;
  let left=viewRight,right=viewLeft,top=viewBottom,bottom=viewTop;
  for(const p of this.smoke){
   if(p.front!==front||p.age<=0||p.age>=p.life)continue;
   const r=p.r*(p.jet&&!this.reduced?1.55+1.21*Math.max(0,1-p.age/.68):1.12);
   if(p.x+r<=viewLeft||p.x-r>=viewRight||p.y+r<=viewTop||p.y-r>=viewBottom)continue;
   visible.push(p);
   left=Math.min(left,p.x-r);right=Math.max(right,p.x+r);
   top=Math.min(top,p.y-r);bottom=Math.max(bottom,p.y+r);
  }
  if(!visible.length)return;
  // Only paint the part of the shared buffer that this pass composites.
  const sx=Math.max(0,Math.floor((Math.max(viewLeft,left)-SMOKE_LEFT)*.5)-1),sy=Math.max(0,Math.floor(Math.max(viewTop,top)*.5)-1);
  const sw=Math.min(SMOKE_WIDTH,Math.ceil((Math.min(viewRight,right)-SMOKE_LEFT)*.5)+1)-sx;
  const sh=Math.min(340,Math.ceil(Math.min(viewBottom,bottom)*.5)+1)-sy;
  const q=this.smokeContext;
  q.setTransform(1,0,0,1,0,0);
  // Interpolation at the crop edge must not pick up pixels from the preceding pass.
  q.clearRect(sx-3,sy-3,sw+6,sh+6);
  q.setTransform(.5,0,0,.5,-SMOKE_LEFT*.5,0);
  for(const p of visible){
   const age=p.age/p.life,fade=Math.min(1,p.age*(p.jet?13:8))*(1-age*age);
   const overWindow=p.front?clamp(Math.min((p.x-303)/40,(879-p.x)/40,(p.y-221)/38,(529-p.y)/38),0,1):0;
   const windowFade=1-overWindow*.77;
   const dilution=p.jet?1/(1+p.age*(p.tex>=6&&p.tex<9?.84:.42)):1;
   q.globalAlpha=clamp(fade*p.alpha*windowFade*1.25*dilution,0,.95);
   if(p.jet&&!this.reduced){
    const squeeze=Math.max(0,1-p.age/.68),roll=Math.sin(p.rot);
    const length=p.r*(1.04+squeeze*1.35+(1-squeeze)*roll*.13),height=p.r*(.99-squeeze*.56);
    q.save();q.translate(p.x,p.y);q.rotate(Math.atan2(p.vy,p.vx)+roll*(1-squeeze)*.46);
    q.drawImage(this.textures[p.tex],-length,-height,length*2,height*2);q.restore();
   }else{
    const stretch=this.reduced?1:1+.12*Math.sin(p.rot);
    q.drawImage(this.textures[p.tex],p.x-p.r*stretch,p.y-p.r,p.r*2*stretch,p.r*2);
   }
  }
  q.globalAlpha=1;
  this.c.drawImage(this.smokeLayer,sx,sy,sw,sh,SMOKE_LEFT+sx*2,sy*2,sw*2,sh*2);
 }
 puff(x,y,kind='exhaust',power=1){
  const m=this.currentModel;if(m){if(kind==='steam'&&m.coolantLevel<.001)return;if(kind==='oil'&&m.oilSmoke<.001)return;}
  const max=Math.round((this.performanceMode==='eco'?150:260)*this.quality);if(this.smoke.length>=max)return;
  if(kind==='exhaust'){x=1102;y=347;power=m?.exhaustSmoke??.04;}
  const p=this.world(x,y),steam=kind==='steam',ex=kind==='exhaust',pulse=m?.exhaustPulse||0;
  this.smoke.push({x:p.x,y:p.y,vx:ex?38+pulse*48:(this.rand()-.5)*24,vy:ex?-12-this.rand()*22:-34-this.rand()*25,age:0,life:3+this.rand()*1.8,r:ex?8+this.rand()*9:14+this.rand()*15,grow:ex?18+power*17:21+power*10,rot:this.rand()*TAU,spin:(this.rand()-.5)*.3,tex:(steam?6:kind==='oil'?3:0)+Math.floor(this.rand()*3),alpha:ex?.07+power*1.7:power,front:!ex&&this.rand()>.35});
 }
 update(dt,m){this.currentModel=m;super.update(dt,m);this.effectsClock+=dt;
  this.extraSmoke+=dt*((m.exhaustSmoke||0)*38+(m.steam||0)*45+(m.relay?.contactTemp>125?3:0))*this.quality;
  for(let n=0;n<10&&this.extraSmoke>=1;n++,this.extraSmoke--){if(m.relay.contactTemp>130&&this.rand()<.13)this.puff(59,181,'electrical',.55);else if(m.steam>.1&&this.rand()<.48)this.puff(this.rand()>.5?915:282,221,'steam',1.1);else this.puff(1102,347,'exhaust',1);}
  const max=Math.round((this.performanceMode==='eco'?150:260)*this.quality);if(this.smoke.length>max)this.smoke.length=max;
 }
 piston(m,j){
  const c=this.c,cy=m.cylinders[j],x=X[j],g=pistonGeometry(m.phase,m.cylinders[j],x),f=pistonGeometry(cy.freeze,m.cylinders[j],x),d=cy.contact;
  const detached=m.fragments.detached[j];
  const showPiston=cy.failure!=='ejected'||!!detached;
  const top=cy.active?g.top:detached?.top??f.top,pin=top+36;
  if(cy.active&&m.ignition==='running'&&top>232&&d.preIgnition)
   this.drawPreIgnition(cy,x,top,m.preIgnitionAge(cy.cycle.angle));
  if(d.headWarp>.012)this.drawHeadSealLeak(d,x,top,cy.cycle.angle);
  const wet=clamp(d.filmMicron/4,0,1),rail=top+26;
  if(showPiston&&wet>.01&&rail>=232&&rail<414){
   for(const side of [-1,1]){
    const edge=x+side*49,foot=Math.min(414,rail+31);
    const oil=c.createLinearGradient(edge,0,edge-side*5,0);
    oil.addColorStop(0,`rgba(51,32,15,${.7*wet})`);
    oil.addColorStop(.24,`rgba(182,135,70,${.53*wet})`);oil.addColorStop(1,'rgba(72,48,23,0)');
    c.fillStyle=oil;c.fillRect(side<0?edge:edge-5,rail,5,414-rail);
    this.line([[edge-side,rail],[edge-side*1.3,foot]],`rgba(218,185,114,${.62*wet})`,.72);
   }
  }
  if(d.boreOil>0&&top>235){
   const oil=clamp(d.boreOil/.00016,0,1),side=d.ringBreakSide,edge=x+side*45;
   const height=Math.min(top-233,4+oil*18);
   this.poly([[edge,top],[edge,top-height],[edge-side*(1+oil),top-3],[edge-side*(6+oil*12),top]],`rgba(96,61,27,${oil*.9})`);
   this.line([[edge-side*.7,top-height*.8],[edge-side*(1+oil),top-2],[edge-side*(5+oil*8),top-.4]],`rgba(205,153,83,${oil*.74})`,.75+oil*.6);
  }
  if(showPiston){
   c.save();c.beginPath();c.rect(x-50,232,100,184);c.clip();
   this.drawPistonOcclusion(cy,x,top);
   c.restore();
  }
  if(cy.active){
   this.rod(x,pin,g.crankX,g.crankY,d.bearing,false,Math.round((d.rodBend??0)*7));
   this.drawJournalScoring(g,d.journalScoring);
   const wipe=d.bearingWipe||0;
   if(d.bearingSpun){
    const a=Math.atan2(g.crankY-pin,g.crankX-x);
    this.drawSpunBearing(g,a,d);
    if(d.rodFatigue>.5){
     c.save();c.translate(g.crankX,g.crankY);c.rotate(a-Math.PI/2);
     this.fracture([[-5.8,-33],[-3.1,-32.6],[-1.9,-30.3],[.4,-30.8],[2.3,-28],[6.1,-27.6]],(d.rodFatigue-.5)*2,1.18);
     c.restore();
    }
   }else if(wipe>.035){
    const a=Math.atan2(pin-g.crankY,x-g.crankX),spread=.28+wipe*1.14;
    const hubX=g.crankX,hubY=g.crankY,tint=clamp((d.bearingTemp-134)/110,0,1);
    c.save();c.translate(hubX,hubY);c.rotate(a);
    c.beginPath();c.arc(0,0,16.9,-spread,spread);
    c.strokeStyle=wipe>=1?'#362924':`rgba(128,89,68,${.2+wipe*.61})`;
    c.lineWidth=.75+1.46*wipe;c.stroke();
    c.beginPath();c.arc(0,0,15.2,-spread*.79,spread*.69);
    c.strokeStyle=`rgba(113,122,136,${wipe*(.23+tint*.55)})`;c.lineWidth=1.08;c.stroke();
    c.beginPath();c.arc(0,0,15.9,-spread*.62,spread*.55);
    c.strokeStyle=`rgba(200,143,91,${wipe*.83})`;c.lineWidth=.78;c.stroke();
    if(wipe>=1){
     this.poly([[15.5,-4.7],[17.35,-4.3],[17.09,-.8],[17.65,2.5],[15.7,4.6],[14.8,.95]],'#292725','#80654f',.56);
     this.line([[16.6,-4.6],[16.5,-2.8],[15.9,-1.9]],'#b49d7c',.56);
    }
    c.restore();
   }
  }else{
   const angle=Math.atan2(f.pinY-f.crankY,x-f.crankX)+m.phase-cy.freeze;
   this.rod(g.crankX+28*Math.cos(angle),g.crankY+28*Math.sin(angle),g.crankX,g.crankY,1,true);
   this.drawJournalScoring(g,d.journalScoring);
   if(cy.failure!=='ejected')this.brokenRodStem(x,pin);
  }
  if(!showPiston)return;
  c.save();c.beginPath();c.rect(x-50,232,100,184);c.clip();
  c.save();
  if(d.rodBend>0&&cy.active){
   c.translate(x,pin);c.rotate(m.pistonSkewAngle(cy)*4);c.translate(-x,-pin);
  }
  this.pistonSurface(x,top,cy,m.ringShed[cy.id]);
  const dent=m.fragments.crownDents[j];
  if(dent){
   const at=x+dent.offset,y=top+2.4,width=1+3.8*dent.depth;
   this.ellipse(at,y,width,.6+1.05*dent.depth,'#49483e');
   this.line([[at-width,y],[at-width*.37,y+.72+dent.depth],[at+width*.7,y+.4]],'#c6c1aa',.66);
  }
  const hot=clamp((d.depositTemp-(HOT_DEPOSIT_C-95))/310,0,1);
  if(hot>0){
   const edge=x+d.ringBreakSide*29,glow=c.createRadialGradient(edge,top+1,0,edge,top+1,13+8*hot);
   glow.addColorStop(0,`rgba(233,94,29,${hot*.61})`);glow.addColorStop(1,'rgba(183,57,16,0)');
   c.fillStyle=glow;c.fillRect(edge-23,top-13,46,29);
   for(const [u,v,r] of [[-6,2,1.1],[0,1,1.7],[5,3,1.2],[9,1.5,.75]])
    this.ellipse(edge+d.ringBreakSide*u,top+v,r+.6*hot,.62+hot*.54,`rgba(255,${Math.round(95+110*hot)},56,${.26+.69*hot})`);
  }
  c.restore();
  const hotSkirt=clamp(((d.skirtTemp??0)-153)/100,0,1),bind=d.thermalBind??0;
  if(hotSkirt>.025||bind>.025){
   const side=d.thermalSide===-1?-1:1;
   const missing=d.skirtSide===side&&d.skirtChips>0?2+Math.min(3,d.skirtChips)*2:0;
   const foot=top+(side===1&&cy.partWear?.skirt>=1?43:55-missing*.6),edge=x+side*46;
   const varnish=c.createLinearGradient(x+side*30,0,edge,0);
   varnish.addColorStop(0,'rgba(102,62,31,0)');
   varnish.addColorStop(.65,`rgba(105,70,47,${.64*hotSkirt})`);
   varnish.addColorStop(1,`rgba(62,43,33,${.72*hotSkirt})`);
   this.poly([[x+side*32,top+31],[edge,top+32],[edge-side,foot],[x+side*37,foot+2]],varnish);
   if(bind>.025){
    const y=Math.min(m.skirtContactPoint(cy).y,foot-2),end=Math.min(y+6,foot);
    this.line([[edge,y-6],[edge-side*.4,y],[edge-side*.6,end]],`rgba(41,32,25,${.4+.49*bind})`,1.3+1.35*bind);
    this.line([[edge-side*1.5,y-5],[edge-side*2,end]],`rgba(222,204,172,${.21+.62*bind})`,.78);
   }
  }
  // The work light reaches a crown in the open bore more than one up in the head.
  c.globalAlpha=(.26+.66*clamp((top-239)/68,0,1))*(1-.68*d.crownCarbon);
  c.drawImage(this.crownReflection,x-27,top-8,57,13);
  c.restore();
  if(cy.active&&d.crownGasFlow>.03)this.drawCrownGas(x,top,d);
  if(d.ringGasLeft>.025)this.drawRingGas(x,top,-1,d.ringGasLeft);
  if(d.ringGasRight>.025)this.drawRingGas(x,top,1,d.ringGasRight);
 }
 drawRingGas(x,top,side,flow){
  const c=this.c,power=1-Math.exp(-flow/2.3),wall=x+side*47.6;
  const foot=top+55,mouth=415,end=mouth+8+68*power;
  const light=c.createLinearGradient(0,top,0,end);
  light.addColorStop(0,'rgba(208,175,125,.62)');
  light.addColorStop(.32,'rgba(214,201,168,.82)');
  light.addColorStop(.78,'rgba(190,186,166,.40)');light.addColorStop(1,'rgba(161,167,157,0)');
  c.save();c.globalAlpha=power;c.fillStyle=light;
  // Narrow jet along the ring lands, expanding into mist only below the skirt.
  c.beginPath();c.moveTo(wall,top+1);c.lineTo(wall,foot);
  const drift=this.reduced?0:Math.sin(this.effectsClock*12+x)*3;
  c.bezierCurveTo(wall+side,foot+14,wall-side*4,mouth,wall-side*(10+drift),end);
  c.bezierCurveTo(wall-side*(35+drift),mouth+19,wall-side*(4+6*power),foot+16,wall-side*1.5,foot);
  c.lineTo(wall-side*1.1,top+26);c.lineTo(wall-side*2,top+16);c.lineTo(wall-side*1.1,top+9);
  c.closePath();c.fill();
  c.globalAlpha=power*.55;c.strokeStyle=light;c.lineWidth=.72;
  c.beginPath();c.moveTo(wall-side,foot);c.bezierCurveTo(wall-side*6,foot+14,wall-side*(3+drift),mouth+3,wall-side*23,end);c.stroke();
  c.restore();
 }
 drawCrownGas(x,top,d){
  const c=this.c,power=1-Math.exp(-d.crownGasFlow/9),side=d.ringBreakSide;
  const source=x+side*28,exit=x+side*16,underside=top+30;
  const end=Math.min(534,Math.max(underside+31,430+91*power));
  const width=1.6+11*power,drift=side*8+Math.sin(this.effectsClock*15+x)*4*power;
  const gas=c.createLinearGradient(0,top,0,end);
  gas.addColorStop(0,`rgba(225,179,122,${power*.81})`);
  gas.addColorStop(.27,`rgba(192,166,136,${power*.51})`);
  gas.addColorStop(.67,`rgba(169,160,145,${power*.32})`);
  gas.addColorStop(1,'rgba(133,127,117,0)');
  c.save();c.strokeStyle=gas;c.lineWidth=.55+power*2.1;
  c.beginPath();c.moveTo(source,top+.4);c.lineTo(x+side*24,top+11);c.lineTo(x+side*21,top+20);c.lineTo(exit,underside);c.stroke();
  const travel=end-underside,scalePhase=this.effectsClock*(4.5+power*5);
  for(let i=0;i<8;i++){
   const u=((i+scalePhase)%8)/8;
   const px=exit-drift*u+Math.sin(u*13+x-this.effectsClock*7)*width*u*.43,py=underside+travel*u;
   const radius=1.8+width*u*1.55,length=5+travel*.13;
   const opacity=power*(.62-.47*u)*Math.min(1,(1-u)*5);
   c.save();c.translate(px,py);c.scale(1,length/radius);
   const wisp=c.createRadialGradient(0,0,0,0,0,radius);
   wisp.addColorStop(0,`rgba(215,190,155,${opacity})`);
   wisp.addColorStop(.44,`rgba(182,170,151,${opacity*.56})`);
   wisp.addColorStop(1,'rgba(149,143,132,0)');
   c.fillStyle=wisp;c.fillRect(-radius,-radius,radius*2,radius*2);c.restore();
  }
  c.restore();
 }
 drawJournalScoring(g,wear){
  if(!(wear>.015))return;
  const c=this.c,count=Math.ceil(6*wear);
  c.save();c.translate(g.crankX,g.crankY);c.rotate(g.cycle);
  // Scoring follows the journal surface, independently of the loose shell.
  for(let i=0;i<count;i++){
   const r=13.7-i*.94+noise(i*31+2)*.24,start=i*.81+noise(i*7+31)*.74;
   const end=start+.48+wear*(1.55+noise(i*19+7)*1.24),width=.47+wear*(.28+noise(i*5+19)*.4);
   c.beginPath();c.arc(0,0,r+.51,start+.04,end-.07);
   c.strokeStyle=`rgba(212,190,157,${.21+wear*.39})`;c.lineWidth=.53;c.stroke();
   c.beginPath();c.arc(0,0,r,start,end);
   c.strokeStyle=`rgba(57,47,37,${.26+wear*.48})`;c.lineWidth=width;c.stroke();
  }
  c.restore();
 }
 drawMainBearings(m){
  const c=this.c;
  for(let i=0;i<m.mainBearings.length;i++){
   const b=m.mainBearings[i],hot=clamp((b.temp-121)/116,0,1),wear=b.wear;
   if(hot<.015&&wear<.015)continue;
   const x=BEARINGS[i],y=460;
   c.save();c.translate(x,y);
   if(hot>.015){
    const tarnish=c.createRadialGradient(0,0,4,0,0,19);
    tarnish.addColorStop(0,`rgba(139,86,50,${hot*.76})`);
    tarnish.addColorStop(.63,`rgba(121,70,42,${hot*.49})`);
    tarnish.addColorStop(1,'rgba(94,55,37,0)');
    c.fillStyle=tarnish;c.fillRect(-17,-17,34,34);
   }
   if(wear>.015){
    const shift=b.offset*14;
    this.ellipse(0,0,10.8,9.9,'#20221d','#94816a',.64);
    const journal=c.createLinearGradient(0,-7+shift,0,7+shift);
    journal.addColorStop(0,'#79746a');journal.addColorStop(.38,'#a39a87');journal.addColorStop(1,'#524a3d');
    this.ellipse(0,shift,9.8,8.55-wear*.55,journal,'#514639',.65);
    c.beginPath();c.arc(0,shift,7.6,.32,.32+wear*3.0);
    c.strokeStyle=`rgba(167,112,68,${.45+wear*.49})`;c.lineWidth=.6+wear*1.1;c.stroke();
    for(let k=0;k<Math.ceil(wear*6);k++){
     const py=(k-2.5)*1.24+shift,len=6+noise(i*13+k)*4;
     this.line([[-len*.52,py],[len*.56,py+.58]],'rgba(42,34,27,.72)',.55);
    }
   }
   c.restore();
  }
 }
 drawSpunBearing(g,rodAngle,d){
  const c=this.c,shellAngle=rodAngle+Math.PI/2+d.bearingSpinAngle;
  const hot=clamp((d.bearingTemp-142)/125,0,1);
  c.save();c.translate(g.crankX,g.crankY);c.rotate(shellAngle);
  // The cap parting line is fixed to the rod. Both shell halves have
  // moved inside it, exposing their separated ends across the journal face.
  this.circle(0,0,15.8,null,'#36302a',3.15);
  for(const face of [0,Math.PI]){
   c.beginPath();c.arc(0,0,15.8,face+.10,face+Math.PI-.065);
   c.strokeStyle=face===0?'#a6876b':'#756f65';c.lineWidth=2.55;c.stroke();
   c.beginPath();c.arc(0,0,14.92,face+.16,face+Math.PI-.16);
   c.strokeStyle=face===0?'#cbb79a':'#aea597';c.lineWidth=.66;c.stroke();
  }
  c.beginPath();c.arc(0,0,15.05,.35,1.52);
  c.strokeStyle=`rgba(97,68,52,${.55+.4*hot})`;c.lineWidth=1.15;c.stroke();
  this.line([[16.85,-1.1],[14.6,-1.55]],'#cdc1a9',.68);
  this.line([[-16.7,.85],[-14.72,1.4]],'#b2a797',.57);
  c.restore();
 }
 drawPistonOcclusion(cy,x,top){
  if(!this.pistonShadow){
   this.pistonShadow=document.createElement('canvas');
   this.pistonShadow.width=100;this.pistonShadow.height=81;
   const shade=this.pistonShadow.getContext('2d');
   const cast=shade.createRadialGradient(59,15,5,67,21,70);
   cast.addColorStop(0,'rgba(8,10,9,.83)');
   cast.addColorStop(.42,'rgba(11,13,11,.66)');
   cast.addColorStop(.76,'rgba(11,13,11,.24)');
   cast.addColorStop(1,'rgba(11,13,11,0)');
   shade.fillStyle=cast;shade.fillRect(0,0,100,81);
   this.crownReflection=document.createElement('canvas');
   this.crownReflection.width=65;this.crownReflection.height=16;
   const glass=this.crownReflection.getContext('2d');
   glass.scale(1,.16);
   const reflected=glass.createRadialGradient(24,24,0,24,24,40);
   reflected.addColorStop(0,'rgba(233,228,206,.49)');
   reflected.addColorStop(.2,'rgba(215,217,202,.28)');
   reflected.addColorStop(.55,'rgba(215,217,202,.10)');
   reflected.addColorStop(1,'rgba(215,217,202,0)');
   glass.fillStyle=reflected;glass.fillRect(0,0,65,100);
  }
  const c=this.c,skirt=cy.partWear?.skirt||0;
  c.globalAlpha=(.88-.34*skirt)*(.86+.14*clamp((top-242)/60,0,1));
  c.drawImage(this.pistonShadow,x-46,top+47);
 }
 drawChamber(cy,x,top){
  const angle=cy.cycle.angle;
  if(!cy.lit||angle>=BURN_ANGLE+.24)return;
  const c=this.c,burn=burnFraction(angle),radius=2.8+59*Math.sqrt(burn);
  const fade=1-clamp((angle-.38)/.94,0,1);
  c.save();c.translate(x,0);c.beginPath();
  c.moveTo(-48,231);c.lineTo(-8,210);c.lineTo(8,210);c.lineTo(48,231);
  c.lineTo(48,top);c.lineTo(-48,top);c.closePath();c.clip();
  c.globalAlpha=fade*clamp(cy.chamberBar/27,.24,1);
  const front=c.createRadialGradient(0,214,0,0,214+burn*12,radius);
  front.addColorStop(0,'rgba(244,180,102,.51)');
  front.addColorStop(.58,'rgba(195,101,47,.43)');
  front.addColorStop(.77,'rgba(255,204,129,.92)');
  front.addColorStop(.83,'rgba(247,161,78,.67)');
  front.addColorStop(1,'rgba(183,80,36,0)');
  c.fillStyle=front;c.fillRect(-48,212,96,top-212);
  // Bounce from the flame front on the crown and the exposed seat bevels.
  const reflected=c.createLinearGradient(-46,0,46,0);
  reflected.addColorStop(0,'#ba7d4780');reflected.addColorStop(.48,'#ffe1a6');
  reflected.addColorStop(1,'#b8784080');c.globalAlpha*=burn*.84;
  this.line([[-45,top-.5],[-15,top-1.1],[17,top-1],[45,top-.5]],reflected,1.45);
  for(const side of [-1,1])this.line([[side*12,215],[side*24,221.4],[side*34,225.1]],reflected,.85);
  c.restore();
 }
 drawPortFlow(x,side,flow,angle,top){
  if(!flow)return;
  const strength=clamp(Math.sqrt(Math.abs(flow)/95),0,1);
  if(strength<.09)return;
  const c=this.c,reach=Math.min(top-1,233+strength*22);
  c.save();c.translate(x,0);c.scale(side,1);
  const tint=side<0?'137,202,207':'233,163,99';
  const wash=c.createLinearGradient(51,193,8,reach);
  wash.addColorStop(0,`rgba(${tint},.10)`);
  wash.addColorStop(.46,`rgba(${tint},.84)`);
  wash.addColorStop(1,`rgba(${tint},0)`);
  c.beginPath();c.moveTo(55,194);c.bezierCurveTo(44,194,35,198,31,207);
  c.bezierCurveTo(27,215,38,220,30,227);c.quadraticCurveTo(17,235,9,reach);
  c.strokeStyle=wash;c.lineWidth=2.2+4*strength;c.globalAlpha=.56*strength;c.stroke();
  c.lineWidth=.85+strength*.65;c.globalAlpha=.4+.57*strength;
  c.setLineDash([4,6]);c.lineDashOffset=this.reduced?0:-Math.sign(flow)*angle*80/TAU;
  c.stroke();c.restore();
 }
 drawPreIgnition(cy,x,top,age){
  if(age<0||age>.88)return;
  const c=this.c,edge=x+cy.contact.ringBreakSide*29,spread=clamp(age/.52,0,1);
  const heat=(1-clamp((age-.39)/.49,0,1))*cy.contact.preIgnition;
  const front=c.createRadialGradient(edge,top-3,0,edge-cy.contact.ringBreakSide*spread*23,top-6-spread*15,9+spread*53);
  front.addColorStop(0,`rgba(255,225,169,${.92*heat})`);
  front.addColorStop(.33,`rgba(254,169,67,${.76*heat})`);
  front.addColorStop(.68,`rgba(185,69,20,${.46*heat})`);
  front.addColorStop(1,'rgba(157,45,16,0)');
  c.fillStyle=front;c.fillRect(x-47,232,94,top-232);
 }
 drawHeadSealLeak(d,x,top,angle){
  const c=this.c,flex=clamp(d.headWarp/.27,0,1),gap=d.headSeal??0;
  c.save();c.translate(x-45,232);
  this.poly([[-4,0],[3,-1.9*flex],[10,-2.5*flex],[24,0],[10,1.1],[3,1.5*gap],[-4,1]],'#26221d');
  this.line([[-4,-.6],[3,-1.8*flex],[10,-2.5*flex],[24,-.25]],'#9d9d8d',.62);
  if(gap>0)this.fracture([[-4,0],[2,-.65],[6,.3],[10,-1.75],[16,-.52]],.18+gap*.82,.8);
  const liquid=clamp(d.boreCoolantFlow/.016,0,1),film=clamp(d.boreCoolant/.002,0,1);
  if(top>234&&(liquid>.01||film>.025)){
   const depth=top-232;
   c.beginPath();c.rect(-3,0,95,depth);c.clip();
   const length=Math.min(depth,8+liquid*17+film*5);
   c.beginPath();c.moveTo(-2,1);c.quadraticCurveTo(3,4,4,length);
   c.strokeStyle=`rgba(87,151,129,${.34+liquid*.54})`;c.lineWidth=.8+liquid*1.5;c.stroke();
   this.ellipse(4,length,1.2+liquid,1.7+liquid,'rgba(154,201,176,.72)');
  }
  c.restore();
  if(d.boreCoolant>.002&&top>234){
   const depth=Math.min(top-232,d.boreCoolant*171),y=top-depth;
   const tilt=Math.sin(angle)*Math.min(1.35,depth*.3);
   this.poly([[x-45,y+tilt],[x-27,y-.5],[x+22,y+.3],[x+45,y-tilt],[x+45,top],[x-45,top]],'#427560b3');
   this.line([[x-45,y+tilt],[x-27,y-.5],[x+22,y+.3],[x+45,y-tilt]],'#a1c3a7aa',.78);
  }
 }
 uncachedPistonSurface(x,top,pin,cy,ringShed,ringWear,fatigue,chips,chipSide){
  const c=this.c,d=cy.contact,j=cy.id;
  const land=cy.partWear?.ringLand||0,skirt=cy.partWear?.skirt||0;
  const depth=chips>0?2+Math.min(chips,3)*2:0;
  const notch=depth>0&&(chipSide===-1||skirt<1)?
   [[44.25,56-depth*.25],[42.6,56-depth*.35],[40.5-depth*.45,60-depth],[40.5-depth*.78,60]]:null;
  const notchEdge=notch?.map(([u,v])=>[x+chipSide*u,top+v]);
  const aluminium=c.createLinearGradient(x-46,top,x+46,top+15);
  for(const [stop,color] of [[0,'#595b55'],[.13,'#a3a49a'],[.29,'#c3c2b7'],[.47,'#acada3'],[.78,'#878a81'],[1,'#50534d']])aluminium.addColorStop(stop,color);
  const shell=new Path2D();shell.moveTo(x-43,top);shell.lineTo(x+(land>=1?28:43),top);
  if(land>=1){shell.lineTo(x+34,top+4);shell.lineTo(x+42,top+3);shell.lineTo(x+41,top+8);shell.lineTo(x+46,top+11);}
  else shell.quadraticCurveTo(x+46,top,x+46,top+3);
  shell.lineTo(x+45,top+42);
  if(skirt>=1){shell.lineTo(x+37,top+44);shell.lineTo(x+39,top+51);shell.lineTo(x+24,top+55);}
  else{
   if(notchEdge&&chipSide===1)for(const p of notchEdge)shell.lineTo(...p);
   else{shell.lineTo(x+44,top+56);shell.lineTo(x+40,top+60);}
   shell.lineTo(x+23,top+60);
  }
  shell.lineTo(x+18,top+49);shell.lineTo(x-18,top+49);shell.lineTo(x-23,top+60);
  if(notchEdge&&chipSide===-1)for(let i=notchEdge.length-1;i>=0;i--)shell.lineTo(...notchEdge[i]);
  else{shell.lineTo(x-40,top+60);shell.lineTo(x-44,top+56);}
  shell.lineTo(x-46,top+4);shell.closePath();
  c.fillStyle=aluminium;c.fill(shell);c.strokeStyle='#343631';c.lineWidth=.6;c.stroke(shell);
  c.save();c.clip(shell);
  // The machined shoulder sits below the exposed cut edge of the crown.
  const crownEdge=x+(land>=1?27:43),crown=c.createLinearGradient(0,top,0,top+8.4);
  crown.addColorStop(0,'#dedbca');crown.addColorStop(.23,'#adafa1');
  crown.addColorStop(.62,'#858a80');crown.addColorStop(1,'#50564d');
  c.beginPath();c.moveTo(x-44,top+2);c.quadraticCurveTo(x-43,top+.7,x-36,top+.1);
  c.lineTo(crownEdge-4,top+.1);c.quadraticCurveTo(crownEdge,top+.7,crownEdge,top+2);
  c.quadraticCurveTo(crownEdge-7,top+6.9,x,top+7.6);
  c.quadraticCurveTo(x-35,top+7,x-44,top+2);c.closePath();c.fillStyle=crown;c.fill();
  c.save();c.clip();
  c.drawImage(this.sootPatch,x-50,top-4,68,12);c.drawImage(this.sootPatch,x+4,top-5,51,14);
  c.restore();
  if(d.crownCarbon>.018){
   const soot=d.crownCarbon,side=d.ringBreakSide;
   const residue=c.createLinearGradient(x-side*41,0,x+side*42,0);
   residue.addColorStop(0,`rgba(44,35,29,${soot*.26})`);
   residue.addColorStop(1,`rgba(27,24,20,${Math.min(.93,soot*1.55)})`);
   c.fillStyle=residue;c.fill();
   for(let i=0;i<Math.ceil(52*soot);i++){
    const px=x+side*(42-noise(j*73+i*5)*79),py=top+1+noise(i*7+8)*6;
    this.ellipse(px,py,.6+noise(i*13)*2.3,.29+noise(i*19)*.6,i%4?'#342d26b8':'#241f1be6');
   }
  }
  const pocket=c.createLinearGradient(x-30,top+29,x+22,top+50);
  pocket.addColorStop(0,'#2c312b');pocket.addColorStop(.16,'#333a32');pocket.addColorStop(.49,'#545b50');
  pocket.addColorStop(.73,'#666b60');pocket.addColorStop(1,'#393f37');
  c.beginPath();c.moveTo(x-30,top+38);c.quadraticCurveTo(x-26,top+29,x-13,top+29);
  c.lineTo(x+13,top+29);c.quadraticCurveTo(x+26,top+29,x+31,top+38);
  c.lineTo(x+23,top+52);c.lineTo(x-23,top+52);c.closePath();
  c.fillStyle=pocket;c.fill();
  const coating=c.createLinearGradient(x,top+28,x,top+61);
  coating.addColorStop(0,'rgba(24,26,23,0)');coating.addColorStop(.24,'rgba(44,47,43,.46)');
  coating.addColorStop(.76,'rgba(46,50,46,.64)');coating.addColorStop(1,'rgba(23,25,22,.76)');
  for(const side of [-1,1]){
   c.beginPath();c.moveTo(x+side*31,top+29);c.lineTo(x+side*47,top+28);
   c.lineTo(x+side*47,top+60);c.lineTo(x+side*29,top+60);
   c.quadraticCurveTo(x+side*34,top+44,x+side*31,top+29);
   c.fillStyle=coating;c.fill();
  }
  for(let k=0;k<23;k++){
   const y=top+2+k*1.1,start=x-45+noise(j*41+k)*13;
   this.line([[start,y],[x+38-noise(k*3)*18,y]],k%3===0?'rgba(27,28,24,.15)':'rgba(235,234,219,.11)',.32);
  }
  for(let k=0;k<73;k++){
   const sx=x+noise(j*91+k)*86-43,sy=top+29+noise(j*63+k*3)*31;
   c.fillStyle=k%3===0?'rgba(220,221,206,.18)':'rgba(26,29,23,.22)';
   c.fillRect(sx,sy,.45+noise(k*8)*.6,.48);
  }
  this.line([[x-40,top+2.8],[x-30,top+4.5],[x-17,top+5.4]],'rgba(214,211,196,.6)',.64);
  this.line([[x-42,top+31],[x-41,top+53],[x-38,top+56]],'rgba(207,206,190,.35)',.55);
  this.line([[x-27,top+38],[x-24,top+33],[x-17,top+31]],'rgba(214,211,192,.38)',.58);
  c.restore();
  // Thin parallel ring lands keep the same model contact plane.
  const ringSteel=c.createLinearGradient(x-44,top,x+44,top);
  ringSteel.addColorStop(0,'#42463f');ringSteel.addColorStop(.24,'#868a80');ringSteel.addColorStop(.49,'#666960');ringSteel.addColorStop(1,'#3e423b');
  for(const offset of [9,16]){
   if(d.ringSeizures>=(offset===9?2:3)){
    const y=top+offset,side=d.ringBreakSide,edge=x+side*(offset===9?29:33);
    this.line([[x-45,y],[x+45,y]],'#2a2d27',2.7);
    this.line([[x-side*44,y-.6],[edge,y-.6]],ringSteel,2.1);
    this.line([[edge-side*1.3,y-1.8],[edge+side*.7,y-.8],[edge-side*.6,y+.65]],'#d1c5a9',.85);
    continue;
   }
   const y=top+offset,chipped=(ringShed||land>=1)&&offset===9,edge=x+(chipped?28:44);
   this.line([[x-45,y],[x+(land>=1&&offset===9?39:45),y]],'#2a2d27',2.7);
   this.line([[x-44,y-.6],[edge,y-.6]],ringSteel,2.1);
   this.line([[x-42,y-1.6],[edge-1,y-1.6]],'rgba(205,204,187,.54)',.45);
   if(ringWear>0)this.line([[x-44,y+.3],[edge,y+.3]],`rgba(128,92,51,${ringWear*.78})`,1.25);
   if(chipped){
    this.line([[edge-1,y-1.6],[edge+1,y],[edge-1,y+1]],'#d8c9aa',1);
    this.line([[edge+5,y+.6],[x+(land>=1?39:44),y+.6]],'#4f5551',.7);
   }
  }
  this.rr(x-45,top+22,90,4.8,0,'#383c35');
  const oilRingGap=d.ringSeizures===3,oilLeft=oilRingGap&&d.ringBreakSide===-1?-30:-44,oilRight=oilRingGap&&d.ringBreakSide===1?30:44;
  for(let k=0;k<9;k++)if(-38+k*9>=oilLeft&&-38+k*9<oilRight)this.rr(x-38+k*9,top+23.5,2.55,1.6,.75,'#1a201c');
  this.line([[x+oilLeft,top+22],[x+oilRight,top+22]],ringSteel,.74);
  this.line([[x+oilLeft,top+26.5],[x+oilRight,top+26.5]],ringSteel,.9);
  for(const side of [-1,1]){
   for(let k=0;k<root.Piston.RING_HEIGHTS.length;k++){
    if(!root.Piston.hasRingFace(cy,ringShed,side,k))continue;
    const y=top+root.Piston.RING_HEIGHTS[k],wear=d.ringFaces[(side<0?0:4)+k];
    const face=x+side*(47.8-1.6*wear)/PISTON_SCALE,heel=x+side*(44.5-3.8*wear)/PISTON_SCALE;
    this.line([[heel,y-.6],[face,y-.55]],k<2?'#8e9892':'#777e71',k<2?1.6:.75);
    this.line([[heel,y-.97],[face-side*.4,y-.94]],'#c0c7bd',.44);
    if(wear>.015){
     this.line([[heel,y+.12],[face,y-.06]],`rgba(109,76,48,${.28+.66*wear})`,.65+wear);
     this.line([[face-side*.54,y-.87],[face,y-.18],[face-side*.2,y+.35]],'#d9c9a8',.55);
    }
   }
  }
  const boss=c.createLinearGradient(x-11,pin-11,x+11,pin+12);
  boss.addColorStop(0,'#c0bfb1');boss.addColorStop(.3,'#969c90');boss.addColorStop(.56,'#646a60');boss.addColorStop(.79,'#3b4239');boss.addColorStop(1,'#787d6f');
  this.circle(x+.8,pin+1.25,12.6,'rgba(24,29,23,.58)');
  this.circle(x,pin,12.3,boss,'#494e45',.58);
  const pinBore=c.createLinearGradient(x,pin-9,x,pin+9);
  pinBore.addColorStop(0,'#30332e');pinBore.addColorStop(.58,'#1d221d');pinBore.addColorStop(.9,'#6b6c5d');pinBore.addColorStop(1,'#969789');
  this.circle(x,pin,9.25,pinBore,'#b5b5a2',.47);
  this.circle(x,pin,7.2,'#171b17','#353b33',.45);
  this.line([[x-7,pin+3.5],[x-5,pin+6],[x-1,pin+7]],'rgba(197,196,173,.48)',.65);
  const scuff=Math.max(d.skirt,cy.wear*.22),n=Math.floor(scuff*30);
  c.save();c.clip(shell);
  for(let k=0;k<n;k++){
   const side=k%3===0?-1:1,sx=x+side*(27+noise(j*31+k)*14),yy=top+32+noise(k+12)*12;
   const end=top+(side>0&&skirt>=1?42:57);
   if(yy>end)continue;
   this.line([[sx,yy],[sx+.4,end]],'rgba(38,38,34,.49)',.65+noise(k)*1.25);
   this.line([[sx-.8,yy],[sx-.4,end-1]],'rgba(222,222,205,.41)',.5);
  }
  if(fatigue>=SKIRT_CRACK_FATIGUE){
   const [u,v]=notch?.[2]??(chipSide===1&&skirt>=1?[39,50.6]:[40.6,59.1]);
   const spread=clamp((fatigue-SKIRT_CRACK_FATIGUE)/(1-SKIRT_CRACK_FATIGUE),0,1);
   const split=.13+.87*Math.sqrt(spread);
   c.translate(x+chipSide*u,top+v);c.scale(chipSide,1);
   this.fracture([[0,0],[-2.6,-4],[-2.1,-6.3],[-6,-9.5],[-5.3,-12.5],[-9.6,-15.2],[-10,-19]],split,.78+split*1.3);
   this.fracture([[-6,-9.5],[-8.7,-8.6],[-11,-10.5]],clamp((fatigue-.69)/.31,0,1),.78);
  }
  c.restore();
  if(land>.38&&land<1)this.fracture([[x+43,top+1],[x+38,top+5],[x+32,top+7],[x+29,top+12]],land,1.15);
  if(land>=1)this.line([[x+28,top],[x+34,top+4],[x+42,top+3],[x+41,top+8],[x+46,top+11]],'#cdc6b4',.85);
  if(skirt>.36&&skirt<1)this.fracture([[x+43,top+39],[x+38,top+45],[x+39,top+49],[x+28,top+55]],skirt,1.4);
  if(skirt>=1)this.line([[x+45,top+42],[x+37,top+44],[x+39,top+51],[x+24,top+55]],'#dad7c6',.9);
  if(notchEdge)this.line(notchEdge,'#b7ae9b',.68);
  if(d.crown>.03){
   this.line([[x-40,top+1],[x-22,top+3],[x+18,top+3],[x+(land>=1?26:40),top+1]],`rgba(52,43,35,${d.crown*.65})`,2.5);
  }
  if(d.crownFatigue>=CROWN_CRACK_FATIGUE){
   const progress=clamp((d.crownFatigue-CROWN_CRACK_FATIGUE)/(1-CROWN_CRACK_FATIGUE),0,1),side=d.ringBreakSide;
   const shape=points=>points.map(([u,v])=>[x+side*u,top+v]);
   this.fracture(shape([[28,1],[24,3.9],[23,7.5],[18,8.7],[16,13.1],[11,15.8],[10,20.5],[2,24]]),.24+.76*Math.sqrt(progress),.8+progress*1.35);
   this.fracture(shape([[18,8.7],[12,8],[9,10],[4,9.6]]),clamp((progress-.24)/.76,0,1),1.12);
  }
  const opening=crownOpening(d);
  if(opening){
   const side=d.ringBreakSide,width=1.05+3.8*Math.sqrt(opening),edge=new Path2D();
   const mouth=[[28-width,-.9],[23-width*.59,8],[22-width*.65,19],[16-width*.68,32],
    [16+width*.78,32],[24+width*.57,19],[24+width*.48,10],[28+width,-.9]];
   mouth.forEach(([u,v],i)=>i?edge.lineTo(x+side*u,top+v):edge.moveTo(x+side*u,top+v));edge.closePath();
   c.save();c.globalCompositeOperation='destination-out';c.fillStyle='#000';c.fill(edge);c.restore();
   this.line(mouth.slice(0,4).map(([u,v])=>[x+side*u,top+v]),'#a49680',.72);
   this.line(mouth.slice(4).map(([u,v])=>[x+side*u,top+v]),'#5f4635',.93);
  }
  if(!cy.active)this.fracture([[x-38,top+37],[x-17,top+43],[x-8,top+52],[x+10,top+47],[x+26,top+50]],1,1.25);
 }
 uncachedHeadCasting(m){
  const c=this.c;
  const face=c.createLinearGradient(287,172,357,232);
  face.addColorStop(0,'#444840');face.addColorStop(.17,'#9b9e90');face.addColorStop(.48,'#7a7d70');face.addColorStop(.88,'#56594f');face.addColorStop(1,'#909586');
  this.poly([[277,178],[283,172],[913,172],[921,179],[921,229],[915,232],[281,232],[277,228]],face,'#45473f',.85);
  this.texture(282,176,634,52,.41);
  this.line([[283,173],[913,173]],'rgba(205,204,183,.55)',.65);
  this.rr(280,225.5,638,3,1,'#94948a');
  for(const {id} of m.cylinders){const x=X[id];
   c.drawImage(this.sootPatch,x+18,174,51,53);
   this.line([[x-59,225.8],[x-54,224.7],[x-48,224.7]],'#cccec1',.65);
   this.line([[x+49,228.3],[x+55,228.3],[x+59,226.8]],'#4b5350',.8);
  }
  this.line([[281,226],[917,226]],'rgba(212,209,193,.45)',.62);
  this.line([[280,229.5],[918,229.5]],'#51534a',.9);
  this.line([[280,231],[918,231]],m.gasket>.15?'#39312a':'#41423b',1.5);
  for(const x of BEARINGS){
   const stain=c.createRadialGradient(x-1,204,2,x+1,207,21);
   stain.addColorStop(0,'#292219bd');stain.addColorStop(.5,'#42332285');stain.addColorStop(1,'#41362900');
   c.fillStyle=stain;c.fillRect(x-20,186,42,41);
   const boss=c.createLinearGradient(x-6,0,x+6,0);
   boss.addColorStop(0,'#73766b');boss.addColorStop(.28,'#b3b2a0');boss.addColorStop(.72,'#85877b');boss.addColorStop(1,'#54584f');
   this.rr(x-6,176,12,45,4,boss);
   this.rr(x-2.4,181,4.8,31,1,'#5f6258');
   this.circle(x,216.9,3.1,'#444940','#777b70',.65);
  }
 }
 headChamber(x,cy,m){
  const heat=Math.floor(clamp(((cy.exhaustValveTemp||0)-350)/240,0,1)*12);
  this.bake('head-chamber'+cy.id,heat,[x-59,167,118,66],()=>{
   const c=this.c;
  // At this viewing plane the two valve banks are unfolded side by side.
  // The sloped seat faces lead directly into the two cast port passages.
   for(const side of [-1,1]){
    const portColor=c.createLinearGradient(x+side*54,188,x+side*31,213);
    const hot=side>0?heat/12:0;
    portColor.addColorStop(0,side<0?'#555b52':'#584d3d');
    portColor.addColorStop(.32,side<0?'#2f352e':'#382e25');
    portColor.addColorStop(.62,'#151b17');
    portColor.addColorStop(1,hot>0?`rgb(${24+Math.round(hot*54)},${24+Math.round(hot*21)},${17+Math.round(hot*11)})`:'#1e221d');
    c.beginPath();
    c.moveTo(x+side*56,187.8);
    c.bezierCurveTo(x+side*44,187.8,x+side*35,191,x+side*29,199);
    c.quadraticCurveTo(x+side*23,205,x+side*17,215);
    c.lineTo(x+side*29,222);
    c.quadraticCurveTo(x+side*37,205,x+side*46,202);
    c.lineTo(x+side*56,200.2);c.closePath();
    c.fillStyle=portColor;c.fill();
     c.save();c.clip();
     const lumen=c.createRadialGradient(x+side*45,193,3,x+side*39,199,24);
     lumen.addColorStop(0,'rgba(9,13,10,.68)');lumen.addColorStop(.52,'rgba(10,14,11,.51)');lumen.addColorStop(1,'rgba(10,14,11,0)');
     c.fillStyle=lumen;c.fillRect(x-58,187,116,36);
     c.beginPath();c.moveTo(x+side*57,197.3);
     c.bezierCurveTo(x+side*43,196.5,x+side*36,200.4,x+side*28,214);
     c.strokeStyle=side<0?'rgba(150,156,139,.35)':'rgba(163,127,94,.34)';c.lineWidth=2.1;c.stroke();
     c.restore();
    c.beginPath();c.moveTo(x+side*56,188.2);
    c.bezierCurveTo(x+side*44,188.2,x+side*35,192,x+side*29,199.4);
    c.strokeStyle=side<0?'#a7a694':'#958673';c.lineWidth=.8;c.stroke();
    c.beginPath();c.moveTo(x+side*56,199.4);c.quadraticCurveTo(x+side*36,199.4,x+side*29,220);
    c.strokeStyle='#35372e';c.lineWidth=1.05;c.stroke();
   }
   const chamber=c.createLinearGradient(x,209,x,232);
   chamber.addColorStop(0,'#35382e');chamber.addColorStop(.28,'#282d25');chamber.addColorStop(1,'#181e18');
   this.poly([[x-48,231],[x-26,219],[x-8,209],[x+8,209],[x+26,219],[x+48,231]],chamber,'#7c7f70',.6);
   this.line([[x-46,230.2],[x-34,224.1]],'#9c9d8e',.68);
   this.line([[x+34,224.6],[x+46,230.2]],'#7e8374',.63);
   // Only the plug electrodes extend through the machined floor of the well.
   this.rr(x-6.5,168,13,39,2,'#4d5248','#6f7568',.6);
   this.rr(x-4.2,169,8.4,13,1,'#292f2b','#767c71',.55);
   const ceramic=c.createLinearGradient(x-3,0,x+3,0);
   ceramic.addColorStop(0,'#898b7d');ceramic.addColorStop(.35,'#d4d3c4');ceramic.addColorStop(1,'#989e90');
   this.rr(x-2.8,182,5.6,15,1,ceramic,'#737b70',.55);
   for(let i=0;i<3;i++)this.line([[x-2.7,184+i*3],[x+2.7,184+i*3]],'rgba(245,240,222,.54)',.5);
   this.poly([[x-5,197],[x-3,195],[x+3,195],[x+5,197],[x+5,201],[x-5,201]],
    '#92968a','#666d61',.65);
   this.rr(x-3,201,6,8,0,'#a6a89b','#52594e',.5);
   for(let i=0;i<3;i++)this.line([[x-2.8,202+i*2],[x+2.8,202.8+i*2]],'#666e62',.45);
   this.line([[x,208],[x,212]],'#c0b69e',1);
   this.line([[x+2.5,209],[x+2.5,214],[x+.4,214]],'#b1b3a6',.9);
  });
  const fouling=cy.contact.plugCarbon;
  if(fouling>.02){
   this.ellipse(x+.5,211.25,1.3+fouling*2.8,1.35+fouling*2.45,`rgba(33,26,22,${Math.min(.96,fouling*1.65)})`);
   this.line([[x-1.7,208.9],[x+.15,210.9],[x+2.5,213.3]],`rgba(58,47,35,${fouling*.85})`,.55+fouling*1.25);
  }
  if(cy.contact.plugWet>.07){
   const wet=cy.contact.plugWet;
   this.ellipse(x+.65,212.1,1.25+wet,1+wet*1.54,`rgba(102,158,131,${.74*wet})`);
   this.ellipse(x+.19,211.6,.45,.68,`rgba(209,225,203,${.65*wet})`);
  }
  if(m.ignition==='running'&&cy.active&&cy.lit&&!cy.contact.preIgnition&&cy.cycle.angle<.19&&!this.reduced){
   const fade=1-cy.cycle.angle/.19,energy=m.sparkEnergy(cy);
   this.circle(x+.2,212.9,1+fade*energy,`rgba(142,164,224,${fade*.32*energy})`);
   this.line([[x,211.8],[x+.6,212.9],[x+.4,214]],`rgba(229,234,254,${(.26+fade*.72)*energy})`,.28+.35*energy);
  }
 }
 makeValveLighting(){
  this.camOutline=new Path2D();this.camOutline.moveTo(...CAM_LOBE[0]);
  for(let i=1;i<CAM_LOBE.length;i++)this.camOutline.lineTo(...CAM_LOBE[i]);
  this.camOutline.closePath();
  this.camBevel=new Path2D(this.camOutline);this.camBevel.moveTo(...CAM_FACE[0]);
  for(let i=1;i<CAM_FACE.length;i++)this.camBevel.lineTo(...CAM_FACE[i]);
  this.camBevel.closePath();
  this.camReflection=document.createElement('canvas');
  this.camReflection.width=this.camReflection.height=38;
  const steel=this.camReflection.getContext('2d');
  const light=steel.createLinearGradient(3,5,30,34);
  light.addColorStop(0,'rgba(234,232,212,.16)');light.addColorStop(.34,'rgba(241,237,215,.79)');
  light.addColorStop(.48,'rgba(224,225,207,.40)');light.addColorStop(.61,'rgba(210,214,197,0)');
  light.addColorStop(.79,'rgba(40,47,39,.38)');light.addColorStop(1,'rgba(24,31,25,.54)');
  steel.fillStyle=light;steel.fillRect(0,0,38,38);
  this.valveShadow=document.createElement('canvas');
  this.valveShadow.width=40;this.valveShadow.height=40;
  const shade=this.valveShadow.getContext('2d');
  const dark=shade.createRadialGradient(21,19,3,20,20,20);
  dark.addColorStop(0,'rgba(7,10,8,.86)');dark.addColorStop(.42,'rgba(9,12,10,.64)');
  dark.addColorStop(1,'rgba(9,12,10,0)');
  shade.fillStyle=dark;shade.fillRect(0,0,40,40);
 }
 valveBank(x,cy,side){
  const c=this.c,s=cy.cycle,exhaust=side>0;
  const angle=side*VALVE_ANGLE,camY=CAM_AXIS[exhaust?1:0],camDepth=(camY-VALVE_SEAT)/Math.cos(angle);
  const lift=(exhaust?s.exhaust:s.intake)*7.5;
  const lobeAngle=((s.valveAngle??s.angle)-(exhaust?Math.PI*1.5:Math.PI*2.5))/2;
  const springTop=-43+lift,springBottom=-23,tappet=camDepth+CAM_RADIUS+lift;
  const wear=exhaust?(cy.partWear?.exhaustValve||0):0,broken=wear>=1;
  const hot=exhaust?clamp(((cy.exhaustValveTemp||0)-400)/225,0,1):0;
  if(!this.camReflection)this.makeValveLighting();
  c.save();c.translate(x+side*24,VALVE_SEAT);c.rotate(angle);
  // Behind the valve face and spring. The penumbra opens with actual lift.
  c.drawImage(this.valveShadow,-9.5,springTop-2,21,26);
  c.drawImage(this.valveShadow,-12,-2+lift*.17,27,4.2+lift*.92);
  this.line([[0,tappet+4],[0,-3+lift]],'#40463d',3.1);
  this.line([[-.52,tappet+4],[-.52,-3+lift]],'#9ca192',.9);
  c.save();c.translate(0,tappet);
  this.bake('valve-tappet'+side,'steel',[-8,-5,20,12],()=>{
   const steel=this.c.createLinearGradient(-7,0,7,0);
   steel.addColorStop(0,'#444940');steel.addColorStop(.26,'#b0b2a5');steel.addColorStop(.67,'#72776c');steel.addColorStop(1,'#52564d');
   this.rr(-6.7,0,13.4,5,1,steel,'#464a40',.65);
   this.line([[-5.9,.25],[5.6,.25]],'#b1b3a3',.58);
   this.line([[-4.5,3.9],[5.3,3.9]],'#565c4f',.68);
  });c.restore();
  this.rr(-5.5,springTop-2,11,3.5,.6,'#868b7d','#4b5248',.6);
  this.rr(-5.6,springBottom-1.5,11.2,3,.5,'#64695e','#464c43',.55);
  c.save();c.translate(0,springTop);c.scale(1,(springBottom-springTop)/20);
  this.bake('valve-spring'+side,'fixed',[-7,-4,19,26],()=>{
   for(let i=0;i<6;i++){
    const y=i*3.2;
    this.line([[-5,y+2.6],[-2,y+1.9],[3,y+1.5],[5,y+2]],'#353b32',1.3);
    this.line([[-5,y],[-2.8,y+.8],[2.9,y+1.9],[5,y+2.3]],'#4f564b',2);
    this.line([[-4.6,y-.45],[-2,y+.25],[2.9,y+1.28]],'#aeb1a2',.62);
   }
  });
  c.restore();
  this.rr(-3.4,-22,6.8,10,.6,'#67695e','#8c8d7d',.55);
  this.line([[-2.5,-21.3],[-2.5,-13]],'#9d9982',.64);
  // The seat stays machined into the deck with the valve open.
  this.line([[-11,.4],[-8,-2],[8,-2],[11,.4]],'#a6a89a',1.4);
  if(wear>.28&&!broken)this.line([[5,lift-.4],[8,lift+.6],[10,lift+.1]],`rgba(74,52,41,${wear})`,.9);
  const left=exhaust?8.7:10.5,right=broken?4:left;
  this.poly([[-2,-5+lift],[-left,-1.6+lift],[-left,1+lift],[right,1+lift],
   [right,-1.6+lift],[2,-5+lift]],exhaust?'#8f8776':'#959e91','#53594e',.6);
  this.poly([[-left,-1.6+lift],[-2,-5+lift],[2,-5+lift],[right,-1.6+lift],[right-1,lift],[-left+1,lift]],
    exhaust?'#655f53':'#657064');
  this.line([[-left+.6,lift+.5],[right-.7,lift+.5]],'#c1c0ab',.54);
  if(hot>.02)this.line([[-left+1,lift],[right-1,lift]],`rgba(201,112,55,${hot*.64})`,1.3);
  if(broken)this.line([[right,-1.6+lift],[right-1,lift-.6],[right,lift+.8]],'#d0a377',.75);
  // The cam lobe and bucket share the valve axis in this projection. Clip
  // the lobe at the face so that it never draws through the solid bucket.
  c.save();c.beginPath();c.rect(-16,camDepth-19,38,tappet-camDepth+19.25);c.clip();
  c.translate(0,camDepth);c.rotate(lobeAngle-angle);
  this.bake('cam-lobe','fixed',[-15,-11,30,29],()=>{
   this.poly(CAM_LOBE,'#858b80','#353d33',.87);
   this.poly(CAM_FACE,'#515950','#70796e',.51);
   this.circle(0,0,2.65,'#3f483f','#73796e',.56);
  });
  // The lobe turns through a stationary light. Hold the reflection in engine
  // space and use the moving machined rim as its mask.
  c.clip(this.camBevel,'evenodd');
  c.rotate(-lobeAngle);
  c.drawImage(this.camReflection,-19,-19);
  c.restore();
  c.restore();
 }
 head(m){
  const c=this.c;
  this.headCasting(m);
  this.bake('cam-housing','casting',[279,117,653,58],()=>{
   const valley=this.c.createLinearGradient(0,129,0,173);
   valley.addColorStop(0,'#131714');valley.addColorStop(.25,'#292e27');valley.addColorStop(.7,'#20251f');valley.addColorStop(1,'#51574e');
   this.rr(281,129,633,44,2,valley,'#41483e',.8);
   this.line([[284,169.5],[911,169.5]],'#737669',1.45);
   this.line([[284,171.7],[911,171.7]],'#b1b1a1',.56);
   for(const axis of CAM_AXIS){
    const shaft=this.c.createLinearGradient(0,axis-2.55,0,axis+2.55);
    shaft.addColorStop(0,'#373f37');shaft.addColorStop(.28,'#a0a394');shaft.addColorStop(.49,'#777f73');shaft.addColorStop(1,'#353d34');
    this.line([[292,axis+1],[905,axis+1]],'#141b15',6.2);
    this.line([[292,axis],[905,axis]],shaft,5);
    for(const x of BEARINGS){
     this.rr(x-6,axis-4.7,12,9.4,1.4,'#747b6f','#373f35',.55);
     this.line([[x-4.8,axis-3.3],[x+4.6,axis-3.3]],'#9fa292',.55);
     this.bolt(x,axis,1.8);
    }
   }
  });
  for(let j=0;j<m.cylinders.length;j++){
   const x=X[j],cy=m.cylinders[j];
   this.headChamber(x,cy,m);
   if(cy.active&&m.rpm>0){
    const s=cy.cycle,top=pistonGeometry(m.phase,m.cylinders[j],x).top;
    if(m.ignition==='running'&&!cy.contact.preIgnition)this.drawChamber(cy,x,top);
    this.drawPortFlow(x,-1,s.intakeLps,s.angle,top);
    this.drawPortFlow(x,1,s.exhaustLps,s.angle,top);
   }
   this.valveBank(x,cy,-1);
   this.valveBank(x,cy,1);
  }
  const cover=m.components.cover,loose=cover>=1;
  this.rr(277,127.5,644,4,1,'#4a4c42','#898c7e',.55);
  c.save();c.translate(289,122);c.rotate((Math.sin(m.phase*2)*.004+m.recoil*.004)*cover-(loose?.015:0));
  this.bake('valve-cover','casting',[-15,-34,681,43],()=>{
   const face=this.c.createLinearGradient(0,-14,0,6);
   face.addColorStop(0,'#717165');face.addColorStop(.17,'#232521');face.addColorStop(.44,'#373930');face.addColorStop(.76,'#1a1c19');face.addColorStop(1,'#10120f');
   this.poly([[-12,5],[-12,-7],[-6,-14],[624,-14],[632,-8],[632,5]],face,'#353931',.85);
   this.c.save();this.c.clip();this.c.globalAlpha=.72;this.c.fillStyle=this.c.createPattern(this.oxideTexture,'repeat');this.c.fillRect(-12,-14,645,20);this.c.restore();
   this.texture(-7,-12,633,16,.4);
   this.line([[-6,-13],[624,-13],[630,-8]],'#85897a',.64);
   this.rr(-8,-10.3,636,3.1,1,'#40433b');
   this.line([[-6,-9.9],[625,-9.9]],'#64695d',.55);
   this.rr(-8,1.35,637,2.45,.8,'#3d433a');
   this.line([[-10,4.2],[630,4.2]],'#7f8273',.55);
  });
  if(loose){
   this.poly([[413,5],[488,5],[478,9],[462,8],[444,12],[430,9]],'#735144','#ad8e76',.65);
   this.line([[487,6],[526,7],[547,10],[561,7],[627,8]],'#807363',1);
  }
  for(let k=0;k<12;k++){
   const x=6+k*55;
   if(!loose||k<2)this.bolt(x,-4,2.85,this.t*cover);
   else this.circle(x,-4,2.6,'#302e27','#9a9685',.7);
  }
  c.restore();
 }
 exhaust(m){
  const heat=clamp(((m.headerTemp||165)-230)/450,0,1),metal=heat>.35?'#786f64':'#748085';
  for(let j=0;j<m.cylinders.length;j++){const x=X[j]+49;this.line([[x,192],[x+40,178],[950,192+j*14],[974,277]],'#151e23',16);this.line([[x,190],[x+40,176],[950,190+j*14],[974,276]],metal,11);this.line([[x,187],[x+40,173],[948,187+j*14],[972,273]],'#aab0ab',1);}
  const c=this.c,swing=Math.sin(m.phase*.7)*.013*m.components.exhaust;c.save();c.translate(975,277);c.rotate(swing);
  this.line([[0,0],[0,39],[16,62],[32,62]],'#11181d',25);this.line([[0,0],[0,39],[16,62],[32,62]],this.metal(-10,40),20);
  // Silencer body, rolled seams, weld bead and soot at the open tailpipe.
  this.rr(22,39,89,45,19,this.metal(22,89),'#8c9697',1.2);this.texture(29,46,75,30,.15);
  for(const xx of[30,99])this.line([[xx,43],[xx,80]],'#4e5a60',2.3);
  this.line([[104,62],[126,69]],'#1b2429',20);this.line([[104,60],[126,67]],'#859195',15);
  this.ellipse(127,68,5,9,'#596465','#b9bdb7',1.2);this.ellipse(128,68,3,6.3,'#11191d');
  for(let k=0;k<10;k++)this.line([[-10,7+k*2],[-6,9+k*2]],'#596568',1);
  if(heat>.03){c.globalAlpha=heat*.38;this.line([[0,0],[0,30],[12,51]],'#8d634b',12);c.globalAlpha=1;}
  if((m.headerTemp||0)>560){c.globalAlpha=clamp((m.headerTemp-560)/350,0,.14);this.line([[0,0],[0,29]],'#c16e4e',13);c.globalAlpha=1;}
  if(this.blast>.1){this.poly([[129,63],[148+this.blast*27,72],[132,75]],`rgba(219,166,95,${this.blast*.65})`);}
  this.line([[59,85],[58,105],[83,105]],'#7b8789',2);c.restore();
  this.text('ВЫПУСК '+Math.round(m.egt||300)+' °C',1025,411,9,'#b3aaa0','center');
 }
 relay(m){const c=this.c,r=m.relay;if(!r)return;c.save();c.translate(-75,0);
  // Mounted off-engine: relay and fan do not inherit block vibration.
  this.bake('electrical-panel','static',[112,120,111,140],()=>{
   this.rr(113,122,108,134,5,'#33312a','#8c8371',1);
   this.rr(121,145,92,82,2,'#211f1a','#5d584b',.9);
   this.rr(126,157,32,51,3,'#4a3a2c','#a0805f',1);
   for(let k=0;k<14;k++){
    const y=160+k*3;
    this.line([[128,y],[155,y]],k%2?'#b68154':'#835534',1.3);
   }
   this.text('K1 / FAN · 12 V',124,138,8,'#d5cab7');
   this.text('30',126,240,7,'#ada495');this.text('87',197,240,7,'#ada495');
  });
  const angle=r.closed?0:-.19;c.save();c.translate(166,170);c.rotate(angle);this.line([[0,0],[29,20]],'#bdc4be',3.7);this.circle(29,20,3.3,r.contactTemp>110?'#8f6d48':'#c6c4a7');c.restore();this.line([[194,196],[204,206],[204,227]],'#8a9495',3);this.circle(195,195,3,'#b3a888');
  if(r.arc>.1){this.line([[193,188],[190,192],[195,195]],`rgba(243,211,153,${r.arc})`,1.7);}
  this.rr(183,129,7,3,1,r.closed?'#d9c388':'#605744');this.text(Math.round(r.contactTemp)+'°C',204,240,9,r.contactTemp>110?'#dbad79':'#c9c1b2','right');
  this.line([[128,256],[128,282],[137,295]],'#825d3f',2.1);this.line([[201,256],[201,277],[184,295]],'#4e5046',2.1);
  c.restore();
  this.radiator(m);
 }
 radiator(m){
  const c=this.c;
  c.save();c.translate(-75,0);
  this.bake('radiator','static',[111,292,114,166],()=>{this.rr(114,295,109,158,4,'#273139','#657780',1.1);for(let k=0;k<27;k++)this.line([[121,302+k*5.3],[215,302+k*5.3]],'#4a575c',.8);this.circle(168,365,44,'#162126','#809095',1.2);this.circle(168,365,36,'#26343b');this.text('ЭЛ. ВЕНТИЛЯТОР',169,441,7,'#a5b1b4','center');});
  c.save();c.translate(168,365);c.rotate(m.fanAngle||0);for(let k=0;k<7;k++){c.rotate(TAU/7);this.poly([[-3,-7],[3,-34],[12,-30],[10,-9]],'#8d9898','#526269',.6);}this.circle(0,0,8,'#40515a','#a0aeac',1);c.restore();
  this.text(Math.round(m.relay.fan*2200)+' rpm',169,423,9,'#b6c2c5','center');c.restore();
 }
 event(e,m){if(e.type==='relay'||e.type==='relayHeat')return;super.event(e,m);}
  drawDrop(p){
    const coolant=p.fluid==='coolant',stretch=Math.min(2.2,1.25+p.vy/650);
    this.line([[p.x,p.y],[p.x-p.vx*.009,p.y-p.vy*.009]],coolant?'rgba(89,154,166,.58)':'#0b0e10',p.r*1.15);
    this.ellipse(p.x,p.y,p.r,p.r*stretch,coolant?'#477981':'#111718');
    this.line([[p.x-.5,p.y-1],[p.x-.5,p.y+1]],coolant?'#90c0c4':'#8b8062',.6);
  }
  particles(){const c=this.c;for(const p of this.drops)this.drawDrop(p);
    for(const p of this.debris){c.save();c.translate(p.x,p.y);c.rotate(p.rot);
      if(p.kind==='spark'){c.globalAlpha=Math.max(0,1-p.age/.45);this.line([[0,0],[-p.vx*.015,-p.vy*.015]],'#e4b76e',1.2);}
      else if(p.kind==='bolt'){this.bolt(0,0,5);this.line([[0,3],[0,12]],'#8d9ca2',3);}
      else if(p.kind==='piston'){this.rr(-26,-20,52,40,4,this.metal(-26,52),'#bfc7c7',2);for(let k=0;k<3;k++)this.line([[-26,-14+k*5],[26,-14+k*5]],'#28383f',2);}
      else if(p.kind==='rod'){this.line([[-20,-23],[17,22]],'#99a8ad',10);this.circle(17,22,10,'#50666f','#a9b9bc',2);}
      else this.poly([[-p.size,0],[0,-p.size*.7],[p.size,1],[0,p.size*.4]],'#84959c','#b6c2c3',.5);
      c.restore();}
  }
 engine(m){this.relay(m);super.engine(m);}
 reset(){super.reset();this.cache?.clear();this.extraSmoke=0;this.effectsClock=0;}
}
root.Piston.Renderer=Renderer;
})(window);
