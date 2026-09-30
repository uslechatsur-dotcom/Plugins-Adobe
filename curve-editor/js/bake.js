/* Curve model + baking.
 * Premiere's UXP API cannot set bezier handles, so an eased segment is written
 * as a run of dense keyframes (adaptively reduced). Values are number or [x,y]. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./easing'));
  else (root.LG = root.LG || {}).bake = factory(root.LG.easing);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const isVec = (v) => Array.isArray(v);
  const lerp = (a, b, k) => (isVec(a) ? a.map((x, i) => x + (b[i] - x) * k) : a + (b - a) * k);
  const add = (a, b) => (isVec(a) ? a.map((x, i) => x + b[i]) : a + b);

  /* Ramer–Douglas–Peucker on a normalized 1-D signal: keep points that deviate
   * more than eps from the straight line between their neighbours. */
  function reduce(points, eps) {
    if (points.length < 3) return points.slice();
    const keep = new Array(points.length).fill(false);
    keep[0] = keep[points.length - 1] = true;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let worst = -1, wi = -1;
      for (let i = a + 1; i < b; i++) {
        const k = (points[i].t - points[a].t) / (points[b].t - points[a].t);
        const d = Math.abs(points[a].y + (points[b].y - points[a].y) * k - points[i].y);
        if (d > worst) { worst = d; wi = i; }
      }
      if (worst > eps && wi > 0) { keep[wi] = true; stack.push([a, wi], [wi, b]); }
    }
    return points.filter((_, i) => keep[i]);
  }

  /* Bake one segment A→B with an easing into [{time,value}], endpoints included. */
  function bakeSegment(a, b, ease, fps, opts) {
    const eps = (opts && opts.tolerance) || 0.004;
    if (E.isLinear(ease) || b.time <= a.time) return [{ time: a.time, value: a.value }, { time: b.time, value: b.value }];
    const step = 1 / fps;
    const n = Math.max(1, Math.round((b.time - a.time) / step));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push({ t, y: E.evaluate(ease, t) });
    }
    return reduce(pts, eps).map((p) => ({
      time: a.time + p.t * (b.time - a.time),
      value: lerp(a.value, b.value, p.y),
    }));
  }

  /* Bake a whole channel. keys: [{time,value}], segs: [ease] (keys.length-1 items). */
  function bakeChannel(keys, segs, fps, opts) {
    const out = [];
    for (let i = 0; i < keys.length - 1; i++) {
      const seg = bakeSegment(keys[i], keys[i + 1], segs[i] || E.LINEAR, fps, opts);
      if (i > 0) seg.shift();
      out.push(...seg);
    }
    if (keys.length === 1) out.push({ time: keys[0].time, value: keys[0].value });
    return out;
  }

  /* Sample a channel's curve normalized for display: [{time, value}] on a regular grid. */
  function sampleChannel(keys, segs, count) {
    const out = [];
    if (keys.length < 2) return out;
    const t0 = keys[0].time, t1 = keys[keys.length - 1].time;
    let seg = 0;
    for (let i = 0; i <= count; i++) {
      const t = t0 + ((t1 - t0) * i) / count;
      while (seg < keys.length - 2 && t > keys[seg + 1].time) seg++;
      const a = keys[seg], b = keys[seg + 1];
      const x = b.time === a.time ? 1 : (t - a.time) / (b.time - a.time);
      out.push({ time: t, value: lerp(a.value, b.value, E.evaluate(segs[seg] || E.LINEAR, x)) });
    }
    return out;
  }

  return { bakeSegment, bakeChannel, sampleChannel, reduce, lerp, add, isVec };
});
