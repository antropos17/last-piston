'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../src/internals.js');

const STEP = 1 / 120;

function contactRig(filmMicron, chamberBar) {
  const engine = new Engine();
  engine.ignition = 'running';
  engine.rpm = 4500;
  const cylinder = engine.cylinders[1];
  cylinder.cycle.angle = Math.PI / 3;
  cylinder.chamberBar = chamberBar;
  Object.assign(cylinder.contact, { filmMicron, liner: .22, skirt: .12, wallTemp: 171 });
  return { engine, cylinder };
}

function contactValues(cylinder) {
  const { play, liner, crack } = cylinder.contact;
  return [play, liner, crack];
}

test('Piston clearance, scoring and cracks grow faster with side thrust and a thin oil film', () => {
  const dryLoaded = contactRig(0, 37);
  const dryLight = contactRig(0, 2);
  const lubricated = contactRig(3, 37);
  const baseline = contactValues(dryLoaded.cylinder);
  for (const { engine, cylinder } of [dryLoaded, dryLight, lubricated]) {
    for (let i = 0; i < 240; i++) engine.advancePistonContact(STEP, cylinder, 0);
  }
  const interim = contactValues(dryLoaded.cylinder);
  for (let i = 0; i < 240; i++) dryLoaded.engine.advancePistonContact(STEP, dryLoaded.cylinder, 0);
  const after = contactValues(dryLoaded.cylinder);
  const light = contactValues(dryLight.cylinder);
  assert.ok(interim.every((value, i) => value > baseline[i] && value < after[i]));
  assert.ok(interim.every((value, i) => value > light[i]));
  assert.deepEqual(contactValues(lubricated.cylinder), baseline);
  assert.ok(dryLoaded.cylinder.contact.wallTemp > dryLight.cylinder.contact.wallTemp);
  assert.ok(dryLoaded.engine.skirtBoundaryNm > dryLight.engine.skirtBoundaryNm);
  assert.equal(lubricated.engine.skirtBoundaryNm ?? 0, 0);
});

test('A trapped contact adds persistent wear locally and stops growing when the shaft stops', () => {
  const { engine, cylinder } = contactRig(3, 37);
  const baseline = contactValues(cylinder);
  for (let i = 0; i < 120; i++) engine.advancePistonContact(STEP, cylinder, .8);
  const damage = contactValues(cylinder);
  assert.ok(damage.every((value, i) => value > baseline[i]));
  assert.equal(engine.cylinders[0].contact.play, .04);

  engine.rpm = 0;
  engine.ignition = 'off';
  for (let i = 0; i < 120; i++) engine.advancePistonContact(STEP, cylinder, .8);
  assert.deepEqual(contactValues(cylinder), damage);

  const snapshot = JSON.parse(JSON.stringify(engine.snapshot()));
  assert.deepEqual(contactValues(Engine.restore(snapshot).cylinders[1]), damage);
  delete snapshot.cylinders[1].contact.play;
  const migrated = Engine.restore(snapshot).cylinders[1];
  assert.deepEqual(contactValues(migrated), [.04, ...damage.slice(1)]);
  snapshot.cylinders[1].contact.play = 20;
  assert.equal(Engine.restore(snapshot).cylinders[1].contact.play, .65);
});
