"""Checks use the actual bundled CC0 recordings, with all HTTP requests blocked.
Mobile input is Chromium touch emulation. Not a physical-device FPS benchmark.
"""
import json,time,hashlib,os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
version=json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']
OUT=ROOT/'dist'/f'verification-{version}'
OUT.mkdir(parents=True,exist_ok=True)
report={'version':version,'checks':[],'runtime_errors':[],'network_requests':[],'audio_recordings_downloaded':True,'limitations':['Desktop Chromium and mobile emulation; no physical phone tested.','Real files decoded and audio signal checked. Subjective timbre was not evaluated.','Local headless render costs are not device FPS guarantees.']}
build_url=(ROOT/'dist/last-piston.html').as_uri()+'?test'
def ok(name,value):
 assert value,name
 report['checks'].append(name)
 print('OK',name,flush=True)
def load(page):
 page.on('pageerror',lambda e:report['runtime_errors'].append(str(e)))
 page.route('http://**/*',lambda r:(report['network_requests'].append(r.request.url),r.abort()))
 page.route('https://**/*',lambda r:(report['network_requests'].append(r.request.url),r.abort()))
 page.goto(build_url,wait_until='load');page.wait_for_function('window.__engineLab');page.evaluate('__engineLab.pause()');page.wait_for_function('__engineLab.renderer.atlas.parts.size===8')
 page.evaluate('document.getElementById("stand-inspection").open=true')
def touch(page,id,pointer,value,kind='pointerdown'):
 b=page.locator('#'+id).bounding_box();page.locator('#'+id).dispatch_event(kind,{'pointerId':pointer,'pointerType':'touch','button':0,'clientX':b['x']+b['width']/2,'clientY':b['y']+b['height']-10-value*(b['height']-20)})
def settle(page):
 page.wait_for_function('!__engineLab.renderer.cameraMove',timeout=4000)
def cockpit_fits(page):
 return page.evaluate('''()=>{
  const rect=s=>document.querySelector(s).getBoundingClientRect();
  const inside=(child,parent)=>child.left>=parent.left-1&&child.top>=parent.top-1
   &&child.right<=parent.right+1&&child.bottom<=parent.bottom+1;
  const viewport={left:0,top:0,right:innerWidth,bottom:innerHeight};
  const cluster=rect('.cockpit-cluster'),tach=rect('#tach-face'),coolant=rect('#coolant-face');
  const lamps=[...document.querySelectorAll('.cluster-lamp svg')].map(el=>el.getBoundingClientRect());
  return inside(cluster,viewport)&&inside(tach,cluster)&&inside(coolant,cluster)
   &&tach.width>=75&&coolant.width>=38&&tach.right<=coolant.left+1
   &&lamps.length===5&&lamps.every(r=>r.width>=12&&inside(r,cluster))
   &&['#ignition-key','#gas','#brake'].every(s=>{const r=rect(s);return r.width>=44&&r.height>=44&&inside(r,viewport);});
 }''')
