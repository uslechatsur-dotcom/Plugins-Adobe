const assert = require('assert');
const E = require('../src/js/easing'), S = require('../src/js/speed');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` ${a} vs ${b}`);
const lin = () => E.clone(E.LINEAR);
const FPS = 30;

t('constant speed: source time = clip time × speed', () => {
  const c = { base: 50, keys: [], segs: [] };
  near(S.stats(c, 4, FPS).sourceUsed, 2, 1e-6);
  near(S.stats({ base: 100, keys: [], segs: [] }, 4, FPS).avg, 100, 1e-6);
});
t('linear ramp 100→200 over 2s consumes 3s of media', () => {
  const c = { base: 100, keys: [{ time: 0, value: 100 }, { time: 2, value: 200 }], segs: [lin()] };
  near(S.stats(c, 2, FPS).sourceUsed, 3, 0.005); near(S.valueAt(c, 1), 150, 1e-9);
});
t('speed is held before the first and after the last key', () => {
  const c = { base: 100, keys: [{ time: 1, value: 200 }, { time: 2, value: 50 }], segs: [lin()] };
  assert.strictEqual(S.valueAt(c, 0), 200); assert.strictEqual(S.valueAt(c, 9), 50);
});
t('sourceAt interpolates the cumulative table', () => {
  const c = { base: 200, keys: [], segs: [] }, tab = S.cumulative(c, 3, FPS);
  near(S.sourceAt(tab, 1.5), 3, 1e-6); near(S.sourceAt(tab, 3), 6, 1e-6); near(S.sourceAt(tab, 99), 6, 1e-6); assert.strictEqual(S.sourceAt(tab, -1), 0);
});
t('splitAt keeps the curve identical (bezier and linear)', () => {
  const ease = E.PRESETS.find((p) => p.label === 'Ease In-Out').ease;
  const c = { base: 100, keys: [{ time: 0, value: 100 }, { time: 2, value: 300 }, { time: 3, value: 100 }], segs: [E.clone(ease), lin()] };
  for (const at of [0.4, 1, 1.7, 2.5]) {
    const s = S.splitAt(c, at);
    assert.strictEqual(s.keys.length, 4); assert.strictEqual(s.segs.length, 3);
    for (let x = 0; x <= 3; x += 0.05) near(S.valueAt(s, x), S.valueAt(c, x), 0.6, `at ${at} x=${x.toFixed(2)}`);
  }
  assert.strictEqual(S.splitAt(c, 2).keys.length, 3, 'existing key: no-op');
});
t('splitAt outside the key range extends with a hold', () => {
  const c = { base: 100, keys: [{ time: 1, value: 80 }, { time: 2, value: 120 }], segs: [lin()] };
  const a = S.splitAt(c, 0.5), b = S.splitAt(c, 3);
  assert.deepStrictEqual([a.keys[0], b.keys[2]], [{ time: 0.5, value: 80 }, { time: 3, value: 120 }]);
  assert.strictEqual(a.segs.length, 2); assert.strictEqual(b.segs.length, 2);
  assert.deepStrictEqual(S.splitAt({ base: 77, keys: [], segs: [] }, 2).keys, [{ time: 2, value: 77 }]);
});
t('hero ramp: dips to the target speed and leaves the rest untouched', () => {
  const base = { base: 100, keys: [], segs: [] }, p = { ...S.paramDefaults(), durationF: 60, speed: 25, ease: 40 };
  const r = S.applyRamp(base, S.RAMPS.find((x) => x.id === 'hero'), p, 2, 10, FPS);
  near(S.valueAt(r, 3), 25, 0.01, 'plateau'); near(S.valueAt(r, 1), 100, 1e-9); near(S.valueAt(r, 9), 100, 1e-9); near(S.valueAt(r, 2), 100, 1e-9);
  assert.strictEqual(r.segs.length, r.keys.length - 1);
  assert.ok(r.keys.length < 30, 'reduced: ' + r.keys.length);
  assert.ok(S.stats(r, 10, FPS).sourceUsed < 10, 'slow-mo consumes less media');
});
t('ramps compose with existing keys (multiplicative) and preserve outside shape', () => {
  const c = { base: 100, keys: [{ time: 0, value: 100 }, { time: 10, value: 200 }], segs: [lin()] };
  const r = S.applyRamp(c, S.RAMPS[0], { ...S.paramDefaults(), durationF: 30, speed: 50, ease: 40 }, 4, 10, FPS);
  near(S.valueAt(r, 2), S.valueAt(c, 2), 0.01); near(S.valueAt(r, 8), S.valueAt(c, 8), 0.01);
  near(S.valueAt(r, 4.5), S.valueAt(c, 4.5) * 0.5, 1.5, 'plateau is half of the underlying speed');
  assert.ok(r.keys.every((k, i) => i === 0 || k.time > r.keys[i - 1].time), 'keys strictly increasing');
});
t('ramp-to-speed holds until the end of the clip', () => {
  const r = S.applyRamp({ base: 100, keys: [], segs: [] }, S.RAMPS.find((x) => x.id === 'rampTo'), { ...S.paramDefaults(), durationF: 30, speedUp: 300 }, 1, 6, FPS);
  near(S.valueAt(r, 2.2), 300, 1); near(S.valueAt(r, 6), 300, 1); near(S.valueAt(r, 0.5), 100, 1e-9);
});
t('freeze stops the clip, rewind reverses it', () => {
  const fr = S.applyRamp({ base: 100, keys: [], segs: [] }, S.RAMPS.find((x) => x.id === 'freeze'), { ...S.paramDefaults(), durationF: 30, ease: 20 }, 1, 5, FPS);
  assert.ok(S.valueAt(fr, 1.5) < 1, 'frozen');
  const rw = S.applyRamp({ base: 100, keys: [], segs: [] }, S.RAMPS.find((x) => x.id === 'rewind'), { ...S.paramDefaults(), durationF: 30, reverse: 100, ease: 20 }, 1, 5, FPS);
  assert.ok(S.valueAt(rw, 1.5) < -90, 'reverse: ' + S.valueAt(rw, 1.5));
});
t('every ramp keeps keys ordered, finite and clamped', () => S.RAMPS.forEach((d) => {
  const r = S.applyRamp({ base: 100, keys: [], segs: [] }, d, S.paramDefaults(), 0.5, 4, FPS);
  r.keys.forEach((k, i) => { assert.ok(Number.isFinite(k.value) && k.value >= -1000 && k.value <= 10000, d.id); if (i) assert.ok(k.time > r.keys[i - 1].time, d.id); });
  assert.strictEqual(r.segs.length, Math.max(0, r.keys.length - 1), d.id);
}));
t('ramp past the clip end is clipped to the clip', () => {
  const r = S.applyRamp({ base: 100, keys: [], segs: [] }, S.RAMPS[0], { ...S.paramDefaults(), durationF: 200 }, 3, 4, FPS);
  assert.ok(r.keys.every((k) => k.time <= 4 + 1e-9));
});
t('lock source length rescales speeds to keep the out-point', () => {
  const c = { base: 100, keys: [{ time: 0, value: 100 }, { time: 2, value: 50 }, { time: 4, value: 200 }], segs: [lin(), lin()] };
  const target = 4, r = S.rescaleToSource(c, 4, FPS, target);
  near(S.stats(r, 4, FPS).sourceUsed, target, 0.005);
});
t('bakeForHost: dense but reduced, endpoints exact, values rounded', () => {
  const c = { base: 100, keys: [{ time: 0, value: 100 }, { time: 2, value: 300 }], segs: [E.PRESETS.find((p) => p.label === 'Cubic Out').ease] };
  const k = S.bakeForHost(c, FPS);
  assert.ok(k.length > 4 && k.length < 61); assert.deepStrictEqual([k[0], k.at(-1)], [{ time: 0, value: 100 }, { time: 2, value: 300 }]);
  assert.strictEqual(S.bakeForHost({ base: 100, keys: [], segs: [] }, FPS).length, 0);
});
t('unit detection: percent vs factor', () => {
  assert.strictEqual(S.detectUnit(100, []), 'percent'); assert.strictEqual(S.detectUnit(1, []), 'factor');
  assert.strictEqual(S.detectUnit(1, [{ time: 0, value: 1 }, { time: 1, value: 2.5 }]), 'factor');
  assert.strictEqual(S.detectUnit(1, [{ time: 0, value: 100 }, { time: 1, value: 250 }]), 'percent');
  assert.strictEqual(S.toHost(150, 'factor'), 1.5); assert.strictEqual(S.fromHost(1.5, 'factor'), 150); assert.strictEqual(S.toHost(150, 'percent'), 150);
});
console.log(n + ' speed engine tests passed');
