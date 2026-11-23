/* Six credited CC0 recordings. Offline bytes are bundled with the project.
 * No synthesized engine fallback. Loops are persistent, one-shots are bounded,
 * asynchronous loading cannot resurrect a destroyed player or duplicate sources.
 */
(function(root){
'use strict';
const {clamp,SAMPLES,preparePCM,prepareStarter}=root.Piston;
const FIRING_ORDER=[0,2,3,1];
function holdFiringGain(gain,at){
 if(gain.cancelAndHoldAtTime)gain.cancelAndHoldAtTime(at);
 else gain.cancelScheduledValues(at);
}
class MotorAudio{
 constructor(){
  this.ctx=null;this.master=null;this.engineBus=null;this.metalBus=null;this.ready=false;this.pending=null;this.muted=false;this.volume=.65;this.backend='recordings';
  this.buffers={};this.loops={};this.media={};this.sources=new Set();this.failures=[];this.status='6 записей встроены · звук с первого запуска';
  this.lastState=null;this.lastHit=-10;this.lastSlap=-10;this.lastChip=-10;this.lastKnock=-10;this.lastMainKnock=-10;this.lastChain=-10;this.oldIgnition='off';this.counter=0;this.suspended=false;this.timer=null;this.underruns=0;
  this.mixSettings={engine:1,mechanical:.7};this.controllers=new Set();this.generation=0;this.destroyed=false;this.loaded=0;this.stats={};this.starterVoice=null;
  this.starterTiming=null;this.catchVoice=null;this.caughtAt=-Infinity;this.coasting=false;this.outputNodes=[];
  this.firingBus=null;this.nextFiring=null;this.firingIndex=0;this.nextValveTick=0;this.camSector=null;
 }
 start(){
  if(this.destroyed)return Promise.resolve(false);
  if(this.ready){this.suspended=false;return this.ctx.resume().then(()=>true).catch(()=>false);}
  if(!this.pending)this.pending=this.init().finally(()=>{this.pending=null;});return this.pending;
 }
 async init(){
  const generation=this.generation;
  try{
   const AC=root.AudioContext||root.webkitAudioContext;if(!AC){this.status='Web Audio недоступен';this.notify();return false;}
   if(!this.ctx){
    this.ctx=new AC({latencyHint:'interactive'});this.master=this.ctx.createGain();this.master.gain.value=this.muted?0:this.volume;
    const compressor=this.ctx.createDynamicsCompressor();compressor.threshold.value=-12;compressor.knee.value=11;compressor.ratio.value=3;compressor.attack.value=.006;compressor.release.value=.16;
    const dc=this.ctx.createBiquadFilter();dc.type='highpass';dc.frequency.value=22;dc.Q.value=.65;
    this.master.connect(dc).connect(compressor).connect(this.ctx.destination);
    // A single damped reflection from the workshop wall leaves the direct attacks intact.
    const wall=this.ctx.createDelay(.05),damping=this.ctx.createBiquadFilter(),reflection=this.ctx.createGain();
    wall.delayTime.value=.023;damping.frequency.value=1450;reflection.gain.value=.095;
    this.master.connect(wall).connect(damping).connect(reflection).connect(dc);
    this.engineBus=this.ctx.createGain();this.metalBus=this.ctx.createGain();this.firingBus=this.ctx.createGain();
    this.firingBus.connect(this.engineBus);this.engineBus.connect(this.master);this.metalBus.connect(this.master);this.applyMix();
    this.outputNodes=[this.firingBus,this.engineBus,this.metalBus,this.master,wall,damping,reflection,dc,compressor];
   }
   await this.ctx.resume();this.failures=[];this.status='Подготовка встроенных записей…';this.notify();
   await Promise.all(Object.entries(SAMPLES).map(async([name,s])=>{
    if(this.buffers[name])return;
    try{
     const encoded=root.Piston.EMBEDDED_AUDIO?.[name];let data;
     if(encoded){const raw=atob(encoded);data=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)data[i]=raw.charCodeAt(i);data=data.buffer;}
     else{
      const controller=new AbortController();this.controllers.add(controller);const timeout=setTimeout(()=>controller.abort(),7000);
      try{const response=await fetch(s.url,{signal:controller.signal,credentials:'omit'});if(!response.ok)throw Error('HTTP '+response.status);data=await response.arrayBuffer();if(data.byteLength>8e6)throw Error('Sample too large');}
      finally{clearTimeout(timeout);this.controllers.delete(controller);}
     }
     if(this.destroyed||generation!==this.generation)return;
     const decoded=await this.ctx.decodeAudioData(data);if(decoded.duration>30||!decoded.length)throw Error('Invalid duration');
     if(this.destroyed||generation!==this.generation)return;
     const starter=name==='starter',rate=decoded.sampleRate;
     const channels=Array.from({length:decoded.numberOfChannels},(_,i)=>decoded.getChannelData(i));
     const prepared=starter?prepareStarter(channels,rate):preparePCM(channels,rate,!!s.loop);
     if(starter)this.starterTiming={start:prepared.loopStart,end:prepared.loopEnd,catchAt:prepared.catchAt};
     const buffer=this.ctx.createBuffer(1,prepared.samples.length,decoded.sampleRate);buffer.copyToChannel(prepared.samples,0);this.buffers[name]=buffer;
     this.stats[name]={duration:buffer.duration,rms:prepared.rms,peak:prepared.peak,overlap:prepared.overlap,embedded:!!encoded};
     if(s.loop)this.loop(name);this.loaded=Object.keys(this.buffers).length;this.notify();
    }catch(error){if(!this.destroyed)this.failures.push(name);}
   }));
   if(this.destroyed||generation!==this.generation)return false;
   this.ready=!!(this.buffers.idle||this.buffers.load);
   this.status=this.ready?(this.failures.length?'Загружено '+this.loaded+'/6 · недоступно: '+this.failures.join(', '):'6/6 записей · офлайн · без синтеза'):'Аудио не загрузилось. Проверь файлы записей.';
   if(this.ready&&!this.timer)this.timer=setInterval(()=>this.mix(),40);
   // Loading is not an ignition event. Never replay an old starter after it caught.
   if(this.ready&&this.lastState?.ignition==='cranking')this.starterVoice=this.play('starter',.59);
   this.oldIgnition=this.lastState?.ignition||'off';this.mix();this.notify();return this.ready;
  }catch(error){if(!this.destroyed){this.status='Не удалось включить аудио';this.notify();}return false;}
 }
 notify(){
  const el=document.getElementById('recording-status');if(el)el.textContent=this.status;
  const count=document.getElementById('audio-loaded');if(count)count.textContent=this.loaded+'/6';
  if(this.onStatus)this.onStatus(this.status);
 }
 loop(name){
  if(this.loops[name]||!this.buffers[name]||this.destroyed)return;
  const src=this.ctx.createBufferSource(),filter=this.ctx.createBiquadFilter(),gain=this.ctx.createGain(),body=this.ctx.createBiquadFilter(),pan=this.ctx.createStereoPanner();
  src.buffer=this.buffers[name];src.loop=true;gain.gain.value=0;filter.type='lowpass';filter.frequency.value=2600;filter.Q.value=.5;
  body.type=name==='rattle'?'highpass':'lowshelf';body.frequency.value=name==='rattle'?430:name==='load'?185:135;
  body.gain.value=name==='rattle'?0:2.2;body.Q.value=.65;
  pan.pan.value=name==='load'?.26:name==='rattle'?-.15:-.10;
  src.connect(body).connect(filter).connect(gain).connect(pan).connect(name==='rattle'?this.metalBus:this.firingBus);src.start();
  this.loops[name]={src,gain,filter,body,pan};
 }
 setLoop(name,level,rate=1,cutoff=3600){
  const l=this.loops[name];if(!l||this.destroyed)return;const t=this.ctx.currentTime;
  l.gain.gain.setTargetAtTime(clamp(level,0,.9),t,.045);l.src.playbackRate.setTargetAtTime(clamp(rate,.62,1.9),t,.09);l.filter.frequency.setTargetAtTime(cutoff,t,.08);
 }
 stopVoice(voice){if(!voice)return;const now=this.ctx.currentTime;try{voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setTargetAtTime(0,now,.02);voice.source.stop(now+.12);}catch(_){} }
 play(name,volume=.3,rate=1,{offset=0,panPosition,cutoff,decay,at,exhaust=false}={}){
  if(!this.ready||this.suspended||this.destroyed||this.sources.size>=12||!this.buffers[name])return null;
  const source=this.ctx.createBufferSource(),gain=this.ctx.createGain(),pan=this.ctx.createStereoPanner(),filter=this.ctx.createBiquadFilter();
  const starter=name==='starter',cranking=starter&&offset===0;
  const level=clamp(volume,0,.8);
  source.buffer=this.buffers[name];source.loop=cranking;source.playbackRate.value=clamp(rate,.7,1.4);
  filter.type='lowpass';filter.frequency.value=cutoff??(starter?3300:name==='impact'?2900:4000);filter.Q.value=.58;
  if(cranking){source.loopStart=this.starterTiming.start;source.loopEnd=this.starterTiming.end;}
  this.counter++;pan.pan.value=panPosition??(starter?-.15:0);
  gain.gain.value=starter||decay?0:level;
  if(starter)gain.gain.setTargetAtTime(level,this.ctx.currentTime,.012);
  source.connect(filter).connect(gain).connect(pan).connect(starter||exhaust?this.engineBus:this.metalBus);
  const voice={source,gain,filter,pan,name};this.sources.add(voice);
  source.onended=()=>{
   source.disconnect();filter.disconnect();gain.disconnect();pan.disconnect();this.sources.delete(voice);
   if(this.starterVoice===voice)this.starterVoice=null;
   if(this.catchVoice===voice)this.catchVoice=null;
  };
  if(decay){
   const now=at??this.ctx.currentTime;
   gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(level,now+.003);
   gain.gain.setTargetAtTime(0,now+.019,decay);
   source.start(now,offset);source.stop(now+.019+decay*5);
  }else source.start(0,offset);
  return voice;
 }
 idleValveTicks(m,now){
  const idle=Math.max(m.overrun?.7:0,clamp((1500-m.rpm)/480,0,1))*clamp(1-(m.throttlePlate??m.throttle)*2,0,1);
  if(!idle||m.rpm<380||m.ignition!=='running'||m.timingDrive?.broken||!this.buffers.rattle||this.muted||!this.mixSettings.mechanical){
   this.nextValveTick=0;this.camSector=null;return;
  }
  // Each cylinder closes its exhaust valves once per two crank revolutions. Use the first sharp tap
  // in the prepared rattle recording; schedule on the audio clock between updates.
  // The quiet train runs at real RPM. Accent the seat actually closing in the slowed cutaway.
  const order=m.build?root.Piston.firingOrders[m.build.cylinders-1]:FIRING_ORDER;
  const position=((m.camAngle/(2*Math.PI)+.5)%1)*order.length;
  if(this.camSector!==null&&(Math.floor(position)!==Math.floor(this.camSector)||position<this.camSector&&order.length===1)&&Number.isFinite(position)){
   const id=order[Math.floor(position)],cy=m.cylinders[id];
   if(cy.active){
    const lash=clamp((85-m.oilTemp)/70,0,1)+cy.partWear.exhaustValve*.65;
    this.play('rattle',idle*(.49+lash*.12),.91+id*.044,{offset:.063,panPosition:(id-1.5)*.26,cutoff:3800+lash*850,decay:.009});
   }
  }
  this.camSector=position;
  if(m.overrun&&m.rpm>1500){this.nextValveTick=0;return;}
  const interval=120/(order.length*m.rpm);
  if(this.nextValveTick<now||!this.nextValveTick)this.nextValveTick=now+.004;
  while(this.nextValveTick<now+.055){
   this.play('rattle',.18*idle,1,{offset:.063,panPosition:-.12,cutoff:2650,decay:.004,at:this.nextValveTick});
   this.nextValveTick+=interval;
  }
 }
 applyFiring(cylinders,rpm,now,powered,order=FIRING_ORDER){
  if(!this.firingBus)return;
  const gain=this.firingBus.gain;
  const fires=cylinder=>cylinder.active&&(cylinder.lit!==false||(cylinder.fired===0&&cylinder.missed===0));
  const uneven=powered&&cylinders&&(order.length<4||cylinders.some(cylinder=>!fires(cylinder)));
  if(!uneven){
   if(this.nextFiring!==null){holdFiringGain(gain,now);gain.setTargetAtTime(1,now,.022);this.nextFiring=null;}
   return;
  }
  const active=cylinders.filter(cylinder=>cylinder.active).length;
  const bed=.32+.125*active;
  const interval=120/(Math.max(380,rpm)*order.length);
  if(this.nextFiring===null||this.nextFiring<now){
   holdFiringGain(gain,now);this.nextFiring=now+.012;
   gain.linearRampToValueAtTime(bed,this.nextFiring);
  }
  // The recording supplies the sound. Missing combustion only removes energy
  // from the appropriate intervals, timed on the real shaft, not the cutaway.
  while(this.nextFiring<now+.085){
   const cylinder=cylinders[order[this.firingIndex%order.length]];
   const at=this.nextFiring;
   gain.setValueAtTime(bed,at);
   if(fires(cylinder)){
    const compression=clamp(cylinder.compression??1,0,1);
    gain.linearRampToValueAtTime(bed+(1-bed)*(.54+.46*compression),at+interval*.18);
    gain.linearRampToValueAtTime(bed,at+interval*.86);
   }
   this.nextFiring+=interval;
   this.firingIndex=(this.firingIndex+1)%order.length;
  }
 }
 mixStarter(m){
  const voice=this.starterVoice;if(!voice||m.ignition!=='cranking')return;
  const now=this.ctx.currentTime;
  const supply=clamp(((m.electrical?.voltage??11)-7.5)/4.5,0,1);
  const current=clamp((m.electrical?.starterA??180)/220,0,1);
  const speed=clamp(m.rpm/340,0,1);
  const compression=.5+.5*Math.cos(2*(m.phase||0));
  voice.source.playbackRate.setTargetAtTime(.67+.27*speed+.16*supply-.065*compression,now,.036);
  voice.gain.gain.setTargetAtTime((.265+.325*supply)*(.72+.28*current),now,.052);
  voice.filter.frequency.setTargetAtTime(1440+1040*supply+720*speed-175*compression,now,.05);
 }
 mix(){
  if(!this.ready||this.suspended||this.destroyed||!this.lastState||this.ctx.state!=='running')return;
  const m=this.lastState,run=m.ignition==='running',rpm=m.rpm;
  const throttle=m.throttlePlate??m.throttle,now=this.ctx.currentTime;
  const powered=run&&!m.overrun&&!m.revCut;
  const coast=this.coasting&&rpm>40?clamp(rpm/1750,0,1):0;
  const brake=clamp((m.absorbedNm||0)/220,0,1);
  const supply=m.fuelDelivery??1;
  const opening=powered?throttle*supply:0;
  const combustion=clamp(m.engineLoad??opening*.55,0,1);
  const load=powered?clamp(Math.max(combustion,opening*.44)+brake*opening*.12,0,1):0;
  const speedBlend=clamp((rpm-1150)/3800,0,1);
  const loadBlend=.17+clamp((load-.18)/.82,0,1)*.60;
  const blend=loadBlend+(1-loadBlend)*speedBlend;
  const drive=powered?1:run?(m.revCut?.13:.27):0;
  const catchBlend=clamp((now-this.caughtAt)/.15,.30,1);
  const level=(.42+load*.35)*drive*catchBlend*(.62+.38*supply);
  let idle=Math.cos(blend*Math.PI/2)*level+coast*.11,loaded=Math.sin(blend*Math.PI/2)*level;
  if(!this.buffers.idle){loaded=level+coast*.11;idle=0;}if(!this.buffers.load){idle=level+coast*.11;loaded=0;}
  const perBore=m.build?m.build.litres*2/m.build.cylinders:1;
  const pitch=clamp(perBore**-.21,.72,1.35)*(m.exhaustPitchRatio??1);
  const idleRate=.91*pitch*Math.sqrt(Math.max(380,rpm)/860);
  const loadRate=.93*pitch*Math.sqrt(Math.max(1050,rpm)/3500);
  const obstruction=clamp(m.auxWear?.mufflerBaffle??0,0,1),leak=clamp(m.exhaust?.leak||0,0,1);
  const tone=(powered?1:.57)*(1-obstruction*.28);
  const pulse=clamp(m.exhaust?.pulse||0,0,1),pressure=clamp((m.exhaust?.pressure||0)/10,0,1);
  this.loops.load?.pan.pan.setTargetAtTime(.38-leak*.70,now,.15);
  this.loops.load?.body.gain.setTargetAtTime(1.6+2*Math.log2(perBore)+load*(6.8+pressure*2.4)*(1-leak*.67),now,.065);
  this.setLoop('idle',idle,idleRate,coast?540+340*coast:(1190+opening*680+load*290)*tone);
  this.setLoop('load',loaded*(1+.12*pulse*load),loadRate,coast?650:(1340+opening*1160+load*510+leak*1900)*tone);
  const rough=clamp(m.fragments?.scrape||0,0,1);
  const wear=clamp(m.damage||0,0,1),starvation=clamp((1.15-(m.pressure??1.15))/1.15,0,1);
  const motionGain=run?clamp(rpm/1300,.4,1):coast;
  const looseChain=m.timingDrive?.broken ? 0 : clamp((m.timingDrive?.slack??0)/6,0,1);
  const looseMain=clamp((m.mainBearingDragNm??0)/18,0,1);
  // The close mechanical recording sits above the idle rumble and follows shaft speed on run-down.
  const valveTrain=m.timingDrive?.broken?0:.078+load*.028;
  this.setLoop('rattle',(valveTrain+rough*.19+wear*(.014+.028*starvation)+looseChain*.068+looseMain*.044)*motionGain,
   .76+rpm*.00012,1190+load*420+rough*1600+starvation*440+looseChain*500);
  this.applyFiring(m.cylinders,rpm,now,powered,m.build?root.Piston.firingOrders[m.build.cylinders-1]:FIRING_ORDER);
  this.idleValveTicks(m,now);
  this.mixStarter(m);
 }
 update(m){
  this.lastState=m;
  if(this.ready){
   if(m.ignition!=='running'&&this.catchVoice){
    this.stopVoice(this.catchVoice);this.catchVoice=null;
   }
   if(m.ignition==='off'&&this.oldIgnition==='running')this.coasting=true;
   if(m.ignition!=='off'||m.rpm<=40)this.coasting=false;
   if(m.ignition==='cranking'&&this.oldIgnition!=='cranking')this.starterVoice=this.play('starter',.59);
   if(m.ignition!=='cranking'&&this.starterVoice){
    this.stopVoice(this.starterVoice);this.starterVoice=null;
    if(m.ignition==='running'){
     this.caughtAt=this.ctx.currentTime;
     this.catchVoice=this.play('starter',.26,1,{offset:this.starterTiming.catchAt});
    }
   }
   this.oldIgnition=m.ignition;this.mix();
  }
 }
 event(e){
  if(e.type==='tipIn'){
   this.play('load',.8*e.level,.72,{offset:.11,panPosition:.38,cutoff:245,decay:.038,exhaust:true});
   return;
  }
  const panPosition=e.type==='mufflerBaffle'?.4:e.cylinder>=0?(e.cylinder-1.5)*.21:0;
  if(e.type==='pistonSlap'||e.type==='edgeChip'||e.type==='bearingKnock'||e.type==='mainBearingKnock'){
   const main=e.type==='mainBearingKnock',slap=e.type==='pistonSlap',knock=main||e.type==='bearingKnock',now=this.ctx?.currentTime;
   const stamp=main?'lastMainKnock':knock?'lastKnock':slap?'lastSlap':'lastChip';
   if(this.ctx?.state!=='running'||this.muted||!this.mixSettings.mechanical||now-this[stamp]<(slap?.065:.09))return;
   if((slap||knock)&&(this.lastState?.ignition!=='running'||!this.lastState.rpm))return;
   if(!Number.isFinite(e.level)||e.level<=0)return;
   const strength=Math.sqrt(clamp(e.level,0,1));
   const pan=Number.isFinite(e.x)?clamp((e.x-589)/650,-.45,.45):panPosition;
   // Enter at the recorded attack. The crankcase dampens a bearing impact.
   let voice;
   if(main)voice=this.play('impact',strength*.83,.62+strength*.07,{offset:.167,panPosition:pan,cutoff:350+strength*390,decay:.038+strength*.013});
   else if(knock)voice=this.play('impact',strength*.72,.70+strength*.06,{offset:.167,panPosition:pan,cutoff:410+strength*380,decay:.023+strength*.010});
   else if(slap)voice=this.play('impact',strength*.62,.72+strength*.11,{offset:.167,panPosition:pan,cutoff:820+strength*760,decay:.015+strength*.007});
   else voice=this.play('click',strength*.51,1.06+strength*.18,{offset:.027,panPosition:pan,cutoff:3200+strength*1800,decay:.011+strength*.005});
   if(voice)this[stamp]=now;
  }
  else if(e.type==='chainRattle'&&this.ctx?.currentTime-this.lastChain>=.09){
   if(this.play('click',.06+.18*clamp(e.level,0,1),1.18,{offset:.027,panPosition:-.41,cutoff:2570,decay:.019}))this.lastChain=this.ctx.currentTime;
  }
  else if(e.type==='hydrolock'){
   const power=clamp(e.level,0,1);
   this.play('impact',.33+power*.27,.68,{offset:.167,panPosition,cutoff:920,decay:.078});
  }
  else if(e.type==='bearingSpin'||e.type==='caseBreach'){
   const pan=Number.isFinite(e.x)?clamp((e.x-589)/650,-.45,.45):panPosition;
   const breach=e.type==='caseBreach';
   this.play('impact',breach?.57:.51,breach?.8:.74,{offset:.167,panPosition:pan,cutoff:breach?1850:1050,decay:.064});
  }
  else if(e.type==='bearingWipe'||e.type==='pistonSeize'){
   const seize=e.type==='pistonSeize';
   this.play('impact',seize?.27:.34,seize?.95:.82,{offset:.167,panPosition:clamp((e.x-589)/650,-.45,.45),cutoff:seize?2100:1480,decay:.05});
  }
  else if(e.type==='chainSkip'||e.type==='chainGuide'||e.type==='chainBreak'){
   this.play('impact',e.type==='chainBreak'?.53:.29,e.type==='chainBreak'?.9:1.06,{offset:.167,panPosition:-.41,cutoff:2950,decay:.045});
  }
  else if(['relay','starter','keyOff'].includes(e.type)){
   const relay=e.type==='relay',off=e.type==='keyOff';
   this.play('click',relay?.17:.24,off?.84:relay?1.17:1,{offset:.027,panPosition:relay?-.52:-.22,cutoff:off?1850:relay?3450:2600,decay:relay?.009:.016});
  }
  else if(e.type==='backfire')this.play('impact',.63,.71,{offset:.167,panPosition:.43,cutoff:860,decay:.069,exhaust:true});
  else if(['cylinder','jam','metal','cover','waterPump','oilPickup','mufflerBaffle','radiator','ringLand','skirt','exhaustValve'].includes(e.type)){
   const heavy=['cylinder','jam','skirt'].includes(e.type);
   this.play('impact',heavy?.46:.24,heavy?.75:.96,{offset:.167,panPosition,cutoff:heavy?1280:2650,decay:heavy?.057:.025});
  }
  else if((e.type==='impact'||e.type==='preIgnition')&&this.ctx&&this.ctx.currentTime-this.lastHit>.11){
   this.lastHit=this.ctx.currentTime;
   const level=clamp(e.level??.15,0,1);
   if(e.type==='preIgnition')this.play('impact',.12+level*.32,.90+level*.16,{offset:.167,panPosition,cutoff:1850+level*480,decay:.04});
   else{
    const wet=e.y>=this.lastState?.fragments?.oilSurface;
    this.play(level>.38?'impact':'click',.055+level*.34,.82+level*.17,{offset:level>.38?.167:.027,panPosition,cutoff:wet?810:3900-level*1300,decay:wet?.012:.032});
   }
  }
 }
 hit(level=1){this.play('impact',level*.4);}
 applyMix(){if(!this.ctx)return;const at=this.ctx.currentTime;this.engineBus?.gain.setTargetAtTime(this.mixSettings.engine,at,.05);this.metalBus?.gain.setTargetAtTime(this.mixSettings.mechanical,at,.05);}
 setMix(channel,value){if(!['engine','mechanical'].includes(channel))return;this.mixSettings[channel]=clamp(Number(value)||0,0,1);this.applyMix();}
 setVolume(v){this.volume=clamp(Number(v)||0,0,1);if(this.master)this.master.gain.setTargetAtTime(this.muted?0:this.volume,this.ctx.currentTime,.04);}
 mute(){this.muted=!this.muted;this.setVolume(this.volume);return this.muted;}
 async suspend(){this.suspended=true;if(this.ctx?.state==='running')await this.ctx.suspend();}
 async resume(){if(this.destroyed)return;this.suspended=false;if(this.ctx?.state==='suspended')await this.ctx.resume();this.mix();}
 destroy(){
  this.destroyed=true;this.generation++;clearInterval(this.timer);this.timer=null;for(const c of this.controllers)c.abort();this.controllers.clear();
  for(const l of Object.values(this.loops)){try{l.src.stop();}catch(_){}l.src.disconnect();l.gain.disconnect();l.filter.disconnect();l.body.disconnect();l.pan.disconnect();}
  for(const v of this.sources){try{v.source.stop();}catch(_){}v.source.disconnect();v.gain.disconnect();v.filter.disconnect();v.pan.disconnect();}
  for(const node of this.outputNodes)node.disconnect();
  this.outputNodes=[];this.sources.clear();this.loops={};this.starterVoice=null;this.catchVoice=null;
  if(this.ctx&&this.ctx.state!=='closed')this.ctx.close().catch(()=>{});this.ready=false;
 }
}
root.Piston.MotorAudio=MotorAudio;
})(window);
