'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Engine, SPEC } = require('../src/internals.js');

function run(engine, seconds, gas = .5, brake = .05) {
  for (let i = 0; i < seconds * 120; i++) engine.step(1 / 120, gas, brake);
  return engine;
}
function warm() {
  const engine = new Engine();
  engine.setProfile('normal');
  engine.requestStart();
  return run(engine, 4, 0, 0).snapshot();
}

test('Independent bench faults branch from the same healthy run into different physical reactions', () => {
  const initial = warm();
  const control = run(Engine.restore(initial), 8);
  const scenarios = [
    ['pickup','clog', m => m.pressure < control.pressure * .4 && m.oilCircuit.q < control.oilCircuit.q],
    ['gasket','break', m => m.cylinders[1].compression < .6 && m.exhaust.coolantSteam > .13 && m.exhaust.ringOil < .02],
    ['rings','break', m => m.cylinders[1].compression < .8 && m.exhaust.ringOil > .12 && m.exhaust.coolantSteam < .02],
    ['waterPump','break', m => m.waterCircuit.q < control.waterCircuit.q * .5 && m.coolantLevel > .99],
    ['radiator','break', m => m.coolantLevel < .96 && m.radiatorRunoff > 0],
    ['pan','break', m => m.oil < initial.oil - .5 && m.caseLeakRate > 0],
    ['timing','skip', m => m.timingDrive.teethSkipped === 1 && m.timingDrive.torqueFactor < 1],
    ['exhaust','break', m => m.exhaust.leak > .04]
  ];
  for (const [part, action, response] of scenarios) {
    const engine = Engine.restore(initial);
    assert.ok(engine.disturb(part, action, 1), part);
    run(engine, 8);
    assert.ok(response(engine), part);
    assert.equal(engine.activeCount, 4, part);
    if (part === 'gasket' || part === 'rings') assert.ok(engine.cylinders[0].compression > .95, part);
  }
});

test('RPM, fuel, heat and rust feed into the live model and persist in a v7 save', () => {
  const initial = warm();
  const control = run(Engine.restore(initial), 9, .85);
  const bench = Engine.restore(initial);
  bench.setBenchValue('rpmLimit', 2800);
  bench.setBenchValue('corrosion', 84);
  bench.setBenchValue('oil', 1.4);
  bench.setBenchValue('coolantLevel', 4.1);
  bench.setBenchValue('oilTemp', 175);
  bench.setBenchValue('coolant', 122);
  assert.ok(Math.abs(bench.oilCircuit.total - 1.4) < 1e-9);
  assert.equal(bench.sensor.oil, 175);
  assert.equal(bench.sensor.coolant, 122);
  run(bench, 9, .85);
  assert.ok(bench.rpm < 2910 && bench.rpm > 1300);
  assert.ok(bench.oil < 1.41 && bench.oilTemp > control.oilTemp && bench.pressure < control.pressure);
  assert.ok(bench.waterCircuit.q < control.waterCircuit.q);
  assert.equal(bench.pistonSpeed, 2 * SPEC.stroke * .001 * bench.rpm / 60);
  bench.setBenchValue('fuel', 0);
  run(bench, 9, .85);
  assert.ok(bench.fuelOnReserve && bench.fuelDelivery < .06 && bench.engineLoad < .1);
  assert.equal(bench.ignition, 'running');
  const restored = Engine.restore(bench.snapshot());
  assert.equal(restored.fuel, 0);
  assert.equal(restored.corrosion, .84);
  assert.equal(restored.rpmLimit, 2800);
  assert.equal(Engine.restore(initial).fuel, initial.bench.fuel);
});

test('Selecting rods directly still protects the final cylinder and the fragments survive a reload', () => {
  const engine = Engine.restore(warm());
  for (const id of [2, 0, 3]) assert.ok(engine.disturb('rod','break',id));
  assert.ok(!engine.disturb('rod','break',1));
  assert.ok(!engine.disturb('rings','break',99));
  assert.equal(engine.activeCount, 1);
  const saved = Engine.restore(engine.snapshot());
  assert.equal(saved.activeCount, 1);
  assert.ok(saved.fragments.bodies.some(p => p.cylinder === 2));
  const firing = saved.cylinders[1].fired;
  run(saved, 8);
  assert.equal(saved.activeCount, 1);
  assert.ok(saved.cylinders[1].fired > firing);
});

test('Fault switches layer over real restrictions and resume their previous physical state when turned off', () => {
  const initial = warm();
  const engine = Engine.restore(initial);
  engine.oilCircuit.pickupClog = .17;
  assert.ok(engine.toggleBenchFault('pickup', 'clog', 0));
  assert.ok(engine.toggleBenchFault('jet', 'clog', 1));
  assert.ok(engine.toggleBenchFault('piston', 'heat', 1));
  assert.equal(engine.oilCircuit.jetRestriction(0), 0);
  const reloaded = Engine.restore(engine.snapshot());
  assert.equal(reloaded.oilCircuit.pickupRestriction, .94);
  assert.equal(reloaded.oilCircuit.jetRestriction(1), .92);
  const cool = run(Engine.restore(initial), 4, .6, .1);
  run(reloaded, 4, .6, .1);
  assert.ok(reloaded.cylinders[1].contact.skirtTemp > cool.cylinders[1].contact.skirtTemp + 35);
  assert.ok(reloaded.pressure < cool.pressure * .6);
  assert.ok(reloaded.toggleBenchFault('pickup', 'clog', 3));
  assert.equal(reloaded.oilCircuit.pickupRestriction, .17);
  assert.ok(reloaded.toggleBenchFault('piston', 'heat', 1));
  const peak = reloaded.cylinders[1].contact.skirtTemp;
  run(reloaded, 10, 0, 0);
  assert.ok(reloaded.cylinders[1].contact.skirtTemp < peak - 20);
  assert.equal(reloaded.oilCircuit.jetRestriction(1), .92);
});

test('Switching off one-time damage does not repair it or affect another cylinder', () => {
  const engine = Engine.restore(warm());
  assert.ok(engine.toggleBenchFault('rings', 'break', 2));
  assert.ok(engine.benchFaultOn('rings','break',2));
  assert.ok(!engine.benchFaultOn('rings','break',1));
  assert.ok(engine.toggleBenchFault('rings', 'break', 2));
  assert.equal(engine.cylinders[2].contact.ringSeizures, 2);
  assert.ok(engine.fragments.bodies.some(p => p.kind === 'ring' && p.cylinder === 2));
  assert.equal(engine.cylinders[1].contact.ringSeizures, 0);
});
