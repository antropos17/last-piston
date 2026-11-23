/* The instrument faces are built once. Only needles and lamp states change. */
(function (root) {
  'use strict';
  const { clamp, RATING } = root.Piston, NS = 'http://www.w3.org/2000/svg';
  const COOLANT_COLD = 24, COOLANT_HOT = 144, OIL_WARNING = .7;
  const COOLANT_WARNING = 110;

  function coolantScale(temp) {
    // The model's sensor is already damped. Compress the normal band so the
    // thermostat cycle stays close to center and a hot excursion reads clearly.
    if (temp < 82) return (temp - COOLANT_COLD) / (82 - COOLANT_COLD) * .48;
    if (temp < 101) return .48 + (temp - 82) / (101 - 82) * .04;
    if (temp < COOLANT_WARNING) return .52 + (temp - 101) / (COOLANT_WARNING - 101) * .25;
    return .77 + (temp - COOLANT_WARNING) / (COOLANT_HOT - COOLANT_WARNING) * .23;
  }

  function node(name, attrs, label) {
    const el = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (label !== undefined) el.textContent = label;
    return el;
  }
  function drawDial(id, { x, y, radius, start, end, ticks, min, max, danger, scale, normal, prelimit }) {
    const face = document.getElementById(id);
    const angleAt = value => start + (end - start) * (scale ? scale(value) : (value - min) / (max - min));
    const point = (angle, r) => [x + Math.sin(angle * Math.PI / 180) * r, y - Math.cos(angle * Math.PI / 180) * r];
    const arc = (from, to, className, r = radius) => node('path', {
      d: `M ${point(from, r).join(' ')} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to, r).join(' ')}`,
      class: className
    });
    face.append(arc(start, end, 'dial-arc'));
    if (prelimit !== undefined) face.append(arc(angleAt(prelimit), angleAt(danger), 'dial-prelimit'));
    if (normal) {
      face.append(arc(start, angleAt(55), 'dial-cold-range'),
        arc(angleAt(normal[0]), angleAt(normal[1]), 'dial-normal-range'));
    }
    face.append(arc(angleAt(danger), end, 'dial-redline'));
    for (const { value, label, major, middle } of ticks) {
      const angle = angleAt(value);
      const [x1, y1] = point(angle, radius - (major ? 10 : middle ? 7.5 : 5.5));
      const [x2, y2] = point(angle, radius - 2.5);
      face.append(node('line', { x1, y1, x2, y2, class: `dial-tick${major ? ' major' : middle ? ' middle' : ''}${value >= danger ? ' hot-tick' : ''}` }));
      if (label !== undefined) {
        const [lx, ly] = point(angle, radius - 18.7);
        face.append(node('text', { x: lx, y: ly + 4, class: 'dial-number' }, label));
      }
    }
    const tip = y - radius + 6, hub = radius > 50 ? 6 : 4.4;
    const needle = node('g', { id: id.replace('-face', '-needle'), class: 'dial-pointer', 'aria-hidden': 'true' });
    const blade = `M ${x - 2.2} ${y + 9} L ${x - 1.35} ${y - 1} ${x - .45} ${tip + 2.5} ${x} ${tip} ${x + .45} ${tip + 2.5} ${x + 1.35} ${y - 1} ${x + 2.2} ${y + 9} Z`;
    needle.style.transformOrigin = `${x}px ${y}px`;
    needle.append(node('path', { d: blade, class: 'dial-needle-shadow', transform: 'translate(1 1.5)' }),
      node('path', { d: blade, class: 'dial-needle' }),
      node('path', { d: `M ${x} ${tip + 3} L ${x - .6} ${y - 3}`, class: 'dial-needle-edge' }));
    face.append(needle, node('circle', { cx: x, cy: y, r: hub, class: 'dial-hub' }),
      node('circle', { cx: x, cy: y, r: hub * .68, class: 'dial-hub-cap' }));
    let lastValue, lastPower;
    return (value, powered) => {
      const displayed = Math.round(clamp(Number.isFinite(value) ? value : min, min, max));
      if (displayed === lastValue && powered === lastPower) return;
      lastValue = displayed;
      lastPower = powered;
      needle.style.transform = `rotate(${angleAt(displayed).toFixed(2)}deg)`;
      face.setAttribute('aria-valuenow', displayed);
      if (powered) face.removeAttribute('aria-valuetext');
      else face.setAttribute('aria-valuetext', 'Зажигание выключено');
    };
  }
  class Dashboard {
    constructor() {
      const rpmTicks = Array.from({ length: 29 }, (_, i) => ({
        value: i * 250, label: i % 4 === 0 ? i / 4 : undefined, major: i % 4 === 0, middle: i % 2 === 0
      }));
      const coolantTicks = [
        { value: COOLANT_COLD, label: 'C', major: true }, { value: 50 }, { value: 68, middle: true },
        { value: 91, major: true }, { value: 105, middle: true }, { value: COOLANT_WARNING, middle: true },
        { value: 125 }, { value: COOLANT_HOT, label: 'H', major: true }
      ];
      this.tach = drawDial('tach-face', { x: 88, y: 70, radius: 60, start: -135, end: 135,
        ticks: rpmTicks, min: 0, max: 7000, danger: RATING.limiter, prelimit: RATING.limiter - 500 });
      this.coolant = drawDial('coolant-face', { x: 47, y: 49, radius: 35, start: -77, end: 77,
        ticks: coolantTicks, min: COOLANT_COLD, max: COOLANT_HOT, danger: COOLANT_WARNING,
        scale: coolantScale, normal: [82, 101] });
      this.cluster = document.querySelector('.cockpit-cluster');
      this.lamps = ['oil', 'charge', 'coolant', 'engine', 'brake'].map(name => document.getElementById('lamp-' + name));
      this.warning = document.getElementById('warning-status');
      this.mode = document.getElementById('dash-mode');
      this.lastWarnings = '';
    }
    condition(m) {
      if (m.ignition === 'cranking') return 'Пуск стартером';
      if (m.ignition === 'off') {
        if (m.rpm > 5) return 'Вал останавливается';
        if (m.startMessage.startsWith('АКБ разряжена')) return 'АКБ разряжена · пусковое питание в настройках';
        if (m.startMessage === 'Стартер остывает') return m.startMessage;
        return 'Зажигание выключено';
      }
      if (m.brakeHot || m.brakeTemp > 400) return 'Тормоз перегрет';
      if (m.coolantLevel <= .01) return 'Утечка охлаждающей жидкости';
      if (m.pressure < OIL_WARNING) return 'Низкое давление масла';
      if (m.coolant >= COOLANT_WARNING) return 'Двигатель перегрет';
      if (m.activeCount === 1 && m.cylinders.length>1) return 'Последний цилиндр';
      if (m.revCut) return 'Отсечка топлива';
      if (m.brake > .04) return 'Торможение вала';
      if (m.overrun) return 'Сброс газа';
      return m.throttle > .08 ? 'Разгон' : 'Холостой ход';
    }
    update(m) {
      const powered = m.ignition !== 'off', checking = m.ignition === 'cranking' && m.crankTime < .5;
      if (this.cluster.dataset.power !== m.ignition) this.cluster.dataset.power = m.ignition;
      const brightness = powered ? clamp((m.electrical.voltage - 6) / 6, .3, 1).toFixed(2) : '0';
      if (brightness !== this.brightness) {
        this.cluster.style.setProperty('--cluster-power', brightness);
        this.brightness = brightness;
      }
      this.tach(powered ? m.sensor.rpm : 0, powered);
      this.coolant(powered ? m.sensor.coolant : COOLANT_COLD, powered);
      this.mode.hidden = m.profile !== 'stress';
      const states = [m.pressure < OIL_WARNING, m.ignition === 'cranking' || m.electrical.current < -1,
        m.coolant >= COOLANT_WARNING || m.coolantLevel <= .01,
        m.activeCount < m.cylinders.length || m.cylinders.some(c => c.misfire > .12 || c.contact?.thermalSeized)
          || Object.values(m.auxWear).some(wear => wear >= 1) || m.timingDrive?.broken || m.timingDrive?.teethSkipped > 0,
        m.brakeHot || m.brakeTemp > 400];
      const warnings = [];
      this.lamps.forEach((lamp, i) => {
        const lit = powered && (checking || states[i]);
        lamp.classList.toggle('on', lit);
        const hidden = String(!lit || checking);
        if (lamp.getAttribute('aria-hidden') !== hidden) lamp.setAttribute('aria-hidden', hidden);
        if (lit && !checking) warnings.push(lamp.title);
      });
      const announcement = warnings.join('. ');
      if (announcement !== this.lastWarnings) {
        this.warning.textContent = announcement;
        this.lastWarnings = announcement;
      }
    }
  }
  root.Piston.Dashboard = Dashboard;
})(window);
