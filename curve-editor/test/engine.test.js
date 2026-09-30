const assert = require('assert');
const E = require('../src/js/easing');
const K = require('../src/js/bake');
const A = require('../src/js/animations');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('all presets hit 0 and 1', () => E.PRESETS.forEach((p) => {
  assert.ok(Math.abs(E.evaluate(p.ease, 0)) < 1e-9, p.label);
  assert.ok(Math.abs(E.evaluate(p.ease, 1) - 1) < 1e-9, p.label);
}));
t('linear is identity', () => assert.ok(Math.abs(E.evaluate(E.LINEAR, 0.37) - 0.37) < 1e-4));
t('ease-in-out symmetric', () => { const e = E.PRESETS.find((p) => p.label === 'Ease In-Out').ease;
  assert.ok(Math.abs(E.evaluate(e, 0.5) - 0.5) < 1e-3); assert.ok(E.evaluate(e, 0.2) < 0.2); });
t('back-out overshoots', () => { const e = E.PRESETS.find((p) => p.label === 'Back Out').ease;
  assert.ok(Math.max(...Array.from({ length: 50 }, (_, i) => E.evaluate(e, i / 49))) > 1.05); });
t('bake linear = 2 keys', () => assert.strictEqual(K.bakeSegment({ time: 0, value: 0 }, { time: 1, value: 10 }, E.LINEAR, 30).length, 2));
t('bake ease-out: reduced but faithful', () => {
  const e = E.PRESETS.find((p) => p.label === 'Cubic Out').ease;
  const ks = K.bakeSegment({ time: 0, value: 0 }, { time: 2, value: 100 }, e, 30);
  assert.ok(ks.length > 3 && ks.length < 61, 'len ' + ks.length);
  assert.deepStrictEqual([ks[0].time, ks[ks.length - 1].time], [0, 2]);
  assert.strictEqual(ks[ks.length - 1].value, 100);
  // linear interpolation between baked keys stays within 1% of the true curve
  for (let x = 0; x <= 1; x += 0.01) {
    const time = x * 2; let i = 0; while (ks[i + 1].time < time) i++;
    const k = (time - ks[i].time) / (ks[i + 1].time - ks[i].time);
    assert.ok(Math.abs(K.lerp(ks[i].value, ks[i + 1].value, k) - 100 * E.evaluate(e, x)) < 1.0);
  }
});
t('bake 2D values', () => { const ks = K.bakeSegment({ time: 0, value: [0, 0] }, { time: 1, value: [100, 50] }, E.PRESETS[3].ease, 30);
  assert.deepStrictEqual(ks[ks.length - 1].value, [100, 50]); });
t('bakeChannel joins segments without duplicates', () => {
  const ks = K.bakeChannel([{ time: 0, value: 0 }, { time: 1, value: 1 }, { time: 2, value: 0 }], [E.PRESETS[1].ease, E.PRESETS[4].ease], 30);
  const times = ks.map((k) => k.time); assert.deepStrictEqual(times, [...new Set(times)].sort((a, b) => a - b)); });
t('every animation lands on base and is finite', () => A.DEFS.forEach((d) => {
  const s = A.sample(d.id, A.defaults(), 100, 30, 5);
  const last = s[s.length - 1].delta;
  assert.deepStrictEqual(last, d.dims === 2 ? [0, 0] : 0, d.id);
  s.forEach((p) => [].concat(p.delta).forEach((v) => assert.ok(Number.isFinite(v), d.id)));
  assert.ok(s.some((p) => [].concat(p.delta).some((v) => Math.abs(v) > 1)), d.id + ' moves');
}));
t('bounce starts at height and stays one-sided', () => { const a = A.build('bounce', { ...A.defaults() }, 100);
  assert.ok(Math.abs(a.at(0) + 60) < 1e-9); for (let u = 0; u <= 1; u += 0.01) assert.ok(a.at(u) <= 1e-9); });
t('wiggle deterministic per variation', () => { const p = A.defaults();
  assert.strictEqual(A.build('wiggle', p, 100).at(0.3), A.build('wiggle', p, 100).at(0.3)); });
console.log(n + ' tests passed');
