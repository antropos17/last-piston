/* Detailed longitudinal I4 projection. The two valve pairs are unfolded for inspection. */
(function(root){
'use strict';
const {Renderer:Workshop,clamp,pistonGeometry,TAU,cycleState}=root.Piston;
const X=[373,517,661,805],BEARINGS=[307,445,589,733,871];
const noise=(n)=>{const v=Math.sin(n*127.1+31.7)*43758.5453;return v-Math.floor(v);};
const COLORS=['#d5a477','#a89f94','#83a8b0','#babfc5'];
const HEAT_SCALE=[[80,87,145,157],[140,183,148,71],[210,228,114,51],[310,209,65,48]];
function heatColor(temp,opacity){
 const value=clamp(temp,80,310);
 const hi=HEAT_SCALE.findIndex(stop=>stop[0]>=value);
 if(hi===0)return `rgba(87,145,157,${opacity})`;
 const a=HEAT_SCALE[hi-1],b=HEAT_SCALE[hi],t=(value-a[0])/(b[0]-a[0]);
 const rgb=a.slice(1).map((channel,i)=>Math.round(channel+(b[i+1]-channel)*t));
 return `rgba(${rgb.join(',')},${opacity})`;
}
const WIDE_VIEW={x:618,y:340,z:1};
const BORE_RADIUS=51,BORE_TOP=232,BORE_BOTTOM=416;
class Renderer extends Workshop{
 constructor(canvas){
  super(canvas);this.mode='section';this.zoom=1;this.focus=1;
  this.camera={...WIDE_VIEW};this.cameraMove=null;
  this.drivePhase=null;this.beltTravel=0;this.idlerAngle=0;
  this.makeDetailTextures();
  this.makeCrankSurfaces();
 }
 metal(x,w,dark=false){
  const g=this.c.createLinearGradient(x,0,x+w,0);
  const stops=dark?[[0,'#373936'],[.15,'#6f716b'],[.31,'#565952'],[.73,'#464944'],[1,'#272a28']]:
   [[0,'#71746f'],[.12,'#a8aba3'],[.28,'#c8cac1'],[.43,'#aeb1a8'],[.65,'#8b8f88'],[.84,'#696e69'],[1,'#4b504c']];
  stops.forEach(([p,col])=>g.addColorStop(p,col));return g;
 }
 bolt(x,y,r=5,a=0){
  const c=this.c,points=[];
  this.ellipse(x+.45,y+.75,r*1.29,r*1.2,'#1f211f');
  this.circle(x,y,r*1.13,'#6c6e66');
  for(let j=0;j<6;j++)points.push([x+Math.cos(a+j*TAU/6)*r,y+Math.sin(a+j*TAU/6)*r]);
  const face=c.createLinearGradient(x-r,y-r,x+r,y+r);
  face.addColorStop(0,'#c7c9be');face.addColorStop(.44,'#8c9086');face.addColorStop(1,'#525650');
  this.poly(points,'#424640');
  this.poly(points.map(([px,py])=>[x+(px-x)*.81,y+(py-y)*.81]),face);
  if(r>3)this.line([[x-r*.42,y-r*.4],[x+r*.22,y-r*.4]],'#d1d2c475',.45);
 }
 makeDetailTextures(){
  const w=BORE_RADIUS*2,h=BORE_BOTTOM-BORE_TOP;
  this.boreTexture=document.createElement('canvas');this.boreTexture.width=w;this.boreTexture.height=h;
  const c=this.boreTexture.getContext('2d'),pixels=c.createImageData(w,h);
  const surface=x=>Math.asin((x-BORE_RADIUS)/BORE_RADIUS);
  for(let x=0;x<w;x++){
   const angle=surface(x+.5);
   const diffuse=Math.max(0,Math.cos(angle+.41)),glare=Math.exp(-((angle+.53)**2)/.054);
   for(let y=0;y<h;y++){
    const shade=1-.58*Math.exp(-y/19)-.39*Math.exp((y-h)/15);
    const grain=(noise(x*31+y*102)-.5)*7+(noise(x*7)-.5)*3;
    const tone=17+(16+51*diffuse**2+24*glare)*shade+grain;
    const i=(x+y*w)*4;
    pixels.data[i]=tone;pixels.data[i+1]=tone+3;pixels.data[i+2]=tone+3+5*glare;pixels.data[i+3]=255;
   }
  }
  c.putImageData(pixels,0,0);
  // The honing marks follow the cylinder surface across the open half-bore.
  for(let i=-27;i<86;i++){
   const pitch=19+noise(i+71)*4,y=i*3+noise(i+35)*1.1;
   for(const sign of [-1,1]){
    c.beginPath();
    for(let x=0;x<=w;x+=3){
     const cy=y+surface(x)*pitch*sign;
     if(x===0)c.moveTo(x,cy);else c.lineTo(x,cy);
    }
    c.strokeStyle=sign>0?`rgba(205,206,193,${.015+noise(i+90)*.042})`:'rgba(14,16,15,.10)';
    c.lineWidth=.39;c.stroke();
   }
  }
  const deckShadow=c.createLinearGradient(0,0,0,25);
  deckShadow.addColorStop(0,'#100e0ccc');deckShadow.addColorStop(1,'#211c1500');
  c.fillStyle=deckShadow;c.fillRect(0,0,w,25);
  for(let x=0;x<w;x++){
   const band=2.6+2*Math.cos(x*.073)+noise(x)*2.2;
   c.fillStyle='rgba(22,19,15,.79)';c.fillRect(x,0,1,band);
   c.fillStyle='rgba(57,43,28,.57)';c.fillRect(x,band,1,1+noise(x+45)*2);
  }
  this.castTexture=document.createElement('canvas');this.castTexture.width=this.castTexture.height=128;
  const q=this.castTexture.getContext('2d'),grain=q.createImageData(128,128);
  for(let y=0;y<128;y++)for(let x=0;x<128;x++){
   const i=(x+128*y)*4,n=noise(x+128*y),neighbor=noise(((x+1)%128)+128*((y+1)%128));
   const value=(neighbor-n)*24+(noise((x>>1)+64*(y>>1))-.5)*11,light=value>0?225:16;
   grain.data[i]=light;grain.data[i+1]=light;grain.data[i+2]=light-2;
   grain.data[i+3]=Math.abs(value)*2.55;
  }
  q.putImageData(grain,0,0);
  // A repeating oxide film: broad patches of mill scale break into granular rust.
  this.oxideTexture=document.createElement('canvas');this.oxideTexture.width=this.oxideTexture.height=128;
  const oxide=this.oxideTexture.getContext('2d'),film=oxide.createImageData(128,128);
  this.sootPatch=document.createElement('canvas');this.sootPatch.width=this.sootPatch.height=128;
  const soot=this.sootPatch.getContext('2d'),dust=soot.createImageData(128,128);
  const mottling=(x,y,step)=>{
   const a=Math.floor(x/step),b=Math.floor(y/step),u=x%step/step,v=y%step/step,n=128/step;
   const cell=(i,j)=>noise((i%n)+37*(j%n)+step);
   return (cell(a,b)*(1-u)+cell(a+1,b)*u)*(1-v)+(cell(a,b+1)*(1-u)+cell(a+1,b+1)*u)*v;
  };
  for(let y=0;y<128;y++)for(let x=0;x<128;x++){
   const i=4*(128*y+x),pit=noise(x+128*y);
   const rust=clamp((mottling(x,y,32)*.58+mottling(x,y,8)*.30+pit*.12-.38)*3.1,0,1);
   film.data[i]=21+rust*(85+pit*49);film.data[i+1]=22+rust*(28+pit*29);
   film.data[i+2]=19+rust*(9+pit*15);film.data[i+3]=67+rust*156;
   const mottled=mottling(x,y,16),radius=Math.hypot((x-64)/64,(y-64)/64);
   const deposit=clamp((1-radius)*1.65+(mottled-.53)*.51,0,1)*clamp((1-radius)*6,0,1);
   dust.data[i]=18+pit*15;dust.data[i+1]=17+pit*13;dust.data[i+2]=15+pit*11;
   dust.data[i+3]=deposit*(149+106*pit);
  }
  oxide.putImageData(film,0,0);
  soot.putImageData(dust,0,0);
 }
 makeCrankSurfaces(){
  const face=new Path2D();face.moveTo(-16,-9);face.lineTo(-27,23);
  face.quadraticCurveTo(-35,49,-14,51);face.lineTo(14,51);
  face.quadraticCurveTo(35,49,27,23);face.lineTo(16,-9);face.closePath();
  this.counterweightFace=face;
  const rim=new Path2D();
  rim.moveTo(-26,22);rim.quadraticCurveTo(-34,47,-14,50);rim.lineTo(14,50);rim.quadraticCurveTo(31,50,30,33);
  this.counterweightRim=rim;
  this.crankShadow=document.createElement('canvas');this.crankShadow.width=this.crankShadow.height=64;
  const c=this.crankShadow.getContext('2d'),soft=c.createRadialGradient(32,32,4,32,32,31);
  soft.addColorStop(0,'#080a09cb');soft.addColorStop(.40,'#080a098e');soft.addColorStop(.72,'#080a0942');soft.addColorStop(1,'#080a0900');
  c.fillStyle=soft;c.fillRect(0,0,64,64);
 }
 update(dt,m){super.update(dt,m);const f=this.reduced?.06:1,broken=m.cylinders.length-m.activeCount;
  if(this.drivePhase!==null){
   const delta=(m.phase-this.drivePhase+TAU*2)%(TAU*2);
   this.beltTravel=(this.beltTravel+delta*19)%10;
   this.idlerAngle=(this.idlerAngle-delta*19/22)%TAU;
  }
  this.drivePhase=m.phase;
  const speed=clamp(m.rpm/750,0,1);
  const amp=((1.45+m.throttle*1.35+broken*.65+m.mountWear*.9)*speed+Math.min(this.impulse*.32,2.7))*f;
  this.pose={x:this.spring.x*f+Math.sin(m.phase*2)*amp,y:this.spring.y*f+Math.cos(m.phase*2)*amp*.48,a:this.spring.roll*f+Math.sin(m.phase)*amp*.0006};
 }
 setView(mode){if(['section','oil','thermal','damage'].includes(mode))this.mode=mode;}
 setFocus(i){this.focus=clamp(i,0,3);this.lookAt({x:X[this.focus],y:320,z:1.8});}
 setGeneral(){this.lookAt(WIDE_VIEW);}
 lookAt(to){
  this.zoom=to.z;
  if(this.reduced){this.camera={...to};this.cameraMove=null;return;}
  this.cameraMove={from:this.camera,to,start:performance.now()};
 }
 updateCamera(now){
  if(!this.cameraMove)return false;
  const {from,to,start}=this.cameraMove;
  const t=this.reduced?1:clamp((now-start)/240,0,1),ease=t*t*(3-2*t);
  this.camera={x:from.x+(to.x-from.x)*ease,y:from.y+(to.y-from.y)*ease,z:from.z+(to.z-from.z)*ease};
  if(t===1)this.cameraMove=null;
  return true;
 }
 engineTransform(){const c=this.c,p=this.pose;c.translate(590+p.x,540+p.y);c.rotate(p.a);c.translate(-590,-540);}
 texture(x,y,w,h,alpha=.5){const c=this.c;c.save();c.beginPath();c.rect(x,y,w,h);c.clip();c.globalAlpha=alpha;c.fillStyle=c.createPattern(this.castTexture,'repeat');c.fillRect(x,y,w,h);c.restore();}
 hatch(x,y,w,h){const c=this.c;c.save();c.beginPath();c.rect(x,y,w,h);c.clip();for(let d=-h;d<w;d+=5)this.line([[x+d,y+h],[x+d+h,y]],'rgba(14,22,25,.24)',.65);c.restore();}
 background(m,left=0,right=1200){
  const c=this.c,width=right-left,wall=c.createLinearGradient(80,40,980,604);
  wall.addColorStop(0,'#555650');wall.addColorStop(.32,'#494b46');wall.addColorStop(.7,'#363936');wall.addColorStop(1,'#252926');
  c.fillStyle=wall;c.fillRect(left,0,width,604);
  this.texture(left,45,width,550,.34);
  for(const x of [-128,12,236,976,1191,1335]){
   this.line([[x+2,48],[x+2,587]],'#181b17',2);
   this.line([[x,48],[x,587]],'#81827a55',1.25);
  }
  // Perforated acoustic baffles sit in recessed frames in the test cell.
  for(const [x,w] of [[26,188],[989,181]]){
   const liner=c.createLinearGradient(x,90,x+w,550);
   liner.addColorStop(0,'#353831');liner.addColorStop(.45,'#262a27');liner.addColorStop(1,'#181c19');
   this.rr(x-4,84,w+8,487,3,'#252824','#62645a',.8);
   this.rr(x,90,w,475,1,liner);
   c.beginPath();
   for(let y=98;y<559;y+=5.5)for(let xx=x+6+(Math.round(y/5.5)%2)*2.7;xx<x+w-4;xx+=5.4){
    c.moveTo(xx+.73,y);c.arc(xx,y,.73,0,TAU);
   }
   c.fillStyle='#10141085';c.fill();
   this.line([[x,564],[x+w,564]],'#72736939',1);
   for(const xx of [x+5,x+w-5])for(const y of [94,561])this.circle(xx,y,1.25,'#88897c');
  }
  const rearShadow=c.createRadialGradient(612,323,80,627,336,394);
  rearShadow.addColorStop(0,'#10140f83');rearShadow.addColorStop(.62,'#15181453');rearShadow.addColorStop(1,'#16191900');
  c.fillStyle=rearShadow;c.fillRect(180,55,850,524);
  const roomLight=c.createRadialGradient(441,50,24,449,83,576);
  roomLight.addColorStop(0,'#efe5c935');roomLight.addColorStop(.27,'#e1dbc025');roomLight.addColorStop(1,'#ece8d700');
  c.fillStyle=roomLight;c.fillRect(left,26,width,545);
  this.rr(left,0,width,43,0,'#343832');
  this.line([[left,44],[right,44]],'#151814',4);
  this.line([[left,47],[right,47]],'#b4b1a155',1);
  this.rr(281,14,369,13,2,'#242823','#777b70',.75);
  const lamp=c.createLinearGradient(281,0,650,0);
  lamp.addColorStop(0,'#aaa899');lamp.addColorStop(.12,'#e0dfcf');lamp.addColorStop(.7,'#f9f1db');lamp.addColorStop(1,'#9d9d8f');
  this.rr(291,20,349,4.7,1,lamp);
  this.rr(left,589,width,15,0,'#282b27');
  this.line([[left,590],[right,590]],'#73776b77',.85);
  this.line([[left,603],[right,603]],'#8a8b803f',.85);
  const floor=c.createLinearGradient(0,604,0,680);
  floor.addColorStop(0,'#42443e');floor.addColorStop(.32,'#3a3b37');floor.addColorStop(1,'#2a2d2a');
  c.fillStyle=floor;c.fillRect(left,604,width,76);
  this.texture(left,605,width,75,.36);
  c.save();c.translate(582,613);c.scale(1,.07);
  const shadow=c.createRadialGradient(0,0,50,0,0,465);
  shadow.addColorStop(0,'rgba(16,13,10,.78)');shadow.addColorStop(.6,'rgba(16,13,10,.46)');shadow.addColorStop(1,'rgba(16,13,10,0)');
  this.circle(0,0,465,shadow);c.restore();
  for(const x of [48,296,549,803,1052,1303]){
   const end=x+(x-560)*.12;
   this.line([[x,605],[end,680]],'#15191578',.8);
   this.line([[x+1,605],[end+1,680]],'#a4a79829',.6);
  }
 }
 floorStains(){
  const c=this.c;
  for(const p of this.stains){
   c.save();c.globalAlpha=p.fluid==='coolant'?clamp(1-p.age/24,0,.8):.86;
   this.ellipse(p.x,612,p.r*1.7,p.r*.36,p.fluid==='coolant'?'#35555b':'#111516');
   this.ellipse(p.x+p.r*.2,611,p.r*.86,.65,p.fluid==='coolant'?'#739da1':'#3b4744');
   c.restore();
  }
 }
 stand(m){
  this.floorStains();
  this.bake('engine-stand','fixed',[244,565,692,49],()=>{
   const c=this.c,beam=c.createLinearGradient(0,589,0,606);
   beam.addColorStop(0,'#676b64');beam.addColorStop(.23,'#50534d');beam.addColorStop(.31,'#3d403b');beam.addColorStop(1,'#252923');
   this.poly([[253,596],[273,590],[912,590],[929,596],[929,604],[253,604]],beam);
   this.line([[255,595.5],[927,595.5]],'#a3a3978c',.85);
   this.line([[259,605],[922,605]],'#181b17a8',1.6);
   for(const x of[337,844]){
    const leg=c.createLinearGradient(x-31,576,x+35,590);
    leg.addColorStop(0,'#696d65');leg.addColorStop(.3,'#485047');leg.addColorStop(1,'#2b302b');
    this.poly([[x-34,591],[x-23,573],[x-13,567],[x+14,567],[x+23,574],[x+36,591]],leg,'#333833',.85);
    this.poly([[x-23,587],[x-13,574],[x+13,574],[x+23,587]],'#2c322d');
    this.line([[x-27,586],[x-17,570],[x+13,570]],'#92978b92',.83);
    this.rr(x-40,587,81,9,1,'#555b52');
    this.line([[x-39,588],[x+39,588]],'#858a77',.7);
    this.bolt(x-29,591,3.4);this.bolt(x+29,591,3.4);
   }
  });
  for(const x of[337,844]){
   const p=this.world(x,553),damage=x<400?m.components.leftMount:m.components.rightMount;
   if(damage>=1){
    // Torn rubber stays attached to its two metal plates.
    this.poly([[x-14,576],[x-9,568],[x-4,572],[x+1,567],[x+7,572],[x+12,569],[x+14,576]],'#222b2d','#6b7371',.9);
    this.poly([[p.x-13,p.y+4],[p.x+13,p.y+4],[p.x+11,p.y+12],[p.x+5,p.y+10],[p.x,p.y+13],[p.x-6,p.y+9],[p.x-11,p.y+13]],'#30383a','#8c9590',1);
   }else{
    this.poly([[x-14,576],[p.x-12,p.y+7],[p.x+12,p.y+7],[x+14,576]],'#202728','#66716f',1);
    const crack=clamp((damage-.25)/.75,0,1);
    this.fracture([[p.x-11,p.y+10],[p.x-4,p.y+13],[x+1,566],[x-4,570],[x+9,574]],crack,1.2+crack*1.2);
    this.line([[x-11,574],[x+11,574]],'#465052',.9);
   }
   this.line([[p.x-13,p.y+5],[p.x+13,p.y+5]],'#b29971',2);
  }
 }
 block(m){
  const c=this.c;
  const cast=c.createLinearGradient(266,198,795,557);
  cast.addColorStop(0,'#62635a');cast.addColorStop(.34,'#41443c');cast.addColorStop(1,'#292c27');
  const sidewall=c.createLinearGradient(909,0,930,0);
  sidewall.addColorStop(0,'#656b62');sidewall.addColorStop(.44,'#4e5750');sidewall.addColorStop(1,'#2b332c');
  this.rr(907,226,23,298,4,sidewall,'#2a312b',.9);
  this.line([[926,232],[926,517]],'#848b7985',.8);
  const block=new Path2D();block.moveTo(290,218);block.lineTo(902,218);
  block.quadraticCurveTo(915,218,915,234);block.lineTo(915,526);block.quadraticCurveTo(913,544,900,549);
  block.lineTo(286,549);block.quadraticCurveTo(277,545,276,537);block.lineTo(276,488);
  block.lineTo(281,470);block.lineTo(281,247);block.lineTo(276,236);block.quadraticCurveTo(276,222,290,218);block.closePath();
  c.save();c.clip(block);c.fillStyle=cast;c.fillRect(275,216,644,336);
  c.fillStyle=c.createPattern(this.oxideTexture,'repeat');c.fillRect(275,216,644,336);
  this.texture(275,217,644,334,.63);c.restore();
  this.line([[282,239],[282,229],[290,223],[899,223]],'#c9c9b79c',.75);
  const cutFace=c.createLinearGradient(280,219,910,547);
  cutFace.addColorStop(0,'#babcb1');cutFace.addColorStop(.49,'#a7a99e');cutFace.addColorStop(1,'#797d73');
  this.rr(289,229,613,317,8,cutFace);
  this.line([[900,243],[900,523],[890,538]],'#49524b',1.4);
  this.rr(295,234,601,308,5,'#242923','#1f2421',1.5);
  const cavity=c.createLinearGradient(0,410,0,550);
  cavity.addColorStop(0,'#1e211c');cavity.addColorStop(.4,'#33372e');cavity.addColorStop(.68,'#2c3029');cavity.addColorStop(1,'#181c18');
  this.rr(301,401,590,147,4,cavity);
  for(const {id} of m.cylinders){const x=X[id];
   const bay=c.createRadialGradient(x-7,464,4,x+9,479,77);
   bay.addColorStop(0,'#4f5753');bay.addColorStop(.46,'#343b38');bay.addColorStop(1,'#171d1b');
   const well=new Path2D();well.moveTo(x-56,404);well.lineTo(x+52,404);
   well.quadraticCurveTo(x+67,434,x+60,481);well.bezierCurveTo(x+57,521,x+41,539,x,540);
   well.bezierCurveTo(x-41,539,x-62,516,x-63,478);well.quadraticCurveTo(x-63,433,x-56,404);well.closePath();
   c.fillStyle=bay;c.fill(well);c.strokeStyle='#151d17';c.lineWidth=2.2;c.stroke(well);
   const shade=c.createLinearGradient(x-54,419,x+56,531);
   shade.addColorStop(0,'#181d18a2');shade.addColorStop(.48,'#151a1600');shade.addColorStop(1,'#080c09a8');
   c.fillStyle=shade;c.fill(well);
   const lip=new Path2D();lip.moveTo(x-59,425);lip.quadraticCurveTo(x-75,492,x-47,522);lip.quadraticCurveTo(x-31,539,x-6,541);
   c.lineWidth=2.9;c.strokeStyle='#151b1691';c.stroke(lip);
   c.lineWidth=1.1;c.strokeStyle='#828b7883';c.stroke(lip);
  }
  // The bulkheads broaden into the cast bosses around the main bearings.
  for(const x of BEARINGS){
   const web=c.createLinearGradient(x-16,423,x+18,446);
   web.addColorStop(0,'#71756b');web.addColorStop(.23,'#585d53');web.addColorStop(.56,'#484e45');web.addColorStop(1,'#282e27');
   const rib=new Path2D();rib.moveTo(x-9,392);rib.lineTo(x+9,392);rib.quadraticCurveTo(x+9,435,x+22,453);
   rib.quadraticCurveTo(x+15,517,x+24,541);rib.lineTo(x-23,541);rib.quadraticCurveTo(x-12,517,x-20,452);
   rib.quadraticCurveTo(x-10,427,x-9,392);rib.closePath();
   c.save();c.clip(rib);c.fillStyle=web;c.fillRect(x-25,390,52,152);this.texture(x-23,393,47,149,.45);c.restore();
   this.line([[x-11,418],[x-16,448],[x-12,480],[x-15,529]],'#b0afa368',.85);
   this.rr(x-4,414,8,29,4,'#2b322a');
  }
  for(let j=0;j<m.cylinders.length;j++){
   const x=X[j];
   this.rr(x-66,232,132,185,2,'#51564e');
   const machined=c.createLinearGradient(x-62,233,x+63,414);
   machined.addColorStop(0,'#c0c5bc');machined.addColorStop(.28,'#a4aea9');machined.addColorStop(.73,'#828c88');machined.addColorStop(1,'#606d68');
   this.rr(x-62,232,124,183,2,machined);
   for(const side of[-1,1]){
    const edge=x+side*57;
    this.rr(edge-4.3,241,8.6,160,3.3,'#383d35','#827f70',.55);
   }
   c.drawImage(this.boreTexture,x-BORE_RADIUS,BORE_TOP);
   this.texture(x-62,233,8,180,.31);this.texture(x+54,233,8,180,.31);
   this.line([[x-51,231],[x+51,231]],'#c3c6b8',1);
   this.line([[x-51.5,233],[x-51.5,411]],'#d0d1c0ad',.7);
   this.line([[x-49.8,234],[x-49.8,412]],'#202622a8',1);
   this.line([[x+51.2,234],[x+51.2,412]],'#535d54',.9);
   this.line([[x-49,415],[x+49,415]],'#282e27',1.45);
   this.linerDamage(x,m.cylinders[j]);
  }
  for(const x of[285,905])for(let y=246;y<520;y+=44)this.bolt(x,y,4.2);
 }
 linerDamage(x,cy){const d=cy.contact,c=this.c,amount=Math.max(d.liner,cy.wear*.22);c.save();c.beginPath();c.rect(x-50,233,100,181);c.clip();
  const n=Math.floor(amount*24);
  if(d.liner>.25){
   const glazing=c.createLinearGradient(x+25,258,x+49,261);
   glazing.addColorStop(0,'#8d7c5e00');glazing.addColorStop(.5,`rgba(150,134,104,${d.liner*.28})`);glazing.addColorStop(1,'#554b3900');
   c.fillStyle=glazing;c.fillRect(x+25,246,25,148);
  }
  for(let i=0;i<n;i++){const side=i%3===0?-1:1,sx=x+side*(30+noise(i+cy.id*39)*18),y=238+noise(i+17)*103,len=25+noise(i+8)*91;
   const score=c.createLinearGradient(0,y,0,y+len);
   score.addColorStop(0,'#12161100');score.addColorStop(.16,'#141713ba');score.addColorStop(.72,'#1417139a');score.addColorStop(1,'#14171300');
   this.line([[sx,y],[sx+.4,y+len]],score,.7+noise(i)*1.6);
   this.line([[sx-.64,y+3],[sx-.21,y+len*.79]],'rgba(196,198,178,.43)',.52);
   if(i%4===0)this.line([[sx+1.4,y+6],[sx+1.65,y+len-8]],'rgba(151,114,79,.28)',1.22);
  }
  c.restore();
 }
 crankShadows(m){
  const c=this.c,shadow=this.crankShadow;
  c.save();c.beginPath();c.rect(299,414,593,133);c.clip();
  for(let j=0;j<m.cylinders.length;j++){
   const x=X[j],cy=m.cylinders[j],a=m.phase-cy.offset,g=pistonGeometry(m.phase,m.cylinders[j],x);
   c.save();c.translate(x+12-Math.sin(a)*28,471+Math.cos(a)*28);c.rotate(a);
   c.globalAlpha=.78;c.drawImage(shadow,-40,-33,80,66);c.restore();
   c.globalAlpha=.75;c.drawImage(shadow,g.crankX-18,g.crankY-12,61,56);
   if(cy.active&&this.performanceMode!=='eco'){
    c.save();c.translate(x+8,g.pinY+12);c.rotate(-Math.atan2(g.crankX-x,g.crankY-g.pinY));
    c.globalAlpha=.66;c.drawImage(shadow,-13,17,26,155);c.restore();
   }
  }
  c.restore();
 }
 crank(m){const c=this.c;
  this.bake('shaft-bearing-surface','fixed',[254,441,674,41],()=>{
   const shaft=this.c.createLinearGradient(0,449,0,472);
   [[0,'#4a514a'],[.16,'#7b8578'],[.28,'#a8ada0'],[.44,'#727d71'],[.66,'#4a554c'],[1,'#242d26']].forEach(([p,v])=>shaft.addColorStop(p,v));
   const body=this.c.createLinearGradient(0,449,0,473);
   body.addColorStop(0,'#343d35');body.addColorStop(.32,'#565f54');body.addColorStop(.58,'#434e45');body.addColorStop(1,'#202721');
   this.rr(257,448,668,25,8,'#181e19');
   this.rr(263,451,658,20,6,body);
   for(const x of BEARINGS){
    this.rr(x-29,447,58,27,5,'#2a312a');this.rr(x-25,448,50,23,2,shaft);
    this.line([[x-25,449],[x-25,470]],'#c2cab687',1);
    this.line([[x+26,450],[x+26,469]],'#161f18',1.2);
   }
   this.rr(893,453,29,13,2,shaft);
  });
  for(let j=0;j<m.cylinders.length;j++){const x=X[j],a=m.phase-m.cylinders[j].offset,g=pistonGeometry(m.phase,m.cylinders[j],x);
   c.save();c.translate(x,460);c.rotate(a);
   this.bake('counterweight','fixed',[-34,-12,68,68],()=>{
    const q=this.c,shape=this.counterweightFace;
    q.fillStyle='#4e5653';q.fill(shape);q.save();q.clip(shape);this.texture(-36,-12,72,66,.33);
    // Concentric tool marks on the turned outer edge of the crank web.
    for(let r=40;r<53;r+=2.6){
     q.beginPath();q.arc(0,0,r,0,Math.PI);q.strokeStyle='rgba(188,194,181,.28)';q.lineWidth=.54;q.stroke();
    }
    q.restore();
    q.strokeStyle='#242d27';q.lineWidth=.9;q.stroke(shape);
    this.ellipse(-12,34,3.5,3.1,'#333a34','#838b7a',.6);
    this.ellipse(-11.5,34.65,2.5,2.1,'#212822');
   });
   this.lightCounterweight(a);
   c.restore();
   const axisX=g.crankX-x,axisY=g.crankY-460,r=Math.hypot(axisX,axisY),nx=-axisY/r,ny=axisX/r;
   const pinWeb=c.createLinearGradient(x+nx*13,460+ny*13,x-nx*13,460-ny*13);
   const light=clamp((nx*-.58+ny*-.82+1)*.5,0,1);
   pinWeb.addColorStop(0,`rgba(158,168,152,${light*.73+.15})`);
   pinWeb.addColorStop(.4,'#5d685e');pinWeb.addColorStop(1,'#303b33');
   this.line([[x+2.6,463],[g.crankX+2.6,g.crankY+3]],'#151f18',29);
   this.line([[x,460],[g.crankX,g.crankY]],'#364238',25);
   this.line([[x,460],[g.crankX,g.crankY]],pinWeb,24.5);
   this.circle(g.crankX,g.crankY,17.3,this.metal(g.crankX-17,34),'#3a483f',.8);
  }
 }
 lightCounterweight(angle){
  const c=this.c,cos=Math.cos(angle),sin=Math.sin(angle);
  // Convert the stationary upper-left work light into the rotating face's axes.
  const lx=-.55*cos-.84*sin,ly=.55*sin-.84*cos;
  const key=c.createLinearGradient(-lx*40,24-ly*40,lx*40,24+ly*40);
  key.addColorStop(0,'#11181393');key.addColorStop(.47,'#273a2600');key.addColorStop(.76,'#b3baac32');key.addColorStop(1,'#e1dfcaa1');
  c.fillStyle=key;c.fill(this.counterweightFace);
  c.strokeStyle=key;c.lineWidth=2.25;c.stroke(this.counterweightRim);
 }
 rod(x1,y1,x2,y2,damage=0,broken=false,bend=0){
  const c=this.c,len=Math.hypot(x2-x1,y2-y1);c.save();c.translate(x1,y1);c.rotate(-Math.atan2(x2-x1,y2-y1));
  const shoulder=Math.min(22,len*.32),hip=Math.max(shoulder,len-23);
  c.beginPath();c.moveTo(-8,1);c.quadraticCurveTo(-8,12,-6,shoulder);
  c.quadraticCurveTo(-6+bend,(shoulder+hip)*.5,-6,hip);c.quadraticCurveTo(-9,len-20,-17,len-10);c.lineTo(-17,len+6);
  c.lineTo(17,len+6);c.lineTo(17,len-10);c.quadraticCurveTo(9,len-20,6,hip);
  c.quadraticCurveTo(6+bend,(shoulder+hip)*.5,6,shoulder);c.quadraticCurveTo(8,12,8,1);c.closePath();
  const web=c.createLinearGradient(-8,0,11,len*.35);
  web.addColorStop(0,'#aab0a6');web.addColorStop(.36,'#787f74');web.addColorStop(.7,'#5e675d');web.addColorStop(1,'#424d44');
  c.fillStyle=web;c.fill();c.strokeStyle='#343c34';c.lineWidth=.68;c.stroke();
  c.save();c.clip();this.texture(-20,-1,40,len+10,.39);c.restore();
  if(!broken){
   const inset=c.createLinearGradient(-4,shoulder,4,shoulder);
   inset.addColorStop(0,'#384137');inset.addColorStop(.27,'#565f54');inset.addColorStop(.66,'#677267');inset.addColorStop(1,'#444f44');
   c.beginPath();c.moveTo(-1.4,shoulder-4);c.quadraticCurveTo(-3.5,shoulder-5,-3.5,shoulder+1);
   c.quadraticCurveTo(-3.7+bend,(shoulder+hip)*.5,-3.9,hip-2);c.quadraticCurveTo(-3.8,hip+4,-.2,hip+7);
   c.quadraticCurveTo(4.1,hip+6,3.9,hip+1);c.quadraticCurveTo(3.7+bend,(shoulder+hip)*.5,3.5,shoulder+1);c.quadraticCurveTo(3.7,shoulder-4,-1.4,shoulder-4);
   c.fillStyle=inset;c.fill();
   c.beginPath();c.moveTo(-5.4,shoulder-5);c.quadraticCurveTo(-5.2+bend,(shoulder+hip)*.5,-5,hip-1);c.lineTo(-7,hip+7);
   c.strokeStyle='#c1c7b690';c.lineWidth=.78;c.stroke();
   c.beginPath();c.moveTo(4,shoulder+3);c.quadraticCurveTo(4.05+bend,(shoulder+hip)*.5,4.1,hip+1);
   c.strokeStyle='#232e2496';c.lineWidth=.82;c.stroke();
  }
  this.circle(0,len,21,this.metal(-21,42,true),'#383a31',1);
  const cap=c.createLinearGradient(0,len,0,len+22);
  cap.addColorStop(0,'#9b9889');cap.addColorStop(.22,'#686a60');cap.addColorStop(1,'#42463d');
  this.poly([[-21,len],[-21,len+11],[-13,len+20],[13,len+20],[21,len+11],[21,len]],cap,'#41443c',.8);
  this.line([[-21,len],[21,len]],'#282a24',1.15);
  const journal=c.createLinearGradient(-18,len-15,16,len+17);
  [[0,'#6d7269'],[.28,'#92968a'],[.41,'#bebeb2'],[.55,'#abad9f'],[.68,'#7e8378'],[1,'#5f645b']].forEach(([at,col])=>journal.addColorStop(at,col));
  this.circle(0,len,17.1,'#b0a691','#504b3b',.75);
  this.circle(0,len,15.5,journal,'#40463d',.65);
  for(const r of [8,11.1,13.8,14.7])this.circle(0,len,r,null,'rgba(47,52,44,.22)',.4);
  this.circle(3.8,len-4.6,1.55,'#282e24','#969989',.55);
  for(const x of [-18.3,18.3]){
   this.line([[x,len-3.5],[x,len+9]],'#b1b0a1',1.5);
   this.rr(x-2.9,len+8.4,5.8,3.5,.5,'#898b7f','#31342e',.7);
  }
  if(damage>.3)this.circle(0,len,16.7,null,`rgba(123,75,41,${damage*.73})`,1.3);
  if(broken){
   this.poly([[-8,2],[-6,-2],[-2,0],[1,-3],[4,1],[8,-.8],[8,3],[1,4]],'#a2a89b');
   this.poly([[-6,-2],[-2,0],[1,-3],[.3,2],[-4.6,3]],'#737e73');
  }
  c.restore();
 }
 brokenRodStem(x,pin){
  // The upper half keeps the small end on the wrist pin. Only the crank
  // half carries a big end.
  this.poly([[x-9,pin],[x+8,pin],[x+3,pin+23],[x-1,pin+26],[x-4,pin+23],
   [x-8,pin+28],[x-11,pin+24]],this.metal(x-11,19),'#383e37',.65);
  this.poly([[x-4,pin+6],[x+3,pin+6],[x-1,pin+20],[x-6,pin+20]],'#49554a');
  this.poly([[x-11,pin+24],[x-8,pin+28],[x-4,pin+23],[x-1,pin+26],[x+3,pin+23],[x-2,pin+21],[x-7,pin+23]],'#929b8e');
 }
 piston(m,j){
  const c=this.c,cy=m.cylinders[j],x=X[j],g=pistonGeometry(m.phase,m.cylinders[j],x),f=pistonGeometry(cy.freeze,m.cylinders[j],x),d=cy.contact;
  const top=cy.active?g.top:f.top,pin=cy.active?g.pinY:f.pinY;
  if(cy.active){
   const s=cy.cycle,fill=COLORS[s.stroke],alpha=s.stroke===0&&cy.lit?.08+cy.pulse*.28:s.stroke===2?.07:.035;
   c.save();c.beginPath();c.rect(x-49,231,98,184);c.clip();c.globalAlpha=alpha;c.fillStyle=fill;c.fillRect(x-49,231,98,Math.max(0,top-231));c.globalAlpha=1;
   if(s.stroke===0&&cy.lit&&s.angle<.6){const fire=1-s.angle/.6;c.fillStyle=`rgba(249,210,138,${fire*.7})`;c.fillRect(x-44,232,88,Math.max(0,top-232));}
   if(s.intake>.02||s.exhaust>.02){const direction=s.intake>.02?1:-1,side=direction===1?-1:1;c.globalAlpha=.35;for(let k=0;k<3;k++){const t=(this.t*2+k/3)%1;const xx=x+side*(26-t*8),yy=234+t*Math.max(3,top-239);this.line([[xx,yy],[xx-2,yy+5*direction]],direction===1?'#92bac3':'#bd9c79',1.1);}c.globalAlpha=1;}
   c.restore();this.rod(x,pin,g.crankX,g.crankY,d.bearing);
  }else{
   this.rod(g.crankX+Math.sin(m.phase+j)*10,g.crankY-28,g.crankX,g.crankY,1,true);
   if(cy.failure!=='ejected')this.brokenRodStem(x,pin);
  }
  if(cy.failure==='ejected')return;
  c.save();c.beginPath();c.rect(x-50,232,100,184);c.clip();
  this.rr(x-46,top,92,67,3.5,this.metal(x-46,92),'#c7cfcc',1.3);
  this.rr(x-39,top+34,78,25,8,'rgba(26,38,41,.28)');
  this.poly([[x-42,top+63],[x-34,top+67],[x-23,top+67],[x-18,top+59],[x+18,top+59],[x+23,top+67],[x+34,top+67],[x+42,top+63]],'#47555b','#9da9a8',.5);
  // Crown, two compression rings and a two-rail oil-control ring.
  this.line([[x-43,top+2],[x-24,top+2],[x-18,top+5],[x+18,top+5],[x+24,top+2],[x+43,top+2]],'#d7dcd3',1.7);
  for(const y of[9,16]){this.line([[x-45,top+y],[x+45,top+y]],'#16252d',3.5);this.line([[x-44,top+y-1],[x+44,top+y-1]],'#bbc2bb',.9);}
  this.rr(x-45,top+22,90,7,0,'#253138');for(let k=0;k<22;k++)this.line([[x-43+k*4,top+23],[x-41+k*4,top+27]],'#879692',.7);
  this.line([[x-45,top+22],[x+45,top+22]],'#c0c6bc',.9);this.line([[x-45,top+29],[x+45,top+29]],'#b2bbb4',.9);
  for(let k=0;k<32;k++){const yy=top+31+k*.9;this.line([[x-43,yy],[x+43,yy]],'rgba(221,229,225,.065)',.4);}
  this.circle(x,pin,11.5,'#55656a','#bbc6c3',1.4);this.circle(x,pin,7.6,this.metal(x-8,16),'#32434a',1.1);this.circle(x,pin,4.5,'#27363f');
  const scuff=Math.max(d.skirt,cy.wear*.22),n=Math.floor(scuff*30);
  for(let k=0;k<n;k++){const sx=x+(k%3===0?-1:1)*(27+noise(j*31+k)*14),yy=top+32+noise(k+12)*12;
   this.line([[sx,yy],[sx+.4,top+62]],'rgba(38,38,34,.56)',1+noise(k)*2);
   this.line([[sx-.8,yy],[sx-.4,top+60]],'rgba(222,222,205,.52)',.6);}
  if(d.crown>.03){c.globalAlpha=d.crown*.55;this.rr(x-41,top+2,82,6,2,'#302a25');c.globalAlpha=1;}
  if(!cy.active)this.fracture([[x-38,top+37],[x-17,top+43],[x-8,top+58],[x+10,top+48],[x+26,top+52]],1,1.5);
  c.restore();
 }
 head(m){
  const c=this.c;
  this.rr(277,175,643,55,5,this.metal(277,643),'#c0c7c7',1.8);this.texture(280,178,638,49,.35);
  this.line([[281,230],[917,230]],m.gasket>.15?'#1e2221':'#747f83',3);
  this.line([[281,228],[917,228]],'#d0d2c6',.7);this.hatch(281,216,637,10);
  for(let j=0;j<m.cylinders.length;j++){
   const x=X[j],cy=m.cylinders[j],s=cy.cycle;
   this.poly([[x-49,225],[x-45,211],[x-18,200],[x+18,200],[x+45,211],[x+49,225]],'#1b2930','#8b9799',1);
   this.rr(x-55,181,35,20,4,'#293d45','#728389',1);this.rr(x+20,181,35,20,4,'#3e3b35','#8d8b82',1);
   for(const side of[-1,1]){
    const lift=(side<0?s.intake:s.exhaust)*9,xx=x+side*27,retainer=186+lift;
    // The stem and valve head move DOWN into the cylinder on opening. Cam stays driven even after rod failure.
    this.line([[xx,retainer-13],[xx,226+lift]],'#c7ccca',3.5);
    this.rr(xx-8,retainer-9,16,7,1,this.metal(xx-8,16),'#a4afae',.7);
    for(let k=0;k<6;k++){const y=retainer+k*(209-retainer)/6;this.line([[xx-6,y],[xx+6,y+2]],'#101e25',2.4);this.line([[xx-6,y-.6],[xx+6,y+1.4]],'#9ca8a8',.7);}
    this.line([[xx-8,211],[xx+8,211]],'#bcc3ba',1);
    this.poly([[xx-3,219+lift],[xx-10,225+lift],[xx-11,228+lift],[xx+11,228+lift],[xx+10,225+lift],[xx+3,219+lift]],side<0?'#afbab8':'#9b998d','#dee1d4',.8);
    if(this.mode==='oil'&&(side<0?s.intake:s.exhaust)>.1)this.line([[xx-12,226+lift],[xx+12,226+lift]],side<0?'#8ab1bf':'#d0a67a',1.5);
   }
   this.rr(x-4,187,8,22,1,'#d7d5c5','#56656a',1);this.rr(x-5,186,10,5,1,'#99a5a6');this.line([[x,210],[x,219]],'#ad9b72',2);this.line([[x+3,216],[x+3,221],[x,221]],'#9aa7a8',1);
   if(cy.active&&cy.lit&&cy.cycle.angle<.13)this.line([[x,218],[x+2,220],[x,222]],'#eee6c9',1.1);
  }
  // Parallel camshaft projections. Each rotates once per 720 crank degrees.
  this.rr(286,132,619,42,3,'#131e24','#69787d',1.4);
  for(let row=0;row<2;row++){
   const y=row?161:143;this.line([[302,y],[891,y]],'#66767a',5);this.line([[302,y-2],[891,y-2]],'#b4beba',.8);
   for(let j=0;j<m.cylinders.length;j++){
    const x=X[j]+(row?27:-27),s=m.cylinders[j].cycle,center=row?Math.PI*1.5:Math.PI*2.5;
    const a=(s.angle-center)/2;
    c.save();c.translate(x,y);c.rotate(a);
    const pts=[];for(let k=0;k<=36;k++){const p=k/36*TAU,r=6+5*Math.max(0,Math.cos(p-Math.PI/2))**3;pts.push([Math.cos(p)*r,Math.sin(p)*r]);}
    this.poly(pts,this.metal(-8,16),'#c5ceca',.8);this.circle(0,0,2,'#24373f');c.restore();
   }
   for(const x of BEARINGS){this.rr(x-6,y-5,12,10,2,'#68777b','#abb6b5',.8);this.bolt(x,y,2.2);}
  }
  // One tethered cover, never duplicate geometry when it loosens.
  c.save();c.translate(289,122);c.rotate((Math.sin(m.phase*2)*.009+m.recoil*.012)*m.components.cover);
  this.rr(-12,-15,644,22,4,this.metal(-12,644),'#b1bdbd',1.5);this.texture(-10,-14,640,18,.2);
  for(let k=0;k<12;k++)if(m.components.cover<1||k<2)this.bolt(6+k*55,-4,3.5,this.t*m.components.cover);
  c.restore();
  this.rr(465,91,262,15,2,'#344147','#76858b',1);this.text('I4 · DOHC · LONGITUDINAL SECTION',596,101,8,'#b9c6c6','center');
 }
 timingTracks(drive){
  const upper=[234,151],lower=[246,460],large=38,small=19;
  const dx=lower[0]-upper[0],dy=lower[1]-upper[1],axis=Math.atan2(dy,dx);
  const tangent=Math.acos((large-small)/Math.hypot(dx,dy)),right=axis-tangent,left=axis+tangent;
  const joint=(origin,r,a)=>[origin[0]+r*Math.cos(a),origin[1]+r*Math.sin(a)];
  const points=[];
  const arc=(origin,r,from,to,n,first)=>{for(let i=first;i<=n;i++)points.push(joint(origin,r,from+(to-from)*i/n));};
  const span=(a,b,dir,amplitude,drop,start,end,open=false)=>{
   const n=Math.ceil((end-start)*20),fade=this.reduced?.22:1;
   for(let i=open?0:1;i<=n;i++){
    const u=start+(end-start)*i/n;
    // Zero displacement and slope where the link first meshes with the sprocket.
    const envelope=Math.sin(Math.PI*u)**2;
    points.push([a[0]+(b[0]-a[0])*u+dir*envelope*(amplitude*fade+drop),a[1]+(b[1]-a[1])*u,open&&i===0]);
   }
  };
  const rightTop=joint(upper,large,right),rightBottom=joint(lower,small,right);
  arc(upper,large,left,right+TAU,16,0);
  if(drive?.broken){
   const gap=drive.gap;
   span(rightTop,rightBottom,1,drive.slack,4*gap,0,.48-.24*gap);
   span(rightTop,rightBottom,1,drive.slack,12*gap,.53+.21*gap,1,true);
  }else span(rightTop,rightBottom,1,drive?.slack??0,0,0,1);
  arc(lower,small,right,left,8,1);
  span(joint(lower,small,left),joint(upper,large,left),-1,drive?.tight??0,0,0,1);
  return points;
 }
 timingChain(m){
  const c=this.c,d=m.timingDrive,points=this.timingTracks(d),rail=new Path2D();
  let length=0;
  points[0][2]=true;
  for(let i=0;i<points.length;i++){
   const p=points[i],a=points[i-1];
   if(a)length+=Math.hypot(p[0]-a[0],p[1]-a[1]);
   p[3]=length;
   if(p[2])rail.moveTo(p[0],p[1]);else rail.lineTo(p[0],p[1]);
  }
  c.save();c.strokeStyle='#1b1c17';c.lineWidth=6.5;c.stroke(rail);
  c.strokeStyle='#777365';c.lineWidth=3.5;c.stroke(rail);
  if(!this.timingLink){
   const link=document.createElement('canvas');link.width=40;link.height=28;
   const q=link.getContext('2d'),metal=q.createLinearGradient(0,4,0,25);
   metal.addColorStop(0,'#b4a898');metal.addColorStop(.36,'#777164');metal.addColorStop(1,'#3c3a33');
   q.beginPath();q.ellipse(10,14,9,10,0,0,TAU);q.ellipse(30,14,9,10,0,0,TAU);
   q.rect(10,7,20,14);q.fillStyle=metal;q.fill();
   for(const x of [9,31]){
    q.beginPath();q.arc(x,14,5.1,0,TAU);q.fillStyle='#302e27';q.fill();
    q.beginPath();q.arc(x,13,2.8,0,TAU);q.fillStyle='#b0a79a';q.fill();
   }
   this.timingLink=link;
  }
  const pitch=length/80,turn=(d?.broken?d.breakCrankPhase:m.phase)*12/TAU;
  let index=1;
  for(let s=(turn-Math.floor(turn))*pitch;s<length;s+=pitch){
   while(index<points.length-1&&points[index][3]<s)index++;
   const a=points[index-1],b=points[index];if(b[2])continue;
   const t=(s-a[3])/(b[3]-a[3]);
   c.save();c.translate(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t);
   c.rotate(Math.atan2(b[1]-a[1],b[0]-a[0]));
   c.drawImage(this.timingLink,-pitch*.51,-3,pitch*1.02,6);
   c.restore();
  }
  c.restore();
 }
 drive(m){
  const c=this.c,d=m.timingDrive,wear=d?.guideWear??0;
  this.line([[190,212],[194,274],[198,351],[207,399]],'#282a24',6.1);
  if(wear<1)this.line([[277,213],[275,263],[273,327],[269,388]],wear>.52?'#534130':'#51493b',6.7);
  else{
   this.line([[277,213],[274,263],[273,281]],'#4f4135',6.7);
   this.line([[272,337],[269,388]],'#4f4135',6.7);
  }
  this.rr(280,296,16,14,2,this.metal(280,16,true),'#2c3029',.7);
  const piston=279-Math.min(6,d?.tensionerTravel??0);
  this.rr(piston,300,283-piston,6,.8,this.metal(piston,283-piston),'#77756a',.5);
  this.bolt(290,303,2.2);
  this.pulley(234,151,38,m.camAngle);this.pulley(246,460,19,m.phase);
  this.timingChain(m);
  this.pulley(190,337,22,this.idlerAngle);
  const hub=c.createLinearGradient(0,451,0,470);
  hub.addColorStop(0,'#656c64');hub.addColorStop(.3,'#a0a59a');hub.addColorStop(1,'#343b35');
  this.rr(264,452,34,16,2,hub);this.rr(272,449,17,22,2,hub,'#353c36',.9);
  this.line([[276,452],[276,467]],'#d0d2c36a',.65);
  this.rr(173,371,53,44,6,this.metal(173,53,true),'#7e8a91',1.3);for(let k=0;k<6;k++)this.line([[180+k*7,377],[180+k*7,409]],'#1b2c35',2.5);
  this.bolt(200,396,5);
 }
 exhaust(m){
  // Ports emerge at head height, not from the crankcase. Header runs behind the block.
  for(let j=0;j<m.cylinders.length;j++){
   const x=X[j]+49;this.line([[x,192],[x+40,178],[951,192+j*14],[975,278]],'#17242b',15);
   this.line([[x,190],[x+40,176],[951,190+j*14],[975,276]],'#697275',10);
   this.line([[x,187],[x+40,173],[949,187+j*14],[972,274]],'#a0a6a0',1);
  }
  const c=this.c;c.save();c.translate(978,278);c.rotate(Math.sin(m.phase*.7)*.025*m.components.exhaust);
  this.line([[0,0],[55,0],[55,-48]],'#111d24',24);this.line([[0,-1],[55,-1],[55,-48]],this.metal(0,60),19);this.line([[0,-6],[49,-6],[49,-47]],'#c4cac5',1);
  for(let k=0;k<5;k++)this.line([[k*4+2,-10],[k*4+2,9]],'#3b4547',1.5);
  this.ellipse(55,-48,11,4.5,'#adb4b2');this.ellipse(55,-48,8,2.8,'#0c171d');c.restore();
  this.line([[1010,279],[1041,315],[1061,301]],'#697b83',1.8);
  if(this.blast>.08){this.poly([[1026,230],[1027,218-this.blast*30],[1033,219-this.blast*70],[1041,214-this.blast*25],[1040,230]],`rgba(218,170,103,${this.blast*.8})`);}
 }
 lubrication(m){
  const c=this.c,active=m.oil>.02,alpha=this.mode==='oil'?.9:.25;
  const y=528-Math.min(20,m.oil*4.1);
  if(active){c.save();c.beginPath();c.rect(302,488,588,42);c.clip();c.beginPath();c.moveTo(301,531);c.lineTo(301,y);
   for(let x=301;x<=890;x+=8)c.lineTo(x,y+Math.sin(x*.04+m.phase)*(1+m.throttle*1.5));c.lineTo(891,531);c.closePath();c.fillStyle='#262721';c.fill();c.restore();
   this.line([[310,y+1],[883,y+1]],'rgba(165,161,133,.20)',.7);}
  this.line([[345,520],[334,520],[324,498],[304,498],[304,435]],'#3f4c4e',6);
  this.rr(330,516,32,6,2,'#39433e','#75827c',.8);for(let k=0;k<8;k++)this.line([[332+k*3,517],[332+k*3,521]],'#182b31',.6);
  this.circle(304,493,11,this.metal(293,22),'#a5b4b4',1);this.bolt(304,493,4,m.phase);
  if(this.mode==='oil'){
   c.globalAlpha=alpha;this.line([[304,494],[300,432],[882,432]],'#a99465',2);this.line([[300,432],[297,174],[891,174]],'#a99465',2);
   for(const x of BEARINGS)this.line([[x,432],[x,460]],'#a99465',2);
   if(active&&m.pressure>.05)for(let k=0;k<18;k++){const x=305+((this.t*m.pressure*28+k*32)%576);this.circle(x,432,1.6,'#ddc48f');}c.globalAlpha=1;
  }
  if(active)for(let j=0;j<m.cylinders.length;j++){
   const x=X[j],g=pistonGeometry(m.phase,m.cylinders[j],x),strength=clamp(m.pressure/3,0,1);this.line([[x-53,480],[x-53,447],[x-44,436]],'#929c96',2);this.circle(x-44,436,2,'#b3bdb0');
   if(strength>.01){c.globalAlpha=alpha*strength;for(let k=0;k<5;k++){const t=(this.t*3+k/5)%1;this.line([[x-44+t*30,436+(g.top+60-436)*t],[x-44+t*30+1,438+(g.top+60-436)*t]],'#baa87c',1);}c.globalAlpha=1;}
  }
 }
 fracture(points,amount,width=2){
  if(amount<=0)return;const n=(points.length-1)*clamp(amount,0,1),whole=Math.floor(n),p=points.slice(0,whole+1);
  if(whole<points.length-1){const a=points[whole],b=points[whole+1],t=n-whole;p.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}if(p.length<2)return;
  const c=this.c,opening=width*.47*clamp((amount-.2)/.8,0,1);
  const lip=p.map(([x,y],i)=>{
   const depth=.29+opening*(1-i/(p.length-1));
   return [x-depth,y-depth*.72];
  });
  c.beginPath();c.moveTo(...p[0]);for(let i=1;i<p.length;i++)c.lineTo(...p[i]);
  for(let i=lip.length-1;i>=0;i--)c.lineTo(...lip[i]);
  c.closePath();c.fillStyle='#212923';c.fill();
  this.line(p,'#131614',width*.7);
  this.line(lip,'#a5aa9885',.56);
 }
 damages(m){
  const c=this.c;
  for(let j=0;j<m.cylinders.length;j++){
   const cy=m.cylinders[j],d=cy.contact,x=X[j],v=Math.max(d.crack,cy.failure==='ejected'?.85:0);
   this.fracture([[x+51,234],[x+55,240],[x+56,244],[x+53,255],[x+58,268],[x+56,281],[x+61,295],[x+59,310]],v,.68+v*1.6);
   this.fracture([[x+56,244],[x+62,245],[x+64,241],[x+69,236]],clamp((v-.36)/.64,0,1),.78);
   this.fracture([[x+58,268],[x+62,272],[x+64,270],[x+69,276]],clamp((v-.67)/.33,0,1),.72);
   this.fracture([[x-47,219],[x-35,224],[x-23,222],[x-14,228]],Math.max(d.crack,m.gasket*.65),1.4);
   if(cy.failure==='ejected'){
    c.save();c.beginPath();c.rect(x-42,548,104,20);c.clip();
    this.poly([[x-33,562],[x-21,550],[x-7,555],[x+3,542],[x+18,550],[x+31,547],[x+24,567]],'#121714');
    this.poly([[x-33,562],[x-21,550],[x-6,555],[x-12,558],[x-8,564],[x-17,562],[x-24,568]],'#70796c');
    this.poly([[x-7,555],[x+3,542],[x+18,550],[x+31,547],[x+22,554],[x+11,553],[x+5,558]],'#626e62');
    this.line([[x-33,562],[x-21,550],[x-6,555]],'#b4b8a184',.8);
    this.fracture([[x+24,565],[x+39,560],[x+49,566],[x+59,562]],1,1.5);
    c.restore();
   }else if(cy.failure==='rod'){
    const side=j%2?1:-1;
    this.fracture([[x-17*side,552],[x-4*side,557],[x+9*side,552],[x+19*side,558],[x+30*side,559]],1,1.5);
    this.line([[x+side*7,550],[x+side*21,552]],'#786c5c',1.4);
   }
   if(this.mode==='damage'){
    for(const [xx,yy,value]of [[x+40,305,d.liner],[x,475,d.bearing]])if(value>=.05){this.circle(xx,yy,8,null,'#d2ae80',1);this.text(Math.round(value*100)+'%',xx-12,yy+3,9,'#dec39e','right');}
   }
  }
  // Small casting scratches and corrosion clustered around wet fasteners, stable across frames.
  for(let k=0;k<42;k++){const x=k%2?287+noise(k+90)*613:330+noise(k+90)*510,y=k%2?222:556;
   this.line([[x,y],[x+noise(k+3)*9,y+2]],'rgba(158,117,79,.4)',.8+noise(k));}
  if(m.gasket>.15){c.globalAlpha=m.gasket*.45;this.line([[283,229],[915,229]],'#171a19',4);c.globalAlpha=1;}
 }
 heatMarks(m){
  if(this.mode==='thermal')return;
  const c=this.c;
  for(let j=0;j<m.cylinders.length;j++){
   const cy=m.cylinders[j],d=cy.contact,x=X[j];
   const wall=clamp((d.wallTemp-133)/112,0,1),crown=clamp((d.crownTemp-168)/148,0,1);
   const bearing=clamp((d.bearingTemp-126)/116,0,1);
   if(wall>.01){
    const stain=c.createLinearGradient(0,232,0,369);
    stain.addColorStop(0,`rgba(171,103,53,${wall*.82})`);
    stain.addColorStop(.32,`rgba(128,72,68,${wall*.56})`);
    stain.addColorStop(1,'rgba(85,61,61,0)');
    c.fillStyle=stain;c.fillRect(x-51,232,7,137);c.fillRect(x+44,232,7,137);
   }
   if(crown>.02&&cy.failure!=='ejected'){
    const g=pistonGeometry(cy.active?m.phase:cy.freeze,m.cylinders[j],x);
    const edge=cy.partWear?.ringLand===1?27:44;
    c.save();c.beginPath();c.rect(x-46,232,92,184);c.clip();
    const glaze=c.createLinearGradient(x-44,g.top,x+edge,g.top);
    glaze.addColorStop(0,'rgba(177,108,53,0)');glaze.addColorStop(.25,`rgba(177,108,53,${crown*.74})`);
    glaze.addColorStop(.84,`rgba(123,69,55,${crown*.68})`);glaze.addColorStop(1,'rgba(123,69,55,0)');
    this.rr(x-44,g.top+.2,44+edge,6,1,glaze);c.restore();
   }
   if(bearing>.02){
    const g=pistonGeometry(m.phase,m.cylinders[j],x);
    c.beginPath();c.arc(g.crankX,g.crankY,17.4,.15,2.7);
    c.strokeStyle=`rgba(183,116,65,${bearing*.85})`;c.lineWidth=2.1;c.stroke();
   }
  }
 }
 oilFilm(m){
  if(m.film<.0002)return;const c=this.c,a=clamp(m.film*8,0,1);
  for(const [x,y,l]of[[286,230,160],[916,277,235],[307,508,48]]){
   const len=l*clamp(m.gasket+m.damage*.4,.08,1);c.beginPath();c.moveTo(x,y);c.bezierCurveTo(x-3,y+len*.2,x+6,y+len*.65,x+2,y+len);
   c.strokeStyle=`rgba(12,17,18,${a*.9})`;c.lineWidth=3+a*2;c.stroke();c.lineWidth=.7;c.strokeStyle=`rgba(161,162,145,${a*.23})`;c.stroke();this.ellipse(x+2,y+len,2.5,4,`rgba(12,17,18,${a})`);
  }
 }
 thermal(m){if(this.mode!=='thermal')return;const c=this.c;
  for(let j=0;j<m.cylinders.length;j++){
   const cy=m.cylinders[j],d=cy.contact,x=X[j],g=pistonGeometry(cy.active?m.phase:cy.freeze,m.cylinders[j],x);
   const band=c.createLinearGradient(0,232,0,416);
   band.addColorStop(0,heatColor(d.wallTemp,.91));band.addColorStop(1,heatColor(d.wallTemp,.49));
   c.fillStyle=band;c.fillRect(x-51,232,5,184);c.fillRect(x+46,232,5,184);
   const valveTemp=cy.exhaustValveTemp??m.headTemp;
   this.rr(x-52,372,104,40,2,'#21231f','#797766',.65);
   this.text('Стенка '+Math.round(d.wallTemp)+'°',x,383,10.5,'#f0ede0','center');
   if(cy.failure!=='ejected')this.text('Днище '+Math.round(d.crownTemp)+'°',x,395,10,'#f0ede0','center');
   this.circle(x-44,403,2.6,heatColor(valveTemp,.95));
   this.text('Вып. клапан '+Math.round(valveTemp)+'°',x,406,9.5,'#f0ede0','center');
   if(cy.failure!=='ejected'){
    c.save();c.beginPath();c.rect(x-46,232,92,184);c.clip();
    const edge=cy.partWear?.ringLand===1?27:43;
    this.rr(x-43,g.top,43+edge,6,1,heatColor(d.crownTemp,.82));
    c.restore();
   }
   const journal=pistonGeometry(m.phase,m.cylinders[j],x);
   this.circle(journal.crankX,journal.crankY,17.3,null,heatColor(d.bearingTemp,.88),2.3);
  }
  this.text('ГБЦ '+Math.round(m.headTemp)+' °C',594,193,11,'#e6cfac','center');
 }
 engine(m){
  const c=this.c;this.stand(m);c.save();this.engineTransform();
  this.exhaust(m);
  const shortBank=m.cylinders.length<4,end=X[m.cylinders.length-1]+76;
  if(shortBank){
   c.save();c.beginPath();c.rect(260,193,end-260,223);c.rect(260,416,704,149);c.clip();
  }
  this.block(m);
  if(shortBank){
   c.restore();this.rr(end-5,220,9,196,2,this.metal(end-5,9,true),'#393d36',1);
   this.line([[end+4,416],[913,416]],'#848779',2);
  }
  this.crankShadows(m);this.crank(m);for(let j=0;j<m.cylinders.length;j++)this.piston(m,j);
  // Main bearing caps belong BETWEEN throws, not over the connecting rods.
  this.bake('main-bearing-caps','fixed',[286,438,606,43],()=>{for(const x of BEARINGS){
   this.rr(x-10,442,20,36,.9,this.metal(x-10,20,true),'#828074',.65);
   this.line([[x-9.5,455],[x-9.5,473]],'#a5aa9580',.73);
   this.rr(x-14,449,28,5,.65,this.metal(x-14,28,true),'#454b43',.7);
   this.line([[x-13,449.5],[x+13,449.5]],'#c4bbab',.9);
   this.line([[x-13,454],[x+13,454]],'#171e18',.75);
   this.circle(x,461,7.4,this.metal(x-8,16),'#393c34',.8);
   this.circle(x,461,5.9,null,'#ada794',.6);
   this.bolt(x-7.4,473,2.15);this.bolt(x+7.4,473,2.15);
  }});
  this.drawMainBearings?.(m);
  this.lubrication(m);
  if(shortBank){c.save();c.beginPath();c.rect(239,76,end-239,159);c.clip();}
  this.head(m);
  if(shortBank){c.restore();this.rr(end-4,111,8,114,2,this.metal(end-4,8,true),'#383c34',.8);}
  this.drive(m);
  this.bake('pan-flange',String(m.damage<.7),[322,547,538,23],()=>{
  const flange=this.c.createLinearGradient(0,548,0,569);
  flange.addColorStop(0,'#92958a');flange.addColorStop(.15,'#6e756e');flange.addColorStop(.39,'#46524c');flange.addColorStop(1,'#303933');
  this.rr(325,549,531,18,2,flange,'#2a3027',.85);
  this.texture(328,551,525,14,.43);
  this.line([[329,550],[851,550]],'#afb09e9e',.8);
  for(let k=0;k<18;k++){
   const x=341+k*28;this.line([[x,554],[x+13,563]],'#242d2555',1.8);
   this.line([[x-1,553],[x+11,561]],'#b0af9b54',.64);
   if(m.damage<.7||k%5)this.bolt(x+5,556,2.8);
  }
  this.bolt(598,563,5);
  });
  this.heatMarks(m);this.damages(m);this.oilFilm(m);this.thermal(m);
  c.restore();
 }
 render(m){this.currentModel=m;this.focus=Math.min(this.focus,m.cylinders.length-1);const c=this.c;c.setTransform(1,0,0,1,0,0);
  c.clearRect(0,0,this.canvas.width,this.canvas.height);
  c.fillStyle='#181e21';c.fillRect(0,0,this.canvas.width,this.canvas.height);
  c.setTransform(this.scale,0,0,this.scale,this.offsetX,this.offsetY);c.globalAlpha=1;
  c.save();c.beginPath();c.rect(0,0,1200,680);c.clip();
  const {x,y,z}=this.camera;
  c.translate(600,340);c.scale(z,z);c.translate(-x,-y);
  this.background(m);this.drawSmoke(false);this.engine(m);this.particles();this.drawSmoke(true);
  for(const p of this.rings)this.ellipse(p.x,p.y,p.r,p.r*.3,null,`rgba(170,181,184,${(1-p.age/.8)*.36})`,2);
  c.restore();
  if(this.zoom>1)this.drawFocusLabel();
 }
 drawFocusLabel(){
  this.focusLabel('Цилиндр '+(this.focus+1)+'  /  ×'+this.zoom);
 }
 focusLabel(label){
  const pixels=this.canvas.clientWidth/1200,font=Math.max(11,9/Math.max(.2,pixels));
  const x=Math.max(25,12/Math.max(.2,pixels)),y=Math.max(26,22/Math.max(.2,pixels)),height=font*2.2;
  this.c.font=`${font}px ui-monospace,monospace`;
  const width=this.c.measureText(label).width+font*2.1;
  this.rr(x,y,width,height,2,'#121b20','#70818a',.9);
  this.line([[x,y+1],[x,y+height-1]],'#c3a477',2.2);
  this.text(label,x+font,y+height*.67,font,'#e3e3da');
 }
 reset(){
  super.reset();
  this.zoom=1;this.camera={...WIDE_VIEW};this.cameraMove=null;
  this.drivePhase=null;this.beltTravel=0;this.idlerAngle=0;
 }
}
Object.assign(root.Piston,{Renderer});
})(window);
