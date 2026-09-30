/* Easing library: cubic-bezier presets + function-based "special" easings.
 * Pure JS, no host dependency (runs in UXP, browser, Node). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.LG = root.LG || {}).easing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- cubic bezier solver (CSS cubic-bezier semantics; y may leave 0..1) ----
  function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const X = (s) => ((ax * s + bx) * s + cx) * s;
    const Y = (s) => ((ay * s + by) * s + cy) * s;
    const dX = (s) => (3 * ax * s + 2 * bx) * s + cx;
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let s = x;
      for (let i = 0; i < 8; i++) {           // Newton
        const err = X(s) - x;
        if (Math.abs(err) < 1e-6) return Y(s);
        const d = dX(s);
        if (Math.abs(d) < 1e-6) break;
        s -= err / d;
      }
      let lo = 0, hi = 1; s = x;              // bisection fallback
      for (let i = 0; i < 40; i++) {
        const v = X(s);
        if (Math.abs(v - x) < 1e-6) break;
        if (v < x) lo = s; else hi = s;
        s = (lo + hi) / 2;
      }
      return Y(s);
    };
  }

  // ---- function easings ----
  function bounceOut(x) {
    const n1 = 7.5625, d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
    if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
    return n1 * (x -= 2.625 / d1) * x + 0.984375;
  }
  const bounceIn = (x) => 1 - bounceOut(1 - x);
  function elasticOut(x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
  }
  function elasticIn(x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    return -Math.pow(2, 10 * x - 10) * Math.sin((x * 10 - 10.75) * (2 * Math.PI / 3));
  }
  const FN = {
    'bounce-out': bounceOut, 'bounce-in': bounceIn,
    'elastic-out': elasticOut, 'elastic-in': elasticIn,
    'hold': (x) => (x >= 1 ? 1 : 0),
    'steps-5': (x) => Math.min(1, Math.floor(x * 5) / 4),
  };

  // ---- preset catalogue (groups mirror the panel: All / In / Out / Bounce / Special) ----
  const B = (label, group, p) => ({ label, group, ease: { kind: 'bezier', p } });
  const F = (label, group, name) => ({ label, group, ease: { kind: 'fn', name } });
  const PRESETS = [
    B('Linear', 'inout', [0, 0, 1, 1]),
    B('Ease', 'inout', [0.25, 0.1, 0.25, 1]),
    B('Ease In', 'in', [0.42, 0, 1, 1]),
    B('Ease Out', 'out', [0, 0, 0.58, 1]),
    B('Ease In-Out', 'inout', [0.42, 0, 0.58, 1]),
    B('Sine In', 'in', [0.12, 0, 0.39, 0]),
    B('Sine Out', 'out', [0.61, 1, 0.88, 1]),
    B('Sine In-Out', 'inout', [0.37, 0, 0.63, 1]),
    B('Cubic', 'inout', [0.65, 0, 0.35, 1]),
    B('Cubic In', 'in', [0.32, 0, 0.67, 0]),
    B('Cubic Out', 'out', [0.33, 1, 0.68, 1]),
    B('Quart In', 'in', [0.5, 0, 0.75, 0]),
    B('Quart Out', 'out', [0.25, 1, 0.5, 1]),
    B('Quart In-Out', 'inout', [0.76, 0, 0.24, 1]),
    B('Expo In', 'in', [0.7, 0, 0.84, 0]),
    B('Expo Out', 'out', [0.16, 1, 0.3, 1]),
    B('Expo In-Out', 'inout', [0.87, 0, 0.13, 1]),
    B('Circ In', 'in', [0.55, 0, 1, 0.45]),
    B('Circ Out', 'out', [0, 0.55, 0.45, 1]),
    B('Back In', 'in', [0.36, 0, 0.66, -0.56]),
    B('Back Out', 'out', [0.34, 1.56, 0.64, 1]),
    B('Back In-Out', 'inout', [0.68, -0.6, 0.32, 1.6]),
    F('Bounce In', 'bounce', 'bounce-in'),
    F('Bounce Out', 'bounce', 'bounce-out'),
    F('Elastic In', 'bounce', 'elastic-in'),
    F('Elastic Out', 'bounce', 'elastic-out'),
    F('Hold', 'special', 'hold'),
    F('Steps', 'special', 'steps-5'),
  ];
  const GROUPS = ['all', 'in', 'out', 'bounce', 'special', 'custom'];

  const LINEAR = { kind: 'bezier', p: [0, 0, 1, 1] };
  const cache = new Map();
  function evaluate(ease, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    if (ease.kind === 'fn') return (FN[ease.name] || FN['hold'])(x);
    const key = ease.p.join(',');
    let f = cache.get(key);
    if (!f) { f = cubicBezier.apply(null, ease.p); cache.set(key, f); }
    return f(x);
  }
  // (a,a,b,b) makes x(s)==y(s): the identity curve, whatever a and b are
  const isLinear = (e) => e.kind === 'bezier' && Math.abs(e.p[0] - e.p[1]) < 1e-6 && Math.abs(e.p[2] - e.p[3]) < 1e-6;
  const clone = (e) => JSON.parse(JSON.stringify(e));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  return { cubicBezier, evaluate, PRESETS, GROUPS, LINEAR, isLinear, clone, same };
});
