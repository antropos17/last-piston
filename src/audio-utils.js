/* Pure PCM preparation; changes recordings, never synthesizes replacement engine audio. */
(function(root){
'use strict';
function preparePCM(channels,sampleRate,loop=false){
 if(!Array.isArray(channels)||!channels.length||!channels[0]?.length||!Number.isFinite(sampleRate)||sampleRate<8000)throw new TypeError('Invalid PCM');
 const n=channels[0].length;if(channels.some(c=>c.length!==n))throw new RangeError('Unequal channel lengths');
 const mono=new Float32Array(n);let mean=0;
 for(let i=0;i<n;i++){let v=0;for(const c of channels){if(!Number.isFinite(c[i]))throw new TypeError('Non-finite PCM');v+=c[i]/channels.length;}mono[i]=v;mean+=v;}
 mean/=n;for(let i=0;i<n;i++)mono[i]-=mean;
 const overlap=loop?Math.min(Math.floor(n*.10),Math.round(sampleRate*.035)):0;
 if(overlap>0){
  let cross=0,headPower=0,tailPower=0;
  for(let i=0;i<overlap;i++){
   const head=mono[i],tail=mono[n-overlap+i];
   cross+=head*tail;headPower+=head*head;tailPower+=tail*tail;
  }
  // In-phase engine harmonics otherwise get louder at each loop seam.
  const correlation=Math.max(0,Math.min(1,cross/Math.max(1e-10,Math.sqrt(headPower*tailPower))));
  for(let i=0;i<overlap;i++){
   const phase=(i+1)/overlap*Math.PI/2,head=Math.sin(phase),tail=Math.cos(phase),at=n-overlap+i;
   mono[at]=(mono[at]*tail+mono[i]*head)/Math.sqrt(1+2*correlation*head*tail);
  }
 }
 const result=loop&&overlap?mono.slice(overlap):mono;
 if(!loop){const attack=Math.min(Math.floor(n*.03),Math.round(sampleRate*.002)),release=Math.min(Math.floor(n*.1),Math.round(sampleRate*.015));for(let i=0;i<attack;i++)result[i]*=i/attack;for(let i=0;i<release;i++)result[n-1-i]*=i/release;}
 let sum=0,peak=0;for(const v of result){sum+=v*v;peak=Math.max(peak,Math.abs(v));}
 const rms=Math.sqrt(sum/result.length),gain=Math.min(4,.135/Math.max(1e-8,rms),.82/Math.max(1e-8,peak));
 for(let i=0;i<result.length;i++)result[i]*=gain;
 return {samples:result,overlap,gain,rms:rms*gain,peak:peak*gain};
}
function prepareStarter(channels,sampleRate){
 const prepared=preparePCM(channels,sampleRate);
 const {samples}=prepared,start=Math.round(sampleRate*.32),end=Math.round(sampleRate*.74);
 const overlap=Math.round(sampleRate*.035);
 if(samples.length<Math.round(sampleRate*1.14))throw new RangeError('Starter recording is too short');
 // Preserve the original solenoid engagement before the loop and the tail
 // after it. Crossfade to the audio immediately preceding the loop start.
 for(let i=0;i<overlap;i++){
  const t=(i+1)/overlap,at=end-overlap+i;
  samples[at]=samples[at]*(1-t)+samples[start-overlap+i]*t;
 }
 let sum=0,peak=0;
 for(const value of samples){sum+=value*value;peak=Math.max(peak,Math.abs(value));}
 return {...prepared,overlap,rms:Math.sqrt(sum/samples.length),peak,loopStart:start/sampleRate,loopEnd:end/sampleRate,catchAt:1.10};
}
const api={preparePCM,prepareStarter};if(typeof module!=='undefined'&&module.exports)module.exports=api;else Object.assign(root.Piston,api);
})(typeof window!=='undefined'?window:globalThis);
