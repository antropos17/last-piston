"""Browser regressions for ignition, v7 saves, pedals and the instrument cluster.
Uses a real loopback origin when permitted; otherwise reports inline limitations.
"""
import functools, json, os, shutil, threading
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
version=json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']
OUT=ROOT/'dist'/f'verification-{version}'/'ignition';OUT.mkdir(parents=True,exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}'
html=(ROOT/'dist/last-piston.html').read_text(encoding='utf-8').replace('<body>','<body><script>window.__PISTON_TEST__=true;</script>')
report={'version':version,'checks':[],'runtime_errors':[],'limitations':[]}
inline=False

def ok(name,value):
 assert value,name
 report['checks'].append(name)

def load(page):
 if inline: page.set_content(html,wait_until='load')
 else: page.goto(base+'/dist/last-piston.html?test')
 page.wait_for_function('window.__engineLab');page.evaluate('__engineLab.pause();__engineLab.engine.requestStart();__engineLab.advance(3,0,true)')

def touch(page,name,pointer,value,kind='pointerdown'):
 box=page.locator('#'+name).bounding_box()
 page.locator('#'+name).dispatch_event(kind,{'pointerId':pointer,'pointerType':'touch','button':0,'clientX':box['x']+box['width']/2,'clientY':box['y']+box['height']-10-value*(box['height']-20)})

def release(page,name,pointer,kind='pointerup'):
 page.locator('#'+name).dispatch_event(kind,{'pointerId':pointer,'pointerType':'touch'})

