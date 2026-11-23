/* Depth-averaged flow across the wet sump. Lengths are in cutaway mm. */
(function(root){
'use strict';
const {clamp}=typeof module!=='undefined'&&module.exports?require('./simulation.js'):root.Piston;
const OIL_PAN=Object.freeze({left:324,right:868,floor:548,depth:20,capacity:3.65});
const CELLS=16,DX=(OIL_PAN.right-OIL_PAN.left)/CELLS,GRAVITY=9810,MAX_SPEED=360;
const DEPTH_PER_LITRE=CELLS*OIL_PAN.depth/OIL_PAN.capacity;
const IMPACT_THRESHOLD=300,MAX_BULK_AIR=.55,MAX_SURFACE_AIR=.42;

class OilPan{
 constructor(){
  this.depths=new Float64Array(CELLS);
  this.faces=new Float64Array(CELLS+1);
  this._flux=new Float64Array(CELLS+1);
  // Separate column volumes let submerged bubbles reach the pickup while
  // the froth left on top can collapse without setting the pickup air fraction.
  this._mixedAir=new Float64Array(CELLS);
  this._surfaceAir=new Float64Array(CELLS);
  this._mixedFlux=new Float64Array(CELLS+1);
  this._surfaceFlux=new Float64Array(CELLS+1);
  this._hasAir=false;
  this.meanDepth=0;
 }
 fillTo(fraction){
  const depth=OIL_PAN.depth*clamp(fraction,0,1),change=depth-this.meanDepth;
  if(change===0)return;
  if(change<0){
   const ratio=depth/this.meanDepth;
   for(let i=0;i<CELLS;i++){
    this.depths[i]*=ratio;
    this._mixedAir[i]*=ratio;
    this._surfaceAir[i]*=ratio;
   }
   if(depth===0){this.faces.fill(0);this._hasAir=false;}
  }else for(let i=0;i<CELLS;i++)this.depths[i]+=change;
  this.meanDepth=depth;
 }
 atColumn(values,x){
  const cell=clamp((x-OIL_PAN.left)/DX-.5,0,CELLS-1),i=Math.floor(cell),j=Math.min(CELLS-1,i+1);
  return values[i]+(values[j]-values[i])*(cell-i);
 }
 depthAt(x){return this.atColumn(this.depths,x);}
 surfaceAt(x){return OIL_PAN.floor-this.depthAt(x);}
 foamAt(x){
  if(!this._hasAir||x<OIL_PAN.left||x>OIL_PAN.right)return 0;
  return clamp(this.atColumn(this._surfaceAir,x)/(.5+.045*this.depthAt(x)),0,1);
 }
 entrainedAirAt(x,pickupY){
  if(!this._hasAir||x<OIL_PAN.left||x>OIL_PAN.right||pickupY>OIL_PAN.floor)return 0;
  const depth=this.depthAt(x),submergence=pickupY-OIL_PAN.floor+depth;
  if(submergence<=0||depth<1e-6)return 0;
  const gas=this.atColumn(this._mixedAir,x)*(1.18-.64*submergence/depth);
  return gas/(depth+gas);
 }
 velocityAt(x){
  const face=clamp((x-OIL_PAN.left)/DX,0,CELLS),i=Math.floor(face),j=Math.min(CELLS,i+1);
  return this.faces[i]+(this.faces[j]-this.faces[i])*(face-i);
 }
 splash(x,speed){
  const cell=Math.floor((x-OIL_PAN.left)/DX);
  if(cell<0||cell>=CELLS||this.depths[cell]<1)return;
  if(cell>0)this.faces[cell]=clamp(this.faces[cell]-speed,-MAX_SPEED,MAX_SPEED);
  if(cell+1<CELLS)this.faces[cell+1]=clamp(this.faces[cell+1]+speed,-MAX_SPEED,MAX_SPEED);
 }
 aerate(x,litres,speedMmPerSec){
  if(!(litres>0&&speedMmPerSec>IMPACT_THRESHOLD)||x<OIL_PAN.left||x>OIL_PAN.right)return;
  const energy=clamp((speedMmPerSec**2-IMPACT_THRESHOLD**2)/(950**2-IMPACT_THRESHOLD**2),0,1.8);
  const gas=litres*DEPTH_PER_LITRE*4*energy;
  const cell=clamp((x-OIL_PAN.left)/DX-.5,0,CELLS-1),first=Math.floor(cell);
  for(let i=first;i<=Math.min(CELLS-1,first+1);i++){
   const amount=gas*(1-Math.abs(cell-i)),depth=this.depths[i];
   if(depth<1.2||amount<=0)continue;
   this._mixedAir[i]=Math.min(depth*MAX_BULK_AIR,this._mixedAir[i]+amount*.63);
   this._surfaceAir[i]=Math.min(depth*MAX_SURFACE_AIR,this._surfaceAir[i]+amount*.37);
   this._hasAir=true;
  }
 }
 step(dt,acceleration,viscosity){
  if(this.meanDepth<1e-6)return;
  const steps=Math.ceil(dt*120),h=dt/steps,depth=this.depths,speed=this.faces,flux=this._flux;
  for(let n=0;n<steps;n++){
   for(let i=1;i<CELLS;i++){
    const left=depth[i-1],right=depth[i];
    if(left+right<1e-5){speed[i]=flux[i]=this._mixedFlux[i]=this._surfaceFlux[i]=0;continue;}
    const drag=(1.7+viscosity*2.2)*clamp(15/(left+right),.42,3.2);
    // A hydrostatic gradient levels the column heights. Viscous shear at the
    // floor dissipates momentum faster in a thin layer or with cold oil.
    const force=acceleration-GRAVITY*(right-left)/DX;
    const next=clamp((speed[i]+force*h)/(1+drag*h),-MAX_SPEED,MAX_SPEED);
    const donor=next>0?left:right;
    // Upwind volume through a shared face. Either side can export at most
    // 44% of the donor column per substep, even with a dry adjacent cell.
    const flow=Math.sign(next)*Math.min(Math.abs(next)*h/DX,.44)*donor;
    speed[i]=next;flux[i]=flow;
    if(this._hasAir){
     const from=flow>=0?i-1:i,fraction=donor>0?flow/donor:0;
     this._mixedFlux[i]=this._mixedAir[from]*fraction;
     this._surfaceFlux[i]=this._surfaceAir[from]*fraction;
    }
   }
   if(!this._hasAir){for(let i=0;i<CELLS;i++)depth[i]+=flux[i]-flux[i+1];continue;}
   const survive=Math.exp(-h*.72/(1+viscosity*.65));
   this._hasAir=false;
   for(let i=0;i<CELLS;i++){
    depth[i]+=flux[i]-flux[i+1];
    const air=this._mixedAir[i]+this._mixedFlux[i]-this._mixedFlux[i+1];
    const rise=air*(1-Math.exp(-h*(.35+7/(10+depth[i]))/(1+viscosity*.30)));
    const surface=this._surfaceAir[i]+this._surfaceFlux[i]-this._surfaceFlux[i+1];
    this._mixedAir[i]=clamp(air-rise,0,depth[i]*MAX_BULK_AIR);
    this._surfaceAir[i]=clamp((surface+rise)*survive,0,depth[i]*MAX_SURFACE_AIR);
    this._hasAir||=this._mixedAir[i]>1e-9||this._surfaceAir[i]>1e-9;
   }
  }
 }
 snapshot(){return {depths:Array.from(this.depths),faces:Array.from(this.faces),
  mixedAir:Array.from(this._mixedAir),surfaceAir:Array.from(this._surfaceAir)};}
 restore(state){
  this._mixedAir.fill(0);this._surfaceAir.fill(0);this._hasAir=false;
  const d=state?.depths,v=state?.faces;
  if(!Array.isArray(d)||d.length!==CELLS||d.some(h=>!Number.isFinite(h)||h<0||h>80)||
     !Array.isArray(v)||v.length!==CELLS+1||v.some(speed=>!Number.isFinite(speed)||Math.abs(speed)>MAX_SPEED))return;
  const mean=d.reduce((total,h)=>total+h,0)/CELLS;
  // The save can carry the geometry and momentum, but volume comes from the circuit.
  if(Math.abs(mean-this.meanDepth)>1e-7)return;
  this.depths.set(d);
  if(this.meanDepth>0){this.faces.set(v);this.faces[0]=this.faces[CELLS]=0;}
  for(const [saved,target,capacity] of [[state.mixedAir,this._mixedAir,MAX_BULK_AIR],[state.surfaceAir,this._surfaceAir,MAX_SURFACE_AIR]]){
   if(!Array.isArray(saved)||saved.length!==CELLS||saved.some((gas,i)=>!Number.isFinite(gas)||gas<0||gas>d[i]*capacity+1e-9))continue;
   target.set(saved);
   this._hasAir||=saved.some(gas=>gas>1e-9);
  }
 }
}
const api={OilPan,OIL_PAN};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else Object.assign(root.Piston,api);
})(typeof globalThis!=='undefined'?globalThis:this);
