'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../src/internals.js');

const STEP = 1 / 120;

function rig({ play = .058, film = 2, pressure = 35 } = {}) {
  const engine = new Engine();
  const cylinder = engine.cylinders[1];
  engine.ignition = 'running';
  engine.rpm = 4500;
  cylinder.contact.play = play;
  cylinder.contact.filmMicron = film;
  cylinder.chamberBar = pressure;
  return { engine, cylinder };
}

function seat({ engine, cylinder }, side) {
  cylinder.cycle.angle = side > 0 ? Math.PI / 2 : 3 * Math.PI / 2;
  for (let i = 0; i < 60; i++) engine.advancePistonSlap(STEP, cylinder);
  return engine.drainEvents();
}

test('A worn skirt strikes only when it crosses to the opposite liner wall', () => {
  const setup = rig();
  assert.deepEqual(seat(setup, 1), []);
  const left = seat(setup, -1);
  assert.equal(left.length, 1);
  assert.equal(left[0].type, 'pistonSlap');
  assert.equal(left[0].cylinder, 1);
  assert.equal(left[0].x, 517 - 48);
  assert.equal(left[0].nx, 1);
  assert.ok(left[0].level > 0 && left[0].level <= 1 && left[0].y > 232 && left[0].y < 416);
  assert.deepEqual(seat(setup, -1), []);
  const right = seat(setup, 1);
  assert.equal(right.length, 1);
  assert.equal(right[0].x, 517 + 48);
  assert.equal(right[0].nx, -1);
  assert.deepEqual(setup.engine.log, []);
});

test('Side load raises the slap level and an oil film damps it at the same clearance', () => {
  const level = options => {
    const setup = rig(options);
    seat(setup, 1);
    return seat(setup, -1)[0].level;
  };
  const loadedDry = level({ film: 0 });
  assert.ok(loadedDry > level({ film: 0, pressure: 3.5 }));
  assert.ok(loadedDry > level({ film: 4 }));
  assert.ok(level({ film: 0, play: .3 }) > loadedDry);
});

test('Nominal clearance, stopped rotation and restored position do not cause false knocks', () => {
  const healthy = rig({ play: .04 });
  seat(healthy, 1);
  assert.deepEqual(seat(healthy, -1), []);

  const worn = rig();
  seat(worn, 1);
  worn.engine.rpm = 0;
  assert.deepEqual(seat(worn, -1), []);
  worn.engine.rpm = 4500;
  assert.deepEqual(seat(worn, -1), []);

  const restored = Engine.restore(JSON.parse(JSON.stringify(worn.engine.snapshot())));
  assert.equal(restored.cylinders[1].contact.play, .058);
  restored.cylinders[1].chamberBar = 35;
  const setup = { engine: restored, cylinder: restored.cylinders[1] };
  assert.deepEqual(seat(setup, 1), []);
  assert.equal(seat(setup, -1).length, 1);
});

test('A chipped cap damages the loaded neighboring bearing even during impact cooldown', () => {
  const engine = new Engine(), cylinder = engine.cylinders[2];
  engine.collisionCooldown = .08;
  engine.fragments.events.push({ type: 'edgeChip', edge: 'cap', cylinder: 2, level: .8, x: 579, y: 470, nx: -1, ny: 0 });
  engine.step(STEP, 0);
  const chips = engine.drainEvents().filter(event => event.type === 'edgeChip');
  assert.equal(chips.length, 1);
  assert.equal(chips[0].cylinder, 2);
  assert.ok(cylinder.contact.bearing > .03);
  assert.equal(engine.cylinders[1].contact.bearing, 0);
  const bearing = cylinder.contact.bearing;
  engine.step(STEP, 0);
  assert.equal(cylinder.contact.bearing, bearing);
});
