(function (root) {
  'use strict';
  const { clamp, approach } = root.Piston;
  const $ = id => document.getElementById(id);
  const number = (value, decimals = 0) => value.toFixed(decimals).replace('.', ',');
  const percent = value => number(value * 100) + '%';
  const temperature = value => number(value) + ' °C';
  const parts = {
    pickup: ['Засор маслоприёмника', 'sump', 'Засор ограничивает подачу к насосу.', {clog: 'Забить сетку'}, m => percent(m.oilCircuit.pickupRestriction) + ' · ' + number(m.pressure,1) + ' бар'],
    filter: ['Засор масляного фильтра', 'filter', 'При большом перепаде давления открывается перепускной клапан.', {clog: 'Засорить фильтр'}, m => 'Перепуск ' + percent(m.oilCircuit.bypass)],
    pan: ['Поддон', 'sump', 'Через пробоину уходит масло. Если оно попадёт на горячую трубу, появится дым.', {break: 'Пробить поддон'}, m => number(m.oil, 2) + ' л масла'],
    radiator: ['Радиатор', 'radiator', 'Через трещину уходит охлаждающая жидкость.', {break: 'Повредить радиатор'}, m => number(m.coolantLevel * 6, 2) + ' л антифриза'],
    waterPump: ['Водяная помпа', 'pump', 'Повреждённая крыльчатка хуже прокачивает антифриз.', {break: 'Сломать крыльчатку'}, m => number(m.waterCircuit.q) + ' л/мин'],
    timing: ['Цепь ГРМ', 'timing', 'Перескок меняет фазы клапанов. При обрыве останавливаются распредвалы.', {skip: 'Сместить на зуб', break: 'Оборвать цепь'}, m => m.timingDrive.broken ? 'Цепь оборвана' : 'Смещение: ' + m.timingDrive.teethSkipped],
    exhaust: ['Фланец выпуска', 'exhaust', 'Через неплотное соединение выходят газы, меняется звук выпуска.', {break: 'Разгерметизировать фланец'}, m => 'Утечка газов ' + percent(m.exhaust.leak)],
    mufflerBaffle: ['Глушитель', 'exhaust', 'Повреждённая перегородка мешает потоку и меняет звук.', {break: 'Повредить перегородку'}, m => number(m.exhaust.pressure, 1) + ' кПа'],
    jet: ['Засор масляной форсунки', null, 'Слабая струя хуже охлаждает днище выбранного поршня.', {clog: 'Засорить форсунку'}, (m,i) => 'Засор ' + percent(m.oilCircuit.jetRestriction(i))],
    gasket: ['Прокладка ГБЦ', null, 'Антифриз может попасть в цилиндр и залить свечу. На выпуске появляется белый пар.', {break: 'Пробить прокладку'}, (m,i) => number(m.cylinders[i].contact.boreCoolant * 1000, 1) + ' мл в цилиндре'],
    rings: ['Поршневые кольца', null, 'Падает компрессия, масло в камере даёт сизый дым. От кольца отделяется осколок.', {break: 'Сломать кольцо'}, (m,i) => 'Сломано колец: ' + Math.max(0,m.cylinders[i].contact.ringSeizures-1)],
    plug: ['Свеча зажигания', null, 'Нагар ослабляет искру и вызывает пропуски.', {foul: 'Загрязнить свечу'}, (m,i) => 'Сила искры ' + percent(m.sparkEnergy(m.cylinders[i]))],
    piston: ['Нагрев поршня', null, 'Нагретая юбка расширяется. При малом зазоре её может прихватить к гильзе.', {heat: 'Нагреть поршень'}, (m,i) => temperature(m.cylinders[i].contact.skirtTemp)],
    skirt: ['Юбка поршня', null, 'Осколок падает в картер, юбка трётся о гильзу.', {break: 'Отколоть юбку'}, (m,i) => 'Износ юбки ' + percent(m.cylinders[i].partWear.skirt)],
    exhaustValve: ['Выпускной клапан', null, 'Повреждённый клапан теряет герметичность.', {break: 'Сколоть кромку клапана'}, (m,i) => temperature(m.cylinders[i].exhaustValveTemp)],
    crown: ['Днище поршня', null, 'Газы прорываются в картер и повышают давление у сальников.', {break: 'Пробить днище'}, m => number(m.crankcasePressure, 2) + ' бар в картере'],
    rod: ['Шатун', null, 'Оборванный шатун отключает выбранный цилиндр, его обломки остаются в моторе.', {break: 'Оборвать шатун'}, m => m.activeCount + ' / ' + m.cylinders.length]
  };
  const settings = [
    ['target', 'Задание оборотов', 850, 6200, 50, 'об/мин', 0, 2600],
    ['rpmLimit', 'Ограничитель', 1200, 6500, 50, 'об/мин', 0],
    ['oil', 'Масло', 0, 4.6, .05, 'л', 2],
    ['fuel', 'Топливо', 0, 20, .1, 'л', 1],
    ['coolantLevel', 'Антифриз', 0, 6, .05, 'л', 2],
    ['coolant', 'Температура антифриза', 24, 160, 1, '°C', 0],
    ['oilTemp', 'Температура масла', 24, 220, 1, '°C', 0],
    ['corrosion', 'Коррозия контура охлаждения', 0, 100, 1, '%', 0]
  ];
  class TestStand {
    constructor(engine, refresh, locate) {
      this.engine = engine;
      this.hold = $('bench-hold');
      this.cylinder = $('bench-cylinder');
      this.throttle = 0;
      this.inspecting = false;
      const tabs = [...document.querySelectorAll('.stand-tabs button')];
      const panels = document.querySelector('.stand-panels');
      const activate = tab => {
        if(tab.getAttribute('aria-selected')==='true')return;
        for (const button of tabs) {
          const selected = button === tab;
          button.setAttribute('aria-selected', String(selected));
          button.tabIndex = selected ? 0 : -1;
          $(button.getAttribute('aria-controls')).hidden = !selected;
        }
        panels.scrollTop = 0;
        this.update(this.inspecting);
      };
      for (const [i, tab] of tabs.entries()) {
        tab.addEventListener('click', () => activate(tab));
        tab.addEventListener('keydown', e => {
          const index = {ArrowLeft: (i + tabs.length - 1) % tabs.length, ArrowRight: (i + 1) % tabs.length, Home: 0, End: tabs.length - 1}[e.key];
          if (index === undefined) return;
          e.preventDefault();
          activate(tabs[index]);
          tabs[index].focus({preventScroll:true});
        });
      }
      this.fields = settings.map(([key, label, min, max, step, unit, decimals, initial]) => {
        const row = document.createElement('div');
        row.className = 'stand-range';
        const input = document.createElement('input'), title = document.createElement('label'), value = document.createElement('output');
        Object.assign(input, {id: 'bench-set-' + key, type: 'range', min, max, step, value: initial ?? min});
        title.htmlFor = input.id;
        title.textContent = label;
        value.setAttribute('aria-hidden', 'true');
        row.append(title, value, input);
        $('stand-ranges').append(row);
        const show = reading => {
          const formatted = number(reading, decimals) + (unit === '%' ? '%' : ' ' + unit);
          value.textContent = formatted;
          input.setAttribute('aria-valuetext', formatted);
        };
        input.addEventListener('input', () => {
          if (key !== 'target') engine().setBenchValue(key, input.valueAsNumber);
          show(input.valueAsNumber);
          refresh(false);
        });
        input.addEventListener('change', () => refresh(true));
        show(input.valueAsNumber);
        return {key,input,show};
      });
      this.target = $('bench-set-target');
      this.faults = [];
      const list = $('fault-list'), feedback = $('bench-feedback');
      for (const [label, keys, temporary] of [
        ['Временные воздействия', ['pickup','filter','jet','piston'], true],
        ['Повреждения деталей', ['pan','radiator','waterPump','timing','exhaust','mufflerBaffle','gasket','rings','plug','skirt','exhaustValve','crown','rod'], false]
      ]) {
        const group = document.createElement('section'), heading = document.createElement('h3');
        heading.textContent = label;
        group.append(heading);
        if (!temporary) {
          const help = document.createElement('p');
          help.className = 'fault-help';
          help.textContent = 'После выключения трещины, износ и осколки остаются.';
          group.append(help);
        }
        const rows = document.createElement('ul');
        rows.className = 'fault-rows';
        group.append(rows);
        list.append(group);
        for (const part of keys) {
          const [name, view, info, actions, read] = parts[part];
          for (const [action, label] of Object.entries(actions)) {
            const row = document.createElement('li'), target = document.createElement('button'),
              toggle = document.createElement('button'), value = document.createElement('small');
            row.className = 'fault-row';
            target.type = toggle.type = 'button';
            target.className = 'fault-target';
            target.textContent = part === 'timing' ? label : name;
            target.title = info;
            target.setAttribute('aria-label', 'Приблизить: '+target.textContent);
            target.addEventListener('click', () => {locate(view, Number(this.cylinder.value));feedback.textContent=info;});
            toggle.className = 'fault-switch';
            toggle.dataset.fault = part+':'+action;
            toggle.setAttribute('role','switch');
            toggle.setAttribute('aria-label',label);
            toggle.setAttribute('aria-checked','false');
            toggle.textContent = 'Выкл';
            toggle.addEventListener('click', () => {
              const m = engine(), cylinder = Number(this.cylinder.value);
              const wasOn = m.benchFaultOn(part,action,cylinder);
              const changed = m.toggleBenchFault(part,action,cylinder);
              feedback.textContent = changed ? label + (wasOn ? ' — выключено.' : ' — включено. '+info) :
                part === 'rod' && m.activeCount === 1 ? 'Последний цилиндр защищён.' : 'Деталь уже повреждена.';
              refresh(changed);
            });
            value.className = 'fault-value';
            row.append(target,toggle,value);
            rows.append(row);
            this.faults.push({part,action,view,toggle,value,read,row,keywords:(name+' '+label+' '+info).toLowerCase()});
          }
        }
      }
      $('fault-search').addEventListener('input', e => {
        const words=e.target.value.toLowerCase().trim().split(/\s+/);
        for(const fault of this.faults)fault.row.hidden=!words.every(word=>fault.keywords.includes(word));
        for(const group of list.children)group.hidden=!group.querySelector('li:not([hidden])');
        $('faults-empty').hidden=!!list.querySelector('li:not([hidden])');
      });
      this.cylinder.addEventListener('change', () => {
        feedback.textContent = '';
        this.update(this.inspecting);
      });
      $('faults-clear').addEventListener('click', () => {
        if (!engine().benchFaults.size) return;
        engine().benchFaults.clear();
        feedback.textContent = 'Все воздействия выключены. Полученные повреждения остались.';
        refresh(true);
      });
    }
    clearHold() { this.hold.checked = false; this.throttle = 0; }
    gas(dt, pedals) {
      const m = this.engine();
      if (!this.hold.checked || pedals.gas > .001 || m.ignition !== 'running') {
        this.throttle = 0;
        return pedals.gas;
      }
      const target = Math.min(this.target.valueAsNumber, m.rpmLimit - 140);
      const error = target - m.rpm;
      // A proportional term catches overshoot. The integral supplies the
      // throttle required by friction and whatever load the shaft sees.
      this.throttle = clamp(this.throttle + dt * error * .00038, 0, .88);
      return clamp(this.throttle + error * .0015, 0, 1);
    }
    update(inspecting) {
      this.inspecting = inspecting;
      const m = this.engine(), running = m.ignition === 'running';
      const set = (id, value, warning = false) => {
        const node = $(id);
        if (node.textContent !== value) node.textContent = value;
        node.classList.toggle('warning', warning);
      };
      set('stand-state', inspecting ? 'На паузе' : running ? 'Мотор работает' : m.ignition === 'cranking' ? 'Стартер' : 'Зажигание выключено');
      if (!$('stand-live').hidden) {
        set('bench-rpm', number(m.rpm), m.revCut);
        $('bench-rpm-meter').value = m.rpm;
        set('bench-speed', number(m.pistonSpeed, 1) + ' м/с');
        set('bench-active', (m.rpm > 0 && running ? m.activeCount : 0) + ' / ' + m.cylinders.length, m.activeCount < m.cylinders.length);
        set('bench-coolant', temperature(m.coolant), m.coolant >= 110);
        set('bench-oil-temp', temperature(m.oilTemp), m.oilTemp >= 140);
        set('bench-pressure', number(m.pressure, 1) + ' бар', running && m.pressure < 1);
        set('bench-oil', number(m.oil, 2) + ' л', m.oil < 1.4);
        set('bench-fuel', number(m.fuel, 1) + ' л', m.fuel < .8);
        set('bench-flow', number(m.waterCircuit.q) + ' л/мин');
        const alarms = [];
        if (running && m.pressure < 1) alarms.push('Низкое давление масла');
        if (m.coolant > 108) alarms.push('Перегрев охлаждающей жидкости');
        if (m.oilTemp > 140) alarms.push('Перегрев масла');
        if (m.fuelOnReserve) alarms.push('Резерв стенда поддерживает холостой ход');
        else if (m.fuel < .8) alarms.push('Падает подача топлива');
        if (m.revCut) alarms.push('Ограничитель отсекает зажигание');
        if (m.exhaust.coolantSteam > .09) alarms.push('Белый пар из выхлопа');
        if (m.exhaust.ringOil > .045) alarms.push('Сизый дым из выхлопа');
        set('stand-reaction', alarms.length ? alarms.join(' · ') : running ? 'Давление и температура в норме.' : m.startMessage, alarms.length > 0);
      }
      if (!$('stand-controls').hidden) {
        $('profile').value = m.profile;
        for (const {key, input, show} of this.fields) {
          if (key === 'target') continue;
          const value = key === 'corrosion' ? m[key] * 100 : key === 'coolantLevel' ? m[key] * 6 : m[key];
          if (document.activeElement !== input) {
            input.value = value;
            show(value);
          }
        }
      }
      const count = m.benchFaults.size;
      $('fault-count').hidden = count === 0;
      set('fault-count', String(count));
      if (!$('stand-faults').hidden) {
        $('faults-clear').setAttribute('aria-disabled',String(count === 0));
        const cylinder = Number(this.cylinder.value);
        for (const {part,action,view,toggle,value,read} of this.faults) {
          const on = m.benchFaultOn(part,action,cylinder);
          if (toggle.getAttribute('aria-checked') !== String(on)) {
            toggle.setAttribute('aria-checked',String(on));
            toggle.textContent = on ? 'Вкл' : 'Выкл';
          }
          toggle.disabled = !on && !view && !m.cylinders[cylinder].active;
          const reading = read(m,cylinder);
          if (value.textContent !== reading) value.textContent = reading;
        }
      }
    }
  }
  root.Piston.TestStand = TestStand;
})(window);
