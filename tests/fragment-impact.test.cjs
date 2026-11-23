'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Engine, pistonGeometry, FRAGMENT_CAP } = require('../src/internals.js');
const h = 1 / 240;

function shot(kind, x, y, r, vx, vy) {
  const engine = new Engine();
  engine.rpm = 6390;
  engine.shaftSpeed = 36;
  engine.phase = Math.PI + engine.shaftSpeed * h;
  engine.oil = 0;
  engine.oilCircuit.setInventory(0);
  const f = engine.fragments, body = f.add(0, kind, 'case', x, y, r);
  Object.assign(body, {vx, vy});
  return {engine, f, body};
}

test('A moving journal catches a grazing crossing with no end overlap', () => {
  const next = pistonGeometry(Math.PI + 36 * h, 0, 373);
  const x = 373 - (850 * h + 373 - next.crankX) / 2, y = 522.1;
  const {engine, f, body} = shot('metal', x, y, 1.4, 850, 0);
  f.step(h, engine);
  assert.equal(f.impacts, 1);
  assert.ok(body.vy > 100);
  assert.ok(Math.hypot(body.x - next.crankX,body.y - next.crankY) >= 19.4);
  const miss = shot('metal', x, y + 1, 1.4, 850, 0);
  miss.f.step(h, miss.engine);
  assert.equal(miss.f.impacts, 0);
  assert.ok(miss.body.x > x);
});

test('A fast chip meets the entry face of a bearing cap and an outer wall', () => {
  const cap = shot('metal', 432.6, 447.55, 1.4, 0, 850);
  cap.f.step(h, cap.engine);
  assert.ok(cap.body.y + cap.body.r <= 449 && cap.body.vy < 0);
  assert.ok(Math.abs(cap.body.x - 432.6) < .1);
  const wall = shot('metal', 886, 520, 1.4, 850, 0);
  wall.f.step(h, wall.engine);
  assert.ok(wall.body.x + wall.body.r <= 890 && wall.body.vx < 0);
});

test('A hard strike frees a smaller shard, retaining mass and respecting the body cap', () => {
  const fast = shot('crown', 879, 532, 8, 850, 0);
  const mass = fast.body.mass;
  fast.f.step(h, fast.engine);
  const child = fast.f.bodies.find(p => p !== fast.body);
  assert.ok(child?.r < fast.body.r && child.vx < 0 && child.x < fast.body.x);
  assert.ok(Math.abs(fast.body.mass + child.mass - mass) < 1e-9);
  const save = Engine.restore(fast.engine.snapshot());
  assert.deepEqual(save.fragments.bodies.map(p => p.mass), fast.f.bodies.map(p => p.mass));
  const gentle = shot('crown', 881.9, 532, 8, 100, 0);
  gentle.f.step(h, gentle.engine);
  assert.equal(gentle.f.bodies.length, 1);
  assert.equal(gentle.body.r, 8);
  const crowd = shot('crown', 879, 532, 8, 850, 0);
  for (let i = 0; i < FRAGMENT_CAP - 1; i++) crowd.f.add(3, 'ring', 'chamber', 803, 247, 1.4);
  crowd.f.step(h, crowd.engine);
  assert.equal(crowd.f.bodies.length, FRAGMENT_CAP);
  assert.ok(crowd.f.dust > 0 && crowd.body.mass < mass);
});
