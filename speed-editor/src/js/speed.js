/* Speed-curve engine (pure JS, no host dependency).
 *
 * Premiere's "Time Remapping > Speed" is a keyframed percentage over clip time. What the viewer sees is the
 * SOURCE time, i.e. the integral of the speed:   source(t) = ∫0..t speed(τ)/100 dτ
 * So the editor works on two linked curves: speed(t) (edited) and source(t) (derived).
 *
 * curve = { base, keys:[{time,value}], segs:[ease] }   time in seconds (clip-local), value in percent.
 * With no keys the speed is the constant `base`. segs[i] eases between keys[i] and keys[i+1] (see easing.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./easing'), require('./bake'));
  else (root.LG = root.LG || {}).speed = factory(root.LG.easing, root.LG.bake);
})(typeof self !== 'undefined' ? self : this, function (E, K) {
  'use strict';
  const SPEED_MIN = -1000, SPEED_MAX = 10000;           // sanity clamp (percent)
  const clampSpeed = (v) => Math.min(SPEED_MAX, Math.max(SPEED_MIN, v));
  const clone = (c) => JSON.parse(JSON.stringify(c));
  const EPS = 1e-9;

  function valueAt(c, t) {
    const ks = c.keys;
    if (!ks.length) return c.base;
    if (t <= ks[0].time) return ks[0].value;
    if (t >= ks[ks.length - 1].time) return ks[ks.length - 1].value;
    let i = 0; while (ks[i + 1].time < t) i++;
    const x = (t - ks[i].time) / (ks[i + 1].time - ks[i].time);
    return ks[i].value + (ks[i + 1].value - ks[i].value) * E.evaluate(c.segs[i], x);
  }

  /* Cumulative source seconds on a fine grid (4 steps per frame, trapezoid rule). */
  function cumulative(c, D, fps) {
    const dt = 1 / (fps * 4), n = Math.max(1, Math.ceil(D / dt)), src = new Float64Array(n + 1);
    let prev = valueAt(c, 0) / 100;
    for (let i = 1; i <= n; i++) {
      const t = Math.min(D, i * dt), cur = valueAt(c, t) / 100;
      src[i] = src[i - 1] + ((prev + cur) / 2) * (t - Math.min(D, (i - 1) * dt));
      prev = cur;
    }
    return { dt, n, D, src };
  }
  function sourceAt(tab, t) {
    if (t <= 0) return 0;
    const x = Math.min(tab.n, t / tab.dt), i = Math.min(tab.n - 1, Math.floor(x));
    return tab.src[i] + (tab.src[i + 1] - tab.src[i]) * (x - i);
  }

  function stats(c, D, fps) {
    const tab = cumulative(c, D, fps), n = Math.max(1, Math.round(D * fps));
    let min = Infinity, max = -Infinity;
    for (let i = 0; i <= n; i++) { const v = valueAt(c, Math.min(D, i / fps)); min = Math.min(min, v); max = Math.max(max, v); }
    const used = tab.src[tab.n];
    return { min, max, sourceUsed: used, avg: D > 0 ? (used / D) * 100 : 100, tab };
  }

  /* Insert a key at t without changing the curve (de Casteljau split for bezier easings). */
  function splitAt(c, t) {
    const out = clone(c), ks = out.keys;
    if (!ks.length) { out.keys = [{ time: t, value: c.base }]; out.segs = []; return out; }
    if (t <= ks[0].time + EPS) {
      if (Math.abs(t - ks[0].time) < EPS) return out;
      ks.unshift({ time: t, value: ks[0].value }); out.segs.unshift(E.clone(E.LINEAR)); return out;
    }
    if (t >= ks[ks.length - 1].time - EPS) {
      if (Math.abs(t - ks[ks.length - 1].time) < EPS) return out;
      ks.push({ time: t, value: ks[ks.length - 1].value }); out.segs.push(E.clone(E.LINEAR)); return out;
    }
    let i = 0; while (ks[i + 1].time <= t + EPS) i++;
    if (Math.abs(ks[i].time - t) < EPS) return out;
    const a = ks[i], b = ks[i + 1], x = (t - a.time) / (b.time - a.time), e = out.segs[i];
    const v = valueAt(c, t);
    let left = E.clone(E.LINEAR), right = E.clone(E.LINEAR);
    if (e.kind === 'bezier') {
      const [x1, y1, x2, y2] = e.p;
      const bx = (s) => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
      let lo = 0, hi = 1, s = x; for (let n = 0; n < 40; n++) { s = (lo + hi) / 2; bx(s) < x ? (lo = s) : (hi = s); }
      const L = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
      const P1 = [x1, y1], P2 = [x2, y2], A1 = L([0, 0], P1, s), B1 = L(P1, P2, s), C1 = L(P2, [1, 1], s), A2 = L(A1, B1, s), B2 = L(B1, C1, s), M = L(A2, B2, s);
      const rel = (pt, o, sx, sy) => [(pt[0] - o[0]) / sx, (pt[1] - o[1]) / sy];
      if (M[0] > 1e-6 && 1 - M[0] > 1e-6 && Math.abs(M[1]) > 1e-6 && Math.abs(1 - M[1]) > 1e-6) {
        left = { kind: 'bezier', p: [...rel(A1, [0, 0], M[0], M[1]), ...rel(A2, [0, 0], M[0], M[1])] };
        right = { kind: 'bezier', p: [...rel(B2, M, 1 - M[0], 1 - M[1]), ...rel(C1, M, 1 - M[0], 1 - M[1])] };
      }
    }
    ks.splice(i + 1, 0, { time: t, value: v });
    out.segs.splice(i, 1, left, right);
    return out;
  }

  // ------------------------------------------------------------------ ramps (multiplicative speed shapes)
  const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  /* plateau with smooth edges: 0 → 1 over the first `e` of the window, 1 until 1-e, back to 0 */
  const bump = (u, e) => (e <= 0 ? 1 : u < e ? smooth(u / e) : u > 1 - e ? smooth((1 - u) / e) : 1);

  const RAMPS = [
    { id: 'hero', label: 'Hero time', hint: 'Slow-motion dip, then back to normal speed.', params: ['durationF', 'speed', 'ease'],
      factor: (p) => (u) => 1 - (1 - p.speed / 100) * bump(u, p.ease / 200) },
    { id: 'burst', label: 'Speed burst', hint: 'Fast pass between two normal-speed moments.', params: ['durationF', 'speedUp', 'ease'],
      factor: (p) => (u) => 1 + (p.speedUp / 100 - 1) * bump(u, p.ease / 200) },
    { id: 'rampTo', label: 'Ramp to speed', hint: 'Smoothly change speed and keep it (to the end of the clip).', params: ['durationF', 'speedUp', 'ease'], hold: true,
      factor: (p) => (u) => 1 + (p.speedUp / 100 - 1) * smooth(u) },
    { id: 'freeze', label: 'Freeze frame', hint: 'Stops on a frame (speed → 0) then resumes.', params: ['durationF', 'ease'],
      factor: (p) => (u) => 1 - bump(u, p.ease / 200) * 0.999 },
    { id: 'pulse', label: 'Beat pulse', hint: 'Rhythmic slow / fast pulses.', params: ['durationF', 'speed', 'cycles'],
      factor: (p) => (u) => 1 - (1 - p.speed / 100) * (0.5 - 0.5 * Math.cos(2 * Math.PI * Math.round(p.cycles) * u)) * Math.sin(Math.PI * u) ** 0.35 },
    { id: 'rewind', label: 'Rewind', hint: 'Plays backwards for a moment, then forward again.', params: ['durationF', 'reverse', 'ease'],
      factor: (p) => (u) => 1 - (1 + p.reverse / 100) * bump(u, p.ease / 200) },
  ];
  const PARAMS = {
    durationF: { label: 'Duration (frames)', min: 4, max: 240, step: 1, def: 36 },
    speed: { label: 'Slow speed (%)', min: 1, max: 100, step: 1, def: 25 },
    speedUp: { label: 'Target speed (%)', min: 101, max: 1000, step: 1, def: 300 },
    ease: { label: 'Ease (%)', min: 0, max: 100, step: 1, def: 60 },
    cycles: { label: 'Pulses', min: 1, max: 8, step: 1, def: 3 },
    reverse: { label: 'Reverse speed (%)', min: 10, max: 400, step: 1, def: 100 },
  };
  const paramDefaults = () => Object.fromEntries(Object.entries(PARAMS).map(([k, v]) => [k, v.def]));

  /* Apply a ramp starting at t0 (clip-local seconds). Existing keys outside the window are untouched; the
   * window is re-baked as speed(t) = existing(t) × factor(u), then reduced to as few keys as the shape allows. */
  function applyRamp(c, def, params, t0, D, fps) {
    const tStart = Math.min(D, Math.max(0, Math.round(t0 * fps) / fps));
    const t1 = Math.min(D, tStart + params.durationF / fps);
    const end = def.hold ? D : t1;
    if (end - tStart < 1 / fps / 2) return clone(c);
    const f = def.factor(params);
    const cc = splitAt(splitAt(c, tStart), end);
    const before = cc.keys.filter((k) => k.time < tStart - EPS);
    const after = cc.keys.filter((k) => k.time > end + EPS);
    const iEnd = cc.keys.findIndex((k) => Math.abs(k.time - end) < EPS);
    const pts = [];
    const n = Math.max(1, Math.round((end - tStart) * fps));
    for (let i = 0; i <= n; i++) {
      const t = i === n ? end : tStart + i / fps;
      const u = t >= t1 - EPS ? 1 : (t - tStart) / (t1 - tStart);
      pts.push({ t, y: clampSpeed(valueAt(cc, t) * f(Math.min(1, u))) });
    }
    const range = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    const kept = K.reduce(pts, Math.max(0.4, range * 0.004));
    const keys = [...before, ...kept.map((p) => ({ time: p.t, value: p.y })), ...after];
    const segs = [...cc.segs.slice(0, before.length), ...kept.slice(1).map(() => E.clone(E.LINEAR)), ...(after.length ? cc.segs.slice(iEnd) : [])];
    return { base: c.base, keys, segs };
  }

  /* Scale every speed so the clip consumes exactly `targetSource` seconds of media (keeps the source out-point). */
  function rescaleToSource(c, D, fps, targetSource) {
    const cur = cumulative(c, D, fps).src.at(-1);
    if (!(cur > 1e-6) || !(targetSource > 0)) return clone(c);
    const k = targetSource / cur, out = clone(c);
    out.base = clampSpeed(out.base * k); out.keys.forEach((q) => { q.value = clampSpeed(q.value * k); });
    return out;
  }

  /* Keys to write to the host: eased segments baked into dense linear keyframes, values rounded to 0.01%. */
  function bakeForHost(c, fps) {
    if (!c.keys.length) return [];
    return K.bakeChannel(c.keys, c.segs, fps, { tolerance: 0.003 }).map((k) => ({ time: k.time, value: Math.round(clampSpeed(k.value) * 100) / 100 }));
  }

  /* percent <-> host unit ('percent': 100 = normal, 'factor': 1 = normal) */
  const toHost = (pct, unit) => (unit === 'factor' ? pct / 100 : pct);
  const fromHost = (v, unit) => (unit === 'factor' ? v * 100 : v);
  function detectUnit(value, keys) {
    const vals = keys.length ? keys.map((k) => k.value) : [value];
    const max = Math.max(...vals.map(Math.abs));
    if (!keys.length) return Math.abs(value - 1) < 0.02 ? 'factor' : 'percent';
    if (max > 12) return 'percent';
    return vals.some((v) => Math.abs(v - 1) < 0.02) ? 'factor' : 'percent';
  }

  return { valueAt, cumulative, sourceAt, stats, splitAt, RAMPS, PARAMS, paramDefaults, applyRamp, rescaleToSource, bakeForHost, toHost, fromHost, detectUnit, clampSpeed, bump, smooth };
});
