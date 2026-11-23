'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../src/internals.js');

for (const count of [1, 2, 3, 4]) {
  test(`assembled ${count}-cylinder motor runs, retains its parts and restarts`, () => {
    const spec = { cylinders: count, litres: 0.8 * count, wear: 0.65 };
    const motor = new Engine(83, spec);
    assert.equal(motor.ignition, 'off');
    assert.equal(motor.cylinders.length, count);
    const phases = motor.cylinders.map(c => c.offset).sort((a, b) => a - b);
    phases.forEach((phase, i) => assert.ok(Math.abs(phase - 4 * Math.PI * i / count) < 1e-9));
    assert.ok(motor.cylinders.every(c => c.wear === spec.wear && c.compression < 1));
    assert.equal(motor.toggleBenchFault('rings', 'break', count), false);
    motor.requestStart();
    for (let i = 0; i < 480; i++) motor.step(1 / 120, 0);
    assert.equal(motor.ignition, 'running');
    assert.ok(motor.rpm > 400);
    assert.equal(motor.toggleBenchFault('rings', 'break', count - 1), true);
    motor.requestStop();
    const restored = Engine.restore(JSON.parse(JSON.stringify(motor.snapshot())));
    assert.deepEqual(restored.build, spec);
    assert.equal(restored.cylinders.length, count);
    assert.equal(restored.exhaustPitchRatio, motor.exhaustPitchRatio);
    assert.equal(restored.crankImbalance, motor.crankImbalance);
    assert.equal(restored.cylinders[count - 1].contact.ringSeizures, 2);
    assert.deepEqual(restored.cylinders.map(c => c.susceptibility), motor.cylinders.map(c => c.susceptibility));
    assert.equal(restored.ignition, 'off');
    restored.requestStart();
    for (let i = 0; i < 480; i++) restored.step(1 / 120, 0);
    assert.equal(restored.ignition, 'running');
  });
}

test('displacement changes the shaft and chamber, seeded wear changes individual weak parts', () => {
  const spec = { cylinders: 2, litres: 1.2, wear: 0.6 };
  const small = new Engine(22, spec), big = new Engine(22, { ...spec, litres: 2.4 });
  assert.ok(big.shaftInertia > small.shaftInertia);
  assert.equal(big.clearanceLitres, 2 * small.clearanceLitres);
  const rings = engine => engine.cylinders.map(c => c.contact.rings);
  assert.deepEqual(rings(small), rings(new Engine(22, spec)));
  const other = new Engine(8341, spec);
  assert.notDeepEqual(rings(small), rings(other));
  assert.notEqual(small.exhaustPitchRatio, other.exhaustPitchRatio);
  assert.notEqual(small.crankImbalance, other.crankImbalance);
});

test('earlier v7 saves keep the stock two-litre four and existing damage', () => {
  const original = new Engine();
  original.toggleBenchFault('gasket', 'break', 2);
  const save = original.snapshot();
  delete save.build;
  const restored = Engine.restore(save);
  assert.deepEqual(restored.build, { cylinders: 4, litres: 2, wear: 0 });
  assert.equal(restored.cylinders[2].contact.headSeal, original.cylinders[2].contact.headSeal);
});
