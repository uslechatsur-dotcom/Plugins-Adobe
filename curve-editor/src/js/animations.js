/* Procedural animations (Bounce, Elastic, Overshoot, Wiggle, Shake, Pulse, Spiral, Orbit).
 * Each returns a delta curve d(u), u∈[0,1], added on top of the property's base value.
 * Scalar animations return a number, 2D ones return [dx, dy]. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.LG = root.LG || {}).animations = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TAU = Math.PI * 2;

  // deterministic smooth noise (sum of seeded sines) in [-1, 1]
  function noise(seed) {
    const ph = [0, 1, 2].map((i) => Math.sin((seed + 1) * (i + 1) * 12.9898) * 43758.5453 % 1 * TAU);
    return (x) => (Math.sin(x * TAU + ph[0]) + 0.5 * Math.sin(x * TAU * 2.13 + ph[1]) + 0.25 * Math.sin(x * TAU * 4.37 + ph[2])) / 1.75;
  }
  const decay = (u, damping) => Math.exp(-(damping / 100) * 5 * u);

  const DEFS = [
    { id: 'bounce', label: 'Bounce', dims: 1, axis: 'y', hint: 'Drops onto the value and bounces to rest.',
      fn: (u, p) => -p.height * decay(u, p.damping) * Math.abs(Math.cos(Math.PI * p.cycles * u)) },
    { id: 'elastic', label: 'Elastic', dims: 1, axis: 'y', hint: 'Springs around the value and settles.',
      fn: (u, p) => p.height * decay(u, p.damping) * Math.cos(TAU * p.cycles * u) },
    { id: 'overshoot', label: 'Overshoot', dims: 1, axis: 'y', hint: 'Goes past the value once and comes back.',
      fn: (u, p) => p.height * Math.sin(Math.PI * u) * Math.pow(1 - u, p.damping / 50) },
    { id: 'wiggle', label: 'Wiggle', dims: 1, axis: 'y', hint: 'Smooth random drift.',
      make: (p) => { const n = noise(p.variation); return (u) => p.height * n(u * p.cycles / 2) * Math.sin(Math.PI * u) ** (p.damping / 50); } },
    { id: 'shake', label: 'Shake', dims: 1, axis: 'y', hint: 'Fast decaying jitter.',
      make: (p) => { const n = noise(p.variation); return (u) => p.height * decay(u, p.damping) * n(u * p.cycles * 4); } },
    { id: 'pulse', label: 'Pulse', dims: 1, axis: 'scale', hint: 'Rhythmic in/out pulse (scale, opacity…).',
      fn: (u, p) => p.height * decay(u, p.damping) * (0.5 - 0.5 * Math.cos(TAU * p.cycles * u)) },
    { id: 'spiral', label: 'Spiral', dims: 2, hint: 'Spirals in to the value.',
      fn: (u, p) => { const r = p.height * decay(u, p.damping) * (1 - u), a = TAU * p.cycles * u; return [r * Math.cos(a), r * Math.sin(a)]; } },
    { id: 'orbit', label: 'Orbit', dims: 2, hint: 'Circles around the value and returns.',
      fn: (u, p) => { const a = TAU * Math.round(p.cycles) * u; return [p.height * (Math.cos(a) - 1), p.height * Math.sin(a)]; } },
  ];

  const PARAMS = [
    { id: 'cycles', label: 'Cycles', min: 1, max: 12, step: 1, def: 4 },
    { id: 'heightPct', label: 'Height (%)', min: 0, max: 200, step: 1, def: 60 },
    { id: 'damping', label: 'Damping (%)', min: 0, max: 100, step: 1, def: 50 },
    { id: 'durationF', label: 'Duration (f)', min: 4, max: 120, step: 1, def: 24 },
    { id: 'variation', label: 'Variation', min: 0, max: 100, step: 1, def: 0 },
  ];
  const defaults = () => Object.fromEntries(PARAMS.map((p) => [p.id, p.def]));

  /* params: {cycles,heightPct,damping,durationF,variation}; ref = magnitude the % applies to. */
  function build(id, params, ref) {
    const d = DEFS.find((x) => x.id === id);
    if (!d) throw new Error('unknown animation ' + id);
    const p = Object.assign({}, params, { height: (params.heightPct / 100) * ref });
    const f = d.make ? d.make(p) : (u) => d.fn(u, p);
    return { def: d, at: (u) => f(u) };
  }

  /* Samples [{time, delta}] over durationF frames at fps (time in seconds from t0). */
  function sample(id, params, ref, fps, t0) {
    const a = build(id, params, ref);
    const n = Math.max(2, Math.round(params.durationF));
    const out = [];
    for (let i = 0; i <= n; i++) out.push({ time: t0 + i / fps, delta: a.at(i / n) });
    out[n].delta = a.def.dims === 2 ? [0, 0] : 0;   // always land exactly on the base value
    return out;
  }

  return { DEFS, PARAMS, defaults, build, sample };
});