try:
 with sync_playwright() as p:
  chromium=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').is_file() else None)
  browser=p.chromium.launch(executable_path=chromium,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':1280,'height':1120},device_scale_factor=1);load(page)
  ok('all eight original SVG parts rasterize without network',page.evaluate('__engineLab.renderer.atlas.failed.length===0&&__engineLab.renderer.atlas.parts.size===8'))
  bore=browser.new_page(viewport={'width':1320,'height':920});load(bore)
  bore.evaluate('''()=>{
   const {engine:m,renderer:v,advance}=__engineLab;
   m.setProfile('normal');m.requestStart();advance(3,0);
   m.phase=1.4*Math.PI;m.refreshCycle();
   const top=Piston.pistonGeometry(m.phase,0,373).top;
   const p=m.fragments.add(0,'valve','chamber',392,top-11,3.3);
   Object.assign(p,{vx:610,vy:400,w:0});
   v.reduced=true;v.focus=0;v.lookAt({x:386,y:267,z:3});v.render(m);
  }''')
  bore.evaluate('''()=>{
   const {engine:m,renderer:v}=__engineLab,h=1/240;
   for(let i=0;i<19;i++){
    m.step(h,.45);for(const event of m.drainEvents())v.event(event,m);v.update(h,m);
   }
   v.render(m);
  }''')
  marks=bore.evaluate('''()=>{
   const {engine:m,renderer:v}=__engineLab,f=m.fragments;
   const dent=f.crownDents[0],scar=f.linerScuffs.find(s=>s.kind==='strike');
   if(!dent||!scar)return {};
   const frame=v.canvas.toDataURL(),scuffs=f.linerScuffs;
   f.crownDents[0]=null;v.render(m);const crownVisible=frame!==v.canvas.toDataURL();
   f.crownDents[0]=dent;f.linerScuffs=[];v.render(m);const wallVisible=frame!==v.canvas.toDataURL();
   f.linerScuffs=scuffs;v.render(m);
   return {crownVisible,wallVisible,repeat:frame===v.canvas.toDataURL(),side:scar.side,impacts:f.impacts};
  }''')
  ok('a loose valve shard rebounds off the rising crown and the right liner in the portable build',
     marks.get('impacts')==2 and marks.get('side')==1)
  ok('the crown dent and liner score each change the paused cutaway pixels',
     marks['crownVisible'] and marks['wallVisible'] and marks['repeat'])
  bore.locator('#engine').screenshot(path=OUT/'crown-and-liner-impact.png')
  bore.close()
  wedge=browser.new_page(viewport={'width':1320,'height':920});load(wedge)
  caught=wedge.evaluate('''()=>{
   const l=__engineLab;l.reset();l.pause();
   const m=l.engine,v=l.renderer,h=1/120;v.reduced=true;m.requestStart();
   for(let i=0;i<284;i++)m.step(h,.25);
   m.toggleBenchFault('skirt','break',0);
   let peak=0;
   for(let i=0;i<=31;i++){m.step(h,.45);peak=Math.max(peak,m.fragments.skirtWedgeNm);}
   l.advance(0);v.setFocus(0);l.advance(0);
   const chip=v.jamFocus,scar=m.fragments.linerScuffs.find(s=>s.kind==='wedge');
   return {jam:chip?.jammed,side:scar?.side,firstLength:scar?.bottom-scar?.top,zoom:v.zoom,peak};
  }''')
  ok('the broken skirt wedges its chip on the right and cylinder inspection follows the loaded contact at x3',
     caught.get('jam') and caught['zoom']==3 and caught['side']==1 and caught['peak']>8
     and 'между юбкой и гильзой' in wedge.locator('#inspection-note').text_content())
  wedge.locator('#engine').screenshot(path=OUT/'skirt-wedge.png')
  freed=wedge.evaluate('''()=>{
   const l=__engineLab,m=l.engine,v=l.renderer,chip=v.jamFocus;
   for(let i=0;i<23;i++)m.step(1/120,.45);
   v.updateCamera(performance.now());l.advance(0);
   const marks=m.fragments.linerScuffs,scar=marks.find(s=>s.kind==='wedge');
   const withScar=v.canvas.toDataURL();m.fragments.linerScuffs=marks.filter(s=>s!==scar);v.render(m);
   const visible=withScar!==v.canvas.toDataURL();m.fragments.linerScuffs=marks;v.render(m);
   return {free:!chip.jammed,load:m.fragments.skirtWedgeNm,length:scar.bottom-scar.top,visible,
    repeat:withScar===v.canvas.toDataURL()};
  }''')
  ok('the released shard leaves a longer visible groove and no further wedge torque',
     freed['free'] and freed['load']==0 and freed['length']>caught['firstLength'] and freed['visible'] and freed['repeat'])
  report['skirt_wedge']={'caught':caught,'released':freed};wedge.close()
  rings=browser.new_page(viewport={'width':1440,'height':1000});load(rings)
  scored=rings.evaluate('''()=>{
   const l=__engineLab;l.reset();l.pause();
   const m=l.engine,v=l.renderer,h=1/120;v.reduced=true;m.requestStart();
   for(let n=0;n<234;n++)m.step(h,.25);
   m.toggleBenchFault('skirt','break',0);
   const cy=m.cylinders[0],d=cy.contact;
   for(let n=0;n<2400;n++)m.step(h,.65);
   for(let n=0;n<220&&(d.ringGasRight<3||cy.cycle.stroke!==0);n++)m.step(h,.65);
   v.focus=0;v.lookAt({x:385,y:324,z:2.25});l.advance(0);
   const frame=v.canvas.toDataURL(),flow=d.ringGasRight;
   v.render(m);const sameFrame=v.canvas.toDataURL()===frame;
   d.ringGasRight=0;v.render(m);
   const plumeVisible=v.canvas.toDataURL()!==frame;d.ringGasRight=flow;v.render(m);
   return {faces:d.ringFaces,flow,sameFrame,plumeVisible,pressure:m.crankcasePressure,
    left:d.ringGasLeft,crown:d.crownGasFlow,repeat:frame===v.canvas.toDataURL()};
  }''')
  ok('a real chip score wears only the four crossing right-hand faces and feeds the crankcase through the rings',
     scored['faces'][:4]==[0]*4 and min(scored['faces'][4:])>.1 and scored['flow']>3
     and scored['pressure']>0 and scored['left']==0 and scored['crown']==0)
  ok('redrawing the first paused frame with ring blow-by gives identical pixels',scored['sameFrame'])
  ok('the ring-side gas jet changes the paused cutaway and inspection reports its measured flow',
     scored['plumeVisible'] and scored['repeat'] and 'газы мимо колец' in rings.locator('#inspection-note').text_content())
  rings.locator('#engine').screenshot(path=OUT/'ring-blowby.png')
  rings.evaluate('''()=>{
   const l=__engineLab,m=l.engine,v=l.renderer;
   for(let n=0;n<220;n++){
    if(m.cylinders[0].cycle.angle>=2.8&&m.cylinders[0].cycle.angle<=3.12)break;
    m.step(1/120,.65);
   }
   v.lookAt({x:409,y:335,z:4});l.advance(0);
  }''')
  rings.locator('#engine').screenshot(path=OUT/'ring-groove.png')
  report['scored_rings']=scored;rings.close()
  high_speed=page.evaluate('''()=>{
   const running=new Piston.Engine(),h=1/240;
   running.setProfile('normal');running.requestStart();
   for(let n=0;n<1100;n++)running.step(1/120,1);
   const {rpm,shaftSpeed}=running;
   const phase=Math.PI+shaftSpeed*h,next=Piston.pistonGeometry(phase,0,373);
   function shot(x,y,vx,vy,r=1.4,kind='metal',sweep=true){
    const m=new Piston.Engine();m.rpm=rpm;m.shaftSpeed=shaftSpeed;m.phase=phase;
    m.oil=0;m.oilCircuit.setInventory(0);
    const f=m.fragments,p=f.add(0,kind,'case',x,y,r),beforeMass=p.mass;
    if(!sweep)f.sweepCase=()=>{};
    Object.assign(p,{vx,vy});f.step(h,m);
    return {x:p.x,y:p.y,vx:p.vx,vy:p.vy,r:p.r,impacts:f.impacts,count:f.bodies.length,
     massError:Math.abs(f.bodies.reduce((sum,b)=>sum+b.mass,0)-beforeMass),
     outsideJournal:Math.hypot(p.x-next.crankX,p.y-next.crankY)>=18+p.r};
   }
   const x=373-(850*h+373-next.crankX)/2;
   return {rpm,journal:shot(x,522.1,850,0),discrete:shot(x,522.1,850,0,1.4,'metal',false),
    clear:shot(x,523.1,850,0),cap:shot(432.6,447.55,0,850),wall:shot(886,520,850,0),
    hard:shot(879,532,850,0,8,'crown'),light:shot(881.9,532,100,0,8,'crown')};
  }''')
  report['high_speed_debris']=high_speed
  journal_hit=high_speed['journal']
  ok('a glancing chip meets the moving journal near redline, without catching a nearby clear path',
     high_speed['rpm']>6200 and high_speed['discrete']['impacts']==0 and journal_hit['impacts']==1
     and journal_hit['vy']>100 and journal_hit['outsideJournal'] and high_speed['clear']['impacts']==0)
  cap_hit,wall_hit=high_speed['cap'],high_speed['wall']
  ok('fast chips rebound on the entry side of the cap lip and the crankcase wall',
     cap_hit['y']+cap_hit['r']<=449 and cap_hit['vy']<0 and abs(cap_hit['x']-432.6)<.1
     and wall_hit['x']+wall_hit['r']<=890 and wall_hit['vx']<0)
  hard,light=high_speed['hard'],high_speed['light']
  ok('a hard impact chips a brittle fragment while a light impact leaves it intact',
     hard['count']==2 and hard['r']<8 and hard['massError']<1e-9 and light['count']==1 and light['r']==8)
  continuity=page.evaluate('''()=>{
   const h=1/120,m=new Piston.Engine();
   m.setProfile('normal');m.requestStart();
   for(let n=0;n<600;n++)m.step(h,.4);
   m.disturb('rod','break',1);
   const rod=m.fragments.bodies.find(p=>p.kind==='rod');
   const g=Piston.pistonGeometry(m.cylinders[1].freeze,1,517);
   const bornAtRod=Math.hypot(rod.x-g.crankX,rod.y-g.crankY)<28;
   let maxRodDebrisTravel=0;
   for(let n=0;n<80;n++){
    const prior=new Map(m.fragments.bodies.map(p=>[p.id,[p.x,p.y]]));
    m.step(h,.45);
    for(const p of m.fragments.bodies){
     const xy=prior.get(p.id);
     if(p.kind==='metal'&&xy)maxRodDebrisTravel=Math.max(maxRodDebrisTravel,Math.hypot(p.x-xy[0],p.y-xy[1]));
    }
   }
   m.disturb('skirt','break',0);
   const skirt=m.fragments.bodies.find(p=>p.kind==='skirt');
   const skirtStartsInLiner=skirt.zone==='liner'&&skirt.y<417;
   m.failCylinder(m.cylinders[2],'ejected',undefined,true);
   const start=m.fragments.detached[2]?.top;
   let span=0,fallStep=0,crossing=0,skirtCrossing=0,restored=false;
   for(let n=0;n<280;n++){
    const last=m.fragments.detached[2]?.top;
    const crown=m.fragments.bodies.find(p=>p.kind==='crown');
    const before=crown&&{...crown},previousSkirt={...skirt};
    if(last>start+18&&!window.fallingReplay)window.fallingReplay=m.snapshot();
    m.step(h,.25);
    const next=m.fragments.detached[2]?.top;
    if(next!==undefined){
     span=Math.max(span,next-start);
     if(last!==undefined)fallStep=Math.max(fallStep,Math.abs(next-last));
    }
    if(before?.zone==='chamber'&&crown.zone==='case')crossing=Math.hypot(crown.x-before.x,crown.y-before.y);
    if(previousSkirt.zone==='liner'&&skirt.zone==='case')skirtCrossing=Math.hypot(skirt.x-previousSkirt.x,skirt.y-previousSkirt.y);
    if(crossing&&skirtCrossing)break;
   }
   const before=window.fallingReplay?.fragments.detached[2],saved=Piston.Engine.restore(window.fallingReplay).fragments.detached[2];
   restored=!!before&&saved.top===before.top&&saved.vy===before.vy;
   return {bornAtRod,maxRodDebrisTravel,skirtStartsInLiner,span,fallStep,crossing,skirtCrossing,restored};
  }''')
  report['fragment_continuity']=continuity
  ok('rod and skirt debris start at the break and a saved falling piston advances gradually',
     continuity['bornAtRod'] and continuity['skirtStartsInLiner'] and continuity['span']>28
     and 0<continuity['fallStep']<5 and continuity['restored'] and continuity['maxRodDebrisTravel']<12)
  ok('the same crown and skirt debris pass into the sump without a position jump',
     0<continuity['crossing']<9 and 0<continuity['skirtCrossing']<9)
  falling=browser.new_page(viewport={'width':1280,'height':1000});load(falling)
  falling.evaluate('(state)=>__engineLab.restore(state)',page.evaluate('fallingReplay'))
  falling.locator('#cyl2').click();settle(falling)
  falling.locator('.machine').screenshot(path=OUT/'piston-falling.png')
  falling.close()
  ok('atlas has a bounded one-time memory footprint',page.evaluate('__engineLab.renderer.atlas.bytes<2500000'))
  ok('fresh engine is off with four cylinders',page.evaluate('__engineLab.engine.ignition==="off"&&__engineLab.engine.activeCount===4'))
  page.locator('.machine').screenshot(path=OUT/'engine-cold.png')
  ok('stopped cylinder cards show stop instead of combustion',
     page.evaluate('[...document.querySelectorAll(".cyl b")].every(el=>el.textContent==="СТОП")'))
  ok('desktop no horizontal overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  page.locator('#failures-open').focus();page.keyboard.press('Enter')
  ok('the separate damage dialog opens by keyboard and announces an empty engine',
     page.locator('#failures-empty').is_visible() and page.evaluate("document.querySelector('#failures-dialog').matches(':modal')&&document.activeElement.id==='failures-close'"))
  page.keyboard.press('Escape');page.wait_for_function("!document.querySelector('#failures-dialog').open&&document.activeElement.id==='failures-open'")
  ok('Escape closes the damage dialog and returns focus',True)
  ok('the driving deck groups the gauges, key and pedals below the cutaway',page.evaluate('''()=>{
   const rect=s=>document.querySelector(s).getBoundingClientRect(),scene=rect('.machine'),cluster=rect('.cockpit-cluster'),key=rect('#ignition-key'),pedals=rect('.pedal-console');
   return scene.bottom<=cluster.top&&cluster.right<=key.left+1&&key.right<=pedals.left+1&&key.bottom<=innerHeight;
  }'''))
  ok('ignition off leaves the warning lamps unlit',page.locator('.cluster-lamp.on').count()==0)
  page.locator('#ignition-key').click();page.wait_for_function('__engineLab.audio.ready',timeout=15000)
  ok('turning the key runs the dashboard bulb check',page.locator('.cluster-lamp.on').count()==5)
  page.locator('.cockpit-cluster').screenshot(path=OUT/'cluster-bulb-check.png')
  page.keyboard.down('w');page.keyboard.down('s');page.evaluate('__engineLab.stepInputs(.25)')
  ok('keyboard gas and brake work with focus still on the ignition key',
     page.evaluate('document.activeElement.id==="ignition-key"&&__engineLab.pedals.gas>0&&__engineLab.pedals.brake>0'))
  page.keyboard.up('w');page.keyboard.up('s')
  ok('all SIX actual CC0 WAV recordings decode entirely offline',page.evaluate('Object.keys(__engineLab.audio.buffers).length===6&&Object.values(__engineLab.audio.stats).every(s=>s.embedded)'))
  ok('no synthesized core or media-stream fallback',page.evaluate('__engineLab.audio.backend==="recordings"&&!__engineLab.audio.dsp&&Object.keys(__engineLab.audio.media).length===0'))
  report['decoded_recordings']=page.evaluate('__engineLab.audio.stats')
  ok('all audio samples have finite bounded prepared peaks',all(0<v['peak']<=.83 for v in report['decoded_recordings'].values()))
  page.evaluate('__engineLab.engine.setProfile("normal");__engineLab.advance(4,0,true);__engineLab.advance(3,.5,true,.3)')
  ok('engine and coupled brake still run',page.evaluate('__engineLab.engine.ignition==="running"&&__engineLab.engine.absorbedKW>0'))
  ok('a healthy running engine clears the bulb check and moves the tachometer',
     page.locator('.cluster-lamp.on').count()==0 and float(page.locator('#tach-face').get_attribute('aria-valuenow'))>0)
  report['cluster_faults']=page.evaluate('''()=>{
   const {engine:m,dashboard}=__engineLab;
   const cases=[
    ['oil',m,{pressure:.4}],
    ['charge',m.electrical,{alternatorA:m.electrical.loadA-2,current:-2}],
    ['coolant',m,{coolant:115}],
    ['engine',m.cylinders[1],{active:false}],
    ['engine',m.timingDrive,{teethSkipped:1}],
    ['brake',m,{brakeHot:true,brakeTemp:385}]
   ];
   return cases.map(([name,target,overrides])=>{
    const before=Object.fromEntries(Object.keys(overrides).map(key=>[key,target[key]]));
    try{
     Object.assign(target,overrides);dashboard.update(m);
     return {expected:'lamp-'+name,lit:[...document.querySelectorAll('.cluster-lamp.on')].map(el=>el.id),
      announced:document.querySelector('#warning-status').textContent};
    }finally{Object.assign(target,before);dashboard.update(m);}
   });
  }''')
  ok('real model warning states light only the corresponding telltale and announce it',
     all(row['lit']==[row['expected']] and row['announced'] for row in report['cluster_faults']))
  coolant_dial=page.evaluate('''()=>{
   const {engine:m,dashboard}=__engineLab;
   const raw=m.coolant,filtered=m.sensor.coolant;
   try{
    return [24,82,100,109,110,144].map(temp=>{
     m.coolant=m.sensor.coolant=temp;dashboard.update(m);
     const needle=document.querySelector('#coolant-needle'),lamp=document.querySelector('#lamp-coolant');
     return {degrees:Number.parseFloat(needle.style.transform.slice(7)),lit:lamp.classList.contains('on')};
    });
   }finally{m.coolant=raw;m.sensor.coolant=filtered;dashboard.update(m);}
  }''')
  report['coolant_dial']=coolant_dial
  ok('the coolant needle stays centered when warm and crosses the red-band threshold with its telltale',
     coolant_dial[0]['degrees']==-77 and all(abs(row['degrees'])<4 for row in coolant_dial[1:3])
     and coolant_dial[3]['degrees']>20 and not coolant_dial[3]['lit']
     and coolant_dial[4]['lit'] and coolant_dial[5]['degrees']==77)
  page.evaluate('window.an=__engineLab.audio.ctx.createAnalyser();an.fftSize=4096;__engineLab.audio.master.connect(an)');page.wait_for_timeout(550)
  report['audio_signal']=page.evaluate('(()=>{let d=new Float32Array(an.fftSize);an.getFloatTimeDomainData(d);return {rms:Math.sqrt(d.reduce((n,v)=>n+v*v,0)/d.length),peak:Math.max(...d.map(Math.abs)),backend:__engineLab.audio.backend}})()')
  ok('actual recordings produce nonzero bounded browser audio',report['audio_signal']['rms']>.0001 and report['audio_signal']['peak']<1)
  ok('three stable loop nodes, not one source per frame',page.evaluate('Object.keys(__engineLab.audio.loops).length===3'))
  page.evaluate('Promise.all([__engineLab.audio.start(),__engineLab.audio.start(),__engineLab.audio.start()])');ok('repeated start does not duplicate loop nodes',page.evaluate('Object.keys(__engineLab.audio.loops).length===3'))
  page.screenshot(path=OUT/'desktop.png',full_page=True);page.locator('.machine').screenshot(path=OUT/'engine.png')
  before=page.evaluate('JSON.stringify(__engineLab.engine.snapshot())')
  page.evaluate('for(let i=0;i<3;i++)__engineLab.renderer.render(__engineLab.engine)')
  ok('rendering cannot advance wear, timing or RNG',before==page.evaluate('JSON.stringify(__engineLab.engine.snapshot())'))
  lighting=page.evaluate('''()=>{
   const {engine:m,renderer:v}=__engineLab, {scale,offsetX,offsetY,camera,c}=v;
   const left=Math.round(offsetX+scale*(600+(314-camera.x)*camera.z));
   const top=Math.round(offsetY+scale*(340+(414-camera.y)*camera.z));
   const measure=()=>{
    v.render(m);
    return c.getImageData(left,top,Math.round(scale*568),Math.round(scale*134)).data;
   };
   const lit=measure(), results={};
   for(const name of ['crankShadows','lightCounterweight']){
    const paint=v[name];v[name]=()=>{};
    let flat;
    try{flat=measure();}finally{v[name]=paint;}
    let affected=0;
    for(let i=0;i<lit.length;i+=4)if(Math.abs(lit[i]-flat[i])+Math.abs(lit[i+1]-flat[i+1])+Math.abs(lit[i+2]-flat[i+2])>=12)affected++;
    results[name]=affected;
   }
   results.repeat=measure().every((value,i)=>value===lit[i]);
   return results;
  }''')
  report['crank_lighting']=lighting
  ok('crank shadows and fixed-light reflections visibly change the same paused frame',
     lighting['repeat'] and lighting['crankShadows']>100 and lighting['lightCounterweight']>100)
  for part in ['radiator','pump','filter','exhaust','sump','timing']:
   page.locator('[data-part='+part+']').click();ok(part+' component zoom uses the real live scene',page.evaluate(f'__engineLab.renderer.partFocus==="{part}"&&__engineLab.renderer.zoom>1'))
   settle(page)
   page.locator('.machine').screenshot(path=OUT/(part+'.png'))
  page.locator('#cyl1').click();ok('cylinder zoom clears part focus',page.evaluate('__engineLab.renderer.partFocus===null&&__engineLab.renderer.focus===1'))
  ok('the overview caption yields to the zoom label',page.locator('.scene-caption').is_hidden())
  page.locator('#zoom-out').click();ok('general view clears component selection',page.evaluate('__engineLab.renderer.zoom===1&&document.querySelectorAll("[data-part][aria-pressed=true]").length===0'))
  ok('the caption returns in the general view',page.locator('.scene-caption').is_visible())
  for mode in ['oil','thermal','damage','section']:
   page.locator('[data-view='+mode+']').click();ok(mode+' inspection layer retained',page.evaluate(f'__engineLab.renderer.mode==="{mode}"'))
   if mode=='thermal':ok('thermal view shows a readable absolute temperature scale',page.locator('#temperature-scale').is_visible())
  ok('temperature scale stays out of the ordinary section',page.locator('#temperature-scale').is_hidden())
  touch(page,'gas',1,.6);touch(page,'brake',2,.3);page.evaluate('__engineLab.stepInputs(1)')
  ok('analogue gas and brake are independent',page.evaluate('__engineLab.pedals.gas>.59&&__engineLab.pedals.brake>.29'))
  page.locator('#gas').dispatch_event('pointercancel',{'pointerId':1});ok('gas cancel preserves held brake',page.evaluate('__engineLab.pedals.gas===0&&__engineLab.pedals.brake>.29'))
  page.locator('#brake').dispatch_event('lostpointercapture',{'pointerId':2});ok('lost capture releases brake',not page.evaluate('__engineLab.held'))
  page.locator('#settings-open').focus();page.keyboard.press('Enter')
  ok('keyboard opens settings with focus on the close button',page.evaluate("document.querySelector('#settings-dialog').matches(':modal')&&document.activeElement.id==='settings-close'"))
  page.locator('#settings-dialog').screenshot(path=OUT/'settings-desktop.png')
  page.locator('#mechanical-mix').fill('35');page.locator('#mechanical-mix').dispatch_event('input');ok('mechanical mix works independently of engine',page.evaluate('__engineLab.audio.mixSettings.mechanical===.35&&__engineLab.audio.mixSettings.engine===1'))
  page.keyboard.press('Escape');page.wait_for_function("!document.querySelector('#settings-dialog').open&&document.activeElement.id==='settings-open'")
  ok('Escape closes settings and restores focus to the opener',True)
  ok('pipe fluids conserve the model inventory',page.evaluate('Math.abs(__engineLab.engine.oilCircuit.total-__engineLab.engine.oil)<1e-8&&Math.abs(__engineLab.engine.waterCircuit.total-__engineLab.engine.coolantLevel*6)<1e-8'))
  oil_color='__engineLab.renderer.oilColor(__engineLab.engine,.7)'
  color_before=page.evaluate(oil_color)
  page.evaluate('__engineLab.engine.setProfile("stress");__engineLab.advance(44,1,true)')
  ok('visible oil darkens under load before the sump runs dry',page.evaluate('__engineLab.engine.oil>0&&__engineLab.engine.oilOxidation>.1') and page.evaluate(oil_color)!=color_before)
  page.locator('.machine').screenshot(path=OUT/'engine-hot.png')
  shimmer=page.evaluate('''()=>{
   const {engine:m,renderer:v}=__engineLab,{scale,offsetX,offsetY,camera,c}=v;
   const x=Math.round(offsetX+scale*(600+(932-camera.x)*camera.z));
   const y=Math.round(offsetY+scale*(340+(151-camera.y)*camera.z));
   const pixels=()=>{v.render(m);return c.getImageData(x,y,Math.round(120*scale),Math.round(96*scale)).data;};
   const measure=()=>{
    const hot=pixels(),warp=v.exhaustShimmer;v.exhaustShimmer=()=>{};
    let flat;
    try{flat=pixels();}finally{v.exhaustShimmer=warp;}
    let changed=0;
    for(let i=0;i<hot.length;i+=4)if(Math.abs(hot[i]-flat[i])+Math.abs(hot[i+1]-flat[i+1])+Math.abs(hot[i+2]-flat[i+2])>=9)changed++;
    return changed;
   };
   const hotPixels=measure(),reduced=v.reduced;v.reduced=true;
   try{return {hotPixels,reducedPixels:measure(),temperature:m.exhaust.manifold};}
   finally{v.reduced=reduced;v.render(m);}
  }''')
  report['heat_shimmer']=shimmer
  ok('hot exhaust distorts local canvas pixels and reduced motion suppresses the refraction',
     shimmer['hotPixels']>100 and shimmer['reducedPixels']==0)
  page.locator('[data-view=thermal]').click()
  page.locator('.machine').screenshot(path=OUT/'thermal-hot.png')
  page.locator('[data-view=section]').click()
  page.locator('[data-part=sump]').click();settle(page)
  page.locator('.machine').screenshot(path=OUT/'sump-hot.png')
  page.locator('#zoom-out').click();settle(page)
  page.evaluate('__engineLab.advance(196,1,true)')
  ok('last piston survives with the new assets and contact workspaces',page.evaluate('__engineLab.engine.activeCount===1&&__engineLab.engine.rpm>=380'))
  ok('internal chips remain bounded and at least one gets trapped',page.evaluate('__engineLab.engine.fragments.bodies.length<=64&&__engineLab.engine.fragments.jamCount>0'))
  report['local_failure_progression']=page.evaluate('''()=>{
    const m=__engineLab.engine;
    return {cylinders:m.cylinders.map(c=>({wear:{...c.partWear},exhaustValveTemp:c.exhaustValveTemp})),
     fragments:[...new Set(m.fragments.bodies.map(p=>p.kind))]};
  }''')
  ok('long stress damages ring lands, skirts and exhaust valves and produces the corresponding fragments',
     all(any(c['wear'][part]==1 for c in report['local_failure_progression']['cylinders'])
         for part in ('ringLand','skirt','exhaustValve'))
     and all(kind in report['local_failure_progression']['fragments'] for kind in ('ringLand','skirt','valve')))
  report['auxiliary_failures']=page.evaluate('''()=>{
   const m=__engineLab.engine;
   return {wear:{...m.auxWear},flow:m.waterCircuit.q,oilPressure:m.pressure,exhaustPressure:m.exhaust.pressure,
    coolant:m.coolantLevel,radiatorRunoff:m.radiatorRunoff,sealWear:m.exhaust.sealWear,jointGap:m.exhaust.jointGap};
  }''')
  ok('the loaded engine can break the impeller, oil pickup, muffler baffle and radiator',
     all(report['auxiliary_failures']['wear'][name]==1 for name in ('waterPump','oilPickup','mufflerBaffle','radiator')))
  hardware=page.evaluate('''()=>{
   const {engine:m,renderer:v}=__engineLab, draw=v.drawInternalHardware, kinds={};
   v.drawInternalHardware=function(p,...args){
    const actual=draw.call(this,p,...args);
    if(actual)kinds[p.kind]=(kinds[p.kind]||0)+1;
    return actual;
   };
   try{v.render(m);return kinds;}finally{v.drawInternalHardware=draw;}
  }''')
  ok('real rod and piston failures render bearing shells and crown fragments',
     hardware.get('bearing')==3 and hardware.get('crown')==1)
  ok('new local failures render all three fragment shapes',
     all(hardware.get(kind,0)>0 for kind in ('ringLand','skirt','valve')))
  failure_labels={}
  for part in ('exhaust','sump','pump','radiator'):
   page.locator(f'[data-part={part}]').click();settle(page)
   failure_labels[part]=page.locator('#inspection-note').text_content()
   page.locator('.machine').screenshot(path=OUT/(part+'-damaged.png'))
   page.locator('#zoom-out').click();settle(page)
  ok('inspection reports the actual failed part at all four affected views',
     all(word in failure_labels[part] for part,word in [
       ('exhaust','перегородка'),('sump','маслоприёмник'),('pump','крыльчатка'),('radiator','трещина')]))
  ok('the stress run opens the worn flange and inspection reports the seal failure',
     report['auxiliary_failures']['sealWear']==1 and report['auxiliary_failures']['jointGap']>0
     and 'повреждено уплотнение фланца' in failure_labels['exhaust'])
  page.locator('[data-view=thermal]').click()
  page.locator('.machine').screenshot(path=OUT/'thermal-damaged.png')
  page.locator('[data-view=section]').click()
  page.screenshot(path=OUT/'damaged.png',full_page=True);page.locator('.machine').screenshot(path=OUT/'engine-damaged.png')
  report['pools']=page.evaluate('({svg:__engineLab.renderer.atlas.parts.size,atlas_bytes:__engineLab.renderer.atlas.bytes,cache:__engineLab.renderer.cache.size,smoke:__engineLab.renderer.smoke.length,internal:__engineLab.engine.fragments.bodies.length,external:__engineLab.renderer.debris.length,loops:Object.keys(__engineLab.audio.loops).length,oneshots:__engineLab.audio.sources.size})')
  ok('memory-heavy effects stay within their budgets',report['pools']['cache']<65 and report['pools']['smoke']<=260 and report['pools']['internal']<=64 and report['pools']['oneshots']<=12)
  page.evaluate('window.saved=__engineLab.engine.snapshot();__engineLab.restore(JSON.parse(JSON.stringify(saved)))')
  ok('restoring keeps internal pieces and releases all input',page.evaluate('__engineLab.engine.fragments.bodies.length===saved.fragments.bodies.length&&__engineLab.pedals.gas===0&&__engineLab.pedals.brake===0'))
  ok('all four new failures survive a v7 reload',page.evaluate('Object.keys(saved.auxWear).every(k=>__engineLab.engine.auxWear[k]===saved.auxWear[k])'))
  ok('local damage survives a v7 reload',page.evaluate('''()=>{
    return __engineLab.engine.cylinders.every((c,i)=>Object.keys(saved.cylinders[i].partWear)
     .every(part=>c.partWear[part]===saved.cylinders[i].partWear[part]));
  }'''))
  page.locator('#ignition-key').click()
  ok('key-off parks the gauges and cuts the warning lamps while the shaft still coasts',
     page.evaluate('''()=>__engineLab.engine.ignition==='off'&&__engineLab.engine.rpm>5
      &&document.querySelector('#tach-face').getAttribute('aria-valuenow')==='0'
      &&document.querySelector('#coolant-face').getAttribute('aria-valuenow')==='24'
      &&!document.querySelector('.cluster-lamp.on')'''))
  page.evaluate('__engineLab.advance(40,0,true)');page.wait_for_timeout(450)
  ok('key-off reaches zero and stops engine recordings',page.evaluate('__engineLab.engine.rpm===0&&__engineLab.audio.loops.idle.gain.gain.value<.001&&__engineLab.audio.loops.load.gain.gain.value<.001'))
  page.locator('#settings-open').click();page.locator('#performance-mode').select_option('eco');ok('eco mode preserved',page.evaluate('__engineLab.renderer.pixelRatioLimit===1'))
  page.locator('#motion').click();ok('reduced motion preserved',page.evaluate('__engineLab.renderer.reduced'))
  page.locator('#reset').click();ok('reset still needs confirmation',page.evaluate("__engineLab.engine.activeCount===1&&document.activeElement.id==='cancel-reset'"));page.locator('#confirm-reset').click();ok('reset clears debris but keeps shared SVG atlas',page.evaluate('__engineLab.engine.fragments.bodies.length===0&&__engineLab.renderer.atlas.parts.size===8'))
  page.locator('#settings-close').click()
  # Validate destruction of an actual loaded player, including queued one-shots.
  result=page.evaluate('''async()=>{const a=new Piston.MotorAudio();a.muted=true;await a.start();for(let i=0;i<40;i++)a.play('impact',.1);const peak=a.sources.size;a.destroy();await new Promise(r=>setTimeout(r,30));return {peak,closed:a.ctx.state,loops:Object.keys(a.loops).length,voices:a.sources.size,timer:a.timer,revive:await a.start()};}''')
  report['audio_cleanup']=result;ok('one-shots capped and destroy closes every live audio resource',result['peak']<=12 and result['closed']=='closed' and result['voices']==0 and result['loops']==0 and result['timer'] is None and result['revive'] is False)
  page.evaluate('__engineLab.engine.requestStart();__engineLab.advance(4,0,true);__engineLab.advance(3,.5,true)');
  report['render_cost']=page.evaluate('(()=>{const a=[];for(let i=0;i<35;i++){let t=performance.now();__engineLab.renderer.render(__engineLab.engine);__engineLab.renderer.c.getImageData(0,0,1,1);if(i>4)a.push(performance.now()-t)}a.sort((a,b)=>a-b);return {median_ms:a[15],p95_ms:a[28],samples:a.length,mode:__engineLab.renderer.performanceMode}})()')
  crank=browser.new_page(viewport={'width':1280,'height':1120});load(crank)
  crank.locator('#ignition-key').click();crank.wait_for_function('__engineLab.audio.ready')
  crank.evaluate('''()=>{
   const a=__engineLab.audio;
   window.crankSignal=a.ctx.createAnalyser();a.master.connect(crankSignal);
  }''')
  crank.wait_for_timeout(1850)
  ok('starter recording remains audible beyond the original clip while cranking',crank.evaluate('''()=>{
   const {engine,audio}=__engineLab, samples=new Float32Array(crankSignal.fftSize);
   crankSignal.getFloatTimeDomainData(samples);
   return engine.ignition==='cranking'&&audio.starterVoice?.source.loop&&samples.some(x=>Math.abs(x)>.003);
  }'''))
  crank.locator('#ignition-key').click()
  crank.wait_for_function('__engineLab.audio.sources.size===0')
  ok('key-off releases the looping starter voice',crank.evaluate('__engineLab.engine.ignition==="off"&&!__engineLab.audio.starterVoice'))
  crank.close()
  visual=browser.new_page(viewport={'width':1280,'height':1120});load(visual)
  camera=visual.evaluate('''()=>{
   const {engine:m,renderer:v}=__engineLab,snapshot=JSON.stringify(m.snapshot());
   v.reduced=false;v.setFocus(1);v.updateCamera(v.cameraMove.start+90);
   const middle=v.camera.z,position={...v.camera};
   v.setPart('sump');
   const continuous=v.camera.x===position.x&&v.camera.y===position.y&&v.camera.z===position.z;
   v.updateCamera(v.cameraMove.start+300);
   const arrived=v.camera.z===v.zoom&&v.cameraMove===null;
   v.reduced=true;v.setGeneral();
   return {middle,continuous,arrived,snapped:v.camera.z===1&&!v.cameraMove,
    unchanged:JSON.stringify(m.snapshot())===snapshot};
  }''')
  ok('inspection zoom eases, retargets continuously and snaps in reduced motion',
     1<camera['middle']<1.8 and all(camera[k] for k in ('continuous','arrived','snapped','unchanged')))
  visual.evaluate('__engineLab.renderer.reduced=false')
  frozen_time=visual.evaluate('__engineLab.engine.time')
  visual.locator('#inspect-pause').click();visual.locator('[data-part=sump]').click();settle(visual)
  ok('camera finishes while the physical cutaway is paused',visual.evaluate('''frozen=>{
   const {renderer:v,engine:m,inspecting}=__engineLab;
   return inspecting&&m.time===frozen&&v.camera.z===v.zoom&&document.querySelector('.machine').classList.contains('inspecting');
  }''',frozen_time))
  visual.locator('#inspect-pause').click()
  belt=visual.evaluate('''()=>{
   const lab=__engineLab,m=lab.engine,v=lab.renderer,oldPhase=m.phase,wrap=Math.PI*4;
   v.drivePhase=wrap-.04;v.beltTravel=3;
   m.phase=.03;v.update(1/60,m);const moved=v.beltTravel;
   m.phase=oldPhase;lab.reset();return moved;
  }''')
  ok('belt remains continuous across the crank phase wrap',abs(belt-4.33)<1e-8)
  smoke_crop=visual.evaluate('''()=>{
   const lab=__engineLab,m=lab.engine,v=lab.renderer,c=v.c;
   const draw=c.drawImage,regions=[];
   c.drawImage=function(image,...args){
    if(image===v.smokeLayer)regions.push(args.slice(0,4));
    return draw.call(this,image,...args);
   };
   try{
    v.reduced=true;v.setGeneral();v.smoke=[];
    v.drawSmoke(false);const empty=regions.length===0;
    const puff={x:1120,y:345,r:22,rot:0,tex:0,age:.5,life:2,alpha:.4,front:false};
    v.smoke=[puff];v.drawSmoke(false);
    const region=regions[0],localized=region[2]<80&&region[3]<80&&region[0]>500;
    v.setPart('pump');v.drawSmoke(false);
    const offscreen=regions.length===1;
    const count=v.cacheMisses;
    v.background(m);v.setPart('exhaust');v.background(m);
    v.smoke=[{...puff,x:1220}];v.drawSmoke(false);
    return {empty,localized,offscreen,reused:v.cacheMisses===count,region,pastWorld:regions.length===2};
   }finally{c.drawImage=draw;v.reduced=false;lab.reset();}
  }''')
  ok('smoke skips empty and offscreen work and composites its local footprint',
     all(smoke_crop[k] for k in ('empty','localized','offscreen')))
  ok('the fixed background is reused across lens changes',smoke_crop['reused'])
  ok('exhaust zoom composites smoke past the wide shot boundary',smoke_crop['pastWorld'])
  report['smoke_region']=smoke_crop['region']
  pinion=visual.evaluate('''()=>{
   const lab=__engineLab,v=lab.renderer,m=lab.engine;
   m.requestStart();lab.advance(.12,0,true);const engaged=v.pinionTravel;
   lab.advance(4,0,true);const running=m.ignition==='running',withdrawn=v.pinionTravel===0;
   const camSlots=[...v.cache.keys()].filter(k=>k.startsWith('valve-spring')).length;
   lab.reset();return {engaged,running,withdrawn,camSlots};
  }''')
  ok('the starter gear engages then withdraws while the shaft keeps turning',
     pinion['engaged']>.8 and pinion['running'] and pinion['withdrawn'])
  ok('all valves share two spring sprites',pinion['camSlots']==2)
  visual.evaluate('__engineLab.engine.setProfile("normal");__engineLab.engine.requestStart();__engineLab.advance(4,0,true)')
  visual.locator('[data-part=pump]').click()
  def flows(temperature):
   return visual.evaluate('''temperature=>{
    const {engine:m,renderer:v}=__engineLab, pipes=[],original=v.pipe;
    m.coolant=temperature;__engineLab.advance(.25,.4,true);
    v.pipe=function(path,cell,color,width,flow=cell.flow,phase=cell.phase){
     if(color==='#669ba4'||color==='#63878c')pipes.push({color,flow,phase});
     return original.call(this,path,cell,color,width,flow,phase);
    };
    try{v.render(m);}finally{v.pipe=original;}
    return pipes;
   }''',temperature)
  cold=flows(70);settle(visual);visual.locator('.machine').screenshot(path=OUT/'pump-bypass.png')
  hot=flows(98);visual.locator('.machine').screenshot(path=OUT/'pump-radiator.png')
  ok('cold coolant markers follow the bypass and leave the radiator still',
     len(cold)==3 and all(p['flow']==0 for p in cold[:2]) and cold[2]['flow']>0)
  ok('hot coolant markers follow the radiator and close the bypass',
     len(hot)==3 and all(p['flow']>0 for p in hot[:2]) and hot[2]['flow']==0 and hot[2]['phase']==cold[2]['phase'])
  report['exhaust_emission']=visual.evaluate('''()=>{
   const {engine:m,renderer:v}=__engineLab, original=v.puff;
   function count(pulse,leak,ignition='running',overrun=false){
    const hits={tailpipe:0,'exhaust-leak':0};
    v.puff=function(x,y,kind,power){
     if(Object.hasOwn(hits,kind))hits[kind]++;
     return original.call(this,x,y,kind,power);
    };
    v.smoke.length=0;v.exhaustAcc=v.leakAcc=0;
    m.exhaust.pulse=pulse;m.exhaust.leak=leak;m.ignition=ignition;m.overrun=overrun;
    try{for(let i=0;i<60;i++)v.update(1/60,m);}finally{v.puff=original;}
    return hits;
   }
   return {weak:count(.15,0),strong:count(.85,0),split:count(.85,.5),
    off:count(.85,.5,'off'),overrun:count(.85,.5,'running',true)};
  }''')
  e=report['exhaust_emission']
  ok('strong pulses emit more from the tailpipe and a damaged joint diverts part of the plume',
     e['strong']['tailpipe']>e['weak']['tailpipe'] and e['strong']['exhaust-leak']==0
     and 0<e['split']['tailpipe']<e['strong']['tailpipe'] and e['split']['exhaust-leak']>0)
  ok('key-off and overrun stop new outlet emissions',all(v==0 for k in ('off','overrun') for v in e[k].values()))
  hot_fluids=visual.evaluate('''()=>{
   const lab=__engineLab;
   lab.reset();
   const {engine:m,renderer:v}=lab;
   function run(wet,hot,mode){
    v.reset();v.setPerformance(mode);v.reduced=mode==='eco';
    const hits={'oil-mist':0,'coolant-steam':0},puff=v.puff;
    v.puff=function(x,y,kind,power){
     const before=v.smoke.length;
     puff.call(this,x,y,kind,power);
     if(v.smoke.length>before&&Object.hasOwn(hits,kind))hits[kind]++;
    };
    Object.assign(m,{ignition:'running',overrun:false,rpm:3700,oil:wet?3:0,coolantLevel:wet?.62:0,
     coolant:hot?117:90,film:wet?.23:0,oilRunoff:wet?.019:0,coolantRunoff:wet?.03:0,steam:.8,oilSmoke:.55,headerTemp:hot?355:120});
    Object.assign(m.exhaust,{pulse:.85,leak:.5,oil:.45,steam:.50,carbon:.12});
    try{for(let i=0;i<180;i++)v.update(1/60,m);}finally{v.puff=puff;}
    return {hits,plume:v.smoke.length,stains:[...new Set(v.stains.map(p=>p.fluid))].sort()};
   }
   const result={hot:run(true,true,'auto'),cold:run(true,false,'auto'),dry:run(false,true,'auto'),eco:run(true,true,'eco')};
   v.setPerformance('auto');v.reduced=false;
   return result;
  }''')
  ok('local steam and oil mist require hot fluid and leave distinct floor stains',
     all(n>0 for n in hot_fluids['hot']['hits'].values()) and hot_fluids['hot']['stains']==['coolant','oil']
     and all(n==0 for variant in ('cold','dry') for n in hot_fluids[variant]['hits'].values()))
  ok('eco reduced-motion mode keeps the combined hot plumes bounded',
     0<hot_fluids['eco']['plume']<=75 and hot_fluids['eco']['plume']<hot_fluids['hot']['plume']<=260)
  report['hot_fluids']=hot_fluids
  filtration=visual.evaluate('''()=>{
   const lab=__engineLab,h=1/120;
   lab.reset();lab.engine.setProfile('normal');lab.engine.requestStart();lab.advance(4,0);
   lab.engine.rpm=3000;
   const starting=lab.engine.snapshot();
   const sample=dust=>{
    lab.restore(starting);const m=lab.engine,f=m.oilCircuit;
    m.fragments.dust=dust;
    for(let i=0;i<960;i++){m.step(h,.6,.45);m.drainEvents();}
    lab.advance(0);
    return {load:f.filterLoad,drop:f.filterDeltaP,filtered:f.filterFlow,bypass:f.filterBypassFlow,
     fines:f.oilFines,pressure:m.pressure,version:m.snapshot().version};
   };
   return {clean:sample(0),fouled:sample(1)};
  }''')
  report['filtration']=filtration
  clean,fouled=filtration['clean'],filtration['fouled']
  ok('circulated fines clog the filter and the resulting pressure drop opens its bypass',
     clean['bypass']==0 and fouled['load']>.25 and fouled['drop']>clean['drop'] and fouled['bypass']>0
     and 0<fouled['filtered']<clean['filtered'] and fouled['fines']>0 and fouled['version']==7)
  visual.locator('[data-part=filter]').click();settle(visual)
  ok('the filter inspection identifies the dirty media and open bypass',
     all(text in visual.locator('#inspection-note').text_content() for text in ('перепускной клапан','загрязнён')))
  visual.locator('.machine').screenshot(path=OUT/'filter-clog.png')
  combustion=visual.evaluate('''()=>{
   const lab=__engineLab;lab.reset();const {engine:m,renderer:v}=lab;
   m.requestStart();lab.advance(4,0);v.reduced=false;
   const plume=temperature=>{
    const e=m.exhaust;e.tail=temperature;e.oil=e.steam=e.carbon=0;
    m.step(1/120,0);v.smoke.length=0;
    for(let i=0;i<12;i++)v.puff(1155,359,'tailpipe');
    return {condensation:e.condensation,alpha:v.smoke[0]?.alpha,white:v.smoke.filter(p=>p.tex>=6&&p.tex<9).length};
   };
   const dry=lab.engine.fragments,impact=(surface,kind)=>{
    dry.cooldown=0;dry.events.length=0;dry.oilSurface=surface;
    const p=dry.add(0,kind,'case',500,524);p.vx=-450;p.vy=650;
    dry.contact(p,1,0,.1);return dry.events[0]?.spark??-1;
   };
   const cold=plume(26),warm=plume(112),sparks=[impact(548,'bearing'),impact(510,'bearing'),impact(548,'skirt')];
   for(const strength of sparks)v.event({type:'impact',x:500,y:524,nx:1,ny:0,level:.9,spark:strength},m);
   const lit=v.metalSparks.length;
   for(let i=0;i<15;i++)v.update(1/60,m);
   return {cold,warm,sparks,lit,after:v.metalSparks.length};
  }''')
  report['combustion_atmosphere']=combustion
  ok('cold tailpipe condensate is visible and hot clean exhaust is almost invisible',
     combustion['cold']['condensation']>.2 and combustion['cold']['white']>6 and combustion['warm']['condensation']==0
     and combustion['warm']['alpha']<combustion['cold']['alpha']*.3)
  ok('only the dry hard metal impact generates short local sparks',
     combustion['sparks'][0]>.07 and combustion['sparks'][1:]==[0,0] and 0<combustion['lit']<=16 and combustion['after']==0)
  contact=visual.evaluate('''()=>{
   const lab=__engineLab;
   lab.reset();
   const {engine:m,renderer:v}=lab,h=1/120;
   m.setProfile('stress');m.requestStart();
   for(let i=0;i<240;i++)m.step(h,0,0);
   let ring;
   for(let i=0;i<3600&&!ring;i++){
    m.step(h,1,0);
    ring=m.fragments.bodies.find(p=>p.cylinder===1&&p.kind==='ring'&&p.zone==='chamber'&&p.jammed);
   }
   if(!ring)return null;
   window.contactReplay={ring,start:m.time};
   const drawLine=v.line;
   let marks=0;
   v.line=function(path,color,width){
    if(width===1.6&&typeof color==='string'&&color.startsWith('rgba(222,187,138,'))marks++;
    return drawLine.call(this,path,color,width);
   };
   try{
    for(let i=0;i<720&&!marks;i++){
     m.step(h,1,.5);m.drainEvents();
     if(ring.rubbing>.05)v.render(m);
    }
   }finally{v.line=drawLine;}
   lab.advance(0);
   return {cylinder:ring.cylinder+1,kind:ring.kind,jammed:ring.jammed,rubbing:ring.rubbing,marks,
    skew:ring.skew,edge:ring.jamEdge,play:m.cylinders[1].contact.play,crack:m.cylinders[1].contact.crack,
    skirt:m.cylinders[1].contact.skirt};
  }''')
  ok('the wedged ring draws loaded contact marks in cylinder two',
     contact and contact['cylinder']==2 and contact['kind']=='ring' and contact['jammed'] and contact['marks']>0)
  ok('the ring catch has an actual supporting edge and measurable skew',
     contact['edge']=='liner' and abs(contact['skew'])>.03)
  visual.locator('#cyl1').click();settle(visual)
  ok('selecting cylinder two centers the camera on the actual jam at three times magnification',visual.evaluate('''()=>{
   const {renderer:v}=__engineLab,{ring}=contactReplay,p=v.world(ring.x,ring.y);
   return v.jamFocus===ring&&v.camera.z===3&&Math.hypot(v.camera.x-p.x,v.camera.y-p.y)<1e-6;
  }'''))
  ok('cylinder inspection names the specific trapped ring',visual.locator('#inspection-note').text_content().startswith('Цилиндр 2: кольцо зажато'))
  settle(visual);visual.locator('.machine').screenshot(path=OUT/'ring-contact.png')
  slipping=visual.evaluate('''()=>{
   const lab=__engineLab,m=lab.engine,{ring,start}=contactReplay;
   for(let i=0;i<7200&&!ring.releaseCount&&ring.jamSlip<.25;i++){m.step(1/120,1,.5);m.drainEvents();}
   lab.advance(0);
   return {jammed:ring.jammed,radius:ring.r,initialRadius:ring.jamRadius,slip:ring.jamSlip,
    elapsed:m.time-start,scuff:m.fragments.linerScuffs.find(mark=>mark.cylinder===1&&mark.side===1)};
  }''')
  ok('ring slips while still wedged and wears a local physical track',
     slipping['jammed'] and slipping['slip']>=.25 and slipping['radius']<slipping['initialRadius']
     and slipping['scuff']['depth']>0)
  visual.locator('.machine').screenshot(path=OUT/'ring-slip.png')
  released=visual.evaluate('''()=>{
   const lab=__engineLab,m=lab.engine,{ring,start}=contactReplay;
   let releaseShift=null;
   for(let i=0;i<7200&&!ring.releaseCount;i++){
    const {x,y}=ring;m.step(1/120,1,.5);m.drainEvents();
    if(ring.releaseCount)releaseShift=Math.hypot(ring.x-x,ring.y-y);
   }
   lab.advance(0);
   const spall=m.fragments.edgeChips.find(chip=>chip.edge==='liner'&&chip.cylinder===1&&chip.damage===1);
   const saved=Piston.Engine.restore(m.snapshot());
   const persisted=spall&&saved.fragments.edgeChips.some(chip=>chip.x===spall.x&&chip.y===spall.y&&chip.damage===1);
   return {released:ring.releaseCount,jammed:ring.jammed,elapsed:m.time-start,rpm:m.rpm,radius:ring.r,releaseShift,
    play:m.cylinders[1].contact.play,crack:m.cylinders[1].contact.crack,skirt:m.cylinders[1].contact.skirt,
    spall,edgeShard:m.fragments.bodies.some(p=>p.kind==='edge'&&p.cylinder===1),persisted,
    scuff:m.fragments.linerScuffs.find(mark=>mark.cylinder===1&&mark.side===1)};
  }''')
  ok('the same ring releases with full gas and half brake',released['released']==1 and not released['jammed'])
  ok('the second-cylinder ring keeps its position as the clamp releases',released['releaseShift']<2)
  ok('the local liner track remains after ring release',released['scuff']['depth']>=slipping['scuff']['depth'])
  ok('the loaded cylinder gains persistent clearance and crack growth while the ring is trapped',
     released['play']>contact['play'] and released['crack']>contact['crack'])
  ok('the same wedge chips its liner edge, releases a physics shard and wears the neighboring skirt',
     released.get('spall') and released['edgeShard'] and released['persisted'] and released['skirt']>contact['skirt'])
  ok('the same cylinder no longer reports that ring as trapped after release','зажато' not in visual.locator('#inspection-note').text_content())
  visual.wait_for_function('!__engineLab.renderer.cameraMove&&!__engineLab.renderer.jamFocus&&__engineLab.renderer.camera.z===1.8')
  ok('the camera returns to the cylinder view when the focused piece releases',visual.evaluate('__engineLab.renderer.focus===1'))
  report['ring_replay']={'contact':contact,'slipping':slipping,'release':released}
  visual.locator('.machine').screenshot(path=OUT/'ring-release.png')
  cap=visual.evaluate('''()=>{
   const lab=__engineLab;lab.reset();const m=lab.engine,h=1/120;
   m.setProfile('stress');m.requestStart();
   // Opening the throttle at this crank phase sends a loose fragment into a bearing cap.
   for(let i=0;i<366;i++)m.step(h,0,0);
   let shard;
   for(let i=0;i<14400&&!shard;i++){
    m.step(h,1,0);
    shard=m.fragments.bodies.find(p=>p.zone==='case'&&p.jammed&&p.jamEdge==='cap');
   }
   if(!shard)return null;
   lab.advance(0);window.capReplay=shard;
   const {edgeX:x,edgeY:y}=shard;
   const onFace=(center,half,top,bottom)=>y>=top&&y<=bottom&&Math.abs(x-center)<=half
    &&(y===top||y===bottom||Math.abs(x-center)===half);
   return {time:m.time,x,y,atCap:[307,445,589,733,871].some(center=>onFace(center,14,449,454)||onFace(center,10,442,478)),
    pickupCaptured:m.oilCircuit.pickupCaptured,pickupClog:m.oilCircuit.pickupClog};
  }''')
  report['cap_catch']=cap
  ok('a real stress-run fragment catches on the mapped bearing cap edge',cap and cap['atCap'])
  visual.locator('[data-part=sump]').click();settle(visual)
  ok('crankcase inspection still centers on a real supported jam',visual.evaluate('''()=>{
   const v=__engineLab.renderer,p=v.jamFocus,anchor=p&&v.world(p.x,p.y);
   return !!(v.partFocus==='sump'&&p?.jammed&&p.jamEdge&&v.camera.z===3
    &&Math.hypot(v.camera.x-anchor.x,v.camera.y-anchor.y)<1e-6);
  }'''))
  visual.evaluate('__engineLab.renderer.lookAtJam(capReplay);__engineLab.advance(0)');settle(visual)
  visual.locator('.machine').screenshot(path=OUT/'bearing-cap-catch.png')
  grind=visual.evaluate('''()=>{
   const m=new Piston.Engine(),f=m.fragments,h=1/120,rod=f.add(3,'rod','case',330,469);
   m.ignition='running';m.rpm=3000;m.shaftSpeed=14;rod.vx=rod.vy=0;
   const wet=new Set();
   let release,maxRadiusStep=0,restored=false;
   for(let n=0;n<800;n++){
    const {x,y,r,jammed}=rod;
    m.phase=(m.phase+14*h)%(4*Math.PI);
    f.step(h,m);
    if(jammed)maxRadiusStep=Math.max(maxRadiusStep,r-rod.r);
    if(jammed&&!rod.jammed&&!release)release={shift:Math.hypot(rod.x-x,rod.y-y),beforeRadius:r,radius:rod.r};
    for(const chip of f.bodies)if(chip.kind==='metal'&&chip.y-chip.r>f.oilSurfaceAt(chip.x)){
     wet.add(chip.id);
     if(rod.jammed&&!window.grindReplay){
      window.grindReplay=m.snapshot();
      const copy=Piston.Engine.restore(grindReplay).fragments;
      const savedRod=copy.bodies.find(p=>p.id===rod.id),savedChip=copy.bodies.find(p=>p.id===chip.id);
      restored=savedRod?.jammed&&savedRod.r===rod.r&&savedRod.jamGrit===rod.jamGrit&&savedChip?.y===chip.y;
     }
    }
   }
   return {release,maxRadiusStep,wet:wet.size,restored};
  }''')
  report['loaded_wedge_grinding']=grind
  ok('crankcase wedging grinds over several frames and releases without resizing or relocation',
     0<grind['maxRadiusStep']<.12 and grind['release']['beforeRadius']==grind['release']['radius']
     and grind['release']['radius']<8 and grind['release']['shift']<2.5)
  ok('pieces worn off the jam enter the oil and keep their identity through reload',
     grind['wet']>=2 and grind['restored'])
  visual.evaluate('__engineLab.restore(grindReplay)')
  visual.locator('[data-part=sump]').click();settle(visual)
  ok('the grinding wedge can be inspected at three times zoom in the 2D view',
     visual.evaluate('__engineLab.renderer.mode==="section"&&__engineLab.renderer.jamFocus?.jammed&&__engineLab.renderer.camera.z===3'))
  visual.locator('.machine').screenshot(path=OUT/'wedge-grinding-oil.png')
  pickup=visual.evaluate('''()=>{
   const lab=__engineLab,h=1/120;
   lab.reset();lab.engine.setProfile('normal');lab.engine.requestStart();lab.advance(4,0);
   lab.engine.cylinders[1].contact.bearing=.075;
   const starting=lab.engine.snapshot();
   const run=debris=>{
    lab.restore(starting);const {engine:m,renderer:v}=lab,f=m.oilCircuit;
    if(debris)for(let i=0;i<15;i++){
     const shard=m.fragments.add(i%4,i<10?'ring':'edge','case',381+i*12,542);
     shard.vx=shard.vy=0;
    }
    let first=null,knock=null;
    for(let i=0;i<60*120;i++){
     m.step(h,.85,.36);
     if(first===null&&f.pickupCaptured>0)first=f.pickupClog;
     for(const e of m.drainEvents())if(e.type==='bearingKnock'&&e.cylinder===1&&(!knock||e.level>knock.level))knock=e;
    }
    if(knock)v.event(knock,m);
    return {first,captured:f.pickupCaptured,clog:f.pickupClog,pressure:m.pressure,flow:f.q,
     temp:m.cylinders[1].contact.bearingTemp,wear:m.cylinders[1].contact.bearing,rpm:m.rpm,
     peak:knock?.level??0,kick:Math.abs(v.spring.vy),saved:Piston.Engine.restore(m.snapshot()).oilCircuit.pickupCaptured};
   };
   const clean=run(false),clogged=run(true);
   for(let i=0;i<12*120;i++){lab.engine.step(h,.15,.65);lab.engine.drainEvents();}
   lab.advance(0);return {clean,clogged,lamp:document.querySelector('#lamp-oil').classList.contains('on')};
  }''')
  report['pickup_starvation']=pickup
  clean,clogged=pickup['clean'],pickup['clogged']
  ok('chips progressively foul the screen and the capture state survives restore',
     0<clogged['first']<clogged['clog']<=1 and clogged['captured']>=2 and clogged['saved']==clogged['captured'] and clean['captured']==0)
  ok('pickup restriction cuts flow and pressure and worsens bearing heat, wear and knock under load',
     abs(clogged['rpm']-clean['rpm'])<250 and clogged['flow']<clean['flow']*.5 and clogged['pressure']<clean['pressure']*.5
     and clogged['temp']>clean['temp']+15 and clogged['wear']>clean['wear'] and clogged['peak']>clean['peak'] and clogged['kick']>0)
  ok('the real dashboard oil warning lights when gallery pressure falls further',pickup['lamp'])
  visual.locator('[data-part=sump]').click();settle(visual)
  ok('the sump inspection identifies screen obstruction',
     'засорена сетка маслоприёмника' in visual.locator('#inspection-note').text_content())
  visual.locator('.machine').screenshot(path=OUT/'pickup-clog.png')
  pan=visual.evaluate('''()=>{
   const lab=__engineLab,h=1/120;
   lab.reset();lab.engine.setProfile('normal');lab.engine.requestStart();lab.advance(4,0);
   lab.engine.oil=2.55;lab.advance(2,0);
   const initial=lab.engine.snapshot();
   const run=(force,recordOnly=false)=>{
    lab.restore(initial);const {engine:m,renderer:v}=lab,f=m.oilCircuit;
    for(let i=0;i<120;i++)f.pan.step(h,force,.36);
    const geometry=[f.surfaceAt(367),f.surfaceAt(848)],volume=f.total,depth=Array.from(f.pan.depths);
    v.render(m);const pure=depth.every((d,i)=>d===f.pan.depths[i]);
    let min=Infinity,air=0;
    for(let i=0;i<720;i++){
     m.step(h,0);m.drainEvents();min=Math.min(min,m.pressure);air=Math.max(air,f.inletAir);
     if(recordOnly&&i===22){lab.advance(0);break;}
    }
    return {geometry,volume,pure,min,air,end:m.pressure,endAir:f.inletAir,oil:m.oil,account:f.total};
   };
   const level=run(0),wave=run(300);run(300,true);
   return {level,wave};
  }''')
  report['oil_pan_motion']=pan
  level,wave=pan['level'],pan['wave']
  ok('a conserved oil wave exposes the pickup and lowers pressure until the sump settles',
     abs(level['volume']-wave['volume'])<1e-8 and abs(wave['oil']-wave['account'])<1e-8 and wave['pure']
     and wave['geometry'][0]-wave['geometry'][1]>4 and wave['air']>.6 and wave['min']<level['min']*.68
     and abs(wave['end']-level['end'])<.04 and wave['endAir']<.04)
  visual.locator('[data-part=sump]').click();settle(visual)
  visual.locator('.machine').screenshot(path=OUT/'oil-pan-wave.png')
  spray=visual.evaluate('''()=>{
   const lab=__engineLab,h=1/120;
   lab.reset();lab.engine.setProfile('normal');lab.engine.requestStart();lab.advance(4,0);
   lab.engine.oil=2.75;lab.engine.rpm=3500;lab.advance(2,.66,false,.45);
   const initial=lab.engine.snapshot(),inlet=Piston.OIL_PICKUP.x+6;
   const sample=stir=>{
    lab.restore(initial);const {engine:m,renderer:v}=lab,f=m.oilCircuit;
    let air=0,film=0,count=0,ledger=0;
    const surfaces=new Set(),kinds=new Set();
    for(let i=0;i<2400;i++){
     if(stir&&i%5===0)f.pan.aerate(inlet,.00025,1210);
     m.step(h,.66,.45);m.drainEvents();
     ledger=Math.max(ledger,Math.abs(m.oil-f.total));
     air=Math.max(air,f.pumpAeration);film=Math.max(film,f.spray.volume);count=Math.max(count,f.spray.drops.length);
     for(const d of f.spray.drops)kinds.add(d.kind);
     for(const d of f.spray.films)surfaces.add(d.surface);
    }
    lab.advance(0);
    const state=JSON.stringify(m.snapshot());v.render(m);
    const saved=Piston.Engine.restore(m.snapshot()).oilCircuit;
    return {air,film,count,ledger,surfaces:[...surfaces],kinds:[...kinds],pressure:m.pressure,oil:m.oil,
     wear:m.cylinders[1].contact.bearing,temp:m.cylinders[1].contact.bearingTemp,
     covered:f.pickupSubmerged,exposed:f.inletAir,pure:state===JSON.stringify(m.snapshot()),
     saved:saved.pumpAeration===f.pumpAeration&&Math.abs(saved.spray.volume-f.spray.volume)<1e-9};
   };
   const ordinary=sample(false),foamed=sample(true),parked=Piston.Engine.restore(lab.engine.snapshot());
   parked.requestStop();
   for(let i=0;i<60*120&&(parked.rpm||parked.oilCircuit.spray.volume);i++)parked.step(h,0);
   const stopped={volume:parked.oilCircuit.spray.volume,rpm:parked.rpm};
   return {ordinary,foamed,stopped};
  }''')
  report['crank_oil_spray']=spray
  ordinary,foamed=spray['ordinary'],spray['foamed']
  ok('rotating parts throw, wet and return oil without changing the oil inventory in render',
     0<ordinary['count']<=48 and ordinary['film']>.0005 and ordinary['ledger']<1e-8
     and set(ordinary['surfaces'])=={'rod','skirt','case'} and set(ordinary['kinds'])=={0,1}
     and ordinary['pure'] and ordinary['saved'] and spray['stopped']['rpm']==0 and spray['stopped']['volume']<1e-8)
  ok('aerated oil under the same load lowers pressure and increases heat and wear at a covered pickup',
     abs(ordinary['oil']-foamed['oil'])<1e-7 and foamed['covered']>.95 and foamed['exposed']<.02
     and foamed['air']>ordinary['air']+.05 and foamed['pressure']<ordinary['pressure']*.87
     and foamed['wear']>ordinary['wear']+.003 and foamed['temp']>ordinary['temp'] and foamed['saved'])
  visual.locator('[data-part=sump]').click();settle(visual)
  visual.locator('[data-view=oil]').click()
  ok('the live crankcase inspection identifies bubbles reaching the pump',
     'пузырьками' in visual.locator('#inspection-note').text_content())
  visual.locator('.machine').screenshot(path=OUT/'crank-spray.png')
  visual.locator('[data-view=section]').click()
  crankcase=browser.new_page(viewport={'width':1440,'height':1000});load(crankcase)
  runoff_replay=crankcase.evaluate('''()=>{
   const lab=__engineLab;lab.reset();const {engine:m,renderer:v}=lab,h=1/120,s=m.oilCircuit.spray;
   m.requestStart();lab.advance(6,0);
   const airborne=()=>s.drops.filter(p=>p.kind===0).length;
   let idle=0,gas=0;
   for(let i=0;i<480;i++){m.step(h,0);idle+=airborne();}
   for(let i=0;i<960;i++){m.step(h,.72);if(i>=480)gas+=airborne();}
   v.reduced=false;
   for(let i=0;i<240&&airborne()<6;i++)m.step(h,.72);
   lab.advance(0);const frame=v.canvas.toDataURL();v.drawCrankSpray=()=>{};v.render(m);
   const visible=frame!==v.canvas.toDataURL();delete v.drawCrankSpray;v.render(m);
   return {idle:idle/480,gas:gas/480,visible,repeat:frame===v.canvas.toDataURL()};
  }''')
  ok('opening the throttle produces a denser visible crank spray in the ordinary cutaway',
     runoff_replay['gas']>runoff_replay['idle']*2 and runoff_replay['visible'] and runoff_replay['repeat'])
  crankcase.locator('#engine').screenshot(path=OUT/'crank-under-throttle.png')
  drain=crankcase.evaluate('''()=>{
   const {engine:m,renderer:v}=__engineLab,h=1/120,s=m.oilCircuit.spray;
   m.requestStop();for(let i=0;i<3600&&m.rpm;i++)m.step(h,0);
   const track=s.films.filter(f=>f.surface==='case').sort((a,b)=>a.y-b.y)[0];
   if(!track)return {};
   const y=track.y;for(let i=0;i<240;i++)m.step(h,0);
   __engineLab.advance(0);const frame=v.canvas.toDataURL(),films=s.films;
   s.films=films.filter(f=>f.surface!=='case');v.render(m);const visible=frame!==v.canvas.toDataURL();
   s.films=films;v.render(m);
   return {rpm:m.rpm,travel:track.y-y,attached:films.includes(track),visible,
    repeat:frame===v.canvas.toDataURL(),fresh:s.drops.some(p=>p.kind===0)};
  }''')
  ok('two seconds after the shaft stops a visible wall bead is still draining without fresh spray',
     drain.get('rpm')==0 and drain['travel']>0 and drain['attached'] and drain['visible'] and drain['repeat'] and not drain['fresh'])
  report['crank_spray_and_runoff']={'throttle':runoff_replay,'stopped':drain}
  crankcase.locator('#engine').screenshot(path=OUT/'crank-after-stop.png');crankcase.close()
  thermal=visual.evaluate('''()=>{
   const lab=__engineLab,h=1/120;
   lab.reset();const hot=lab.engine;
   hot.setProfile('normal');hot.requestStart();lab.advance(4,0);
   const control=Piston.Engine.restore(hot.snapshot());
   hot.oilCircuit.pickupClog=.88;
   const cv=control.cylinders[1],cy=hot.cylinders[1],d=cy.contact;
   let seized=null,scar=null,count=0,weakHits=0,goodHits=0;
   for(let i=0;i<90*120;i++){
    control.step(h,1,.33);hot.step(h,1,.33);control.drainEvents();
    if(i>600){count++;weakHits+=hot.oilCircuit.pistonJets[1].hitFlow;goodHits+=control.oilCircuit.pistonJets[1].hitFlow;}
    for(const e of hot.drainEvents())if(e.cylinder===1&&e.type==='pistonSeize')seized=e;
    scar=hot.fragments.linerScuffs.find(s=>s.cylinder===1&&s.kind==='skirt');
    if(seized&&d.thermalSeized&&scar?.depth>.04)break;
   }
   window.weakJetReplay=hot.snapshot();window.strongJetReplay=control.snapshot();
   const restored=Piston.Engine.restore(weakJetReplay);
   lab.advance(0);
   return {weak:{pressure:hot.pressure,hit:weakHits/count,crown:d.crownTemp,skirt:d.skirtTemp,gap:d.clearance,
     seized:d.thermalSeized,wear:scar?.depth??0,volume:hot.oil,pure:Math.abs(hot.oil-hot.oilCircuit.total)<1e-8,
     drag:hot.skirtBoundaryNm,saved:restored.cylinders[1].contact.thermalSeized,
     event:seized?.type??null},
    strong:{pressure:control.pressure,hit:goodHits/count,crown:cv.contact.crownTemp,gap:cv.contact.clearance,
     seized:cv.contact.thermalSeized,volume:control.oil}};
  }''')
  report['thermal_seizure']=thermal
  good,weak=thermal['strong'],thermal['weak']
  ok('low pressure weakens a still-flowing cooling jet until the hotter piston closes its liner clearance',
     good['pressure']>weak['pressure'] and 0<weak['hit']<good['hit']*.45 and weak['crown']>good['crown']+12
     and weak['gap']<0<good['gap'] and weak['seized'] and not good['seized'] and weak['pure']
     and weak['drag']>0 and weak['event']=='pistonSeize' and weak['wear']>.04 and weak['saved'])
  visual.locator('#cyl1').click();settle(visual)
  ok('cylinder selection follows the actual thermal contact at three times zoom',visual.evaluate('''()=>{
   const {engine:m,renderer:v}=__engineLab,p=m.skirtContactPoint(m.cylinders[1]),q=v.world(p.x,p.y);
   return v.thermalFocus&&!v.jamFocus&&v.camera.z===3&&Math.hypot(v.camera.x-q.x,v.camera.y-q.y)<1e-6;
  }'''))
  ok('inspection, fault lamp and journal identify a thermal seizure',
     'тепловой прихват' in visual.locator('#inspection-note').text_content()
     and visual.locator('#lamp-engine').evaluate("node=>node.classList.contains('on')")
     and 'прихват' in visual.locator('#journal').text_content().lower())
  visual.locator('.machine').screenshot(path=OUT/'skirt-seized.png')
  cooling=visual.evaluate('''()=>{
   const lab=__engineLab,m=lab.engine,d=m.cylinders[1].contact,h=1/120;
   const start=m.time;m.requestStop();const stillSeized=d.thermalSeized;
   for(let i=0;i<50*120&&d.thermalSeized;i++)m.step(h,0);
   const scar=m.fragments.linerScuffs.find(s=>s.cylinder===1&&s.kind==='skirt');
   const loaded=Piston.Engine.restore(m.snapshot());
   lab.advance(0);
   return {stillSeized,released:!d.thermalSeized,elapsed:m.time-start,skirt:d.skirtTemp,gap:d.clearance,wear:scar?.depth??0,
    journal:loaded.log.some(e=>e.type==='pistonFree'&&e.cylinder===1),
    scarSaved:loaded.fragments.linerScuffs.some(s=>s.cylinder===1&&s.kind==='skirt'&&s.depth===scar?.depth)};
  }''')
  report['thermal_cooling']=cooling
  ok('cooling releases the skirt gradually and keeps the same physical liner damage after reload',
     cooling['stillSeized'] and cooling['released'] and cooling['elapsed']>1 and cooling['skirt']<weak['skirt']
     and cooling['gap']>.01 and cooling['wear']>=weak['wear'] and cooling['journal'] and cooling['scarSaved'])
  visual.wait_for_function('!__engineLab.renderer.cameraMove&&!__engineLab.renderer.thermalFocus&&__engineLab.renderer.camera.z===1.8')
  ok('thermal contact zoom returns to the selected cylinder once it cools',visual.evaluate('__engineLab.renderer.focus===1'))
  visual.locator('.machine').screenshot(path=OUT/'skirt-cooled.png')
  visual.evaluate('''()=>{
   const lab=__engineLab,h=1/120;lab.restore(strongJetReplay);
   for(let i=0;i<240;i++){
    lab.engine.step(h,1,.33);
    if(lab.engine.oilCircuit.pistonJets[1].hit&&lab.engine.oilCircuit.pistonJets[1].flow>.2)break;
   }
   lab.advance(0);
  }''')
  visual.locator('[data-view=oil]').click()
  visual.locator('#cyl1').click();settle(visual)
  visual.locator('.machine').screenshot(path=OUT/'piston-oil-jet.png')
  visual.locator('[data-view=section]').click()
  nozzle=visual.evaluate('''()=>{
   const lab=__engineLab,h=1/120;
   lab.reset();const dirty=lab.engine;
   dirty.setProfile('normal');dirty.requestStart();lab.advance(4,0);
   const clean=Piston.Engine.restore(dirty.snapshot()),events=[];
   dirty.fragments.dust=clean.fragments.dust=.06;
   dirty.oilCircuit.filterLoad=.55;
   let scar,bypass=0;
   for(let i=0;i<150*120;i++){
    dirty.step(h,1,.33);clean.step(h,1,.33);clean.drainEvents();
    events.push(...dirty.drainEvents().filter(e=>e.type==='jetClog'||e.type==='pistonSeize'));
    bypass=Math.max(bypass,dirty.oilCircuit.bypass);
    scar=dirty.fragments.linerScuffs.find(s=>s.cylinder===0&&s.kind==='skirt');
    if(dirty.cylinders[0].contact.thermalSeized&&scar?.depth>.025)break;
   }
   const loaded=Piston.Engine.restore(dirty.snapshot()),jets=dirty.oilCircuit.pistonJets;
   lab.advance(0);
   return {events,bypass,pressure:dirty.pressure,clogs:jets.map(j=>j.clog),flows:jets.map(j=>j.flow),
    crowns:dirty.cylinders.map(c=>c.contact.crownTemp),seized:dirty.cylinders.map(c=>c.contact.thermalSeized),
    cleanClog:clean.oilCircuit.pistonJets[0].clog,cleanSeized:clean.cylinders.some(c=>c.contact.thermalSeized),
    wear:scar?.depth??0,volumeError:Math.abs(dirty.oil-dirty.oilCircuit.total),
    journal:loaded.log.filter(e=>e.type==='jetClog').map(e=>e.cylinder),
    saved:loaded.oilCircuit.pistonJets.every((j,i)=>j.clog===jets[i].clog),
    oilWarning:document.querySelector('#lamp-oil').classList.contains('on')};
  }''')
  report['local_nozzle_blockage']=nozzle
  ok('filtered oil keeps the control jets open while bypass deposits restrict one jet at normal gallery pressure',
     nozzle['bypass']>.4 and nozzle['pressure']>3 and not nozzle['oilWarning']
     and nozzle['clogs'][0]>=.55 and nozzle['clogs'][3]<.28 and nozzle['cleanClog']<.25
     and 0<nozzle['flows'][0]<nozzle['flows'][3]*.65 and nozzle['volumeError']<1e-8)
  ok('local loss of cooling seizes only the affected cylinder, with liner wear and a saved warning',
     nozzle['crowns'][0]>nozzle['crowns'][3]+7 and nozzle['seized']==[True,False,False,False] and not nozzle['cleanSeized']
     and nozzle['wear']>.025 and nozzle['saved'] and nozzle['journal']==[0]
     and [(e['type'],e['cylinder']) for e in nozzle['events']]==[('jetClog',0),('pistonSeize',0)])
  visual.locator('#cyl0').click();settle(visual)
  ok('the clogged nozzle is named in cylinder inspection while thermal contact gets the same threefold zoom',
     'засорена масляная форсунка' in visual.locator('#inspection-note').text_content()
     and 'масляная форсунка засорилась' in visual.locator('#journal').text_content()
     and visual.evaluate('__engineLab.renderer.thermalFocus&&__engineLab.renderer.focus===0&&__engineLab.renderer.camera.z===3'))
  visual.locator('.machine').screenshot(path=OUT/'nozzle-local-seizure.png')
  skirt=visual.evaluate('''()=>{
   const lab=__engineLab,h=1/120,id=1;
   lab.reset();const m=lab.engine;
   m.setProfile('normal');m.requestStart();lab.advance(4,0);
   const d=m.cylinders[id].contact,oil=m.oilCircuit;
   oil.pistonJets[id].clog=1;
   const history=[],captures=[],tracked=new Map();
   let cycles=0,crackReplay=null,oilReplay=null,ringOil=0;
   function run(seconds,gas,brake,stop){
    for(let i=0;i<seconds*120;i++){
     const before=oil.pickupCaptured;
     m.step(h,gas,brake);
     ringOil=Math.max(ringOil,m.exhaust.ringOil);
     for(const e of m.drainEvents()){
      if(e.cylinder!==id||!['pistonSeize','pistonFree','skirtCrack','skirtChip'].includes(e.type))continue;
      history.push({type:e.type,time:e.time,fatigue:d.skirtFatigue,chips:d.skirtChips});
      if(e.type==='skirtChip')tracked.set(e.fragmentId,{});
     }
     if(!crackReplay&&d.thermalSeized&&d.skirtFatigue>=.50&&d.skirtChips===0)crackReplay=m.snapshot();
     if(oil.pickupCaptured>before){
      for(const [key,p] of tracked)if(!m.fragments.bodies.some(q=>q.id===key)){
       captures.push({id:key,x:p.x,y:p.y,submerged:p.submerged,clog:oil.pickupClog,time:m.time});
       tracked.delete(key);
      }
     }
     for(const p of m.fragments.bodies){
      const mark=tracked.get(p.id);
      if(!mark||p.kind!=='skirt'||p.zone!=='case'||p.cylinder!==id)continue;
      mark.x=p.x;mark.y=p.y;
      if(p.y+p.r>oil.surfaceAt(p.x)){mark.submerged=true;oilReplay??=m.snapshot();}
     }
     if(stop?.())return true;
    }
    return false;
   }
   while(cycles<6&&captures.length<2){
    if(cycles>=3)m.toggleBenchFault('piston','heat',id);
    const seized=run(90,1,.33,()=>d.thermalSeized);
    run(4,1,.33);
    if(cycles>=3)m.toggleBenchFault('piston','heat',id);
    if(!seized)break;
    if(!run(35,0,0,()=>!d.thermalSeized))break;
    cycles++;
   }
   window.skirtCrackReplay=crackReplay;
   window.skirtOilReplay=oilReplay;
   const reload=Piston.Engine.restore(m.snapshot()),stored=reload.cylinders[id].contact;
   lab.advance(0);
   return {history,captures,cycles,fatigue:d.skirtFatigue,chips:d.skirtChips,
    clog:oil.pickupClog,live:m.activeCount,hasCrack:!!crackReplay,hasImmersedChip:!!oilReplay,ringOil,
    saved:stored.skirtFatigue===d.skirtFatigue&&stored.skirtChips===d.skirtChips&&
     stored.skirtSide===d.skirtSide&&reload.oilCircuit.pickupClog===oil.pickupClog&&
     reload.oilCircuit.pickupCaptured===oil.pickupCaptured};
  }''')
  report['skirt_fatigue']=skirt
  history=[event['type'] for event in skirt['history']]
  ok('repeated thermal contact first cracks and later chips the same piston skirt',
     skirt['cycles']>=2 and history.count('pistonSeize')>=2 and history.count('pistonFree')>=2
     and 'skirtCrack' in history and 'skirtChip' in history
     and history.index('pistonFree')<history.index('skirtCrack')<history.index('skirtChip')
     and skirt['hasCrack'] and skirt['chips']>=2 and skirt['live']>=1 and skirt['saved'])
  ok('a skirt fragment passes through the oil before obstructing the pickup screen',
     skirt['hasImmersedChip'] and skirt['captures'] and all(c.get('submerged') for c in skirt['captures'])
     and 0<skirt['captures'][0]['clog']<=skirt['clog'])
  ok('repeated thermal seizures produce oil exhaust with the original sump inventory',skirt['ringOil']>.03)
  visual.evaluate('__engineLab.restore(skirtCrackReplay)')
  visual.locator('#cyl1').click();settle(visual)
  ok('the cracked skirt can be inspected at the actual thermal contact at three times zoom',
     'трещина юбки' in visual.locator('#inspection-note').text_content()
     and visual.evaluate('__engineLab.renderer.thermalFocus&&__engineLab.renderer.focus===1&&__engineLab.renderer.camera.z===3'))
  visual.locator('.machine').screenshot(path=OUT/'skirt-fatigue-crack.png')
  visual.evaluate('__engineLab.restore(skirtOilReplay)')
  visual.locator('[data-view=oil]').click()
  visual.locator('[data-part=sump]').click();settle(visual)
  visual.locator('.machine').screenshot(path=OUT/'skirt-chip-in-oil.png')
  visual.locator('[data-view=section]').click()
  wipe=visual.evaluate('''()=>{
   const lab=__engineLab;lab.reset();const m=lab.engine,h=1/120;
   m.setProfile('normal');m.requestStart();lab.advance(4,0);m.oilCircuit.pickupClog=1;
   const d=m.cylinders[1].contact;
   let tear=null,chip=null,partial=0,drag=0;
   for(let i=0;i<60*120&&!tear;i++){
    m.step(h,.78,.32);
    if(d.bearingWipe<1)partial=Math.max(partial,d.bearingWipe);
    drag=Math.max(drag,m.bearingBoundaryNm);
    tear=m.drainEvents().find(e=>e.type==='bearingWipe'&&e.cylinder===1);
    if(tear)chip=m.fragments.bodies.find(p=>p.kind==='bearing'&&p.cylinder===1&&p.r<=3.2);
   }
   lab.advance(0);
   return {tear,chip:chip&&{x:chip.x,y:chip.y,r:chip.r},partial,drag,final:d.bearingWipe,running:m.ignition==='running',
    saved:Piston.Engine.restore(m.snapshot()).log.some(e=>e.type==='bearingWipe'&&e.cylinder===1)};
  }''')
  report['bearing_wipe']=wipe
  ok('the worn bearing rubs the shaft before its lining tears and becomes a saved physical fragment',
     .35<wipe['partial']<1 and wipe['drag']>2 and wipe['final']==1 and wipe['tear'] and wipe['chip'] and wipe['running'] and wipe['saved'])
  visual.locator('[data-part=sump]').click();settle(visual)
  ok('the crankcase inspection identifies the torn bearing lining',
     'вкладыша' in visual.locator('#inspection-note').text_content())
  visual.locator('.machine').screenshot(path=OUT/'bearing-wipe.png')
  spun=visual.evaluate('''()=>{
   const lab=__engineLab,h=1/120,id=1;
   lab.reset();const dirty=lab.engine;
   dirty.setProfile('normal');dirty.requestStart();lab.advance(4,0);
   const clean=Piston.Engine.restore(dirty.snapshot()),c=clean.cylinders[id].contact,d=dirty.cylinders[id].contact;
   for(let i=0;i<9;i++){
    const chip=dirty.fragments.add(i%4,'ring','case',381+i*12,542);
    chip.vx=chip.vy=0;
   }
   const stages=[0],spins=[],oil=dirty.oilCircuit;
   let wipe=null,firstKnock=null,goodKnock=0,badKnock=0,partialWipe=0,gripBeforeSpin=1,gripProgress=false;
   function advance(gas,brake){
    clean.step(h,gas,brake);dirty.step(h,gas,brake);
    for(const e of clean.drainEvents())if(e.cylinder===id&&e.type==='bearingKnock')goodKnock=Math.max(goodKnock,e.level);
    for(const e of dirty.drainEvents()){
     if(e.cylinder!==id)continue;
     if(e.type==='bearingKnock'){firstKnock??=e;badKnock=Math.max(badKnock,e.level);}
     else if(e.type==='bearingWipe')wipe??=e.time;
     else if(e.type==='bearingSpin')spins.push(e.time);
    }
    if(stages.at(-1)!==oil.pickupClog)stages.push(oil.pickupClog);
    if(d.bearingWipe<1)partialWipe=Math.max(partialWipe,d.bearingWipe);
    if(!d.bearingSpun){
     gripBeforeSpin=Math.min(gripBeforeSpin,d.bearingGrip);
     gripProgress ||= d.bearingGrip>0&&d.bearingGrip<.9;
    }
   }
   for(let i=0;i<175*120&&!spins.length;i++)advance(1,.40);
   const loaded=m=>({pressure:m.pressure,flow:m.oilCircuit.cells[4].flow,rpm:m.rpm});
   const before={...loaded(dirty),temp:d.bearingTemp,peak:badKnock},
    control={...loaded(clean),temp:c.bearingTemp,peak:goodKnock,spun:c.bearingSpun};
   const atSpin=dirty.snapshot(),angle=d.bearingSpinAngle;
   window.bearingSpinAtStart=atSpin;
   let angleMoved=false;
   for(let i=0;i<120;i++){
    advance(1,.40);
    angleMoved ||= Math.abs(Math.sin(d.bearingSpinAngle-angle))>1e-4;
   }
   for(let i=0;i<60*120&&d.thermalSeized;i++)advance(0,0);
   window.bearingSpinReplay=dirty.snapshot();
   const saved=Piston.Engine.restore(atSpin),stored=saved.cylinders[id].contact;
   const restored=stored.bearingSpun&&stored.bearingGrip===atSpin.cylinders[id].contact.bearingGrip
    &&stored.bearingSpinAngle===angle&&saved.log.some(e=>e.type==='bearingSpin'&&e.cylinder===id);
   saved.requestStop();
   for(let i=0;i<25*120&&saved.rpm>0;i++)saved.step(h,0,0);
   const stopped=stored.bearingSpinAngle;
   for(let i=0;i<120;i++)saved.step(h,0,0);
   lab.advance(0);
   return {before,control,firstKnock:firstKnock&&{time:firstKnock.time,level:firstKnock.level},
    wipe,partialWipe,gripBeforeSpin,gripProgress,spins,stages,captured:oil.pickupCaptured,
    angleMoved,restored,cooled:saved.rpm===0&&stored.bearingSpun&&stopped===stored.bearingSpinAngle&&stored.bearingTemp<before.temp,
    live:dirty.activeCount,focusReady:!d.thermalSeized};
  }''')
  report['bearing_spin']=spun
  low,good=spun['before'],spun['control']
  ok('debris fouls the pickup in stages and the loaded bearings heat and knock as gallery delivery falls',
     len(spun['stages'])>=4 and spun['stages'][0]==0 and spun['stages'][-1]>.85
     and spun['captured']>=8 and low['pressure']<good['pressure']*.45 and low['flow']<good['flow']*.5
     and abs(low['rpm']-good['rpm'])<500 and low['temp']>good['temp']+30
     and spun['firstKnock'] and low['peak']>max(good['peak']+.15,spun['firstKnock']['level']*2))
  ok('the loaded shell wears, loses its grip and spins once, with angle and damage saved through cooling',
     not good['spun'] and len(spun['spins'])==1 and spun['firstKnock']['time']<spun['wipe']<spun['spins'][0]
     and .3<spun['partialWipe']<1 and spun['gripProgress'] and spun['angleMoved']
     and spun['restored'] and spun['cooled'] and spun['live']>=1 and spun['focusReady'])
  visual.evaluate('__engineLab.restore(bearingSpinReplay)')
  visual.locator('#cyl1').click();settle(visual)
  ok('the direct cutaway zoom centers threefold on the actual spun big-end bearing',visual.evaluate('''()=>{
   const v=__engineLab.renderer,p=v.bearingPoint(1),w=p&&v.world(p.x,p.y);
   return v.mode==='section'&&v.bearingFocus&&v.focus===1&&v.camera.z===3&&w
    &&Math.hypot(v.camera.x-w.x,v.camera.y-w.y)<1e-6;
  }''') and 'провернуло шатунный вкладыш' in visual.locator('#inspection-note').text_content())
  visual.locator('.machine').screenshot(path=OUT/'bearing-spun.png')
  journal=visual.evaluate('''()=>{
   const h=1/120,id=1,loaded=Piston.Engine.restore(bearingSpinAtStart),
    idle=Piston.Engine.restore(bearingSpinAtStart);
   const c=loaded.cylinders[id],d=c.contact;
   const stage=engine=>{
    const contact=engine.cylinders[id].contact;
    return {time:engine.time,score:contact.journalScoring,clearance:contact.bearingClearance,fatigue:contact.rodFatigue};
   };
   const start=stage(loaded),firstBodyId=loaded.fragments.nextId;
   let scored=null,nearBreak=null,breakEvent=null;
   for(let i=0;i<120*120&&c.active;i++){
    loaded.step(h,1,.40);idle.step(h,0,0);idle.drainEvents();
    for(const e of loaded.drainEvents())if(e.cylinder===id&&e.type==='cylinder')breakEvent=e;
    if(!scored&&d.journalScoring>start.score+.08&&d.bearingClearance>start.clearance+.008&&c.active)
     scored=stage(loaded);
    if(d.rodFatigue>.90&&d.rodFatigue<1&&c.active&&
     (!nearBreak||d.rodFatigue>nearBreak.cylinders[id].contact.rodFatigue))nearBreak=loaded.snapshot();
   }
   const final=stage(loaded),replay=loaded.snapshot();
   window.journalBreakReplay=replay;
   const restored=Piston.Engine.restore(replay),saved=stage(restored);
   const breakPoint=Piston.pistonGeometry(c.freeze,id,517);
   const shard=loaded.fragments.bodies.find(p=>p.id>=firstBodyId&&p.kind==='rod'&&p.cylinder===id&&
    Math.hypot(p.x-breakPoint.crankX,p.y-breakPoint.crankY)<28);
   let survivor=null;
   if(nearBreak){
    for(const [i,cy] of nearBreak.cylinders.entries())if(i!==id){
     cy.active=false;cy.failure='rod';cy.compression=0;
    }
    const last=Piston.Engine.restore(nearBreak),phase=last.phase,fired=last.cylinders[id].fired;
    const from=stage(last);
    let minAlive=last.activeCount,failures=0;
    for(let i=0;i<60*120;i++){
     last.step(h,1,.09);
     minAlive=Math.min(minAlive,last.activeCount);
     failures+=last.drainEvents().filter(e=>e.type==='cylinder'&&e.cylinder===id).length;
    }
    survivor={from,to:stage(last),minAlive,live:last.activeCount,rpm:last.rpm,
     active:last.cylinders[id].active,moved:last.phase!==phase,failures,
     running:last.ignition==='running',fired:last.cylinders[id].fired-fired};
   }
   return {start,scored,final,idle:stage(idle),idleHealthy:idle.cylinders[id].active,live:loaded.activeCount,
    broken:!c.active&&c.failure==='rod',breakEvent,shard:!!shard,survivor,
    saved:restored.cylinders[id].failure==='rod'&&saved.score===final.score
     &&saved.clearance===final.clearance&&saved.fatigue===final.fatigue
     &&restored.log.some(e=>e.type==='cylinder'&&e.cylinder===id&&e.message===breakEvent?.message)};
  }''')
  report['journal_rod_failure']=journal
  initial,scored,failed=journal['start'],journal['scored'],journal['final']
  ok('a spun bearing scores its crankpin and enlarges clearance progressively while loaded',
     scored and initial['time']<scored['time']<failed['time']
     and initial['score']<scored['score']<=failed['score']
     and initial['clearance']<scored['clearance']<=failed['clearance']
     and journal['idleHealthy'] and journal['idle']['fatigue']<failed['fatigue'])
  ok('progressive big-end damage breaks the loaded rod and leaves a real fragment and saved damage',
     journal['broken'] and journal['breakEvent'] and journal['shard'] and journal['saved']
     and 'после проворота вкладыша' in journal['breakEvent']['message']
     and failed['fatigue']==1 and 1<=journal['live']<4)
  survivor=journal['survivor']
  ok('a damaged last cylinder survives further load with the crankshaft still turning',
     survivor and survivor['minAlive']==survivor['live']==1 and survivor['active'] and survivor['moved']
     and survivor['running'] and survivor['fired']>0 and not survivor['failures'] and survivor['rpm']>=380
     and survivor['to']['fatigue']==1 and .90<survivor['from']['fatigue']<1)
  visual.evaluate('__engineLab.restore(journalBreakReplay)')
  visual.locator('#cyl1').click();settle(visual)
  ok('the broken rod crankpin is shown in the direct cutaway at the actual threefold focus',visual.evaluate('''()=>{
   const {engine,renderer:v}=__engineLab;
   const {crankX,crankY}=Piston.pistonGeometry(engine.phase,1,517);
   const w=v.world(crankX,crankY);
   return v.mode==='section'&&v.bearingFocus&&v.focus===1&&v.camera.z===3
    &&Math.hypot(v.camera.x-w.x,v.camera.y-w.y)<1e-6;
  }''') and 'обрыв шатуна' in visual.locator('#inspection-note').text_content().lower())
  visual.locator('.machine').screenshot(path=OUT/'scored-crankpin-broken-rod.png')
  breach=visual.evaluate('''()=>{
   const lab=__engineLab,h=1/120;
   lab.reset();const m=lab.engine;
   m.setProfile('stress');m.requestStart();lab.advance(3,0);
   let hit;
   for(let i=0;i<60*120&&!hit;i++){
    m.step(h,1,0);
    hit=m.drainEvents().find(e=>e.type==='caseBreach');
   }
   if(!hit)return null;
   const saved=m.snapshot(),matched=Piston.Engine.restore(saved),parked=Piston.Engine.restore(saved);
   const hole=m.fragments.caseBreach,startOil=m.oil,startPressure=m.pressure;
   const rod=m.cylinders[hit.cylinder].failure==='rod'&&m.fragments.bodies.some(p=>p.kind==='rod'&&p.cylinder===hit.cylinder);
   matched.fragments.caseBreach=null;
   parked.requestStop();
   let smokeBeforeFire=false,ignition=null;
   for(let i=0;i<20*120;i++){
    m.step(h,1,0);matched.step(h,1,0);parked.step(h,0,0);
    if(m.exhaustSpill.smoke>.35&&!m.exhaustSpill.burning&&!ignition)smokeBeforeFire=true;
    if(!ignition&&m.drainEvents().some(e=>e.type==='spillFire')){
     ignition=m.time;window.spillFireReplay=m.snapshot();
    }
   }
   const after={oil:m.oil,pressure:m.pressure,matchOil:matched.oil,matchPressure:matched.pressure};
   for(let i=0;i<60*120;i++)m.step(h,1,0);
   const dry={oil:m.oil,pressure:m.pressure,rate:m.caseLeakRate,live:m.activeCount,rpm:m.rpm};
   lab.advance(0);
   dry.warning=document.querySelector('#lamp-oil').classList.contains('on');
   lab.restore(saved);lab.advance(.45,0,true);
   return {hit,hole,rod,startOil,startPressure,after,dry,parked:{oil:parked.oil,rpm:parked.rpm,rate:parked.caseLeakRate},
    saved:parked.fragments.caseBreach.x===hole.x&&parked.log.some(e=>e.type==='caseBreach'),
    ignition,smokeBeforeFire,flameOut:!m.exhaustSpill.burning&&m.exhaustSpill.smoke<.001,
    massError:Math.abs(m.oil-m.oilCircuit.total),stream:lab.engine.caseLeakRate,oilDrops:lab.renderer.drops.filter(p=>p.fluid==='oil').length};
  }''')
  report['case_breach']=breach
  ok('a rod fragment actually punches the sump and the falling oil level starves the gallery',
     breach and breach['rod'] and breach['hit']['x']==breach['hole']['x']
     and breach['after']['oil']<breach['after']['matchOil']-1
     and breach['after']['pressure']<min(breach['startPressure'],breach['after']['matchPressure'])*.4
     and breach['massError']<1e-8)
  ok('the saved puncture drains after key-off while the running engine keeps its final cylinder even when dry',
     breach['saved'] and breach['parked']['rpm']==0 and breach['parked']['rate']>0
     and breach['parked']['oil']<breach['startOil']-1 and breach['dry']['oil']==0
     and breach['dry']['pressure']<.02 and breach['dry']['warning'] and breach['dry']['live']==1 and breach['dry']['rpm']>0)
  visual.locator('[data-part=sump]').click();settle(visual)
  ok('the punctured sump centers on a trapped fragment if one is present, otherwise on the puncture',
     visual.evaluate('''()=>{
      const {engine:m,renderer:v}=__engineLab, jam=m.fragments.bodies.find(p=>p.zone==='case'&&p.jammed);
      return v.camera.z===3&&(jam?v.jamFocus===jam:!v.jamFocus&&!!v.breachView());
     }'''))
  if visual.evaluate('!!__engineLab.renderer.jamFocus'):
   visual.locator('[data-part=sump]').click();settle(visual)
  ok('sump inspection shows the live leak at the impact site in the flat cutaway',
     'вытекает масло' in visual.locator('#inspection-note').text_content() and breach['stream']>.025 and breach['oilDrops']>0
     and visual.evaluate('''()=>{
      const v=__engineLab.renderer,point=v.breachView();
      return v.mode==='section'&&!v.jamFocus&&point&&v.camera.z===3&&Math.hypot(point.x-v.camera.x,point.y-v.camera.y)<1e-6;
     }'''))
  visual.locator('.machine').screenshot(path=OUT/'sump-breach-oil-leak.png')
  ok('the oil film smokes before igniting on the hot pipe and burns out as the oil runs out',
     breach['smokeBeforeFire'] and breach['ignition']>breach['hit']['time']+1 and breach['flameOut'])
  visual.evaluate('__engineLab.restore(spillFireReplay);__engineLab.advance(1.1,1,true)')
  visual.locator('[data-part=sump]').click();settle(visual)
  if visual.evaluate('!!__engineLab.renderer.jamFocus'):
   visual.locator('[data-part=sump]').click();settle(visual)
  ok('the reloaded surface flame and rising smoke are localized below the breach in the flat view',
     'масло горит на выпуске' in visual.locator('#inspection-note').text_content()
     and visual.evaluate('''()=>{
      const {engine:m,renderer:v}=__engineLab,h=m.fragments.caseBreach,w=v.world(h.x,574);
      return m.exhaustSpill.burning&&v.mode==='section'&&v.camera.z===3&&v.smoke.some(p=>p.front&&p.tex>=9
       &&Math.abs(p.x-w.x)<25&&p.y<w.y&&p.y>w.y-100);
     }'''))
  visual.locator('.machine').screenshot(path=OUT/'oil-burning-on-exhaust.png')
  hose=visual.evaluate('''()=>{
   const h=1/120,hot=Piston.Engine.restore(spillFireReplay),sealed=Piston.Engine.restore(spillFireReplay);
   sealed.advanceCoolantHose=()=>{};
   let charred=false,events=[],shot=null;
   for(let i=0;i<34*120;i++){
    hot.step(h,1,0);sealed.step(h,1,0);
    const hose=hot.coolantHose;
    charred ||= hose.damage>.15&&hose.damage<Piston.HOSE_RUPTURE&&hose.runoff===0;
    events.push(...hot.drainEvents().filter(e=>e.type==='coolantHose'));
    if(!shot&&hose.runoff>.10&&hot.exhaustSpill.burning)shot=hot.snapshot();
   }
   window.hoseLeakReplay=shot;
   const loaded=Piston.Engine.restore(shot);
   return {charred,events,wet:hot.coolantLevel*6,control:sealed.coolantLevel*6,block:hot.block,
    controlBlock:sealed.block,damage:hot.coolantHose.damage,saved:loaded.coolantHose.damage===shot?.coolantHose.damage
     &&loaded.log.some(e=>e.type==='coolantHose'),alive:hot.activeCount,rpm:hot.rpm,
    massError:Math.abs(hot.coolantLevel*6-hot.waterCircuit.total)};
  }''')
  report['coolant_hose_fire']=hose
  ok('a nearby flame chars a hose before rupturing it and the coolant loss raises block temperature',
     hose['charred'] and len(hose['events'])==1 and hose['events'][0]['time']>breach['ignition']+2
     and hose['wet']<hose['control']-3 and hose['block']>hose['controlBlock']+12
     and hose['saved'] and hose['massError']<1e-8 and hose['alive']==1 and hose['rpm']>0)
  visual.evaluate('__engineLab.restore(hoseLeakReplay);__engineLab.advance(.75,1,true)')
  visual.locator('[data-part=sump]').click();settle(visual)
  if visual.evaluate('!!__engineLab.renderer.jamFocus'):
   visual.locator('[data-part=sump]').click();settle(visual)
  ok('the damaged hose visibly jets coolant beside the oil flame in the 2D cutaway',
     'из прожжённого шланга течёт антифриз' in visual.locator('#inspection-note').text_content()
     and visual.evaluate('''()=>{
      const {engine:m,renderer:v}=__engineLab,p=v.world(m.fragments.caseBreach.x,Piston.COOLANT_HOSE.y);
      return m.coolantHose.runoff>.1&&v.mode==='section'&&v.camera.z===3
       &&v.drops.some(d=>d.fluid==='coolant'&&d.x>p.x&&d.x<p.x+48&&d.y>p.y&&d.y<p.y+40);
     }'''))
  visual.locator('.machine').screenshot(path=OUT/'burnt-coolant-hose.png')
  gasket=visual.evaluate('''()=>{
   const hot=Piston.Engine.restore(hoseLeakReplay),sealed=Piston.Engine.restore(hoseLeakReplay),h=1/120;
   sealed.advanceHeadGaskets=()=>{};
   let warped=false,wetIntake=false,steamPeak=0,wetShot=null,steamShot=null,opening=null,peak=0,controlPeak=0;
   for(let i=0;i<46*120;i++){
    hot.step(h,1);sealed.step(h,1);
    const b=hot.cylinders.find(c=>c.active),d=b.contact,a=sealed.cylinders[b.id];
    for(const e of hot.drainEvents())if(e.type==='headSeal')opening??=e;
    warped ||= d.headWarp>.016&&d.headSeal===0;
    wetIntake ||= d.boreCoolantFlow>0&&b.cycle.intake>.01;
    steamPeak=Math.max(steamPeak,hot.exhaust.coolantSteam);
    if(d.headSeal>.58&&i<38*120){
     if(b.cycle.stroke===3)peak=Math.max(peak,b.chamberBar);
     if(a.cycle.stroke===3)controlPeak=Math.max(controlPeak,a.chamberBar);
    }
    if(!wetShot&&d.boreCoolant>.0015&&d.boreCoolantFlow>.003&&d.headSeal>.30)wetShot=hot.snapshot();
    if(!steamShot&&hot.exhaust.coolantSteam>.26&&d.headSeal>.4)steamShot=hot.snapshot();
   }
   window.headGasketWetReplay=wetShot;window.headGasketSteamReplay=steamShot;
   const saved=Piston.Engine.restore(wetShot),d=saved.cylinders[opening?.cylinder??0].contact;
   return {warped,wetIntake,steamPeak,opening,peak,controlPeak,wetShot:!!wetShot,steamShot:!!steamShot,
    fluidError:Math.abs(hot.waterCircuit.total-hot.coolantLevel*6),live:hot.activeCount,rpm:hot.rpm,
    saved:!!wetShot&&d.boreCoolant>0&&d.headWarp>.055&&d.headSeal>.3&&saved.log.some(e=>e.type==='headSeal')};
  }''')
  report['head_gasket_leak']=gasket
  ok('uneven heat warps the deck before the gasket opens and coolant enters on intake',
     gasket['warped'] and gasket['opening'] and gasket['wetIntake'] and gasket['saved']
     and gasket['wetShot'] and gasket['steamShot'] and gasket['fluidError']<1e-8)
  ok('the local leak lowers real compression pressure while the last cylinder keeps turning',
     0<gasket['peak']<gasket['controlPeak']*.82 and gasket['steamPeak']>.28 and gasket['live']==1 and gasket['rpm']>0)
  visual.evaluate('__engineLab.restore(headGasketWetReplay)')
  visual.locator('#cyl'+str(gasket['opening']['cylinder'])).click();settle(visual)
  ok('the flat cutaway identifies the damaged seal and coolant in the selected cylinder',
     'пробита прокладка ГБЦ' in visual.locator('#inspection-note').text_content()
     and 'антифриз в цилиндре' in visual.locator('#inspection-note').text_content()
     and visual.evaluate('__engineLab.renderer.mode==="section"'))
  visual.locator('.machine').screenshot(path=OUT/'coolant-in-cylinder.png')
  visual.evaluate('__engineLab.restore(headGasketSteamReplay);__engineLab.advance(2,1,true)')
  visual.locator('[data-part=exhaust]').click();settle(visual)
  ok('the existing exhaust outlet emits the white coolant vapor plume',
     visual.evaluate('''()=>__engineLab.renderer.smoke.some(p=>p.x>1150&&p.jet&&!p.front&&p.tex>=6&&p.tex<=8)'''))
  visual.locator('.machine').screenshot(path=OUT/'white-exhaust-vapor.png')
  hydraulic=visual.evaluate('''()=>{
   const h=1/120,source=new Piston.Engine();
   source.setProfile('stress');source.requestStart();
   for(let i=0;i<360;i++)source.step(h,0);
   for(let i=0;i<68*120;i++){source.step(h,1);source.drainEvents();}
   const m=Piston.Engine.restore(source.snapshot()),cy=m.cylinders.find(c=>c.active),d=cy.contact;
   for(let i=0;i<150;i++)m.step(h,1);
   m.requestStop();
   for(let i=0;i<5*120&&m.rpm>0;i++)m.step(h,0);
   if(m.rpm===0){m.phase=(cy.offset+2.45*Math.PI)%(4*Math.PI);m.refreshCycle();}
   for(let i=0;i<35*120;i++)m.step(h,0);
   const pooled={litres:d.boreCoolant,plug:d.plugWet,clearance:Piston.CHAMBER_CLEARANCE_L,rpm:m.rpm};
   window.hydraulicPoolReplay=m.snapshot();
   m.drainEvents();m.requestStart();
   const missed=d.wetMisses,tries=cy.fired;
   let hits=0,stroke=null,shot=null;
   for(let i=0;i<14*120;i++){
    m.step(h,0);
    for(const e of m.drainEvents())if(e.type==='hydrolock'){
     hits++;stroke=cy.cycle.stroke;shot=m.snapshot();
    }
   }
   window.hydraulicBentReplay=m.snapshot();
   const loaded=Piston.Engine.restore(shot);
   return {id:cy.id,pooled,hits,stroke,bend:d.rodBend,misses:d.wetMisses-missed,fired:cy.fired-tries,
    active:m.activeCount,rpm:m.rpm,running:m.ignition==='running',
    saved:loaded.cylinders[cy.id].contact.rodBend===d.rodBend&&loaded.log.some(e=>e.type==='hydrolock')};
  }''')
  report['coolant_hydrolock']=hydraulic
  ok('coolant accumulates above the compression clearance while parked and wets the spark plug',
     hydraulic['pooled']['rpm']==0 and hydraulic['pooled']['litres']>hydraulic['pooled']['clearance']
     and hydraulic['pooled']['plug']>.9)
  ok('restarting causes a real compression hit, persistent rod bend and wet misfires while the last cylinder survives',
     hydraulic['hits']==1 and hydraulic['stroke'] in (0,3) and hydraulic['bend']>.25 and hydraulic['misses']>0
     and hydraulic['saved'] and hydraulic['fired']>0 and hydraulic['active']==1 and hydraulic['running'] and hydraulic['rpm']>0)
  visual.evaluate('__engineLab.restore(hydraulicPoolReplay)')
  visual.locator('#cyl'+str(hydraulic['id'])).click();settle(visual)
  ok('the flat inspection identifies the wet spark plug and pooled coolant',
     'свеча залита' in visual.locator('#inspection-note').text_content()
     and 'антифриз в цилиндре' in visual.locator('#inspection-note').text_content()
     and visual.evaluate('__engineLab.renderer.mode==="section"'))
  visual.locator('.machine').screenshot(path=OUT/'flooded-cylinder.png')
  visual.evaluate('''()=>{
   const lab=__engineLab;lab.restore(hydraulicBentReplay);
   lab.renderer.lookAt({x:373,y:411,z:2.45});lab.advance(0);
  }''');settle(visual)
  visual.locator('.machine').screenshot(path=OUT/'hydrolock-bent-rod.png')
  skew=visual.evaluate('''()=>{
   const h=1/120,id=hydraulicBentReplay.cylinders.find(c=>c.active).id;
   const bent=Piston.Engine.restore(hydraulicBentReplay),straight=Piston.Engine.restore(hydraulicBentReplay);
   const cy=bent.cylinders[id],d=cy.contact;
   straight.cylinders[id].contact.rodBend=0;
   const initial=d.skewScuff;
   let jam=null,drag=0,reference=0;
   for(let i=0;i<35*120&&!jam;i++){
    bent.step(h,1,.09);straight.step(h,1,.09);
    jam=bent.drainEvents().find(e=>e.type==='skewSeize');straight.drainEvents();
    drag=Math.max(drag,bent.skirtBoundaryNm);reference=Math.max(reference,straight.skirtBoundaryNm);
   }
   window.skewJamReplay=bent.snapshot();
   const restored=Piston.Engine.restore(skewJamReplay),scar=bent.fragments.linerScuffs.find(s=>s.kind==='skew'&&s.cylinder===id);
   const during={time:bent.time,score:d.skewScuff,bind:d.skewBind,live:bent.activeCount,rpm:bent.rpm,depth:scar?.depth};
   let released;
   for(let i=0;i<8*120;i++){
    bent.step(h,0);released??=bent.drainEvents().find(e=>e.type==='skewFree');
   }
   return {id,initial,jam,during,drag,reference,tilt:bent.pistonSkewAngle(cy),released,
    alive:bent.activeCount,rpm:bent.rpm,depth:scar?.depth,latched:d.skewSeized,
    saved:restored.cylinders[id].contact.skewSeized&&restored.log.some(e=>e.type==='skewSeize')};
  }''')
  report['bent_rod_skirt_bind']=skew
  ok('the bent rod tilts the moving piston and increases drag and one-sided scuffing until the skirt binds',
     skew['jam'] and skew['during']['score']>skew['initial']+.10 and skew['drag']>skew['reference']+2
     and abs(skew['tilt'])>.001 and skew['during']['depth']>.22 and skew['saved']
     and skew['during']['live']==1 and skew['during']['rpm']>0)
  ok('reducing the load frees the skewed skirt while saving the wear and the last cylinder',
     skew['released'] and not skew['latched'] and skew['depth']>=skew['during']['depth'] and skew['alive']==1 and skew['rpm']>0)
  visual.evaluate('__engineLab.restore(skewJamReplay)')
  visual.locator('#cyl'+str(skew['id'])).click();settle(visual)
  if visual.evaluate('!!__engineLab.renderer.jamFocus'):
   visual.locator('#cyl'+str(skew['id'])).click();settle(visual)
  ok('the 2D inspection can center at threefold zoom on the actual point of the skewed skirt bind',
     'клин юбки от перекоса' in visual.locator('#inspection-note').text_content()
     and visual.evaluate('''()=>{
      const {engine:m,renderer:v}=__engineLab,p=m.skewContactPoint(m.cylinders[v.focus]),at=v.world(p.x,p.y);
      return v.mode==='section'&&v.thermalFocus&&!v.jamFocus&&v.camera.z===3
       &&Math.hypot(v.camera.x-at.x,v.camera.y-at.y)<1e-6;
     }'''))
  visual.locator('.machine').screenshot(path=OUT/'skewed-piston-liner-bind.png')
  rings=visual.evaluate('''()=>{
   const h=1/120,id=skewJamReplay.cylinders.find(c=>c.active).id,m=Piston.Engine.restore(skewJamReplay);
   const cy=m.cylinders[id],first=cy.contact.ringSeizures,stages=[];
   for(let cycle=0;cycle<2;cycle++){
    for(let i=0;i<3*120;i++){m.step(h,0);m.drainEvents();}
    const before=m.fragments.nextId;
    for(let i=0;i<12*120;i++){
     m.step(h,1,.09);
     const fracture=m.drainEvents().find(e=>e.type==='ringFracture');
     if(!fracture)continue;
     stages.push({stage:fracture.stage,fragment:m.fragments.bodies.some(p=>p.id>=before&&p.kind==='ring'&&p.cylinder===id)});
     break;
    }
   }
   window.ringFractureReplay=m.snapshot();
   window.oilBurnReplay={...m.snapshot(),oil:1.6};
   const intact=Piston.Engine.restore(ringFractureReplay),broken=Piston.Engine.restore(ringFractureReplay),wet=Piston.Engine.restore(oilBurnReplay);
   intact.cylinders[id].contact.ringSeizures=1;
   for(const test of [intact,broken]){test.phase=(cy.offset+3.88*Math.PI)%(4*Math.PI);test.refreshCycle();}
   let blue=0,clear=0,maxOil=0;
   for(let i=0;i<8*120;i++){
    m.step(h,.55);wet.step(h,.55);
    const d=wet.cylinders[id].contact;
    maxOil=Math.max(maxOil,d.boreOil);blue=Math.max(blue,wet.exhaust.ringOil);clear=Math.max(clear,m.exhaust.ringOil);
    if(d.boreOil>.00005&&wet.cylinders[id].cycle.intake>.3&&!window.oilFilmReplay)window.oilFilmReplay=wet.snapshot();
   }
   return {id,first,stages,pressure:broken.cylinders[id].chamberBar,control:intact.cylinders[id].chamberBar,
    blue,clear,maxOil,film:!!window.oilFilmReplay,live:wet.activeCount,rpm:wet.rpm,
    fluidError:Math.abs(wet.oilCircuit.total-wet.oil),saved:broken.log.some(e=>e.type==='ringFracture'&&e.stage===2)};
  }''')
  report['seizure_ring_fracture']=rings
  ok('releasing and reloading a skewed piston fractures its rings in two stages and persists the lower compression',
     rings['first']==1 and rings['stages']==[{'stage':1,'fragment':True},{'stage':2,'fragment':True}]
     and (rings['pressure']-1)<(rings['control']-1)*.67 and rings['saved'] and rings['live']==1 and rings['rpm']>0)
  visual.evaluate('__engineLab.restore(ringFractureReplay)')
  visual.locator('#cyl'+str(rings['id'])).click();settle(visual)
  if visual.evaluate('!!__engineLab.renderer.jamFocus'):
   visual.locator('#cyl'+str(rings['id'])).click();settle(visual)
  ok('fractured rings remain visible in the flat cutaway with the same threefold skirt jam camera',
     'сломаны кольца' in visual.locator('#inspection-note').text_content()
     and visual.evaluate('''()=>{
      const {renderer:v}=__engineLab;return v.mode==='section'&&v.thermalFocus&&v.camera.z===3;
     }'''))
  visual.locator('.machine').screenshot(path=OUT/'broken-piston-rings.png')
  ok('oil enters past the fractured rings only with a liquid supply and feeds the exhaust after burning',
     rings['film'] and rings['maxOil']>.00005 and rings['blue']>.03 and rings['clear']==0 and rings['fluidError']<1e-8)
  visual.evaluate('__engineLab.restore(oilFilmReplay)')
  visual.locator('#cyl'+str(rings['id'])).click();settle(visual)
  ok('cylinder inspection identifies oil held above the damaged piston',
     'масло в камере сгорания' in visual.locator('#inspection-note').text_content())
  visual.evaluate('__engineLab.restore(oilBurnReplay);__engineLab.advance(4,.55,true)')
  visual.locator('[data-part=exhaust]').click();settle(visual)
  plume=visual.evaluate('''()=>{
   const oil=__engineLab.renderer.smoke.filter(p=>p.x>1150&&p.jet&&!p.front&&p.tex>=12&&p.tex<=14);
   return {count:oil.length,wide:oil.filter(p=>p.r>29&&p.alpha>.32).length};
  }''')
  report['oil_plume']=plume
  ok('the tailpipe delivers a visibly thicker blue-gray oil plume',plume['count']>=8 and plume['wide']>=5)
  visual.locator('.machine').screenshot(path=OUT/'blue-gray-oil-exhaust.png')
  carbon=visual.evaluate('''()=>{
   const id=oilBurnReplay.cylinders.find(c=>c.active).id,h=1/120;
   const scenario={...oilBurnReplay,oil:3.8,fragments:{...oilBurnReplay.fragments,caseBreach:null,bodies:[]}};
   const wet=Piston.Engine.restore(scenario),dry=Piston.Engine.restore({...scenario,oil:0});
   const cy=wet.cylinders[id],d=cy.contact;
   wet.setProfile('normal');dry.setProfile('normal');
   let early=0;
   for(let i=0;i<145*120&&d.plugCarbon<.62;i++){
    wet.step(h,.36);dry.step(h,.36);
    if(i===10*120)early=d.plugCarbon;
   }
   window.fouledReplay=wet.snapshot();
   const control=Piston.Engine.restore({...fouledReplay,oil:0}),worn=Piston.Engine.restore({...fouledReplay,oil:0});
   const c=control.cylinders[id],b=worn.cylinders[id];c.contact.plugCarbon=0;
   const energy=worn.sparkEnergy(b),risk=worn.ignitionMissChance(b),referenceRisk=control.ignitionMissChance(c);
   control.rpm=worn.rpm=2200;
   control.step(h,.68);worn.step(h,.68);
   return {id,early,plug:d.plugCarbon,crown:d.crownCarbon,dry:dry.cylinders[id].contact.plugCarbon,
    energy,risk,referenceRisk,torque:worn.shaftDriveNm,reference:control.shaftDriveNm,rpm:wet.rpm,live:wet.activeCount,
    saved:worn.log.some(e=>e.type==='plugFouling')&&b.contact.crownCarbon>=d.crownCarbon&&b.contact.plugCarbon>=d.plugCarbon};
  }''')
  report['spark_plug_fouling']=carbon
  ok('burned oil grows permanent carbon, weakens the spark and lowers shaft torque with one live cylinder',
     0<carbon['early']<carbon['plug'] and carbon['plug']>.45 and carbon['crown']>.26 and carbon['dry']==0
     and carbon['energy']<.72 and carbon['risk']>carbon['referenceRisk'] and carbon['torque']<carbon['reference']
     and carbon['live']==1 and carbon['rpm']>0 and carbon['saved'])
  visual.evaluate('__engineLab.restore(fouledReplay)')
  visual.locator('#failures-open').click()
  row=visual.locator('#failure-list button').filter(has_text='нагар на свече')
  ok('the damage dialog shows the fouled plug and retains the diagnostic history',
     row.count()==1 and 'ослабил искру' in visual.locator('#journal').text_content())
  visual.locator('#failures-dialog').screenshot(path=OUT/'damage-menu.png')
  row.focus();visual.keyboard.press('Enter');visual.wait_for_function('__engineLab.inspecting');settle(visual)
  ok('keyboard inspection from the damage dialog pauses and focuses the damaged cylinder',
     'нагар на днище поршня' in visual.locator('#inspection-note').text_content() and visual.evaluate(f'''()=>{{
       const {{renderer:v}}=__engineLab;return v.mode==='section'&&v.focus==={carbon['id']}&&v.camera.z>1&&document.activeElement.id==='cyl{carbon['id']}';
     }}'''))
  visual.locator('.machine').screenshot(path=OUT/'spark-plug-carbon.png')
  pre=visual.evaluate('''()=>{
   const m=Piston.Engine.restore(fouledReplay),h=1/120,id=m.cylinders.find(c=>c.active).id;
   const cy=m.cylinders[id],d=cy.contact,initial=d.crownCarbon;
   let first=null,crack=null,peak=0,pressure=0,load=0;
   for(let i=0;i<225*120;i++){
    m.step(h,1,.10);peak=Math.max(peak,d.depositTemp);
    for(const e of m.drainEvents()){
     if(e.type==='preIgnition'&&!first)first={time:m.time,phase:cy.cycle.stroke,angle:cy.cycle.angle,fatigue:d.crownFatigue};
     if(e.type==='crownCrack')crack=m.time;
    }
    if(d.preIgnition&&cy.cycle.stroke===3){
     const level=d.preIgnition,bar=cy.chamberBar,torque=cy.gasTorqueNm;
     d.preIgnition=0;m.refreshCycle();
     pressure=Math.max(pressure,bar-cy.chamberBar);load=Math.max(load,cy.gasTorqueNm-torque);
     d.preIgnition=level;m.refreshCycle();
    }
    if(d.crownFatigue>.43&&d.preIgnition&&cy.cycle.stroke===0){window.crownCrackReplay=m.snapshot();break;}
   }
   const restored=Piston.Engine.restore(m.snapshot());
   return {id,initial,first,crack,peak,pressure,load,hits:d.preIgnitionHits,fatigue:d.crownFatigue,live:m.activeCount,rpm:m.rpm,
    remainingOil:m.oil,coolant:d.boreCoolant,replay:!!window.crownCrackReplay,
    saved:restored.cylinders[id].contact.crownFatigue===d.crownFatigue&&restored.log.some(e=>e.type==='crownCrack')};
  }''')
  report['crown_pre_ignition']=pre
  ok('oil deposits heat up until they ignite during compression and exert reverse gas torque before the spark',
     pre['first'] and pre['first']['phase']==3 and 12<pre['first']['angle']<12.57
     and pre['peak']>610 and pre['pressure']>3 and pre['load']>12)
  ok('repeated pressure impacts grow a saved crown crack while the last cylinder stays running',
     pre['crack'] and pre['crack']>pre['first']['time'] and pre['first']['fatigue']<.24 and pre['hits']>5
     and pre['fatigue']>.43 and pre['saved'] and pre['live']==1 and pre['rpm']>0 and pre['replay'])
  visual.evaluate('''()=>{
   const lab=__engineLab;lab.restore(crownCrackReplay);
   const m=lab.engine,v=lab.renderer,cy=m.cylinders.find(c=>c.active),axis=373+144*cy.id;
   for(let i=0;i<720;i++){
    m.step(1/120,1,.10);
    if(cy.contact.preIgnition&&cy.cycle.stroke===3&&m.preIgnitionAge(cy.cycle.angle)>.23)break;
   }
   v.lookAt({x:axis,y:248,z:3});lab.advance(0);
  }''');settle(visual)
  ok('the cutaway draws the early flame at the piston and retains a true 2D inspection lens',
     visual.evaluate('''()=>{
      const {engine:m,renderer:v}=__engineLab,cy=m.cylinders.find(c=>c.active);
      return v.mode==='section'&&v.camera.z===3&&cy.cycle.stroke===3&&cy.contact.preIgnition>0
       &&cy.contact.crownFatigue>Piston.CROWN_CRACK_FATIGUE;
     }'''))
  visual.locator('.machine').screenshot(path=OUT/'hot-carbon-pre-ignition.png')
  visual.locator('#failures-open').click()
  ok('the damage menu names the hot deposits and the distinct crown crack',
     visual.locator('#failure-list button').filter(has_text='трещина в днище поршня').filter(has_text='раскалённый нагар').count()==1)
  visual.locator('#failures-close').click()
  breach=visual.evaluate('''()=>{
   const m=Piston.Engine.restore(crownCrackReplay),h=1/120,cy=m.cylinders.find(c=>c.active),d=cy.contact;
   const initial=d.crownFatigue,firstHits=d.preIgnitionHits;
   let event=null,openingAtBreach=0,maxFlow=0,casePressure=0,leaked=null,sealed=null,zeroBefore=true;
   for(let i=0;i<38*120;i++){
    m.step(h,1,.10);
    for(const e of m.drainEvents())if(e.type==='crownBreach'){event=e;openingAtBreach=Piston.crownOpening(d);}
    if(!event){zeroBefore&&=d.crownGasFlow===0;continue;}
    maxFlow=Math.max(maxFlow,d.crownGasFlow);casePressure=Math.max(casePressure,m.crankcasePressure);
    if(cy.cycle.stroke!==3||cy.cycle.angle<12.34||d.crownGasFlow<4||Piston.crownOpening(d)<.46)continue;
    window.crownBreachReplay=m.snapshot();leaked=cy.chamberBar;
    const fatigue=d.crownFatigue;d.crownFatigue=initial;m.refreshCycle();sealed=cy.chamberBar;
    d.crownFatigue=fatigue;m.refreshCycle();break;
   }
   const reload=Piston.Engine.restore(m.snapshot()),hole=Piston.crownOpening(d);
   return {id:cy.id,initial,firstHits,event,openingAtBreach,hole,hits:d.preIgnitionHits,zeroBefore,maxFlow,casePressure,leaked,sealed,
    live:m.activeCount,rpm:m.rpm,saved:hole>0&&Piston.crownOpening(reload.cylinders[cy.id].contact)===hole&&reload.log.some(e=>e.type==='crownBreach')};
  }''')
  report['crown_through_hole']=breach
  ok('continued pre-ignition opens a persistent through-hole only after the crown crack has grown',
     breach['event'] and breach['zeroBefore'] and breach['saved'] and breach['hits']>breach['firstHits']
     and 0<breach['openingAtBreach']<breach['hole'])
  ok('pressure escapes to the crankcase and reduces pressure at the same crank angle with the last cylinder running',
     breach['maxFlow']>4 and breach['casePressure']>.08 and breach['sealed']-breach['leaked']>2
     and (breach['leaked']-1)<(breach['sealed']-1)*.75 and breach['live']==1 and breach['rpm']>=380)
  visual.evaluate('''()=>{
   const lab=__engineLab;lab.restore(crownBreachReplay);
   const m=lab.engine,v=lab.renderer,cy=m.cylinders.find(c=>c.active),axis=373+144*cy.id;
   for(let i=0;i<720;i++){
    m.step(1/120,1,.10);
    if(cy.cycle.stroke===3&&cy.contact.crownGasFlow>7)break;
   }
   v.focus=cy.id;v.lookAt({x:axis,y:345,z:2.5});lab.advance(0);
  }''');settle(visual)
  ok('the cutaway shows gas through the damaged piston into the crankcase',
     'газы прорываются в картер' in visual.locator('#inspection-note').text_content()
     and visual.evaluate('__engineLab.renderer.mode==="section"&&__engineLab.renderer.camera.z===2.5'))
  visual.locator('.machine').screenshot(path=OUT/'crown-breach-blowby.png')
  visual.locator('#failures-open').click()
  ok('the through-hole is listed as the current piston fault and recorded in the journal',
     visual.locator('#failure-list button').filter(has_text='сквозной пробой днища поршня').count()==1
     and 'сквозной пробой' in visual.locator('#journal').text_content())
  visual.locator('#failures-close').click()
  seals=visual.evaluate('''()=>{
   const m=Piston.Engine.restore(crownBreachReplay),h=1/120,oilBefore=m.oil,pressureBefore=m.pressure;
   const edges=['frontCrankSeal','rearCrankSeal'],events=m.log.filter(e=>edges.includes(e.type)).reverse();
   let maxCase=0,loss=[0,0],maxFlow=[0,0],air=0;
   for(let i=0;i<145*120;i++){
    m.step(h,1,.10);
    events.push(...m.drainEvents().filter(e=>edges.includes(e.type)));
    maxCase=Math.max(maxCase,m.crankcasePressure);air=Math.max(air,m.oilCircuit.inletAir);
    m.crankSeals.forEach((s,id)=>{loss[id]+=s.flow*h;maxFlow[id]=Math.max(maxFlow[id],s.flow);});
    if(!window.crankSealWetReplay&&m.crankSeals.every(s=>s.film>.004))window.crankSealWetReplay=m.snapshot();
    if(window.crankSealWetReplay&&m.oil<1.05&&m.pressure<pressureBefore*.36&&air>.57)break;
   }
   window.lowOilSealReplay=m.snapshot();
   const stored=Piston.Engine.restore(lowOilSealReplay),old=Piston.Engine.restore({...lowOilSealReplay,crankSeals:undefined});
   return {events,oilBefore,pressureBefore,oil:m.oil,pressure:m.pressure,loss,maxFlow,maxCase,air,
    rpm:m.rpm,alive:m.activeCount,account:Math.abs(m.oilCircuit.total-m.oil),wet:!!window.crankSealWetReplay,
    saved:stored.crankSeals.every((s,i)=>s.wear===m.crankSeals[i].wear)&&stored.log.some(e=>e.type==='rearCrankSeal'),
    legacy:old.crankSeals.every(s=>s.wear===0&&s.flow===0)};
  }''')
  report['crankcase_seal_leaks']=seals
  ok('crankcase overpressure lifts both seals and expels a conserved volume of oil',
     [e['type'] for e in seals['events']]==['frontCrankSeal','rearCrankSeal']
     and seals['maxCase']>.15 and min(seals['maxFlow'])>.01 and min(seals['loss'])>.3
     and sum(seals['loss'])>(seals['oilBefore']-seals['oil'])*.88 and seals['account']<1e-8)
  ok('leaking seals starve the pickup and oil gallery while the last cylinder and saved seal damage survive',
     seals['oil']<1.4 and seals['pressure']<seals['pressureBefore']*.4 and seals['air']>.55
     and seals['alive']==1 and seals['rpm']>=380 and seals['wet'] and seals['saved'] and seals['legacy'])
  visual.evaluate('__engineLab.restore(crankSealWetReplay);__engineLab.advance(3,1,true,.10)')
  visual.locator('[data-part=sump]').click();settle(visual)
  ok('crankcase inspection zooms into a leaking seal and both shaft ends emit oil drops in 2D',
     visual.evaluate('''()=>{
      const {renderer:v}=__engineLab;
      return v.mode==='section'&&v.camera.z===2.5&&v.partFocus==='sump'&&!v.jamFocus&&
       [0,1].every(id=>v.drops.some(d=>d.fluid==='oil'&&d.seal===id));
     }''') and 'сальники' in visual.locator('#inspection-note').text_content())
  visual.locator('.machine').screenshot(path=OUT/'crankshaft-seal-oil-leak.png')
  visual.evaluate('__engineLab.restore(lowOilSealReplay)')
  ok('the existing dashboard oil lamp is lit with the seal-driven oil pressure loss',
     visual.locator('#lamp-oil').evaluate("node=>node.classList.contains('on')"))
  mains=visual.evaluate('''()=>{
   const m=Piston.Engine.restore(lowOilSealReplay),h=1/120,id=m.cylinders.find(c=>c.active).id;
   const index=[id,id+1].reduce((a,b)=>m.mainBearings[a].wear>=m.mainBearings[b].wear?a:b);
   const bearing=m.mainBearings[index],before={...bearing};
   let hit=null,maxDrag=0;
   for(let i=0;i<110*120;i++){
    m.step(h,1,.10);maxDrag=Math.max(maxDrag,m.mainBearingDragNm);
    for(const e of m.drainEvents())if(e.type==='mainBearingKnock'&&(!hit||e.level>hit.level))hit=e;
    if(bearing.wear>.44&&bearing.wear>before.wear+.15&&hit?.level>.24)break;
   }
   window.mainBearingReplay=m.snapshot();window.mainBearingHit=hit;
   const loaded=Piston.Engine.restore(mainBearingReplay),idle=Piston.Engine.restore(mainBearingReplay);
   let peak=0,idlePeak=0;
   for(let i=0;i<12*120;i++){
    loaded.step(h,1,.10);idle.step(h,0);
    for(const e of loaded.drainEvents())if(e.type==='mainBearingKnock')peak=Math.max(peak,e.level);
    for(const e of idle.drainEvents())if(e.type==='mainBearingKnock')idlePeak=Math.max(idlePeak,e.level);
   }
   const stored=Piston.Engine.restore(mainBearingReplay),old=Piston.Engine.restore({...mainBearingReplay,mainBearings:undefined});
   return {index,before,after:{...bearing},hit,peak,idlePeak,maxDrag,rpm:loaded.rpm,live:loaded.activeCount,
    saved:stored.mainBearings[index].clearance===bearing.clearance&&stored.log.some(e=>e.type==='mainBearingWear'),
    legacy:old.mainBearings.every(b=>b.wear===0)};
  }''')
  report['main_bearing_starvation']=mains
  ok('after the seal leak, low gallery flow heats the main bearing and increases its saved running clearance',
     mains['after']['temp']>147 and mains['after']['wear']>mains['before']['wear']+.12
     and mains['after']['clearance']>mains['before']['clearance']+.022 and mains['maxDrag']>1
     and mains['saved'] and mains['legacy'])
  ok('loaded crankshaft clearance produces stronger recorded knocks and mount recoil while the final cylinder runs',
     mains['hit'] and mains['hit']['level']>.24 and mains['peak']>mains['idlePeak']+.2
     and mains['live']==1 and mains['rpm']>=380 and visual.evaluate('''()=>{
      const v=__engineLab.renderer,e=mainBearingHit,s=v.spring;
      s.vy=0;v.event(e,__engineLab.engine);
      const audio=new Piston.MotorAudio();audio.ctx={state:'running',currentTime:1};
      audio.lastState={ignition:'running',rpm:480};let clip;
      audio.play=(...args)=>{clip=args;return true;};audio.event(e);
      return Math.abs(s.vy)>9&&clip?.[0]==='impact'&&clip[2]<.71&&clip[3].offset===.167;
     }'''))
  visual.evaluate('__engineLab.restore(mainBearingReplay)')
  for _ in range(4):
   visual.locator('[data-part=sump]').click();settle(visual)
   if visual.evaluate('__engineLab.renderer.camera.z===2.8'):break
  ok('crankcase inspection reaches the worn main bearing in the flat cutaway',
     'люфт коленвала' in visual.locator('#inspection-note').text_content()
     and visual.evaluate('''()=>{
      const v=__engineLab.renderer,p=v.mainBearingView();
      return p&&v.mode==='section'&&v.camera.z===2.8&&!v.jamFocus&&Math.hypot(v.camera.x-p.x,v.camera.y-p.y)<1e-6;
     }'''))
  visual.locator('.machine').screenshot(path=OUT/'worn-main-bearing.png')
  drive=visual.evaluate('''()=>{
   const lab=__engineLab;lab.reset();const m=lab.engine,h=1/120;
   m.setProfile('stress');m.requestStart();
   for(let i=0;i<480;i++)m.step(h,0);
   const healthy=m.timingDrive.tensionerPressure,seen={};m.oil=0;
   for(let i=0;i<14400&&!m.timingDrive.broken;i++){
    m.step(h,1);
    for(const e of m.drainEvents())if(e.type.startsWith('chain')&&!Object.hasOwn(seen,e.type))seen[e.type]=e.time;
   }
   const cam=m.camAngle,phase=m.phase;
   for(let i=0;i<180;i++)m.step(h,1,.45);
   const saved=Piston.Engine.restore(m.snapshot()).timingDrive;
   lab.advance(0);
   return {healthy,seen,gap:m.timingDrive.gap,broken:m.timingDrive.broken,camFrozen:cam===m.camAngle,
    shaftMoving:phase!==m.phase,live:m.activeCount,saved:saved.broken&&saved.teethSkipped>0};
  }''')
  report['timing_drive']=drive
  ok('oil loss makes the chain rattle, jump teeth and break, with a saved failure and moving last piston',
     drive['healthy']>.5 and 0<drive['seen']['chainRattle']<drive['seen']['chainSkip']<drive['seen']['chainBreak']
     and drive['gap']>.5 and drive['broken'] and drive['camFrozen'] and drive['shaftMoving'] and drive['live']==1 and drive['saved'])
  visual.locator('[data-part=timing]').click();settle(visual)
  ok('the chain inspection zoom reports the actual break',
     'обрыв' in visual.locator('#inspection-note').text_content() and visual.evaluate('__engineLab.renderer.partFocus==="timing"'))
  visual.locator('.machine').screenshot(path=OUT/'timing-chain-broken.png')
  jet=visual.evaluate('''()=>{
   const lab=__engineLab;lab.reset();const {engine:m,renderer:v}=lab;
   m.setProfile('normal');m.requestStart();lab.advance(4,0);
   m.coolant=104;m.auxWear.radiator=1;v.reduced=false;
   const liters=m.coolantLevel*6;
   lab.advance(.65,0,true);
   const drops=v.drops.filter(p=>p.fluid==='coolant'&&p.x<149&&p.y>432&&p.vx<0&&p.vy>0);
   return {speed:m.radiatorJetSpeed,drops:drops.length,loss:liters-m.coolantLevel*6,flow:m.radiatorRunoff,
    sameInventory:Math.abs(m.waterCircuit.total-m.coolantLevel*6)<1e-8};
  }''')
  report['coolant_jet']=jet
  ok('coolant escapes the damaged seam under pressure and follows a falling path',
     jet['speed']>2 and jet['drops']>=2 and jet['loss']>0 and jet['flow']>0 and jet['sameInventory'])
  visual.locator('[data-part=radiator]').click();settle(visual)
  visual.locator('.machine').screenshot(path=OUT/'radiator-jet.png')
  runoff=visual.evaluate('''()=>{
   const lab=__engineLab;lab.reset();const {engine:m,renderer:v}=lab;
   m.oil=0;m.film=.08;m.oilTemp=135;
   lab.advance(7,0,true);
   return {rpm:m.rpm,oil:m.oil,film:m.film,drops:v.drops.length,stains:v.stains.filter(p=>p.fluid==='oil').length};
  }''')
  ok('a stopped dry engine leaves a local stain from its remaining surface film',
     runoff['rpm']==0 and runoff['oil']==0 and 0<runoff['film']<.08 and 0<runoff['stains']<=40)
  motion=visual.evaluate('''()=>{
   const lab=__engineLab;lab.reset();const {engine:m,renderer:v}=lab;
   m.setProfile('normal');m.requestStart();lab.advance(4,0,true);
   v.reduced=false;lab.advance(5,.7,true,.5);
   const roll=v.spring.roll,loaded=Math.abs(v.pose.a),slope=m.oilCircuit.surfaceAt(868)-m.oilCircuit.surfaceAt(324);
   v.reduced=true;lab.advance(.12,.7,true,.5);
   return {roll,loaded,slope,reduced:Math.abs(v.pose.a),brake:m.absorbedKW};
  }''')
  ok('shaft load rolls the engine and reduced motion limits the visible roll',
     motion['brake']>0 and motion['roll']<-.001 and motion['reduced']<motion['loaded']*.22)
  report['runoff']=runoff
  report['loaded_motion']=motion
  slap=visual.evaluate('''()=>{
   const lab=__engineLab;lab.reset();
   lab.engine.setProfile('normal');lab.engine.requestStart();lab.advance(4,0,true);
   const starting=lab.engine.snapshot();
   const run=(play,feedback,reduced=false)=>{
    lab.restore(starting);
    const {engine:m,renderer:v}=lab;
    m.cylinders[1].contact.play=play;v.reduced=reduced;
    const events=[],poses=[],drawEvent=v.event,update=v.update;
    v.event=function(e,model){
     if(e.type==='pistonSlap'){
      events.push(e.level);
      if(!feedback)return;
     }
     drawEvent.call(this,e,model);
    };
    v.update=function(dt,model){update.call(this,dt,model);poses.push([this.pose.x,this.pose.a]);};
    try{lab.advance(4,.85,true,.36);}finally{v.event=drawEvent;v.update=update;}
    return {events,poses,state:JSON.stringify(m.snapshot()),rpm:m.rpm};
   };
   const healthy=run(.04,true),worn=run(.19,true),silent=run(.19,false),gentle=run(.19,true,true),gentleSilent=run(.19,false,true);
   const poseDifference=(test,control)=>Math.sqrt(test.poses.reduce((sum,[x,a],i)=>sum+(x-control.poses[i][0])**2+((a-control.poses[i][1])*180)**2,0)/test.poses.length);
   return {healthy:healthy.events.length,worn:worn.events.length,peak:Math.max(0,...worn.events),rpm:worn.rpm,
    fullMotion:poseDifference(worn,silent),reducedMotion:poseDifference(gentle,gentleSilent),samePhysicalState:worn.state===silent.state};
  }''')
  report['piston_slap']=slap
  ok('loaded excess clearance makes local knocks and extra block motion, with a reduced-motion cap',
     slap['healthy']==0 and slap['worn']>0 and 0<slap['peak']<=1 and slap['fullMotion']>.08
     and slap['reducedMotion']<slap['fullMotion']*.2 and slap['samePhysicalState'])
  impact=visual.evaluate('''()=>{
   const lab=__engineLab,m=lab.engine,v=lab.renderer;
   const e={type:'impact',x:427,y:461,nx:1,ny:0,level:.7};
   v.event(e,m);const mark=v.contactMarks.at(-1);
   const wasLocal=mark.x===e.x&&mark.y===e.y;
   for(let i=0;i<30;i++)v.update(1/60,m);
   return {wasLocal,cleared:v.contactMarks.length===0};
  }''')
  ok('contact feedback starts at the impact and expires on the visual clock',impact['wasLocal'] and impact['cleared'])
  visual.close()
  mobile=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True)
  mp=mobile.new_page();load(mp);ok('mobile no horizontal overflow',mp.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  ok('mobile gas and brake are in the first viewport before scrolling',
     mp.evaluate("['gas','brake'].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})"))
  mp.locator('#ignition-key').click();mp.wait_for_function('__engineLab.audio.ready');mp.evaluate('__engineLab.advance(4,0,true)')
  box={k:mp.locator('#'+k).bounding_box() for k in ['gas','brake']};ok('both mobile pedals remain accessible',all(b['height']>=44 and b['y']>=0 and b['y']+b['height']<=844 for b in box.values()))
  cdp=mobile.new_cdp_session(mp);points=[{'id':i+1,'x':box[k]['x']+box[k]['width']/2,'y':box[k]['y']+box[k]['height']*.35}for i,k in enumerate(['gas','brake'])]
  cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':points});ok('trusted two-finger throttle and brake',mp.evaluate('__engineLab.pedals.gas>.5&&__engineLab.pedals.brake>.5'));cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});ok('trusted touch release clears inputs',not mp.evaluate('__engineLab.held'))
  mp.locator('[data-part=exhaust]').click();settle(mp);mp.locator('.machine').screenshot(path=OUT/'mobile-exhaust.png');ok('mobile zoom is not stretched',mp.evaluate('__engineLab.renderer.scale===__engineLab.renderer.sy'))
  mp.locator('#zoom-out').click();settle(mp);mp.screenshot(path=OUT/'mobile.png',full_page=True)
  mp.set_viewport_size({'width':320,'height':754})
  mp.evaluate('window.scrollTo(0,0)')
  ok('320px mobile fits the full cluster, key and both pedals before scrolling',cockpit_fits(mp))
  mp.screenshot(path=OUT/'cockpit-320.png')
  mp.locator('#failures-open').tap()
  ok('the damage dialog and its close action fit a 320px touch viewport',mp.evaluate('''()=>{
   const panel=document.getElementById('failures-dialog'),rect=panel.getBoundingClientRect(),close=document.getElementById('failures-close').getBoundingClientRect();
   return document.documentElement.scrollWidth<=innerWidth&&rect.left>=0&&rect.right<=innerWidth
    &&panel.scrollWidth<=panel.clientWidth+1&&close.height>=44&&close.bottom<=innerHeight;
  }'''))
  mp.locator('#failures-close').tap()
  mp.locator('#settings-open').tap()
  ok('settings reflow on a 320px touch viewport with reachable controls',mp.evaluate('''()=>{
   const panel=document.getElementById('settings-dialog'),rect=panel.getBoundingClientRect();
   return rect.left>=0&&rect.right<=innerWidth&&panel.scrollWidth<=panel.clientWidth+1
    &&['settings-close','performance-mode','volume','mechanical-mix','battery-boost','reset'].every(id=>document.getElementById(id).getBoundingClientRect().height>=44);
  }'''))
  mp.locator('#settings-dialog').screenshot(path=OUT/'settings-320.png')
  mp.locator('#volume').fill('47')
  ok('mobile master volume updates the mix and its readout',mp.evaluate('''()=>
   __engineLab.audio.volume===.47&&document.getElementById('volume-value').textContent==='47%' '''))
  mp.set_viewport_size({'width':844,'height':390})
  ok('settings remain scrollable with an on-screen close action in landscape',mp.evaluate('''()=>{
   const panel=document.getElementById('settings-dialog'),close=document.getElementById('settings-close').getBoundingClientRect();
   panel.scrollTop=panel.scrollHeight;
   const pinned=document.getElementById('settings-close').getBoundingClientRect();
   return panel.scrollTop>0&&close.top>=0&&pinned.top>=0&&pinned.bottom<=innerHeight;
  }'''))
  mp.locator('#settings-close').tap()
  mp.set_viewport_size({'width':320,'height':754})
  mp.locator('#cyl1').scroll_into_view_if_needed()
  mp.evaluate('''()=>document.getElementById('cyl1').addEventListener('click',()=>window.clickedY=scrollY,{once:true,capture:true})''')
  mp.locator('#cyl1').tap()
  settle(mp)
  ok('mobile cylinder zoom keeps the engine and pedals pinned without scrolling the page',mp.evaluate('''()=>{
   const r=document.querySelector('.machine').getBoundingClientRect(),gas=document.getElementById('gas').getBoundingClientRect();
   return __engineLab.renderer.focus===1&&Math.abs(scrollY-clickedY)<1&&r.top>=-1&&r.bottom<=innerHeight
     &&gas.top>=0&&gas.bottom<innerHeight;
  }'''))
  page.set_viewport_size({'width':1366,'height':768})
  page.evaluate('window.scrollTo(0,0)')
  ok('1366x768 desktop fits the full cluster, key and both pedals before scrolling',cockpit_fits(page))
  page.screenshot(path=OUT/'cockpit-1366.png')
  page.set_viewport_size({'width':1280,'height':1000})
  page.locator('#cyl1').scroll_into_view_if_needed()
  page.evaluate('''()=>document.getElementById('cyl1').addEventListener('click',()=>window.clickedY=scrollY,{once:true,capture:true})''')
  page.locator('#cyl1').click()
  settle(page)
  ok('desktop cylinder zoom leaves the page and the cutaway in place',page.evaluate('''()=>{
   const r=document.querySelector('.machine').getBoundingClientRect();
   return __engineLab.renderer.focus===1&&Math.abs(scrollY-clickedY)<1&&r.top>=-1&&r.bottom<=innerHeight;
  }'''))
  for width in [320,360,768]:
   mp.set_viewport_size({'width':width,'height':844});ok(str(width)+'px stays within viewport',mp.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  bench=browser.new_page(viewport={'width':1440,'height':900});load(bench)
  bench.locator('#stand-faults-tab').click()
  bench.locator('#fault-search').fill('кольц')
  ok('fault search reveals matching parts and hides unrelated faults',
     bench.locator('[data-fault="rings:break"]').is_visible() and not bench.locator('[data-fault="filter:clog"]').is_visible())
  bench.locator('#fault-search').fill('xyz')
  ok('an empty fault search explains how to recover',bench.locator('#faults-empty').is_visible())
  bench.locator('#fault-search').fill('')
  bench.locator('[data-fault="filter:clog"]').click()
  bench.locator('#new-engine').click()
  bench.keyboard.press('Escape')
  ok('cancelling motor replacement returns focus and preserves the current fault',
     bench.evaluate("document.activeElement.id==='new-engine'&&__engineLab.engine.benchFaults.has('filter:clog')"))
  bench.locator('#new-engine').click()
  bench.locator('#confirm-reset').click()
  bench.wait_for_function("document.activeElement.id==='ignition-key'")
  ok('confirmed replacement installs a healthy stopped motor ready for the key',
     bench.evaluate("__engineLab.engine.activeCount===4&&!__engineLab.engine.benchFaults.size&&__engineLab.engine.ignition==='off'"))
  bench.locator('#stand-live-tab').click()
  bench.locator('#stand-inspection summary').click()
  ok('inspection folds away without hiding the pedals or the separate fault list tab',
     not bench.locator('[data-part=filter]').is_visible() and bench.locator('#zoom-out').is_visible()
     and bench.locator('#stand-faults-tab').is_visible() and bench.locator('#gas').is_visible())
  ok('a new bench uses normal wear and shows the cutaway and controls side by side',
     bench.evaluate('''()=>__engineLab.engine.profile==='normal' &&
       document.querySelector('.stand').getBoundingClientRect().left>document.querySelector('.machine').getBoundingClientRect().right'''))
  bench.locator('#ignition-key').click()
  bench.wait_for_function('__engineLab.audio.ready')
  bench.evaluate('__engineLab.advance(4,0)')
  bench.locator('#stand-live-tab').focus()
  bench.keyboard.press('ArrowRight')
  ok('the bench tabs respond to arrow keys and keep a single tab stop',
     bench.locator('#stand-controls').is_visible() and bench.evaluate('''()=>document.activeElement.id==="stand-controls-tab"&&
       [...document.querySelectorAll(".stand-tabs button")].filter(t=>t.tabIndex===0).length===1'''))
  bench.locator('#bench-set-target').fill('2700')
  bench.locator('#bench-hold').check()
  bench.evaluate('__engineLab.stepInputs(22)')
  ok('the RPM governor uses throttle and actually settles near its target',
     bench.evaluate('Math.abs(__engineLab.engine.rpm-2700)<190&&__engineLab.engine.throttle>0'))
  touch(bench,'brake',57,.3)
  bench.evaluate('__engineLab.stepInputs(10)')
  ok('the governor holds the target under bench brake load',
     bench.evaluate('Math.abs(__engineLab.engine.rpm-2700)<230&&__engineLab.engine.absorbedNm>35'))
  touch(bench,'brake',57,0,'pointerup')
  bench.locator('#bench-hold').uncheck()
  bench.locator('#bench-set-rpmLimit').fill('3000')
  bench.locator('#bench-set-oil').fill('1.15')
  bench.locator('#bench-set-oilTemp').fill('160')
  bench.locator('#bench-set-coolant').fill('115')
  bench.locator('#bench-set-corrosion').fill('70')
  bench.locator('#bench-set-fuel').fill('2.5')
  ok('the six bench inputs change shaft and physical inventories and warn at high temperatures',
     bench.evaluate('''()=>{const e=__engineLab.engine;return e.rpmLimit===3000&&e.oil===1.15&&e.oilTemp===160&&
       e.coolant===115&&e.corrosion===.70&&e.fuel===2.5&&Math.abs(e.oilCircuit.total-1.15)<1e-8;}'''))
  bench.locator('#stand-live-tab').click()
  ok('live readings reflect both temperature warnings and the piston speed',
     bench.locator('#bench-oil-temp').inner_text()=='160 °C' and bench.locator('#bench-coolant').evaluate('(e)=>e.classList.contains("warning")')
     and bench.locator('#bench-speed').inner_text()!='0,0 м/с')
  bench.evaluate('window.scrollTo(0,0)')
  bench.screenshot(path=OUT/'test-stand-desktop.png',full_page=True)
  bench.locator('#stand-faults-tab').click()
  pickup=bench.locator('[data-fault="pickup:clog"]')
  filter_switch=bench.locator('[data-fault="filter:clog"]')
  pickup.focus();bench.keyboard.press('Space');filter_switch.click()
  ok('the fault list combines two independent switches while the engine runs',
     pickup.get_attribute('aria-checked')=='true' and filter_switch.get_attribute('aria-checked')=='true'
     and bench.evaluate('''()=>{const e=__engineLab.engine;return e.ignition==='running'&&e.oilCircuit.pickupRestriction===.94
       &&e.oilCircuit.pickupClog===0&&e.oilCircuit.filterRestriction===.86;}'''))
  pickup.click()
  ok('turning off the pickup restriction leaves the filter experiment active',
     pickup.inner_text()=='Выкл' and filter_switch.inner_text()=='Вкл' and bench.evaluate('__engineLab.engine.oilCircuit.pickupRestriction===0'))
  bench.locator('[data-fault="timing:skip"]').click()
  ok('the timing switch applies the same saved phase damage',
     bench.evaluate('__engineLab.engine.timingDrive.teethSkipped===1&&__engineLab.engine.timingDrive.torqueFactor<1'))
  bench.locator('#bench-cylinder').select_option(label='2')
  bench.locator('[data-fault="gasket:break"]').click()
  bench.get_by_role('button',name='Приблизить: Прокладка ГБЦ').click()
  settle(bench)
  ok('a selected head gasket fault and zoom target the second cylinder only',
     bench.evaluate('''()=>{const {engine:m,renderer:v}=__engineLab;return m.cylinders[1].contact.headSeal>.8&&
       m.cylinders[0].contact.headSeal===0&&v.focus===1&&v.camera.z>1&&m.activeCount===4;}'''))
  bench.locator('#faults-clear').click()
  ok('clearing every switch removes test restrictions while the head gasket and timing stay damaged',
     bench.evaluate('''()=>{const m=__engineLab.engine;return m.benchFaults.size===0&&m.oilCircuit.filterRestriction===m.oilCircuit.filterLoad
       &&m.cylinders[1].contact.headSeal>.8&&m.timingDrive.teethSkipped===1;}'''))
  mp.set_viewport_size({'width':320,'height':844})
  mp.locator('#stand-faults-tab').tap()
  mp.locator('#bench-cylinder').select_option(label='2')
  mp.locator('[data-fault="rings:break"]').tap()
  ok('the mobile list can select a cylinder and create a physical ring shard',
     mp.evaluate('__engineLab.engine.cylinders[1].contact.ringSeizures===2&&__engineLab.engine.fragments.bodies.some(p=>p.kind==="ring"&&p.cylinder===1)'))
  mp.screenshot(path=OUT/'mobile-pinned-controls.png')
  mp.locator('#stand-faults').screenshot(path=OUT/'fault-switches-mobile.png')
  fixed=mp.evaluate('''()=>{
   const p=document.querySelector('.stand-panels');p.scrollTop=490;
   return {y:scrollY,h:p.clientHeight,gas:document.getElementById('gas').getBoundingClientRect().top};
  }''')
  mp.evaluate('document.getElementById("stand-controls-tab").click()')
  ok('moving from a long fault list to the regulators keeps the page and pedals stable',mp.evaluate('''previous=>{
   const p=document.querySelector('.stand-panels');
   return p.scrollTop===0&&p.clientHeight===previous.h&&Math.abs(scrollY-previous.y)<1
     &&Math.abs(document.getElementById('gas').getBoundingClientRect().top-previous.gas)<1;
  }''',fixed))
  ports=browser.new_page(viewport={'width':1400,'height':960});load(ports)
  ports.evaluate('''()=>{
   const {engine:m,renderer:v,advance}=__engineLab;
   m.requestStart();advance(2,0);
   for(let i=0;i<1200&&m.rpm<3500;i++)m.step(1/120,.75);
   v.reduced=true;v.focus=0;v.lookAt({x:550,y:242,z:2.1});
  }''')
  for name,angle,layer in [('combustion',.45,'drawChamber'),('valve-flow',4.71,'drawPortFlow')]:
   visible=ports.evaluate('''([angle,layer])=>{
    const {engine:m,renderer:v}=__engineLab;
    for(let i=0;i<2400;i++){
     m.step(1/480,.7,.45);
     if(Math.abs(m.phase-angle)<.03&&m.cylinders[0].lit&&!m.revCut)break;
    }
    if(Math.abs(m.phase-angle)>=.03||!m.cylinders[0].lit||m.revCut)return false;
    v.render(m);const frame=v.canvas.toDataURL();
    v[layer]=()=>{};
    v.render(m);const without=v.canvas.toDataURL();delete v[layer];
    v.render(m);return frame!==without&&v.canvas.toDataURL()===frame;
   }''',[angle,layer])
   ok(name+' is visible in the portable cutaway and stable on a paused frame',visible)
   ports.locator('#engine').screenshot(path=OUT/(name+'-after.png'))
  ok('no HTTP requests needed for sound OR SVG',len(report['network_requests'])==0)
  ok('no JavaScript runtime exceptions',not report['runtime_errors'])
  browser.close()
finally:
 (OUT/'report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps(report,indent=2,ensure_ascii=False))
