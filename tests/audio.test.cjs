'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs');
const {EngineDSP,WORKLET}=require('../src/audio.js');
const {preparePCM,prepareStarter}=require('../src/audio-utils.js');
function stats(d,seconds=1){let peak=0,sum=0,n=0;for(let i=0;i<Math.ceil(seconds*d.sr/128);i++){let a=new Float32Array(128);d.render(a);for(let v of a){assert.ok(Number.isFinite(v));peak=Math.max(peak,Math.abs(v));sum+=v*v;n++;}}return{peak,rms:Math.sqrt(sum/n)};}
test('Shared DSP is finite and bounded at 44.1 / 48 / 96 kHz',()=>{for(let sr of[44100,48000,96000]){let d=new EngineDSP(sr);d.set({rpm:6500,load:1});let a=stats(d,2);assert.ok(a.rms>.01);assert.ok(a.peak<.83);}});
test('Four-stroke firing frequency tracks RPM rather than a fixed audio loop',()=>{for(let rpm of[750,3000,6500]){let d=new EngineDSP();d.rpm=rpm;d.set({rpm,load:.7});stats(d,2);assert.ok(Math.abs(d.fires-rpm/30*2)<2);}});
test('Single-cylinder DSP forces an ignition after at most three misses',()=>{let d=new EngineDSP();d.set({rpm:1800,load:1,cyl:[.28,0,0,0],miss:[.85,0,0,0],damage:.95});let a=stats(d,8);assert.ok(d.fires>20&&d.misses>20);assert.ok(d.streak[0]<=3);assert.ok(a.peak<.83&&a.rms>.001);});
test('Generated AudioWorklet module processes actual output blocks',()=>{let Voice;class Processor{constructor(){this.port={};}}vm.runInNewContext(WORKLET,{AudioWorkletProcessor:Processor,sampleRate:48000,registerProcessor:(_,c)=>Voice=c,Float32Array,Float64Array,Uint8Array,Math});const v=new Voice();v.port.onmessage({data:{rpm:3200,load:1,cyl:[1,1,1,1],miss:[0,0,0,0]}});let sum=0;for(let i=0;i<400;i++){const a=new Float32Array(128);assert.equal(v.process([],[[a]]),true);sum+=a.reduce((s,x)=>s+x*x,0);}assert.ok(sum>1);});
test('Backfire, relay and metallic impacts decay without a runaway signal',()=>{let d=new EngineDSP();d.hit(5);d.backfire();d.relay();const a=stats(d,3);assert.ok(a.peak<.83);assert.ok(d.pop<1e-10&&d.mech<1e-10&&d.click<1e-10);});

