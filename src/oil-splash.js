/* Finite packets of crankshaft oil in the cutaway plane, in mm and litres. */
(function(root){
'use strict';
const common=typeof module!=='undefined'&&module.exports;
const {clamp,pistonGeometry}=common?require('./simulation.js'):root.Piston;
const {OIL_PAN}=common?require('./oil-pan.js'):root.Piston;
const XS=[373,517,661,805],LEFT=305,RIGHT=890,DECK=415,GRAVITY=9810;
const MAX_DROPS=48,MAX_FILMS=30,MAX_VOLUME=.045;
const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
const sum=items=>items.reduce((total,p)=>total+p.litres,0);

class OilSplash{
 constructor(seed=875451){
  this.seed=seed>>>0;this.credit=0;
  this.drops=[];this.films=[];
 }
 get volume(){return sum(this.drops)+sum(this.films);}
 random(){
  this.seed=(Math.imul(1664525,this.seed)+1013904223)>>>0;
  return this.seed/4294967296;
 }
 limitVolume(litres){
  if(litres<=0){this.drops.length=this.films.length=this.credit=0;return;}
  const volume=this.volume;
  if(volume<=litres)return;
  const scale=litres/volume;
  for(const p of this.drops)p.litres*=scale;
  for(const p of this.films)p.litres*=scale;
 }
 step(dt,m,f){
  const running=m.rpm>0&&m.shaftSpeed>0;
  if(!running)this.credit=0;
  if(this.drops.length||this.films.length){
   const subdivisions=Math.ceil(dt*240),h=dt/subdivisions,drag=1/(1+1.4*h);
   for(let sub=0;sub<subdivisions;sub++){
    const phase=m.phase-(subdivisions-sub-1)*h*m.shaftSpeed;
    const moving=m.cylinders.map(cy=>pistonGeometry(phase,cy,XS[cy.id]));
    this.moveDrops(h,drag,m,f,moving,phase);
    this.moveFilms(h,m,moving);
   }
  }
  if(!running||f.cells[0].litres<=0)return;
  const speed=clamp(m.rpm/6500,0,1.05),bearing=f.cells[4];
  let depth=Infinity;
  for(const cy of m.cylinders)depth=Math.min(depth,f.surfaceAt(XS[cy.id]));
  const belowShaft=clamp((515-depth)/11,0,1);
  const fed=clamp(bearing.flow/17+belowShaft*.65,0,1);
  if(!fed){this.credit=0;return;}
  // Faster throws break the bearing outflow into a denser fan of droplets.
  this.credit=Math.min(2,this.credit+dt*(8+108*speed)*fed);
  let available=Math.max(0,Math.min(f.cells[0].litres,MAX_VOLUME-this.volume,
   (bearing.flow/60+belowShaft*.08)*dt*.77));
  while(this.credit>=1&&this.drops.length<MAX_DROPS&&available>.000016){
   this.credit-=1;
   const cylinder=Math.floor(this.random()*m.cylinders.length);
   const angle=m.phase-m.cylinders[cylinder].offset+Math.PI+(this.random()-.5)*.82;
   const r=50+this.random()*5,sin=Math.sin(angle),cos=Math.cos(angle);
   const tangential=r*m.shaftSpeed*(.71+this.random()*.55),radial=36+this.random()*62;
   const litres=Math.min(available,(.000072+.00013*speed)*(.52+.96*this.random()));
   available-=litres;
   this.drops.push({x:XS[cylinder]+sin*r,y:460-cos*r,
    vx:cos*tangential+sin*radial,vy:sin*tangential-cos*radial,litres,kind:0});
  }
 }
 moveDrops(h,drag,m,f,moving,phase){
  for(let i=this.drops.length-1;i>=0;i--){
   const p=this.drops[i],oldX=p.x,oldY=p.y;
   p.vx*=drag;p.vy=(p.vy+GRAVITY*h)*drag;p.x+=p.vx*h;p.y+=p.vy*h;
   const level=f.surfaceAt(clamp(p.x,OIL_PAN.left,OIL_PAN.right));
   if(p.y>=level&&(p.vy>=0||oldY<level)){
    const at=clamp(p.x,OIL_PAN.left,OIL_PAN.right),impact=Math.max(0,p.vy);
    f.pan.splash(at,Math.min(16,p.litres*impact*42));
    f.pan.aerate(at,p.litres,impact);
    this.drops.splice(i,1);
    continue;
   }
   if(this.findContact(p,oldX,oldY,h,m,moving,phase))this.drops.splice(i,1);
  }
 }
 findContact(p,oldX,oldY,h,m,moving,phase){
  const x=p.x,y=p.y;
  if(x<LEFT||x>RIGHT)return this.wet(p,'case',-1,clamp(x,LEFT+1,RIGHT-1),y,x<LEFT?1:-1);
  for(let i=0;i<m.cylinders.length;i++){
   const axis=XS[i],cy=m.cylinders[i],g=moving[i];
   if(Math.abs(x-axis)>73)continue;
   const top=cy.active?g.top:pistonGeometry(cy.freeze,cy,axis).top;
   const bottom=top+60;
   if(cy.failure!=='ejected'&&Math.abs(x-axis)<42&&y<=bottom&&
      (oldY>=bottom||cy.active&&oldY>=pistonGeometry(phase-m.shaftSpeed*h,cy,axis).top+60)){
    return this.wet(p,'skirt',i,x,bottom+.55,x-axis);
   }
   if(cy.active&&p.kind===0&&y>=g.pinY&&y<=g.crankY-17){
    const dx=g.crankX-axis,dy=g.crankY-g.pinY,ud=((x-axis)*dx+(y-g.pinY)*dy)/(dx*dx+dy*dy);
    const px=axis+ud*dx,py=g.pinY+ud*dy,side=Math.sign(x-px)||1;
    if(ud>.16&&ud<.85&&(x-px)**2+(y-py)**2<30)return this.wet(p,'rod',i,px+side*5.5,py,ud,side);
   }
  }
  // The lower liner lips leave gaps for the bores. Spray that meets the
  // solid webs goes into the wall film rather than through the block.
  if(y<DECK){
   const cylinder=clamp(Math.round((x-XS[0])/144),0,m.cylinders.length-1);
   const axis=XS[cylinder],side=x<axis?-1:1;
   if(Math.abs(x-axis)>47||y<286){
    const lip=axis+side*47;
    return this.wet(p,'case',cylinder,lip,Math.max(287,y),-side);
   }
  }
  // A fixed main-bearing web intercepts some of the tangential stream.
  if(p.kind===0&&y>=425&&y<=478){
   const web=445+144*clamp(Math.round((x-445)/144),0,2);
   if(Math.abs(x-web)<9&&Math.abs(oldX-web)>=9){
    const side=x<web?-1:1;
    return this.wet(p,'case',-1,web+side*9,y,side);
   }
  }
  return false;
 }
 wet(p,surface,cylinder,x,y,anchor,side=0){
  const films=this.films,near=films.find(f=>f.surface===surface&&f.cylinder===cylinder&&
   Math.abs(f.x-x)<10&&Math.abs(f.y-y)<17&&(!side||side===f.side));
  if(near){
   near.litres+=p.litres;
   if(surface==='case')near.startY=Math.min(near.startY,y);
   return true;
  }
  if(films.length>=MAX_FILMS){
   p.x=x+(surface==='case'?anchor:0);p.y=y+.9;p.vx*=.16;p.vy=Math.max(45,p.vy*.15);p.kind=1;
   return false;
  }
  const film={x,y,tx:surface==='skirt'?1:0,ty:surface==='skirt'?0:1,
   litres:p.litres,surface,cylinder,anchor,side,age:0};
  if(surface==='case')film.startY=y;
  films.push(film);
  return true;
 }
 wetPistonJet(cylinder,axis,x,y,litres){
  const amount=Math.min(litres,MAX_VOLUME-this.volume);
  if(amount<=0)return;
  this.wet({litres:amount,vx:0,vy:0},'skirt',cylinder,x,y,x-axis);
 }
 moveFilms(dt,m,moving){
  const films=this.films,warm=clamp((m.oilTemp-35)/100,0,1);
  for(let i=films.length-1;i>=0;i--){
   const f=films[i];f.age+=dt;
   let detach=false,vx=0;
   if(f.surface==='skirt'){
    const i=f.cylinder,cy=m.cylinders[i],g=moving[i];
    if(cy.failure==='ejected')detach=true;
    else{
     const top=cy.active?g.top:pistonGeometry(cy.freeze,cy,XS[i]).top;
     f.x=XS[i]+f.anchor;f.y=top+60.55;
     detach=f.age*(.75+.82*warm)>.41-Math.min(.20,f.litres*155);
    }
   }else if(f.surface==='rod'){
    const i=f.cylinder,cy=m.cylinders[i],g=moving[i];
    if(!cy.active)detach=true;
    else{
     const dx=g.crankX-XS[i],dy=g.crankY-g.pinY,length=Math.hypot(dx,dy);
     f.anchor=Math.min(.89,f.anchor+dt*(.50+.86*warm));
     f.tx=dx/length;f.ty=dy/length;
     f.x=XS[i]+dx*f.anchor+f.side*5.5*f.ty;f.y=g.pinY+dy*f.anchor-f.side*5.5*f.tx;
     detach=f.anchor>=.87;vx=f.side*39;
    }
   }else{
    // Thin films creep down the casting after the shaft stops. Pooled, hot oil runs faster.
    f.y=Math.min(530,f.y+dt*(2.5+4*warm+Math.min(14,f.litres*4200)));
    detach=f.y>=526;
    if(f.x<OIL_PAN.left||f.x>OIL_PAN.right)vx=f.anchor*142;
    else vx=f.anchor*21;
   }
   if(detach&&this.drops.length<MAX_DROPS){
    this.drops.push({x:f.x+(f.surface==='case'?f.anchor*2.2:0),y:f.y+1.7,vx,vy:75,litres:f.litres,kind:1});
    films.splice(i,1);
   }
  }
 }
 snapshot(){
  return {seed:this.seed,credit:this.credit,drops:this.drops.map(p=>({...p})),films:this.films.map(f=>({...f}))};
 }
 restore(s,maxLitres=Infinity){
  this.drops.length=this.films.length=0;
  this.credit=finite(s?.credit,0,2)?s.credit:0;
  if(finite(s?.seed,0,4294967295))this.seed=s.seed>>>0;
  if(Array.isArray(s?.drops))for(const p of s.drops.slice(0,MAX_DROPS)){
   if(!p||!finite(p.x,LEFT,RIGHT)||!finite(p.y,285,OIL_PAN.floor+2)||
      !finite(p.vx,-3000,3000)||!finite(p.vy,-3000,3000)||!finite(p.litres,0,MAX_VOLUME)||!p.litres)continue;
   const {x,y,vx,vy,litres}=p;
   this.drops.push({x,y,vx,vy,litres,kind:p.kind===1?1:0});
  }
  if(Array.isArray(s?.films))for(const f of s.films.slice(0,MAX_FILMS)){
   if(!f||!finite(f.x,LEFT,RIGHT)||!finite(f.y,285,OIL_PAN.floor)||!finite(f.litres,0,MAX_VOLUME)||!f.litres)continue;
   const {surface,cylinder,anchor,side,x,y,litres}=f;
   const attached=Number.isInteger(cylinder)&&finite(cylinder,0,3);
   if(!(surface==='case'&&Math.abs(anchor)===1&&(attached||cylinder===-1)||
        surface==='skirt'&&attached&&finite(anchor,-42,42)||
        surface==='rod'&&attached&&finite(anchor,.16,.89)&&Math.abs(side)===1))continue;
   const tx=finite(f.tx,-1,1)?f.tx:surface==='skirt'?1:0,ty=finite(f.ty,-1,1)?f.ty:surface==='skirt'?0:1;
   const film={x,y,tx,ty,litres,surface,cylinder,anchor,side:surface==='rod'?side:0,age:finite(f.age,0,120)?f.age:0};
   if(surface==='case')film.startY=finite(f.startY,285,y)?f.startY:y;
   this.films.push(film);
  }
  this.limitVolume(Math.min(MAX_VOLUME,maxLitres));
 }
}
const api={OilSplash};
if(common)module.exports=api;else Object.assign(root.Piston,api);
})(typeof globalThis!=='undefined'?globalThis:this);
