(function () {
  'use strict';
  const { Engine, Renderer, MotorAudio, PedalInput, Dashboard, IgnitionPanel, TestStand, PISTON_JET_CLOG_WARNING, SKIRT_CRACK_FATIGUE, HOSE_RUPTURE, FOULED_PLUG_CARBON, HOT_DEPOSIT_C, CROWN_CRACK_FATIGUE, crownOpening, crankSealOpening, MAIN_WEAR_WARNING } = window.Piston;
  const $ = id => document.getElementById(id), canvas = $('engine'), button = $('gas');
  const storageKey = 'last-piston:survivor:v1', prefsKey = 'last-piston:settings:v1';
  const testing = new URLSearchParams(location.search).has('test') || window.__PISTON_TEST__ === true;
  let model = new Engine(), saved = false, prefs = {};
  model.setProfile('normal');
  try {
    if (!testing) {
      const raw = localStorage.getItem(storageKey);
      if (raw) { const data = JSON.parse(raw); model = Engine.restore(data); saved = model.time > 0; }
      prefs = JSON.parse(localStorage.getItem(prefsKey) || '{}') || {};
    }
  } catch (_) { /* Blocked storage is an offline mode, not a fatal error. */ }
  const view = new Renderer(canvas), sound = new MotorAudio();
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  let reducedOverride = typeof prefs.reducedOverride === 'boolean' ? prefs.reducedOverride : null;
  if (prefs.reducedOverride === undefined && prefs.reduced === true) reducedOverride = true;
  sound.muted = prefs.muted === true; view.reduced = reducedOverride ?? motionPreference.matches;
  let held = false, last = 0, acc = 0, hudTime = 0, saveTime = 0;
  let inspecting = false, audioTime=0, perfTime=0, renderCost=0, slowFrames=0;
  let targetFps=60, skippedTime=0;
  let frameMs = 16, pausedForTest = false, logSignature = null;
  const settings = $('settings-dialog'), settingsTrigger = $('settings-open'), resetPrompt = $('reset-prompt');
  const failures = $('failures-dialog'), failuresTrigger = $('failures-open'), failureList = $('failure-list');
  const modalOpen = () => settings.open || failures.open;
  let settingsOpener = settingsTrigger;
  let failureTarget = null;
  const partFailures = {
    radiator: ['radiator', 'трещина в радиаторе'], pump: ['waterPump', 'повреждена крыльчатка'],
    sump: ['oilPickup', 'треснул маслоприёмник'], exhaust: ['mufflerBaffle', 'повреждена перегородка']
  };
  if(Number.isFinite(prefs.volume)) sound.setVolume(prefs.volume);
  for(const channel of ['engine','mechanical']) if(Number.isFinite(prefs.mix?.[channel])) sound.setMix(channel,prefs.mix[channel]);
  view.setPerformance(prefs.performance || 'auto');
  targetFps=view.performanceMode==='eco'?30:60; $('profile').value=model.profile; $('performance-mode').value=view.performanceMode;
  const dom = Object.fromEntries(['status', 'dash-condition', 'event-log',
    'audio-status', 'journal', 'journal-count', 'mute', 'motion', 'reset', 'control-info',
    'inspection-note'].map(id => [id, $(id)]));
  const cylDom = Array.from({ length: 4 }, (_, i) => ({ root: $('cyl' + i), name: $('cyl' + i).querySelector('b') }));
  const machine = canvas.parentElement;
  const deck = document.querySelector('.control-deck'), driveActions = $('drive-actions'), mobileDrive = $('mobile-drive');
  const instruments = [deck,$('stand-inspection')];
  const compactDrive = matchMedia('(max-width: 900px)');
  function placeDrive(){
    const compact=compactDrive.matches;
    (compact?mobileDrive:deck).append(driveActions);
    $(compact?'mobile-instruments':'desktop-instruments').append(...instruments);
    view.resize();view.render(model);
  }
  compactDrive.addEventListener('change',placeDrive);
  placeDrive();
  const pinnedStage = document.querySelector('.engine-workspace');
  new ResizeObserver(()=>{
    pinnedStage.closest('.workstation').style.setProperty('--stage-height',pinnedStage.offsetHeight+'px');
  }).observe(pinnedStage);
  const fmt = t => { const s = Math.max(0, Math.floor(t)); return (s >= 3600 ? String(Math.floor(s / 3600)).padStart(2, '0') + ':' : '') + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  function audioStatus() {
    dom['audio-status'].textContent = sound.muted ? 'Звук выключен' : sound.ready ? 'Записи двигателя · CC0' : sound.status.includes('не загрузилось') ? 'Записи не загрузились' : 'Звук включится при запуске';
    dom.mute.checked = !sound.muted;
    dom.motion.checked = view.reduced;
    document.documentElement.classList.toggle('reduce-motion', view.reduced);
  }
  const dashboard = new Dashboard();
  const stand = new TestStand(() => model, save => {
    events(); hud(); view.render(model); if (save) persist();
  }, (part, cylinder) => {
    if(part)view.setPart(part);else view.setFocus(cylinder);
    syncParts();hud();view.render(model);
  });
  const ignitionPanel = new IgnitionPanel(action => {
    release();
    if (action === 'boost') model.chargeBattery();
    else {
      if (model.ignition === 'off') model.requestStart(); else { model.requestStop(); stand.clearHold(); }
      if (inspecting) setInspection(false);
      sound.start().then(audioStatus);
    }
    events(); sound.update(model); hud(); view.render(model); persist();
  });
  const pedals = new PedalInput(button, $('brake'), () => {
    if (inspecting) setInspection(false);
    sound.start().then(ok => { audioStatus(); if (!ok) dom['audio-status'].textContent = 'ЗВУК НЕДОСТУПЕН'; });
  });
  function release() { pedals.release(); held = false; }
  function setInspection(value){
    inspecting=value;last=0;acc=0;
    $('inspect-pause').textContent=value?'Продолжить':'Пауза осмотра';$('inspect-pause').setAttribute('aria-pressed',String(value));
    if(value){release();sound.suspend().catch(()=>{});}else sound.resume().catch(()=>{});
    hud();view.render(model);
  }
  $('inspect-pause').addEventListener('click',()=>setInspection(!inspecting));
  for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>{
    view.setView(b.dataset.view);
    $('temperature-scale').hidden=b.dataset.view!=='thermal';
    document.querySelectorAll('[data-view]').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));
    hud();view.render(model);
  });
  $('zoom-out').addEventListener('click',()=>{view.setGeneral();hud();view.render(model);});
  cylDom.forEach((d,i)=>{
    d.root.title='Осмотреть цилиндр '+(i+1);
    d.root.addEventListener('click',()=>{
      view.setFocus(i);syncParts();hud();view.render(model);
    });
  });
  function syncParts(){
    for(const b of document.querySelectorAll('[data-part]')) b.setAttribute('aria-pressed',String(view.partFocus===b.dataset.part&&view.zoom>1));
  }
  for(const b of document.querySelectorAll('[data-part]')) b.addEventListener('click',()=>{
    view.setPart(b.dataset.part);syncParts();hud();view.render(model);
  });
  $('zoom-out').addEventListener('click',syncParts);
  for(const [id,value,apply] of [
    ['volume',sound.volume,value=>sound.setVolume(value)],
    ['engine-mix',sound.mixSettings.engine,value=>sound.setMix('engine',value)],
    ['mechanical-mix',sound.mixSettings.mechanical,value=>sound.setMix('mechanical',value)]
  ]) {
    const range=$(id),output=$(id+'-value');range.value=Math.round(value*100);
    const updateLabel=()=>{const formatted=range.value+'%';output.textContent=formatted;range.setAttribute('aria-valuetext',formatted);};
    updateLabel();
    range.addEventListener('input',()=>{apply(Number(range.value)/100);updateLabel();persist();});
  }
  sound.onStatus=()=>{audioStatus();};
  function persist() {
    if (testing) return;
    try { localStorage.setItem(storageKey, JSON.stringify(model.snapshot())); localStorage.setItem(prefsKey, JSON.stringify({ muted: sound.muted, reducedOverride, volume:sound.volume, performance:view.performanceMode, mix:sound.mixSettings })); } catch (_) {}
  }
  function newEngine(spec) {
    release(); stand.clearHold(); if(!modalOpen())sound.resume().catch(()=>{}); inspecting=false; view.zoom=1; $('inspect-pause').textContent='Пауза осмотра'; $('inspect-pause').setAttribute('aria-pressed','false'); model = new Engine(spec?crypto.getRandomValues(new Uint32Array(1))[0]:7193,spec); model.setProfile('normal'); view.reset(); sound.update(model); logSignature = null;
    closeResetPrompt(); dom['control-info'].textContent = 'Новый мотор установлен.';
    dom['event-log'].textContent = ''; persist(); hud(); view.render(model);
  }
  function openSettings(opener) {
    if(modalOpen())return;
    settingsOpener=opener instanceof HTMLElement&&opener!==document.body?opener:settingsTrigger;
    release();last=0;acc=0;settings.showModal();settings.scrollTop=0;
    sound.suspend().catch(()=>{});
  }
  function closeResetPrompt() {
    resetPrompt.hidden=true;
    dom.reset.setAttribute('aria-expanded','false');
  }
  const countInput=$('build-count'),litresInput=$('build-litres'),wearInput=$('build-wear');
  const buildName=n=>['Одноцилиндровый','Рядная двойка','Рядная тройка','Рядная четвёрка'][n-1];
  const volumeLabel=v=>v.toFixed(1).replace('.',',')+' л';
  function readBuild(){return {cylinders:Number(countInput.value),litres:litresInput.valueAsNumber,wear:wearInput.valueAsNumber/100};}
  function previewBuild(){
    const {cylinders,litres,wear}=readBuild();
    document.querySelectorAll('.build-bank i').forEach((el,i)=>{el.hidden=i>=cylinders;});
    $('build-litres-out').textContent=volumeLabel(litres);$('build-wear-out').textContent=Math.round(wear*100)+'%';
    $('build-summary').textContent=buildName(cylinders)+' · '+Math.round(litres*1000/cylinders)+' см³ на цилиндр';
  }
  for(const input of [countInput,litresInput,wearInput])input.addEventListener('input',previewBuild);
  function requestReset() {
    countInput.value=model.build.cylinders;litresInput.value=model.build.litres;wearInput.value=Math.round(model.build.wear*100);previewBuild();
    resetPrompt.hidden=false;
    dom.reset.setAttribute('aria-expanded','true');
    dom['control-info'].textContent='';
    (settings.classList.contains('replace-engine')?countInput:$('cancel-reset')).focus();
  }
  function checkRecordings() {
    sound.start().then(()=>{audioStatus();sound.notify();if(modalOpen()||inspecting)sound.suspend().catch(()=>{});});
  }
  settingsTrigger.addEventListener('click',()=>openSettings(settingsTrigger));
  $('new-engine').addEventListener('click',()=>{
    settings.classList.add('replace-engine');$('settings-title').textContent='Конструктор мотора';
    openSettings($('new-engine'));requestReset();
  });
  $('settings-close').addEventListener('click',()=>settings.close());
  settings.addEventListener('close',()=>{
    closeResetPrompt();dom['control-info'].textContent='';
    settings.classList.remove('replace-engine');$('settings-title').textContent='Настройки';
    last=0;acc=0;
    if(!inspecting&&!document.hidden)sound.resume().catch(()=>{});
    settingsOpener.focus({preventScroll:true});
  });
  settings.addEventListener('keydown',e=>{
    // Keep the game's window-level pedal shortcuts out of native controls.
    if(e.code==='KeyR'&&!e.repeat&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&e.target.closest('#reset-prompt')){
      e.preventDefault();$('confirm-reset').click();
    }
    e.stopPropagation();
  });
  failuresTrigger.addEventListener('click',()=>{
    if(modalOpen())return;
    updateFailures();journal();release();last=0;acc=0;
    failures.showModal();failures.scrollTop=0;sound.suspend().catch(()=>{});
  });
  $('failures-close').addEventListener('click',()=>failures.close());
  failures.addEventListener('keydown',e=>e.stopPropagation());
  failures.addEventListener('close',()=>{
    last=0;acc=0;
    const target=failureTarget;
    failureTarget=null;
    if(target){
      if(!inspecting)setInspection(true);
      $('stand-inspection').open=true;
      target.click();target.focus({preventScroll:true});
    }else{
      if(!inspecting&&!document.hidden)sound.resume().catch(()=>{});
      failuresTrigger.focus({preventScroll:true});
    }
  });
  dom.mute.addEventListener('change', () => { if(sound.muted===dom.mute.checked)sound.mute(); audioStatus(); persist(); });
  dom.motion.addEventListener('change', () => { reducedOverride = dom.motion.checked; view.reduced = reducedOverride; audioStatus(); view.render(model); persist(); });
  dom.reset.addEventListener('click', requestReset);
  $('cancel-reset').addEventListener('click',()=>{if(settings.classList.contains('replace-engine'))settings.close();else{closeResetPrompt();dom.reset.focus();}});
  $('confirm-reset').addEventListener('click',()=>{
    newEngine(readBuild());$('fault-search').value='';$('fault-search').dispatchEvent(new Event('input'));
    $('bench-cylinder').value='0';$('bench-feedback').textContent='';$('stand-live-tab').click();
    if(settings.classList.contains('replace-engine')){settingsOpener=$('ignition-key');settings.close();}else dom.reset.focus();
  });
  $('profile').addEventListener('change',e=>{model.setProfile(e.target.value);hud();persist();});
  $('performance-mode').addEventListener('change',e=>{view.setPerformance(e.target.value);view.cache.clear();targetFps=e.target.value==='eco'?30:60;view.render(model);persist();});
  motionPreference.addEventListener?.('change', e => {
    if(reducedOverride!==null)return;
    view.reduced=e.matches;audioStatus();view.render(model);
  });
  window.addEventListener('keydown', e => {
    if (modalOpen() || e.ctrlKey || e.altKey || e.metaKey) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;
    if (e.code === 'KeyM' && !e.repeat) { sound.mute(); audioStatus(); persist(); }
    if (e.code === 'KeyR' && !e.repeat) { openSettings(document.activeElement); requestReset(); }
  });
  const suspend = () => { release(); last = 0; acc = 0; persist(); sound.suspend().catch(() => {}); };
  const resume = () => { last = 0; acc = 0; if(!inspecting&&!modalOpen()) sound.resume().catch(() => {}); };
  document.addEventListener('visibilitychange', () => document.hidden ? suspend() : resume());
  window.addEventListener('pagehide', suspend); window.addEventListener('pageshow', resume);
  window.addEventListener('resize', () => { view.resize(); view.render(model); });
  function events() {
    for (const e of model.drainEvents()) {
      if (e.type !== 'brakeHeat') { if (!['starter','keyOff','ignition','battery','startFailed'].includes(e.type)) view.event(e, model); sound.event(e); }
      if (e.message && !['backfire','relay','impact','chainRattle'].includes(e.type)) dom['event-log'].textContent = `${fmt(e.time)} / ${e.message}`;
    }
  }
  function journal() {
    const signature = model.log.map(e => `${e.time}:${e.message}`).join('|');
    if (signature === logSignature) return;
    logSignature = signature; dom.journal.replaceChildren();
    dom['journal-count'].textContent = String(model.log.length);
    for (const e of model.log) {
      const li = document.createElement('li'), time = document.createElement('time'), text = document.createElement('span');
      time.textContent = fmt(e.time); text.textContent = e.message; li.append(time, text); dom.journal.append(li);
    }
  }
  function updateFailures() {
    failureList.replaceChildren();
    function add(target, label, faults) {
      const summary=faults.filter(Boolean).join(' · ');
      if(!summary)return;
      const row=document.createElement('li'),action=document.createElement('button');
      const title=document.createElement('strong'),detail=document.createElement('span');
      title.textContent=label;detail.textContent=summary;action.type='button';
      action.append(title,detail);row.append(action);failureList.append(row);
      action.addEventListener('click',()=>{failureTarget=target;failures.close();});
    }
    const wedged=model.fragments.bodies.filter(p=>p.jammed);
    for(const cy of model.cylinders){
      const d=cy.contact;
      add(cylDom[cy.id].root,`Цилиндр ${cy.id+1}`,[
        !cy.active&&(cy.failure==='ejected'?'поршень выбит':'обрыв шатуна'),
        cy.active&&(d.skewSeized||d.thermalSeized)&&'клин юбки',
        wedged.some(p=>p.zone!=='case'&&p.cylinder===cy.id)&&'зажат осколок',
        d.ringFaces.some(w=>w>.05)&&'кольца изношены по задиру',
        d.ringSeizures>1&&'сломаны кольца',d.plugCarbon>=FOULED_PLUG_CARBON&&'нагар на свече · пропуски зажигания',
        cy.active&&d.depositTemp>=HOT_DEPOSIT_C&&'раскалённый нагар',crownOpening(d)?'сквозной пробой днища поршня':d.crownFatigue>=CROWN_CRACK_FATIGUE&&'трещина в днище поршня',
        d.rodBend>0&&'погнут шатун',d.headSeal>0&&'пробита прокладка ГБЦ',d.bearingSpun&&'провернуло вкладыш',
        d.skirtFatigue>=SKIRT_CRACK_FATIGUE&&(d.skirtChips?'осколки юбки':'трещина юбки'),
        model.oilCircuit.jetRestriction(cy.id)>=PISTON_JET_CLOG_WARNING&&'засорена масляная форсунка'
      ]);
    }
    for(const target of document.querySelectorAll('[data-part]')){
      const part=target.dataset.part,aux=partFailures[part];
      const faults=[aux&&model.auxWear[aux[0]]>=1&&aux[1]];
      if(part==='sump')faults.push(model.fragments.caseBreach&&'пробит поддон',wedged.some(p=>p.zone==='case')&&'зажат осколок',model.oilCircuit.pickupRestriction>.16&&'засорён маслоприёмник',
        crankSealOpening(model.crankSeals[0].wear)&&'повреждён передний сальник',crankSealOpening(model.crankSeals[1].wear)&&'повреждён задний сальник',
        model.mainBearings.some(b=>b.wear>=MAIN_WEAR_WARNING)&&'изношены коренные вкладыши, люфт коленвала');
      if(part==='filter')faults.push(model.oilCircuit.filterRestriction>.28&&'загрязнён фильтрующий элемент');
      if(part==='timing')faults.push(model.timingDrive.broken?'обрыв цепи':model.timingDrive.teethSkipped?'нарушены фазы':model.timingDrive.guideWear>=1&&'изношена направляющая');
      if(part==='exhaust')faults.push(model.exhaust.sealWear>=1&&'повреждено уплотнение фланца',model.exhaustSpill.burning&&'горит масло на трубе',model.coolantHose.damage>HOSE_RUPTURE&&'прожжён шланг охлаждения');
      add(target,target.textContent,faults);
    }
    $('failures-empty').hidden=failureList.children.length>0;
  }
  let displayedMotor=null;
  function hud() {
    if(displayedMotor!==model){
      displayedMotor=model;
      const n=model.cylinders.length,caption=buildName(n)+' · '+volumeLabel(model.build.litres);
      document.querySelector('.scene-caption span').textContent=caption;
      canvas.setAttribute('aria-label','Двигатель в разрезе. '+caption);
      cylDom.forEach((d,i)=>{d.root.hidden=i>=n;});
      $('bench-cylinder').replaceChildren(...model.cylinders.map(c=>new Option(String(c.id+1),String(c.id))));
      view.focus=Math.min(view.focus,n-1);
    }
    stand.update(inspecting);
    dom.status.dataset.state = inspecting ? 'paused' : model.ignition;
    dom['dash-condition'].textContent = inspecting ? 'Пауза осмотра' : dashboard.condition(model);
    const cylinderMotion=model.ignition==='cranking'?'ПРОКРУТКА':model.rpm>5?'ВЫБЕГ':'СТОП';
    model.cylinders.forEach((cy, i) => {
      const d = cylDom[i], isLast = cy.active && model.activeCount === 1 && model.cylinders.length>1, bind=cy.contact.thermalSeized||cy.contact.skewSeized;
      d.root.className = 'cyl' + (!cy.active ? ' off' : isLast ? ' last' : bind||cy.wear > .35 ? ' worn' : '');
      d.name.textContent = !cy.active ? (cy.failure === 'ejected' ? 'ПОРШЕНЬ ВЫБИТ' : 'ОБРЫВ ШАТУНА') : bind?'ПРИХВАТ':model.ignition!=='running'?cylinderMotion:cy.contact.plugCarbon>=FOULED_PLUG_CARBON?'ПРОПУСКИ':isLast ? 'ДЕРЖИТСЯ' : cy.wear > .65 ? 'ПРОПУСКИ' : cy.wear > .35 ? 'ИЗНОС' : 'РАБОТАЕТ';
      d.root.setAttribute('aria-pressed',String(view.zoom>1&&!view.partFocus&&view.focus===i));
    });
    let inspectionNote='';
    if(view.zoom>1&&!view.partFocus){
      const cy=model.cylinders[view.focus], wedged=model.fragments.bodies.filter(p=>p.zone!=='case'&&p.cylinder===cy.id&&p.jammed);
      const ring=wedged.find(p=>p.kind==='ring');
      const skirtJam=cy.contact.skewSeized&&(view.thermalFocus||!wedged.length);
      const state=skirtJam?'клин юбки от перекоса':ring?'кольцо зажато':wedged.length?'осколок зажат':cy.active&&cy.contact.thermalSeized?'тепловой прихват юбки':!cy.active||model.ignition!=='running'?cylDom[cy.id].name.textContent.toLowerCase():cy.cycle.name.toLowerCase();
      inspectionNote=`Цилиндр ${cy.id+1}: ${state}`;
      if(view.jamFocus?.zone==='liner'&&view.jamFocus.jammed)inspectionNote+=' между юбкой и гильзой';
      if(cy.contact.headSeal>0)inspectionNote+=' · пробита прокладка ГБЦ, компрессия падает';
      else if(cy.contact.headWarp>.025)inspectionNote+=' · головку повело от перегрева';
      if(cy.contact.boreCoolant>.00015)inspectionNote+=' · антифриз в цилиндре';
      if(cy.contact.plugWet>.22)inspectionNote+=' · свеча залита';
      if(cy.contact.rodBend>0)inspectionNote+=' · погнутый шатун перекашивает поршень';
      if(cy.contact.skewSeized&&!skirtJam)inspectionNote+=' · юбка заклинена от перекоса';
      if(cy.contact.ringSeizures>1)inspectionNote+=' · сломаны кольца, компрессия снижена';
      if(cy.contact.ringFaces.some(w=>w>.02)){
        const flow=cy.contact.ringGasLeft+cy.contact.ringGasRight;
        inspectionNote+=' · износ колец по задиру';
        if(flow>.03)inspectionNote+=' · газы мимо колец '+flow.toFixed(1).replace('.',',')+' г/с';
      }
      if(cy.contact.boreOil>.00002||cy.contact.boreOilVapour>.00002)inspectionNote+=' · масло в камере сгорания';
      if(cy.contact.plugCarbon>=FOULED_PLUG_CARBON)inspectionNote+=' · нагар на свече, слабая искра';
      if(cy.contact.crownCarbon>.12)inspectionNote+=' · нагар на днище поршня';
      if(cy.contact.depositTemp>=HOT_DEPOSIT_C)inspectionNote+=' · нагар раскалён';
      if(cy.contact.preIgnition)inspectionNote+=' · смесь вспыхнула до искры';
      if(crownOpening(cy.contact))inspectionNote+=' · сквозной пробой днища поршня, компрессия снижена';
      else if(cy.contact.crownFatigue>=CROWN_CRACK_FATIGUE)inspectionNote+=' · трещина в днище поршня';
      if(cy.contact.crownGasFlow>.2)inspectionNote+=' · газы прорываются в картер';
      if(cy.contact.bearingSpun)inspectionNote+=' · провернуло шатунный вкладыш';
      if(cy.contact.journalScoring>.08)inspectionNote+=' · задиры на шатунной шейке';
      if(cy.active&&cy.contact.bearingClearance>=.105)inspectionNote+=' · люфт шатунного подшипника';
      const jet=model.oilCircuit.pistonJets[cy.id];
      if(model.oilCircuit.jetRestriction(cy.id)>=PISTON_JET_CLOG_WARNING)inspectionNote+=' · засорена масляная форсунка';
      else if(view.mode==='oil'&&cy.active&&model.throttle>.3&&jet.flow<.23)inspectionNote+=jet.flow>.01?' · слабая струя под поршнем':' · нет струи под поршнем';
      if(ring&&Math.abs(ring.skew)>.045)inspectionNote+=' · перекос';
      if(cy.contact.play>.12)inspectionNote+=' · люфт поршня';
      if(cy.contact.liner>.33||model.fragments.linerScuffs.some(mark=>mark.cylinder===cy.id&&mark.depth>.03))inspectionNote+=' · задиры на гильзе';
      if(model.fragments.edgeChips.some(chip=>chip.cylinder===cy.id&&(chip.edge==='liner'||chip.edge==='head')&&chip.damage>=1))inspectionNote+=' · скол кромки';
      if(cy.contact.skirtChips>0||cy.partWear.skirt===1)inspectionNote+=' · скол юбки';
      else if(cy.contact.skirtFatigue>=SKIRT_CRACK_FATIGUE)inspectionNote+=' · трещина юбки';
      for(const [part,label] of [['ringLand','скол перемычки колец'],['exhaustValve','скол тарелки клапана']])
        if(cy.partWear?.[part]===1)inspectionNote+=' · '+label;
    }
    journal(); dashboard.update(model); ignitionPanel.update(model);syncParts();
    if(view.partFocus&&view.zoom>1){
      const descriptions = {
        radiator: model.relay.fan > .1 ? 'Радиатор · вентилятор включён' : 'Радиатор',
        pump: 'Водяная помпа',
        filter: model.oilCircuit.bypass > .02 ? 'Масляный фильтр · открыт перепускной клапан' : 'Масляный фильтр',
        exhaust: 'Выпуск',
        timing: model.timingDrive.broken ? 'Цепь ГРМ · обрыв' : model.timingDrive.teethSkipped ? 'Цепь ГРМ · нарушены фазы' : 'Цепь ГРМ',
        sump: view.jamFocus?.jammed ? 'Картер · осколок зажат' : model.fragments.bodies.some(p => p.zone === 'case' && p.y + p.r > model.oilCircuit.surfaceAt(p.x)) ? 'Картер · обломки в масле' : 'Картер'
      };
      inspectionNote=descriptions[view.partFocus];
      if(view.partFocus==='filter'&&model.oilCircuit.filterRestriction>.28)inspectionNote+=' · загрязнён фильтрующий элемент';
      if(view.partFocus==='timing'&&!model.timingDrive.broken&&model.timingDrive.guideWear>=1)inspectionNote+=' · изношена направляющая';
      if(view.partFocus==='sump'&&view.jamFocus?.jammed&&view.jamFocus.jamEdge)
        inspectionNote+=view.jamFocus.jamEdge==='cap'?' у кромки крышки подшипника':' у кромки картера';
      if(view.partFocus==='sump'&&model.fragments.edgeChips.some(chip=>(chip.edge==='cap'||chip.edge==='case')&&chip.damage>=1))
        inspectionNote+=' · скол кромки';
      if(view.partFocus==='sump'&&model.oilCircuit.pickupRestriction>.16)
        inspectionNote+=' · засорена сетка маслоприёмника';
      if(view.partFocus==='sump'&&model.rpm>0&&model.oil>.025&&model.oilCircuit.inletAir>.22)
        inspectionNote+=' · маслоприёмник захватывает воздух';
      else if(view.partFocus==='sump'&&model.oilCircuit.pumpAeration>.045)
        inspectionNote+=' · масло с пузырьками поступает в насос';
      if(view.partFocus==='sump'){
        if(model.fragments.caseBreach)inspectionNote+=model.caseLeakRate>.001?' · пробит поддон, вытекает масло':' · пробит поддон';
        if(model.crankcasePressure>.04&&model.cylinders.some(c=>crownOpening(c.contact)))inspectionNote+=' · прорыв газов через пробой поршня';
        if(model.crankcasePressure>.005&&model.cylinders.some(c=>c.contact.ringGasLeft+c.contact.ringGasRight>.03))
          inspectionNote+=' · газы через кольца, давление +'+model.crankcasePressure.toFixed(2).replace('.',',')+' бар';
        if(model.crankSeals.some(s=>s.flow>.0005))inspectionNote+=' · масло выдавливает через сальники';
        else if(model.crankSeals.some(s=>crankSealOpening(s.wear)))inspectionNote+=' · повреждены сальники коленвала';
        if(model.mainBearings.some(b=>b.temp>162))inspectionNote+=' · перегреты коренные вкладыши';
        if(model.mainBearings.some(b=>b.wear>=MAIN_WEAR_WARNING))inspectionNote+=' · износ коренных вкладышей, люфт коленвала';
        if(model.cylinders.some(cy=>cy.contact.bearingSpun))inspectionNote+=' · провернуло шатунный вкладыш';
        else if(model.cylinders.some(cy=>cy.contact.bearingWipe>=1))inspectionNote+=' · содран слой шатунного вкладыша';
      }
      if(view.partFocus==='sump'||view.partFocus==='exhaust'){
        if(model.exhaustSpill.burning)inspectionNote+=' · масло горит на выпуске';
        else if(model.exhaustSpill.smoke>.08)inspectionNote+=' · масло дымит на выпуске';
        if(model.coolantHose.runoff>.001)inspectionNote+=' · из прожжённого шланга течёт антифриз';
        else if(model.coolantHose.damage>HOSE_RUPTURE)inspectionNote+=' · шланг охлаждения прожжён';
        else if(model.coolantHose.damage>.08)inspectionNote+=' · шланг охлаждения обуглился';
      }
      if(view.partFocus==='exhaust'&&model.exhaust.coolantSteam>.08)inspectionNote+=' · белый пар из цилиндра';
      if(view.partFocus==='exhaust'&&model.exhaust.ringOil>.025)inspectionNote+=' · сизый дым от сгоревшего масла';
      const failure = partFailures[view.partFocus];
      if (failure && model.auxWear?.[failure[0]] >= 1) inspectionNote += ' · ' + failure[1];
      if(view.partFocus==='exhaust'){
        if(model.exhaust.sealWear>=1)inspectionNote+=' · повреждено уплотнение фланца';
        else if(model.exhaust.jointGap>.06)inspectionNote+=' · зазор во фланце';
      }
    }
    if (dom['inspection-note'].textContent !== inspectionNote) dom['inspection-note'].textContent=inspectionNote;
    dom['inspection-note'].hidden = !inspectionNote;
    machine.classList.toggle('inspecting',inspecting);
    machine.classList.toggle('zoomed',view.zoom>1);
  }
  function frame(now) {
    requestAnimationFrame(frame);
    if(document.hidden){last=0;return;}
    if(pausedForTest || inspecting || modalOpen()){last=0;if(view.updateCamera(now))view.render(model);return;}
    if(last && now-last<1000/targetFps-.6)return;
    const raw=last?(now-last)/1000:1/60;last=now;
    const dt=Math.min(.05,Math.max(0,raw));skippedTime+=Math.max(0,raw-dt);
    frameMs=frameMs*.96+raw*1000*.04;
    const begin=performance.now();
    acc+=dt;let n=0;while(acc>=1/120&&n++<6){pedals.update(1/120); held=pedals.gas>.001; model.step(1/120,stand.gas(1/120,pedals),pedals.brake);acc-=1/120;}if(acc>.05)acc=0;
    events();view.update(dt,model);view.updateCamera(now);view.render(model);
    const cost=performance.now()-begin;renderCost=renderCost*.95+cost*.05;
    hudTime+=dt;audioTime+=dt;saveTime+=dt;perfTime+=dt;
    if(audioTime>.045){audioTime=0;sound.update(model);}
    if(hudTime>.1){hudTime=0;hud();}
    if(saveTime>8){saveTime=0;persist();}
    if(perfTime>2){perfTime=0;
      if(view.performanceMode==='auto'){
        slowFrames=(renderCost>16||(targetFps===60&&frameMs>24))?slowFrames+1:Math.max(0,slowFrames-1);
        if(slowFrames>=2){if(view.pixelRatioLimit>1){view.pixelRatioLimit=1;view.resize();}view.quality=Math.max(.48,view.quality*.8);targetFps=30;slowFrames=0;}
      }
    }
  }

  if (saved) { dom['event-log'].textContent = 'Мотор и история повреждений восстановлены.'; view.restoreDebris(model); }
  if (testing) window.__engineLab = {
    get ignitionPanel() { return ignitionPanel; }, get inspecting() { return inspecting; }, get engine() { return model; }, get renderer() { return view; }, get audio() { return sound; }, get held() { return pedals.held; }, get pedals() { return pedals; }, get dashboard() { return dashboard; }, get frameMs() { return frameMs; }, get renderCost(){return renderCost;}, get skippedTime(){return skippedTime;},
    pause(value = true) { pausedForTest = value; last = 0; },
    advance(seconds, gas = true, visual = false, brake = 0) {
      for (let n = 0; n < Math.round(seconds * 120); n++) { model.step(1 / 120, gas, brake); events(); if (visual && n % 2 === 0) view.update(1 / 60, model); }
      hud(); sound.update(model); view.render(model);
    },
    restore(data) { release(); stand.clearHold(); model = Engine.restore(data); view.reset(); view.restoreDebris(model); logSignature = null; hud(); view.render(model); },
    stepInputs(seconds = 1) { for (let i=0; i<Math.round(seconds*120); i++) { pedals.update(1/120); model.step(1/120,stand.gas(1/120,pedals),pedals.brake); } events(); hud(); view.render(model); },
    reset: newEngine
  };
  for(const item of Object.values(window.Piston.SAMPLES)){const li=document.createElement('li'),a=document.createElement('a');a.href=item.source;a.target='_blank';a.rel='noopener';a.textContent=item.title+' / '+item.author+' / '+item.license;li.append(a);$('sample-credits').append(li);}
  $('reload-audio').addEventListener('click',checkRecordings);
  audioStatus(); hud(); view.render(model); requestAnimationFrame(frame);
})();
