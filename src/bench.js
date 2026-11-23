/* Fixed test-stand hardware. The absorber is coupled to the shaft but mounted to
 * the floor, so its caliper and battery must not inherit engine-block shake. */
(function(root){
'use strict';
const {Renderer:Previous,TAU,clamp,approach}=root.Piston;
function turnedSteel(c,y,h){
 const surface=c.createLinearGradient(0,y,0,y+h);
 for(const [at,color] of [[0,'#363735'],[.15,'#81837f'],[.25,'#aeb0a9'],[.41,'#777a75'],[.74,'#424642'],[1,'#252925']])surface.addColorStop(at,color);
 return surface;
}
class Renderer extends Previous {
 constructor(canvas){super(canvas);this.pinionTravel=0;this.pinionAngle=0;}
 puff(x,y,kind='exhaust',power=1){
  const m=this.currentModel;
  if(m&&m.ignition&&m.ignition!=='running'&&kind==='exhaust')return;
  if(m&&m.ignition==='off'&&m.headerTemp<130&&kind==='oil')return;
  super.puff(x,y,kind,power);
 }
 update(dt,m){
  super.update(dt,m);
  const cranking=m.ignition==='cranking',target=cranking?1:0;
  this.pinionTravel=this.reduced?target:approach(this.pinionTravel,target,cranking?27:19,dt);
  if(Math.abs(this.pinionTravel-target)<.006)this.pinionTravel=target;
  if(cranking)this.pinionAngle=-m.phase*6;
  this.brakeSmokeAcc=(this.brakeSmokeAcc||0)+dt*clamp((m.brakeTemp-380)/150,0,3)*clamp(m.absorbedKW/30,0,1);
  if(this.brakeSmokeAcc>=1){this.brakeSmokeAcc%=1;if(this.smoke.length<Math.round(260*this.quality))this.smoke.push({x:1045,y:416,vx:8,vy:-24,age:0,life:1.6,r:9,grow:17,rot:0,spin:.2,tex:1,alpha:.42,front:true});}
 }
 engine(m){this.silencerSupport();super.engine(m);this.battery(m);this.absorber(m);this.starter(m);}
 silencerSupport(){
  // The post is bolted to the stand. The rubber isolator follows the silencer's movement.
  this.bake('silencer-pedestal','fixed',[1119,382,54,229],()=>{
   const c=this.c,post=c.createLinearGradient(1136,0,1148,0);
   post.addColorStop(0,'#595c57');post.addColorStop(.27,'#737670');post.addColorStop(.4,'#494d49');post.addColorStop(1,'#252924');
   this.ellipse(1144,604,24,3.1,'#171a17');
   this.rr(1137,387,10,210,1,post);
   this.poly([[1137,573],[1137,596],[1128,598],[1128,594]],'#4f514a');
   this.poly([[1147,574],[1147,596],[1156,598],[1156,594]],'#292e29');
   this.rr(1124,597,36,8,1,turnedSteel(c,596,13));
   this.bolt(1130,600,2);this.bolt(1153,600,2);
  });
  const eye=this.world(1085,367),hook=[eye.x+4,eye.y+9];
  this.line([[1142,390],[1132,378],[1110,378]],'#272a27',5);
  this.line([[1141,389],[1132,376.6],[1110,376.6]],'#777970',1.4);
  this.line([[eye.x,eye.y],hook],'#96978c',2.3);
  this.line([hook,[1110,378]],'#151816',7.7);
  this.line([[hook[0],hook[1]-1.2],[1110,376.8]],'#353a34',2.15);
  this.circle(hook[0],hook[1],1.45,'#8d8e84');this.circle(1110,378,1.45,'#8d8e84');
 }
 drive(m){const c=this.c;c.save();c.translate(246,460);c.rotate(m.phase);
  this.bake('flywheel','fixed',[-51,-51,102,102],()=>{
   const points=[];for(let i=0;i<144;i++){const a=i*TAU/144,r=i%2?47:50;points.push([Math.cos(a)*r,Math.sin(a)*r]);}
   this.poly(points,'#76786e','#b5af9f',.7);
   this.circle(0,0,42,'#35362f','#a29d8c',1);
   this.circle(0,0,39,null,'#555449',.8);
   for(let i=0;i<6;i++){const a=i*TAU/6;this.circle(Math.cos(a)*32,Math.sin(a)*32,5,'#23231e','#8f8a7b',.7);}
  });
  c.restore();super.drive(m);
  this.bake('alternator-case','fixed',[174,373,50,42],()=>{
   this.rr(175,374,48,39,4,this.metal(175,48,true),'#918b7a',.8);
   this.rr(178,378,43,29,4,'#25231f','#50483a',.65);
   for(const xx of[180,214]){
    this.rr(xx,378,5,27,2,'#643d28');
    for(let k=0;k<7;k++){
     const y=380+k*3.5;
     this.line([[xx+.4,y],[xx+4.5,y+1]],k%2?'#bf8658':'#a86840',1.5);
    }
   }
   this.line([[180,375],[218,375]],'#c2b6a3',.6);
  });
  this.circle(200,393,14,'#59594d','#b3ac98',1);c.save();c.translate(200,393);c.rotate(m.electrical.altAngle);
  for(let j=0;j<6;j++){c.rotate(TAU/6);this.line([[0,3],[3,11]],'#b9b3a0',2);}c.restore();this.bolt(200,393,3);
 }
 starter(m){
  const c=this.c;c.save();c.translate(202,514);
  this.bake('starter-body','fixed',[-36,-31,81,63],()=>{
   const q=this.c,caseFinish=q.createLinearGradient(0,-19,0,16);
   caseFinish.addColorStop(0,'#59564d');caseFinish.addColorStop(.22,'#777369');
   caseFinish.addColorStop(.62,'#403e37');caseFinish.addColorStop(1,'#282924');
   this.rr(-30,-18,57,34,6,turnedSteel(q,-20,37));
   this.rr(-23,-17,41,32,2,caseFinish);
   this.texture(-21,-15,36,28,.24);
   this.line([[-21,-13],[14,-13]],'rgba(215,209,193,.22)',.7);
   for(const x of [-23,18]){
    this.line([[x,-13],[x,12]],'#232621',2);
    this.line([[x-.7,-11],[x-.7,10]],'rgba(180,179,168,.42)',.55);
   }
   this.rr(-17,-29,34,13,3,turnedSteel(q,-30,15));
   this.rr(8,-28,7,11,2,'#947855');
   this.line([[8.6,-26.3],[14.1,-26.3]],'#b79b72',.6);
   this.bolt(-24,0,2.8);this.bolt(19,0,2.8);
   this.poly([[24,-8],[38,-8],[44,-4],[43,17],[30,17],[30,9],[24,8]],turnedSteel(q,-11,33));
   this.line([[29,-6],[38,-6],[41,-3]],'rgba(214,217,203,.58)',.75);
   this.bolt(33,-2,2.1);
  });
  const travel=this.pinionTravel,pinionY=15-13*travel;
  this.line([[29,9],[37,9],[40,pinionY]],'#535e55',3.2);
  c.save();c.translate(40,pinionY);c.rotate(this.pinionAngle);
  this.bake('starter-pinion','fixed',[-11,-11,22,22],()=>{
   const teeth=[];
   for(let i=0;i<48;i++){
    const a=i/48*TAU,r=i%4===0||i%4===3?7.15:8.5;
    teeth.push([Math.cos(a)*r,Math.sin(a)*r]);
   }
   this.poly(teeth,'#a2a59a','#4d544d',.7);
   this.circle(0,0,5.7,'#646d64','#8a9286',.7);
   this.circle(0,0,2.4,'#828b7e','#b7beb0',.55);
  });
  c.restore();
  c.restore();
  c.beginPath();c.moveTo(58,489);c.bezierCurveTo(65,468,129,459,150,478);c.quadraticCurveTo(165,491,188,492);
  this.batteryCable(c,'#7a4a35',4.6);
  c.beginPath();c.moveTo(111,490);c.quadraticCurveTo(132,513,149,534);c.lineTo(170,538);
  this.batteryCable(c,'#3e4140',3.9);
  this.bolt(170,538,2.4);
 }
 batteryCable(c,color,width){
  c.strokeStyle='#161916';c.lineWidth=width;c.stroke();
  c.strokeStyle=color;c.lineWidth=width-1.35;c.stroke();
 }
 battery(){
  this.bake('battery-body','fixed',[30,472,109,140],()=>{
   const c=this.c,polymer=c.createLinearGradient(45,497,119,556);
   polymer.addColorStop(0,'#424640');polymer.addColorStop(.3,'#313530');polymer.addColorStop(1,'#202520');
   this.ellipse(83,607,50,3.3,'#171a17');
   this.rr(44,555,6,47,1,this.metal(44,6,true));
   this.rr(116,555,6,47,1,this.metal(116,6,true));
   for(const x of [47,119]){
    this.poly([[x-1,560],[x-1,579],[x+12,560]],'#4b4c45');
    this.rr(x-13,601,26,6,1,'#4b4e46');this.bolt(x-7,603,1.7);
   }
   this.rr(36,553,98,8,1.4,turnedSteel(c,552,11));
   this.rr(43,499,82,57,4,polymer);
   this.rr(41,494,86,11,2,'#5b5c53');
   this.line([[45,495.4],[124,495.4]],'#7d7f73',.65);
   this.line([[43,502.2],[124,502.2]],'#1e231d',1.2);
   this.texture(46,505,76,47,.23);
   for(let i=0;i<6;i++){
    const x=50+i*12;
    this.line([[x,513],[x,548]],'#232723',2.35);
    this.line([[x-1.3,513],[x-1.3,546.6]],'#4b4d45',.64);
   }
   this.rr(52,488,12,7,1,'#72543e');
   this.rr(105,488,12,7,1,'#72746b');
   this.line([[53,489],[63,489]],'#b99166',.65);
   this.line([[106,489],[116,489]],'#aaa99c',.65);
   this.line([[48,540],[119,540]],'#1d211d',6);
   this.line([[49,538],[118,538]],'#43463d',.65);
   this.text('+',58,482,10,'#c9ab82','center');this.text('−',111,482,10,'#b2aa96','center');
  });
 }
 absorber(m){
  const c=this.c,x=1045,y=460,temp=m.brakeTemp,hot=clamp((temp-230)/530,0,1);
  const joint=this.world(918,y);
  // The shaft meets a fixed bearing block on the dyno. Only the short
  // coupling on the engine side moves with its rubber mounts.
  this.line([[joint.x,joint.y],[949,y]],turnedSteel(c,y-7,14),12);
  this.bake('dyno-base','cast',[963,437,163,175],()=>{
   const q=this.c;
   const shadow=q.createRadialGradient(1044,607,0,1044,607,82);
   shadow.addColorStop(0,'#151815');shadow.addColorStop(.8,'rgba(17,20,17,.65)');shadow.addColorStop(1,'rgba(17,20,17,0)');
   this.ellipse(1044,607,82,3.8,shadow);
   for(const at of [981,1081]){
    const iron=q.createLinearGradient(at-9,479,at+32,590);
    iron.addColorStop(0,'#535954');iron.addColorStop(.38,'#3a403b');iron.addColorStop(.77,'#2b312b');iron.addColorStop(1,'#3e423b');
    this.poly([[at-1,470],[at+21,470],[at+22,551],[at+31,597],[at-11,597],[at-3,551]],iron);
    q.save();q.clip();this.texture(at-12,474,45,124,.23);q.restore();
    this.poly([[at+17,480],[at+21,478],[at+23,552],[at+31,597],[at+22,597],[at+15,550]],'#262b26');
    this.poly([[at+2,481],[at+8,481],[at+8,555],[at+2,588],[at-5,588],[at+1,550]],'#525750');
    this.line([[at+2,487],[at+1,552],[at-7,592]],'rgba(171,174,161,.32)',.8);
    this.rr(at-10,592,41,6,1.5,'#454a44');
    this.bolt(at-6,593.6,2.15);this.bolt(at+26,593.6,2.15);
   }
   this.poly([[969,596],[1118,596],[1122,602],[966,602]],'#585a50');
   this.rr(966,601,156,7,1,'#353a34');
   this.line([[969,602],[1119,602]],'rgba(170,172,155,.39)',.65);
   this.bolt(974,599,2.2);this.bolt(1114,599,2.2);
  });
  this.bake('dyno-shaft','fixed',[929,435,185,49],()=>{
   const q=this.c;
   this.rr(931,y-6,163,12,1.5,turnedSteel(q,y-6,12));
   this.rr(930,y-9,6,18,1,turnedSteel(q,y-9,18));
   this.rr(942,y-8,7,16,1,turnedSteel(q,y-8,16));
   this.line([[936,y-6],[936,y+5]],'#242922',1);
   this.line([[948,y-6],[948,y+5]],'rgba(209,210,198,.38)',.6);
   for(const at of [981,1081]){
    const cast=q.createLinearGradient(at-4,444,at+22,480);
    cast.addColorStop(0,'#797c72');cast.addColorStop(.43,'#4d534e');cast.addColorStop(1,'#323833');
    this.poly([[at-8,475],[at-8,469],[at-4,467],[at-4,451],[at+1,445],[at+18,445],[at+23,450],[at+23,467],[at+28,470],[at+28,475]],cast);
    q.save();q.clip();this.texture(at-9,444,39,31,.23);q.restore();
    this.rr(at-5,453,30,13,1.3,turnedSteel(q,453,13));
    this.line([[at-6,454],[at+24,454]],'rgba(230,231,217,.45)',.6);
    this.line([[at-7,467],[at+26,467]],'#30352f',1);
    this.bolt(at-4,471,1.9);this.bolt(at+23,471,1.9);
    this.rr(at+6,442,4,4,1,'#76776c');
   }
  });
  const scuffed=Math.floor(m.brakeWear*8);
  this.bake('rotor',Math.floor(hot*8)+':'+scuffed,[x-19,y-53,38,106],()=>{
   const q=this.c,metal=q.createLinearGradient(x-12,y-43,x+12,y+46);
   metal.addColorStop(0,'#87867c');metal.addColorStop(.33,'#797e76');
   metal.addColorStop(.53,'#a1a399');metal.addColorStop(.81,'#5e635b');metal.addColorStop(1,'#383d37');
   this.poly([[x-11,y-48],[x+10,y-48],[x+12,y-43],[x+12,y+43],[x+10,y+48],[x-11,y+48]],metal);
   this.rr(x-5.6,y-48,10.8,96,.5,'#242925');
   this.line([[x-5.7,y-46],[x-5.7,y+46]],'rgba(174,179,166,.47)',.65);
   this.line([[x+5.6,y-46],[x+5.6,y+46]],'rgba(161,165,152,.56)',.65);
   this.line([[x-10,y-43],[x-10,y+43]],'rgba(191,190,179,.51)',.62);
   this.line([[x+10.9,y-43],[x+10.9,y+43]],'#454b44',.6);
   if(hot>.05)for(const d of [-1,1]){
    const gradient=this.c.createLinearGradient(x,y+d*29,x,y+d*48);
    gradient.addColorStop(0,'rgba(138,91,57,0)');
    gradient.addColorStop(.75,`rgba(165,91,49,${hot*.68})`);
    gradient.addColorStop(1,`rgba(219,109,49,${hot*.72})`);
    this.rr(x-11,Math.min(y+d*30,y+d*47),22,17,0,gradient);
   }
   for(let i=0;i<scuffed;i++){
    const at= y-43+i*12;
    this.line([[x-10,at],[x-6,at]],'#3d3e35',.65);
    this.line([[x+6,at],[x+11,at]],'#a19a8b',.65);
   }
   this.rr(x-16,y-10,32,20,1,turnedSteel(q,y-10,20));
   this.rr(x-18,y-7,36,14,1,turnedSteel(q,y-7,14));
   this.line([[x-11,y-9],[x-11,y+9]],'rgba(21,24,21,.65)',.85);
   this.line([[x+9,y-9],[x+9,y+9]],'rgba(21,24,21,.57)',.85);
  });
  for(let i=0;i<12;i++){
   const phase=m.dynoAngle+i*TAU/12;
   if(Math.sin(phase)<0)continue;
   const row=y+Math.cos(phase)*44;
   if(Math.abs(row-y)<10)continue;
   this.line([[x-4.7,row-.8],[x+4.2,row+.9]],'rgba(122,128,118,.59)',1.15);
  }
  this.bake('brake-caliper',hot>.28?'warm':'cool',[x-28,y-65,78,55],()=>{
   const q=this.c,material=q.createLinearGradient(x-22,y-56,x+7,y-29);
   material.addColorStop(0,hot>.28?'#976c59':'#777c72');material.addColorStop(.31,hot>.28?'#746255':'#5a625a');
   material.addColorStop(1,hot>.28?'#4f4237':'#383f39');
   this.poly([[x+20,y-43],[x+35,y-43],[x+44,y-13],[x+36,y-12],[x+29,y-36],[x+20,y-36]],'#434942');
   this.line([[x+27,y-41],[x+34,y-41],[x+42,y-14]],'#636a60',.8);
   q.beginPath();q.moveTo(x-25,y-32);q.lineTo(x-25,y-47);
   q.quadraticCurveTo(x-25,y-55,x-17,y-56);q.lineTo(x+20,y-56);
   q.quadraticCurveTo(x+27,y-54,x+27,y-46);q.lineTo(x+27,y-33);q.lineTo(x+14,y-29);
   q.lineTo(x+14,y-47);q.lineTo(x-14,y-47);q.lineTo(x-14,y-29);q.closePath();
   q.fillStyle=material;q.fill();q.save();q.clip();
   this.texture(x-28,y-57,58,30,.3);q.restore();
   this.line([[x-22,y-48],[x-19,y-54],[x+19,y-54],[x+23,y-50]],'rgba(196,197,182,.46)',.75);
   this.rr(x+15,y-59,5,4,1,'#8d8e80');
   this.bolt(x-20,y-41,2.1);this.bolt(x+22,y-41,2.1);
  });
  const travel=m.brake*2;
  this.rr(x-15+travel,y-46,2.6,15,0,'#67655a','#3b443b',.6);
  this.rr(x+12.5-travel,y-46,2.6,15,0,'#67655a','#3b443b',.6);
  this.line([[x+27,y-47],[x+38,y-47],[x+52,y-35],[x+52,y-20]],'#82877d',2.05);
  c.beginPath();c.moveTo(x+16,y-55);c.quadraticCurveTo(x+39,y-74,x+65,y-60);
  c.quadraticCurveTo(x+78,y-50,x+70,y+60);
  c.strokeStyle='#242a25';c.lineWidth=3;c.stroke();
 }
 reset(){super.reset();this.brakeSmokeAcc=0;this.pinionTravel=0;this.pinionAngle=0;}
}
root.Piston.Renderer=Renderer;
})(window);