try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':1280,'height':1120},device_scale_factor=1)
  page.on('pageerror',lambda e:report['runtime_errors'].append(str(e)))
  try: load(page)
  except Exception as e:
   if 'ERR_BLOCKED_BY_ADMINISTRATOR' not in str(e): raise
   inline=True;report['limitations'].append('URL navigation blocked: inline document used. Browser AudioWorklet hosting and storage across navigation not verified.');load(page)
  ok('standalone boots with v7 saves and dashboard',page.evaluate('__engineLab.engine.snapshot().version===7 && !!__engineLab.dashboard'))
  ok('desktop has no horizontal overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  ok('tachometer has static scale and dynamic needle',page.locator('#tach-face .dial-tick').count()==29 and page.locator('#tach-needle').count()==1)
  touch(page,'gas',1,.25);ok('pointer position produces quarter gas',page.evaluate('Math.abs(__engineLab.pedals.gas-.25)<.01'))
  page.evaluate('__engineLab.stepInputs(1)');ok('model throttle actually remains partial',page.evaluate('__engineLab.engine.throttle>.24&&__engineLab.engine.throttle<.26'))
  touch(page,'gas',1,.72,'pointermove');ok('dragging smoothly changes gas command',page.evaluate('Math.abs(__engineLab.pedals.gas-.72)<.01'))
  touch(page,'brake',2,.55);ok('simultaneous pointers retain separate values',page.evaluate('__engineLab.pedals.gas>.7 && Math.abs(__engineLab.pedals.brake-.55)<.01'))
  page.evaluate('__engineLab.stepInputs(1)');ok('brake absorbs shaft power',page.evaluate('__engineLab.engine.absorbedKW>0&&__engineLab.engine.brakeTemp>24'))
  release(page,'gas',1);ok('gas release does not release held brake',page.evaluate('__engineLab.pedals.gas===0&&__engineLab.pedals.brake>.54'))
  release(page,'brake',2,'pointercancel');ok('cancel releases brake',page.evaluate('__engineLab.pedals.brake===0&&!__engineLab.held'))
  page.locator('h1').click();page.keyboard.down('KeyW');page.evaluate('__engineLab.stepInputs(.2)');ok('keyboard throttle has progressive travel',page.evaluate('__engineLab.pedals.gas>.2&&__engineLab.pedals.gas<.5'))
  page.keyboard.down('KeyS');page.evaluate('__engineLab.stepInputs(.5)');ok('keyboard gas and brake work together',page.evaluate('__engineLab.pedals.gas>.95&&__engineLab.pedals.brake>.95'))
  page.keyboard.up('KeyW');ok('releasing W preserves S',page.evaluate('__engineLab.pedals.gas===0&&__engineLab.pedals.brake>.9'))
  page.keyboard.up('KeyS');page.keyboard.down('Space');page.keyboard.down('ArrowUp');page.keyboard.up('Space');page.evaluate('__engineLab.stepInputs(.2)');ok('releasing one throttle key preserves the other',page.evaluate('__engineLab.pedals.gas>0'))
  page.keyboard.up('ArrowUp');page.locator('#brake').focus();page.keyboard.down('Space');page.evaluate('__engineLab.stepInputs(.4)');ok('focused brake works with Space',page.evaluate('__engineLab.pedals.brake>.9&&__engineLab.pedals.gas===0'));page.keyboard.up('Space')
  touch(page,'gas',3,.7);touch(page,'brake',4,.7);page.evaluate('window.dispatchEvent(new Event("blur"))');ok('blur releases both pedals',page.evaluate('__engineLab.pedals.gas===0&&__engineLab.pedals.brake===0&&!__engineLab.held'))
  touch(page,'gas',5,.5);release(page,'gas',5,'lostpointercapture');ok('lost capture releases gas',not page.evaluate('__engineLab.held'))
  page.locator('#inspect-pause').click();touch(page,'brake',6,.4);ok('brake resumes inspection without losing input',page.evaluate('!__engineLab.inspecting&&__engineLab.pedals.brake>.39'));release(page,'brake',6)
  page.evaluate('__engineLab.reset();__engineLab.engine.requestStart();__engineLab.advance(3,0);__engineLab.engine.setProfile("normal");__engineLab.advance(2,.55,true);__engineLab.advance(.5,.55,true,.35)')
  ok('braking absorbs power and the dashboard reports shaft braking',page.evaluate('__engineLab.engine.absorbedKW>0 && document.getElementById("dash-condition").textContent==="Торможение вала"'))
  running_needle=page.locator('#tach-needle').evaluate('el=>el.style.transform')
  ok('tachometer shows the running engine speed',page.evaluate('Number(document.getElementById("tach-face").getAttribute("aria-valuenow"))===Math.round(__engineLab.engine.sensor.rpm) && __engineLab.engine.sensor.rpm>0'))
  page.evaluate('document.activeElement.blur()');page.screenshot(path=OUT/'desktop.png',full_page=True)
  page.locator('.dashboard').screenshot(path=OUT/'dashboard.png')
  page.locator('.pedal-console').screenshot(path=OUT/'pedals.png')
  # Electrical integration and manual ignition checks.
  ok('starter has disengaged after successful start',page.evaluate('__engineLab.engine.ignition==="running" && __engineLab.engine.electrical.starterA===0'))
  ok('alternator supplies current and the charge warning matches the battery current',page.evaluate('__engineLab.engine.electrical.alternatorA>0 && document.getElementById("lamp-charge").classList.contains("on")===(__engineLab.engine.electrical.current < -1)'))
  page.locator('#ignition-key').click();page.evaluate('__engineLab.advance(20,0,true)')
  ok('manual key-off reaches zero without resetting engine',page.evaluate('__engineLab.engine.rpm===0 && __engineLab.engine.ignition==="off" && __engineLab.engine.time>20'))
  ok('instrument zero and key action update together',page.evaluate('document.getElementById("tach-face").getAttribute("aria-valuenow")==="0" && document.getElementById("key-action").textContent==="Пуск"') and page.locator('#tach-needle').evaluate('el=>el.style.transform')!=running_needle)
  page.evaluate('__engineLab.advance(8,0,true)')
  ok('stopped engine has no fresh exhaust smoke',page.evaluate('__engineLab.renderer.smoke.length===0'))
  page.locator('#ignition-key').click();page.evaluate('__engineLab.advance(.65,0,true)')
  ok('cranking shows current and voltage drop',page.evaluate('__engineLab.engine.electrical.starterA>50 && __engineLab.engine.electrical.voltage<12 && __engineLab.engine.ignition==="cranking"'))
  ok('v7 save during cranking restores with the key off and starter disengaged',page.evaluate('''()=>{
   const save=__engineLab.engine.snapshot(),restored=Piston.Engine.restore(save);
   return save.version===7 && save.ignition==='off' && restored.ignition==='off' && restored.electrical.starterA===0
    && restored.electrical.soc===save.electrical.soc;
  }'''))
  page.locator('.ignition-console').screenshot(path=OUT/'cranking.png')
  page.evaluate('__engineLab.advance(3,0,true)')
  ok('restart clears the cranking indication and disengages the starter',page.evaluate('__engineLab.engine.ignition==="running" && __engineLab.engine.electrical.starterA===0 && document.getElementById("key-action").textContent==="Заглушить" && document.getElementById("dash-condition").textContent!=="Пуск стартером"'))
  # A pause and rerender must not consume wear, RNG or time.
  before=page.evaluate('JSON.stringify(__engineLab.engine.snapshot())');page.evaluate('__engineLab.renderer.render(__engineLab.engine);__engineLab.dashboard.update(__engineLab.engine)')
  ok('rendering instruments does not mutate model',before==page.evaluate('JSON.stringify(__engineLab.engine.snapshot())'))
  page.locator('#stand-inspection summary').click()
  page.locator('#cyl2').click();ok('cylinder zoom retained',page.evaluate('__engineLab.renderer.zoom>1&&__engineLab.renderer.focus===2'));page.locator('#zoom-out').click()
  for mode in ['oil','thermal','damage','section']:
   page.locator(f'[data-view={mode}]').click();ok(mode+' view retained',page.evaluate(f'__engineLab.renderer.mode==="{mode}"'))
  ok('live shaft meter is visible and tracks model rpm',page.locator('#bench-rpm-meter').is_visible() and page.evaluate('Math.abs(document.getElementById("bench-rpm-meter").value-__engineLab.engine.rpm)<1'))
  page.locator('#settings-open').click();page.locator('#performance-mode').select_option('eco');ok('eco rendering preserved',page.evaluate('__engineLab.renderer.pixelRatioLimit===1'))
  page.locator('#performance-mode').select_option('auto');page.locator('#motion').click();ok('reduced motion preserved',page.evaluate('__engineLab.renderer.reduced'))
  page.locator('#volume').fill('40');page.locator('#volume').dispatch_event('input');ok('volume controls work',page.evaluate('Math.abs(__engineLab.audio.volume-.4)<.01'))
  page.locator('#settings-close').click()
  # Inspect the real produced browser audio, not merely an initialization flag.
  page.evaluate('__engineLab.audio.update(__engineLab.engine);window.an=__engineLab.audio.ctx.createAnalyser();an.fftSize=2048;__engineLab.audio.master.connect(an)');page.wait_for_timeout(400)
  report['audio']=page.evaluate('(()=>{const a=new Float32Array(an.fftSize);an.getFloatTimeDomainData(a);return {backend:__engineLab.audio.backend,rms:Math.sqrt(a.reduce((n,v)=>n+v*v,0)/a.length),peak:Math.max(...a.map(Math.abs))}})()')
  ok('browser audio is nonzero and bounded',report['audio']['rms']>1e-6 and report['audio']['peak']<1)
  page.evaluate('__engineLab.engine.setProfile("stress");__engineLab.advance(240,1,true)')
  ok('last cylinder still survives new physics',page.evaluate('__engineLab.engine.activeCount===1&&__engineLab.engine.rpm>=380'))
  page.evaluate('__engineLab.advance(60,1,true,1)');ok('last cylinder also survives full braking',page.evaluate('__engineLab.engine.activeCount===1&&__engineLab.engine.rpm>=380'))
  page.screenshot(path=OUT/'damaged.png',full_page=True)
  report['pools']=page.evaluate('({smoke:__engineLab.renderer.smoke.length,debris:__engineLab.renderer.debris.length,cache:__engineLab.renderer.cache.size})')
  ok('effects remain bounded',report['pools']['smoke']<=260 and report['pools']['debris']<=76 and report['pools']['cache']<65)
  page.evaluate('window.snap=__engineLab.engine.snapshot();__engineLab.restore(snap)')
  ok('v7 restore preserves running ignition and brake heat and releases inputs',page.evaluate('snap.version===7&&__engineLab.engine.ignition==="running"&&__engineLab.engine.brakeTemp===snap.brakeTemp&&__engineLab.engine.brake===0&&__engineLab.engine.gasCommand===0'))
  page.locator('#settings-open').click();page.locator('#reset').click();ok('reset still requires confirmation',page.evaluate('__engineLab.engine.activeCount===1&&document.activeElement.id==="cancel-reset"'));page.locator('#confirm-reset').click();ok('confirmed reset resets brake heat',page.evaluate('__engineLab.engine.activeCount===4&&__engineLab.engine.brakeTemp===24'))
  page.locator('#settings-close').click()
  # Reproducible cost distribution; measures CPU submission and forced raster, not hardware FPS.
  page.evaluate('__engineLab.engine.requestStart();__engineLab.advance(3,0,true);__engineLab.advance(2,.5,true)')
  report['render_cost']=page.evaluate('(()=>{const a=[];for(let i=0;i<35;i++){let t=performance.now();__engineLab.renderer.render(__engineLab.engine);__engineLab.dashboard.update(__engineLab.engine);__engineLab.renderer.c.getImageData(0,0,1,1);if(i>4)a.push(performance.now()-t)}a.sort((a,b)=>a-b);return {median_ms:a[15],p95_ms:a[28],samples:a.length,viewport:innerWidth}})()')
  mobile=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True)
  mp=mobile.new_page();mp.on('pageerror',lambda e:report['runtime_errors'].append(str(e)));load(mp)
  ok('mobile has no horizontal overflow',mp.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  boxes={s:mp.locator('#'+s).bounding_box() for s in ['gas','brake']}
  ok('both mobile pedals are visible and at least 44px',all(x['height']>=44 and x['y']>=0 and x['y']+x['height']<=844 for x in boxes.values()))
  # Trusted simultaneous touch via Chromium input, not only synthetic dispatch.
  cdp=mobile.new_cdp_session(mp)
  a=boxes['gas'];bb=boxes['brake'];points=[{'id':21,'x':a['x']+a['width']/2,'y':a['y']+a['height']*.3},{'id':22,'x':bb['x']+bb['width']/2,'y':bb['y']+bb['height']*.55}]
  cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':points})
  ok('trusted two-finger touch controls both pedals',mp.evaluate('__engineLab.pedals.gas>.5&&__engineLab.pedals.brake>.3'))
  mp.evaluate('__engineLab.stepInputs(1)');cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
  ok('trusted touch release releases both pedals',mp.evaluate('__engineLab.pedals.gas===0&&__engineLab.pedals.brake===0'))
  mp.locator('.dashboard').scroll_into_view_if_needed();mp.screenshot(path=OUT/'mobile.png',full_page=True);mp.screenshot(path=OUT/'mobile-viewport.png')
  for width in [320,360,768]:
   mp.set_viewport_size({'width':width,'height':844});ok(f'{width}px layout stays in viewport',mp.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  mp.set_viewport_size({'width':390,'height':844});touch(mp,'gas',77,.6);mp.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide"))');ok('navigation releases mobile pedals',not mp.evaluate('__engineLab.held'))
  if not inline:
   built=browser.new_page(viewport={'width':1280,'height':920})
   built.on('pageerror',lambda error:report['runtime_errors'].append(str(error)))
   built.goto(base+'/dist/last-piston.html')
   built.locator('#new-engine').click()
   built.locator('#build-count').select_option('3')
   built.locator('#build-litres').fill('1.7')
   built.locator('#build-wear').fill('45')
   built.locator('#confirm-reset').click()
   stored="JSON.parse(localStorage.getItem('last-piston:survivor:v1'))"
   ok('assembling a triple stores its displacement and wear with the key off',
      built.evaluate(f"()=>{{const s={stored};return s.version===7&&s.ignition==='off'&&s.cylinders.length===3&&s.build.litres===1.7&&s.build.wear===.45}}"))
   built.locator('#ignition-key').click()
   built.wait_for_selector('#status[data-state="running"]')
   built.locator('#stand-faults-tab').click()
   built.locator('#bench-cylinder').select_option(label='3')
   built.locator('[data-fault="rings:break"]').click()
   built.locator('#ignition-key').click()
   built.wait_for_selector('#status[data-state="off"]')
   built.reload()
   ok('reloading the real workshop keeps the three-cylinder bank and selected ring damage',
      built.locator('#bench-cylinder option').count()==3 and built.locator('#cyl3').is_hidden()
      and built.evaluate(f"()=>{{const s={stored};return s.cylinders[2].contact.ringSeizures===2&&s.cylinders[0].contact.ringSeizures===0}}"))
   built.locator('#new-engine').click()
   ok('the builder restores all three choices after a page reload',
      [built.locator('#build-'+field).input_value() for field in ('count','litres','wear')]==['3','1.7','45'])
   built.keyboard.press('Escape')
   built.locator('#ignition-key').click()
   built.wait_for_selector('#status[data-state="running"]')
   ok('the saved triple restarts from its ignition key',built.locator('#status').get_attribute('data-state')=='running')
   built.close()
  ok('no JavaScript runtime exceptions',not report['runtime_errors'])
  report['transport']='inline' if inline else 'loopback'
  browser.close()
finally:
 server.shutdown()
 (OUT/'report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps(report,indent=2,ensure_ascii=False))