const window={Piston:{clamp:(value,min,max)=>Math.max(min,Math.min(max,value))}};
vm.runInNewContext(fs.readFileSync(require.resolve('../src/sample-audio.js'),'utf8'),{window});
function recordingMix(state,available=['idle','load']){
  const player=new window.Piston.MotorAudio(), mix={};
  player.ready=true;
  player.ctx={state:'running',currentTime:0};
  player.buffers=Object.fromEntries(available.map(name=>[name,{}]));
  player.lastState={ignition:'running',rpm:750,throttle:0,engineLoad:.17,activeCount:4,damage:0,...state};
  player.setLoop=(name,gain,rate,cutoff)=>{mix[name]={gain,rate,cutoff};};
  player.mix();
  return mix;
}
test('Healthy valve train is audible at idle, follows RPM and falls silent when the chain breaks',()=>{
  const idle=recordingMix({}),fast=recordingMix({rpm:3200});
  assert.ok(idle.rattle.gain>0&&idle.rattle.gain<idle.idle.gain);
  assert.ok(fast.rattle.rate>idle.rattle.rate&&fast.rattle.gain>idle.rattle.gain);
  assert.equal(recordingMix({timingDrive:{broken:true}}).rattle.gain,0);
});
test('Recorded load layer responds to combustion load at the same low RPM',()=>{
  const idle=recordingMix({}), loaded=recordingMix({throttle:1,engineLoad:1});
  assert.ok(idle.load.gain>0&&idle.load.gain<idle.idle.gain*.35);
  assert.ok(loaded.load.gain>loaded.idle.gain);
  assert.equal(idle.idle.rate,loaded.idle.rate);
  assert.equal(idle.load.rate,loaded.load.rate);
  const noBrake=recordingMix({throttle:.7,engineLoad:.5});
  const shaftLoad=recordingMix({throttle:.7,engineLoad:.5,absorbedNm:170});
  assert.ok(shaftLoad.load.gain>noBrake.load.gain);
  assert.equal(shaftLoad.load.rate,noBrake.load.rate);
  assert.ok(recordingMix({rpm:4600}).load.rate>recordingMix({rpm:2000}).load.rate);
  let previous=idle;
  for(let load=.18;load<=1;load+=.01){
    const mix=recordingMix({engineLoad:load});
    assert.ok(mix.load.gain>=previous.load.gain);
    assert.ok(mix.load.gain-previous.load.gain<.02);
    assert.ok(Math.hypot(mix.idle.gain,mix.load.gain)<.8);
    previous=mix;
  }
  const partial={rpm:2400,throttle:.5,engineLoad:.5};
  const mixed=recordingMix(partial), single=recordingMix(partial,['idle']);
  assert.ok(Math.abs(single.idle.gain-Math.hypot(mixed.idle.gain,mixed.load.gain))<1e-12);
});
test('Valve ticks use the recorded attack at cam cadence and fade out above idle',()=>{
  const player=new window.Piston.MotorAudio(),ticks=[];
  player.buffers.rattle={};
  player.play=(name,level,rate,options)=>ticks.push({name,level,...options});
  const m={rpm:750,ignition:'running',throttle:0};
  for(let i=0;i<10;i++)player.idleValveTicks(m,i*.04);
  assert.ok(ticks.length>=10&&ticks.every(t=>t.name==='rattle'&&t.offset>0&&t.decay<.01));
  for(let i=1;i<ticks.length;i++)assert.ok(Math.abs(ticks[i].at-ticks[i-1].at-.04)<1e-9);
  const idle=ticks[0].level;
  ticks.length=0;player.idleValveTicks({...m,rpm:1260},.48);
  assert.ok(ticks.length&&ticks.every(t=>t.level>0&&t.level<idle));
  ticks.length=0;
  for(const change of [{rpm:2000},{throttle:1},{ignition:'off'},{timingDrive:{broken:true}}])
    player.idleValveTicks({...m,...change},.6);
  assert.equal(ticks.length,0);
});
test('A visible exhaust seat accents its own cylinder once, including across cam wrap',()=>{
  const player=new window.Piston.MotorAudio(),seats=[];
  const m={rpm:780,ignition:'running',throttle:0,oilTemp:65,cylinders:Array.from({length:4},()=>({active:true,partWear:{exhaustValve:0}}))};
  player.buffers.rattle={};
  player.play=(name,level,rate,options)=>{if(options.at===undefined)seats.push(options.panPosition);};
  for(const sector of [2,3,3,0,1,2]){
    m.camAngle=(sector+.1)*Math.PI/2;
    m.cylinders[1].active=false;
    player.idleValveTicks(m,1);
  }
  assert.deepEqual(seats,[.13,.39,-.39]);
  m.timingDrive={broken:true};m.camAngle=1.55*Math.PI;player.idleValveTicks(m,1);
  assert.equal(seats.length,3);
});
test('In-phase harmonics keep their level throughout the recording seam',()=>{
  const rate=8000,period=40;
  const data=Float32Array.from({length:8000},(_,i)=>.18*Math.sin(2*Math.PI*i/period));
  const prepared=preparePCM([data],rate,true);
  const firstCycle=prepared.samples.slice(0,period);
  for(let i=0;i<prepared.overlap;i++){
    assert.ok(Math.abs(prepared.samples.at(-prepared.overlap+i)-firstCycle[i%period])<1e-6);
  }
});
test('Recorded firing intervals follow RPM and skip the corresponding inactive or misfiring cylinders',()=>{
  function envelope(rpm,active,unlit=[],holdMethod='cancelAndHoldAtTime',order){
    const player=new window.Piston.MotorAudio(),events=[];
    player.firingBus={gain:{
      [holdMethod]:at=>events.push(['hold',at]),
      setValueAtTime:(value,at)=>events.push(['base',at,value]),
      linearRampToValueAtTime:(value,at)=>events.push(['ramp',at,value]),
      setTargetAtTime:(value,at)=>events.push(['target',at,value])
    }};
    const cylinders=Array.from({length:order?.length??4},(_,id)=>({active:active.includes(id),lit:!unlit.includes(id),compression:1}));
    player.applyFiring(cylinders,rpm,0,true,order);
    const peaks=events.filter(([type,,value])=>type==='ramp'&&value===1).map(([,at])=>at);
    player.applyFiring(cylinders,rpm,.02,false);
    if(peaks.length)assert.deepEqual(events.slice(-2),[['hold',.02],['target',.02,1]]);
    return peaks;
  }
  const rounded=peaks=>peaks.map(value=>Number(value.toFixed(5)));
  assert.deepEqual(rounded(envelope(1500,[0],[],undefined,[0])),[.0264]);
  assert.deepEqual(rounded(envelope(1500,[0,1],[],undefined,[0,1])),[.0192,.0592]);
  assert.deepEqual(rounded(envelope(1500,[0,1,2],[2],undefined,[0,2,1])),[.0168,.07013]);
  assert.deepEqual(rounded(envelope(1500,[0,1,2,3])),[]);
  assert.deepEqual(rounded(envelope(1500,[0,2,3])),[.0156,.0356,.0556]);
  assert.deepEqual(rounded(envelope(1500,[0,1,2,3],[2])),[.0156,.0556,.0756]);
  assert.deepEqual(rounded(envelope(3000,[3])),[.0338,.0738]);
  assert.deepEqual(rounded(envelope(3000,[3],[],'cancelScheduledValues')),[.0338,.0738]);
});
test('Prepared starter retains engagement and catch while matching the cranking seam',()=>{
  const rate=8000,recording=[Float32Array.from({length:rate*1.6},(_,i)=>.18*Math.sin(i*.18)+.11*Math.cos(i*.17))];
  const original=preparePCM(recording,rate).samples;
  const starting=prepareStarter(recording,rate);
  const begin=starting.loopStart*rate,end=starting.loopEnd*rate;
  assert.deepEqual(starting.samples.slice(0,begin),original.slice(0,begin));
  assert.deepEqual(starting.samples.slice(starting.catchAt*rate),original.slice(starting.catchAt*rate));
  assert.equal(starting.samples[end-1],original[begin-1]);
  assert.ok(starting.loopEnd<starting.catchAt&&starting.peak<=.82);
});
test('Recorded starter pitch, brightness and level react to battery sag and crank speed',()=>{
  const player=new window.Piston.MotorAudio(),params={};
  const setting=name=>({setTargetAtTime:value=>{params[name]=value;}});
  player.ctx={currentTime:1};
  player.starterVoice={source:{playbackRate:setting('rate')},gain:{gain:setting('level')},filter:{frequency:setting('cutoff')}};
  player.mixStarter({ignition:'cranking',rpm:95,electrical:{voltage:8,starterA:110}});
  const sagged={...params};
  player.mixStarter({ignition:'cranking',rpm:230,electrical:{voltage:11.1,starterA:170}});
  for(const key of ['rate','level','cutoff'])assert.ok(params[key]>sagged[key]);
});
test('Recorded overrun coasts audibly, limiter honors zero load and key-off fades to silence',()=>{
  const base={rpm:4100,engineLoad:0};
  const powered=recordingMix({...base,throttle:.5,engineLoad:.5});
  const overrun=recordingMix({...base,overrun:true});
  const limiter=recordingMix({...base,throttle:1,revCut:true});
  const keyOff=recordingMix({...base,ignition:'off',overrun:true});
  assert.ok(powered.load.gain>overrun.load.gain&&overrun.load.gain>limiter.load.gain&&limiter.load.gain>0);
  assert.ok(overrun.load.cutoff<recordingMix(base).load.cutoff);
  assert.equal(limiter.load.gain,recordingMix({...base,revCut:true}).load.gain);
  assert.equal(keyOff.idle.gain+keyOff.load.gain,0);
});
test('Key-off leaves a quiet mechanical recording until the shaft stops',()=>{
  const player=new window.Piston.MotorAudio(),gains={};
  player.ready=true;
  player.ctx={state:'running',currentTime:1};
  player.buffers={idle:{},load:{}};
  player.setLoop=(name,gain)=>{gains[name]=gain;};
  const base={rpm:1800,throttle:.45,engineLoad:.45,damage:.3,ignition:'running'};
  player.update(base);
  const powered=gains.idle;
  player.update({...base,ignition:'off'});
  assert.ok(gains.idle>0&&gains.idle<powered&&gains.rattle>0);
  assert.equal(gains.load,0);
  player.update({...base,ignition:'off',rpm:220});
  assert.ok(gains.idle>0&&gains.idle<.02);
  player.update({...base,ignition:'off',rpm:0});
  assert.equal(gains.idle+gains.load+gains.rattle,0);
});
test('Recorded collision sound responds to contact strength without playing repeated impacts for a static jam',()=>{
  const player=new window.Piston.MotorAudio(),sounds=[];
  player.ready=true;
  player.ctx={state:'running',currentTime:1};
  player.lastState={ignition:'running',rpm:750,throttle:0,engineLoad:.17,activeCount:4,damage:0,fragments:{jamCount:1,scrape:0}};
  player.play=(name,volume)=>sounds.push({name,volume});
  player.mix();
  assert.equal(sounds.length,0);
  player.event({type:'impact',level:.18});
  player.event({type:'impact',level:.9});
  player.ctx.currentTime+=.2;
  player.event({type:'impact',level:.9});
  assert.deepEqual(sounds.map(sound=>sound.name),['click','impact']);
  assert.ok(sounds[1].volume>sounds[0].volume);
});
test('The same loose fragment loses its bright ring below the sump surface',()=>{
  const player=new window.Piston.MotorAudio(),sounds=[];
  player.ctx={currentTime:1};player.lastState={fragments:{oilSurface:515}};
  player.play=(name,volume,rate,options)=>sounds.push(options);
  player.event({type:'impact',level:.7,y:510});
  player.ctx.currentTime+=.2;player.event({type:'impact',level:.7,y:520});
  assert.ok(sounds[1].cutoff<sounds[0].cutoff&&sounds[1].decay<sounds[0].decay);
});
test('Recorded piston slap follows contact strength and position with a bounded cadence',()=>{
  const player=new window.Piston.MotorAudio(),sounds=[];
  player.ctx={state:'running',currentTime:1};
  player.lastState={ignition:'running',rpm:1600};
  player.play=(name,volume,rate,options)=>{sounds.push({name,volume,rate,...options});return {};};
  player.event({type:'pistonSlap',level:.09,x:385});
  player.event({type:'pistonSlap',level:.81,x:820});
  assert.equal(sounds.length,1);
  player.ctx.currentTime+=.1;
  player.event({type:'pistonSlap',level:.81,x:820});
  assert.deepEqual(sounds.map(({name})=>name),['impact','impact']);
  assert.ok(sounds[0].panPosition<0&&sounds[1].panPosition>0);
  assert.ok(sounds[1].volume>sounds[0].volume*2&&sounds[1].cutoff>sounds[0].cutoff);
  player.ctx.currentTime+=.1;
  player.lastState.ignition='off';
  player.event({type:'pistonSlap',level:1,x:820});
  assert.equal(sounds.length,2);
});
test('The recorded edge chip has a brighter and shorter attack than piston slap',()=>{
  const player=new window.Piston.MotorAudio(),sounds=[];
  player.ctx={state:'running',currentTime:1};
  player.lastState={ignition:'running',rpm:1600};
  player.play=(name,volume,rate,options)=>{sounds.push({name,rate,...options});return {};};
  player.event({type:'pistonSlap',level:.5,x:390});
  player.event({type:'edgeChip',level:.5,x:790});
  player.event({type:'edgeChip',level:.7,x:790});
  assert.deepEqual(sounds.map(({name})=>name),['impact','click']);
  assert.ok(sounds[0].cutoff<sounds[1].cutoff&&sounds[0].decay>sounds[1].decay&&sounds[0].rate<sounds[1].rate);
  assert.ok(sounds[0].offset>0&&sounds[1].offset>0&&sounds[1].panPosition>0);
});
