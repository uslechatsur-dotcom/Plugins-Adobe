/* Speed Curves panel: edit Premiere's Time Remapping > Speed keyframes, with a cursor locked to the timeline playhead. */
(function () {
  'use strict';
  const { easing: E, bake: K, speed: SP, host: H } = window.LG;
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const TAU = Math.PI * 2;
  const C_SPEED = '#8b9bff', C_SRC = '#52d1b2', C_UP = '#52d1b2', C_DOWN = '#f5a94a';
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
  const now = () => performance.now();

  const S = {
    host: H.detect(), fps: 30, D: 1, clip: '', how: '', sig: null,
    start: 0, end: 1, inPoint: 0, node: null,
    prop: null, candidates: [], prefer: null,
    unit: 'auto', timeBase: 'start',
    curve: { base: 100, keys: [], segs: [] }, baked: null, origSource: null,
    phAbs: 0, ph: 0, phSeen: 0, view: { t0: 0, t1: 1 }, sel: new Set(),
    tab: 'speed', group: 'all', strength: 100, live: true, follow: true,
    undo: [], redo: [], custom: [], error: '', busy: false,
    ramp: { id: 'hero', params: SP.paramDefaults(), hold: false },
    stats: null, tab_: null,
  };
  try { S.custom = JSON.parse(localStorage.getItem('sc.custom') || '[]'); } catch (_) { S.custom = []; }

  // ------------------------------------------------------------------ icons
  const ICONS = {
    refresh: (g) => { g.beginPath(); g.arc(12, 12, 7, 0.7, 5.4); g.stroke(); g.beginPath(); g.moveTo(16.4, 2.8); g.lineTo(16.6, 7.6); g.lineTo(11.8, 7.4); g.stroke(); },
    fit: (g) => { [[4, 9, 4, 4, 9, 4], [15, 4, 20, 4, 20, 9], [20, 15, 20, 20, 15, 20], [9, 20, 4, 20, 4, 15]].forEach((p) => { g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[2], p[3]); g.lineTo(p[4], p[5]); g.stroke(); }); },
    target: (g) => { g.beginPath(); g.arc(12, 12, 6.5, 0, TAU); g.stroke(); g.beginPath(); g.arc(12, 12, 1.6, 0, TAU); g.fill(); [[12, 2, 12, 6], [12, 18, 12, 22], [2, 12, 6, 12], [18, 12, 22, 12]].forEach((p) => { g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[2], p[3]); g.stroke(); }); },
    keyadd: (g) => { g.beginPath(); g.moveTo(10, 4); g.lineTo(17, 11); g.lineTo(10, 18); g.lineTo(3, 11); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(19, 3); g.lineTo(19, 9); g.moveTo(16, 6); g.lineTo(22, 6); g.stroke(); },
    trash: (g) => { g.beginPath(); g.moveTo(4.5, 7); g.lineTo(19.5, 7); g.moveTo(9.5, 7); g.lineTo(9.5, 4); g.lineTo(14.5, 4); g.lineTo(14.5, 7); g.moveTo(6.5, 7); g.lineTo(7.5, 20); g.lineTo(16.5, 20); g.lineTo(17.5, 7); g.stroke(); },
    star: (g) => { g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 4.6 : 9.6, a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(12 + r * Math.cos(a), 12.6 + r * Math.sin(a)); } g.closePath(); g.stroke(); },
    undo: (g) => { g.beginPath(); g.moveTo(9, 6); g.lineTo(4, 11); g.lineTo(9, 16); g.moveTo(4, 11); g.lineTo(14, 11); g.bezierCurveTo(19, 11, 20.5, 14.5, 20, 19); g.stroke(); },
    redo: (g) => { g.beginPath(); g.moveTo(15, 6); g.lineTo(20, 11); g.lineTo(15, 16); g.moveTo(20, 11); g.lineTo(10, 11); g.bezierCurveTo(5, 11, 3.5, 14.5, 4, 19); g.stroke(); },
    logo: (g) => {
      const gr = g.createLinearGradient(0, 0, 24, 24); gr.addColorStop(0, '#f5a94a'); gr.addColorStop(1, '#f472b6');
      g.fillStyle = gr; g.beginPath(); g.moveTo(6, 0.5); g.lineTo(18, 0.5); g.quadraticCurveTo(23.5, 0.5, 23.5, 6); g.lineTo(23.5, 18); g.quadraticCurveTo(23.5, 23.5, 18, 23.5); g.lineTo(6, 23.5); g.quadraticCurveTo(0.5, 23.5, 0.5, 18); g.lineTo(0.5, 6); g.quadraticCurveTo(0.5, 0.5, 6, 0.5); g.fill();
      g.strokeStyle = '#1a0f14'; g.lineWidth = 2.4; g.lineJoin = 'round'; g.beginPath(); g.moveTo(3.5, 17.5); g.lineTo(8.5, 17.5); g.bezierCurveTo(12.5, 17.5, 11.5, 6.5, 15.5, 6.5); g.lineTo(20.5, 6.5); g.stroke();
      g.fillStyle = '#1a0f14'; [[8.5, 17.5], [15.5, 6.5]].forEach((p) => { g.beginPath(); g.arc(p[0], p[1], 2.1, 0, TAU); g.fill(); });
    },
  };
  function drawIcon(cv) {
    const size = cv.classList.contains('logo') ? 22 : 16, dpr = window.devicePixelRatio || 1;
    cv.width = size * dpr; cv.height = size * dpr;
    const g = cv.getContext('2d'); g.scale((size * dpr) / 24, (size * dpr) / 24);
    g.lineWidth = 1.9; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = css('--text'); g.fillStyle = css('--text');
    ICONS[cv.dataset.ico](g);
  }

  // ------------------------------------------------------------------ helpers
  const fmtTC = (t) => { const fr = Math.round(S.fps), f = Math.round(Math.abs(t) * S.fps), m = Math.floor(f / fr / 60), s = Math.floor(f / fr) % 60; return (t < 0 ? '-' : '') + m + ':' + String(s).padStart(2, '0') + ':' + String(f % fr).padStart(2, '0'); };
  const fmtPct = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)) + '%';
  const unit = () => (S.unit === 'auto' ? S.unitRes || 'percent' : S.unit);
  const T0 = () => (S.timeBase === 'inpoint' ? S.inPoint : 0);       // host key time = clip-relative time + T0
  function status(msg, kind) { $('#status-text').textContent = msg; $('#status').className = kind || ''; }
  const HINTS = {
    speed: 'Drag keys: time & speed (Alt: speed only · Ctrl: time only) · Drag the ruler: move Premiere\'s playhead · Wheel: zoom · F: fit · ←→↑↓: nudge',
    keys: 'Type exact frames and speeds · click a row to select the key in the graph',
    ramps: 'Pick a ramp, tune it, then apply it at the playhead',
    setup: 'Time base, unit and diagnostics',
  };
  const stats = () => (S.stats && S.stats.rev === S.rev ? S.stats : (S.stats = Object.assign(SP.stats(S.curve, S.D, S.fps), { rev: S.rev })));
  S.rev = 0;
  const touch = () => { S.rev++; S.stats = null; };

  // ------------------------------------------------------------------ history
  const snap = () => JSON.stringify(S.curve);
  function pushUndo() { S.undo.push(snap()); if (S.undo.length > 100) S.undo.shift(); S.redo = []; }
  function undo() { if (!S.undo.length) return; S.redo.push(snap()); S.curve = JSON.parse(S.undo.pop()); S.sel.clear(); touch(); markDirty(true); renderAll(); }
  function redo() { if (!S.redo.length) return; S.undo.push(snap()); S.curve = JSON.parse(S.redo.pop()); S.sel.clear(); touch(); markDirty(true); renderAll(); }

  // ------------------------------------------------------------------ host sync
  const nearKeys = (a, b) => a.length === b.length && a.every((k, i) => Math.abs(k.time - b[i].time) < 2e-3 && Math.abs(k.value - b[i].value) < 0.06);

  async function scan(opts) {
    opts = opts || {};
    S.busy = true;
    try {
      const r = await S.host.scan(S.prefer ? { prefer: S.prefer } : {});
      S.fps = r.fps || 30; S.clip = r.clip; S.how = r.how; S.sig = r.sig; S.node = r.node;
      S.start = r.start; S.end = r.end; S.inPoint = r.inPoint || 0; S.D = Math.max(1 / S.fps, r.end - r.start);
      S.candidates = r.candidates || []; S.prop = r.speed; S.error = '';
      if (r.speed) {
        const sp = r.speed;
        S.unitRes = SP.detectUnit(sp.value, sp.keys);
        const u = unit(), t0 = T0();
        const scanned = sp.keys.map((k) => ({ time: k.time - t0, value: SP.fromHost(k.value, u) }));
        const keepable = S.baked && nearKeys(S.baked, scanned);
        if (!keepable) {
          S.curve = { base: SP.fromHost(sp.value, u), keys: scanned, segs: scanned.slice(1).map(() => E.clone(E.LINEAR)) };
          S.baked = null;
          if (!opts.quiet) S.sel.clear();
        }
        if (S.node !== S.origNode) { S.origNode = S.node; S.origSource = null; }   // new clip: forget the old source baseline
        S.sel = new Set([...S.sel].filter((i) => i < S.curve.keys.length));
        touch();
        if (S.origSource == null) S.origSource = SP.stats(S.curve, S.D, S.fps).sourceUsed;
        if (!opts.quiet) { fitView(); status(`“${S.clip}” · ${sp.label}${sp.tv ? ` · ${sp.keys.length} keyframes` : ' · no keyframes yet'}${S.how === 'playhead' ? ' · clip under the playhead' : ''}`, 'ok'); }
      } else {
        S.curve = { base: 100, keys: [], segs: [] }; S.baked = null; touch();
        S.error = 'Could not find “Time Remapping › Speed” on “' + S.clip + '”.';
        if (!opts.quiet) { fitView(); status(S.error, 'err'); }
      }
    } catch (e) {
      S.prop = null; S.candidates = []; S.clip = ''; S.sig = null; S.error = e.message || String(e); S.curve = { base: 100, keys: [], segs: [] }; touch();
      if (!opts.quiet) status(S.error, 'err');
    }
    S.busy = false;
    renderAll(); renderSetup();
  }

  let commitTimer = 0, dirty = false;
  const markDirty = (immediate) => { dirty = true; if (!S.live) return; clearTimeout(commitTimer); commitTimer = setTimeout(commit, immediate ? 0 : 250); };
  async function commit() {
    if (!dirty || !S.prop) return;
    dirty = false;
    const keys = SP.bakeForHost(S.curve, S.fps);
    S.baked = keys.map((k) => ({ time: k.time, value: k.value }));
    S.busy = true;
    try {
      const u = unit(), t0 = T0();
      await S.host.apply(keys.length
        ? { ci: S.prop.ci, pi: S.prop.pi, keys: keys.map((k) => ({ time: k.time + t0, value: SP.toHost(k.value, u) })) }
        : { ci: S.prop.ci, pi: S.prop.pi, keys: [] });
      status(`Written to Premiere · ${keys.length} keyframes`, 'ok');
      S.busy = false;
      if (S.host.live) await scan({ quiet: true });
    } catch (e) { status('Apply failed: ' + (e.message || e), 'err'); }
    S.busy = false;
  }

  // ------------------------------------------------------------------ real-time playhead
  function setPlayhead(abs) {
    S.phAbs = abs;
    const rel = abs - S.start;
    if (Math.abs(rel - S.ph) < 1e-5) return false;
    S.ph = rel; S.phSeen = now();
    if (S.follow && !drag && S.tab === 'speed') {
      const w = S.view.t1 - S.view.t0;
      if (S.ph < S.view.t0 || S.ph > S.view.t1) { const t0 = Math.max(-w * 0.05, Math.min(S.ph - w * 0.12, S.D - w * 0.9)); S.view = { t0, t1: t0 + w }; }
    }
    return true;
  }
  let seekBusy = false, seekNext = null;
  async function seek(rel) {
    rel = Math.max(0, Math.min(S.D, Math.round(rel * S.fps) / S.fps));
    S.ph = rel; S.phSeen = now(); invalidate(); updateHud();
    if (seekBusy) { seekNext = rel; return; }
    seekBusy = true;
    try { await S.host.seek(rel + S.start); } catch (e) { status('Seek failed: ' + (e.message || e), 'err'); }
    seekBusy = false;
    if (seekNext != null) { const n = seekNext; seekNext = null; seek(n); }
  }

  let lastProbe = 0, idleSince = 0;
  async function loop() {
    let delay = 40;
    try {
      if (!document.hidden && !S.busy) {
        const abs = await S.host.ph();
        if (!seekBusy && seekNext == null && setPlayhead(abs)) { invalidate(); updateHud(); idleSince = 0; delay = 8; }
        else { idleSince = idleSince || now(); delay = now() - idleSince > 1500 ? 90 : 24; if (now() - S.phSeen > 700) updateHud(); }   // lets the live chip switch off
        if (now() - lastProbe > 500) {
          lastProbe = now();
          const r = await S.host.probe();
          if (r.sig !== S.sig && !dirty && !drag && !S.busy) await scan();
        }
      }
    } catch (e) { delay = 400; }
    setTimeout(loop, delay);
  }

  // ------------------------------------------------------------------ canvas plumbing
  function setup(canvas) {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(50, Math.round(r.width)), h = Math.max(50, Math.round(r.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h };
  }
  let raf = 0;
  function invalidate() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; if (S.tab === 'speed') drawSpeed(); }); }
  function updateHud() {
    if (!S.prop) { $('#h-speed').textContent = '—'; $('#h-src').textContent = '—'; $('#h-clip').textContent = '—'; $('#h-live').classList.remove('on'); return; }
    const v = SP.valueAt(S.curve, S.ph), tab = stats().tab;
    $('#h-speed').textContent = fmtPct(v);
    $('#h-src').textContent = fmtTC(S.inPoint + SP.sourceAt(tab, S.ph));
    $('#h-clip').textContent = fmtTC(S.ph);
    const live = now() - S.phSeen < 700;
    $('#h-live').classList.toggle('on', live); $('#h-live-t').textContent = live ? 'following Premiere' : 'cursor';
  }

  function fitView() { const pad = S.D * 0.04; S.view = { t0: -pad, t1: S.D + pad }; }

  const PADL = 46, PADR = 14, RULER = 22, GAP = 26, PADB = 10;
  const L = { w: 0, h: 0, y1a: 0, y1b: 0, y2a: 0, y2b: 0, yr: { lo: 0, hi: 200 }, srcMax: 1 };
  const gx = (t) => PADL + ((t - S.view.t0) / (S.view.t1 - S.view.t0)) * (L.w - PADL - PADR);
  const gt = (x) => S.view.t0 + ((x - PADL) / (L.w - PADL - PADR)) * (S.view.t1 - S.view.t0);
  const gyS = (v) => L.y1a + ((L.yr.hi - v) / (L.yr.hi - L.yr.lo)) * (L.y1b - L.y1a);
  const gvS = (y) => L.yr.hi - ((y - L.y1a) / (L.y1b - L.y1a)) * (L.yr.hi - L.yr.lo);
  const gyT = (s) => L.y2b - (s / L.srcMax) * (L.y2b - L.y2a);

  function niceStep(span) { return [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((s) => span / s <= 7) || 10000; }
  function speedRange() {
    const vs = [...S.curve.keys.map((k) => k.value), S.curve.base, 100];
    let lo = Math.min(0, ...vs), hi = Math.max(200, ...vs);
    const pad = (hi - lo) * 0.1; lo = lo < 0 ? lo - pad : 0; hi += pad;
    const r = { lo, hi };
    if (drag && drag.yr) { r.lo = Math.min(r.lo, drag.yr.lo); r.hi = Math.max(r.hi, drag.yr.hi); drag.yr = r; }
    return r;
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }
  function diamond(g, x, y, r, fill, stroke, glow) {
    if (glow) { g.shadowColor = glow; g.shadowBlur = 10; }
    g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath();
    g.fillStyle = fill; g.fill(); g.shadowBlur = 0; if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); }
  }

  const hit = { keys: [], handles: [] };
  function drawSpeed() {
    const { g, w, h } = setup(cv);
    g.clearRect(0, 0, w, h);
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#25272c'); bg.addColorStop(1, '#1f2126'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    hit.keys = []; hit.handles = [];
    const ok = !!S.prop;
    setEmpty(!ok);
    L.w = w; L.h = h;
    const avail = h - RULER - GAP - PADB - 4, h1 = Math.round(avail * 0.64);
    L.y1a = RULER + 6; L.y1b = L.y1a + h1; L.y2a = L.y1b + GAP; L.y2b = h - PADB;
    L.yr = speedRange();
    const st = ok ? stats() : null;
    L.srcMax = Math.max(S.D, st ? st.sourceUsed : 0, 0.1) * 1.06;

    // ---- ruler (scrub zone)
    g.fillStyle = 'rgba(255,255,255,.035)'; g.fillRect(PADL, 0, w - PADL - PADR, RULER);
    const span = S.view.t1 - S.view.t0, tstep = [1 / S.fps, 2 / S.fps, 5 / S.fps, 10 / S.fps, 0.5, 1, 2, 5, 10, 30, 60].find((s) => span / s <= 9) || 120;
    g.font = '9.5px -apple-system, "Segoe UI", sans-serif'; g.lineWidth = 1;
    for (let t = Math.ceil(S.view.t0 / tstep) * tstep; t <= S.view.t1; t += tstep) {
      const x = Math.round(gx(t)) + 0.5;
      g.strokeStyle = 'rgba(255,255,255,.05)'; g.beginPath(); g.moveTo(x, RULER); g.lineTo(x, L.y2b); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.moveTo(x, RULER - 5); g.lineTo(x, RULER); g.stroke();
      g.fillStyle = css('--faint'); g.fillText(fmtTC(t), x + 3, RULER - 8);
    }
    // clip bounds
    [0, S.D].forEach((t) => { const x = Math.round(gx(t)) + 0.5; g.strokeStyle = 'rgba(245,169,74,.35)'; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x, RULER); g.lineTo(x, L.y2b); g.stroke(); g.setLineDash([]); });

    // ---- speed graph grid
    const vstep = niceStep(L.yr.hi - L.yr.lo);
    g.font = '9.5px -apple-system, "Segoe UI", sans-serif';
    for (let v = Math.ceil(L.yr.lo / vstep) * vstep; v <= L.yr.hi; v += vstep) {
      const y = Math.round(gyS(v)) + 0.5, major = v === 100 || v === 0;
      g.strokeStyle = v === 100 ? 'rgba(255,255,255,.28)' : v === 0 ? 'rgba(255,107,107,.3)' : 'rgba(255,255,255,.055)';
      g.setLineDash(v === 100 ? [5, 4] : []); g.beginPath(); g.moveTo(PADL, y); g.lineTo(w - PADR, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = major ? css('--muted') : css('--faint'); g.fillText(v + '%', 6, y + 3);
    }
    g.fillStyle = css('--faint'); g.fillText('SPEED', PADL + 4, L.y1a + 10);
    if (!ok) { g.fillStyle = css('--faint'); g.fillText('SOURCE TIME', PADL + 4, L.y2a + 10); return; }

    // ---- speed curve (+ fill above/below 100%)
    const n = Math.max(80, Math.round((w - PADL - PADR) / 2)), pts = [];
    for (let i = 0; i <= n; i++) { const t = S.view.t0 + ((S.view.t1 - S.view.t0) * i) / n; pts.push({ x: gx(t), t, v: SP.valueAt(S.curve, Math.min(S.D, Math.max(0, t))) }); }
    const path = () => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, gyS(p.v)) : g.moveTo(p.x, gyS(p.v)))); };
    const y100 = gyS(100);
    [[L.y1a, y100, C_UP], [y100, L.y1b, C_DOWN]].forEach(([ya, yb, col]) => {
      if (yb <= ya) return;
      g.save(); g.beginPath(); g.rect(PADL, ya, w - PADL - PADR, yb - ya); g.clip();
      path(); g.lineTo(pts[pts.length - 1].x, y100); g.lineTo(pts[0].x, y100); g.closePath();
      g.fillStyle = col + '30'; g.fill(); g.restore();
    });
    g.save(); g.beginPath(); g.rect(PADL, L.y1a - 2, w - PADL - PADR, L.y1b - L.y1a + 4); g.clip();
    path(); g.strokeStyle = C_SPEED; g.lineWidth = 2.4; g.lineJoin = 'round'; g.shadowColor = C_SPEED; g.shadowBlur = 8; g.stroke(); g.shadowBlur = 0;
    g.restore();

    // ---- handles + keys
    S.curve.segs.forEach((s, i) => {
      if (!(S.sel.has(i) || S.sel.has(i + 1)) || s.kind !== 'bezier') return;
      const a = S.curve.keys[i], b = S.curve.keys[i + 1], dt = b.time - a.time;
      [[a, s.p[0], s.p[1], 0], [b, s.p[2], s.p[3], 1]].forEach(([k, px, py, which]) => {
        const hx = gx(a.time + px * dt), hy = gyS(a.value + (b.value - a.value) * py), kx = gx(k.time), ky = gyS(k.value);
        g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1; g.beginPath(); g.moveTo(kx, ky); g.lineTo(hx, hy); g.stroke();
        g.beginPath(); g.arc(hx, hy, 5, 0, TAU); g.fillStyle = '#1b1c1f'; g.fill(); g.strokeStyle = C_SPEED; g.lineWidth = 2; g.stroke();
        g.beginPath(); g.arc(hx, hy, 1.8, 0, TAU); g.fillStyle = C_SPEED; g.fill();
        hit.handles.push({ i, which, x: hx, y: hy });
      });
    });
    S.curve.keys.forEach((k, i) => {
      const x = gx(k.time), y = gyS(k.value), on = S.sel.has(i);
      diamond(g, x, y, on ? 6.5 : 5.2, on ? css('--amber') : '#f4f5f7', on ? '#fff' : C_SPEED, on ? css('--amber') : null);
      hit.keys.push({ i, x, y });
    });

    // ---- source-time graph (derived)
    g.fillStyle = css('--faint'); g.fillText('SOURCE TIME', PADL + 4, L.y2a + 10);
    for (let s = 0; s <= L.srcMax; s += Math.max(0.5, Math.ceil(L.srcMax / 4))) {
      const y = Math.round(gyT(s)) + 0.5; g.strokeStyle = 'rgba(255,255,255,.055)'; g.beginPath(); g.moveTo(PADL, y); g.lineTo(w - PADR, y); g.stroke();
      g.fillStyle = css('--faint'); g.fillText(s.toFixed(s % 1 ? 1 : 0) + 's', 8, y + 3);
    }
    g.save(); g.beginPath(); g.rect(PADL, L.y2a - 2, w - PADL - PADR, L.y2b - L.y2a + 4); g.clip();
    g.setLineDash([4, 4]); g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1; g.beginPath(); g.moveTo(gx(0), gyT(0)); g.lineTo(gx(S.D), gyT(S.D)); g.stroke(); g.setLineDash([]);   // 100% reference
    const sp = []; for (let i = 0; i <= n; i++) { const t = S.view.t0 + ((S.view.t1 - S.view.t0) * i) / n; sp.push({ x: gx(t), y: gyT(SP.sourceAt(st.tab, Math.min(S.D, Math.max(0, t)))) }); }
    g.beginPath(); sp.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.lineTo(sp[sp.length - 1].x, L.y2b); g.lineTo(sp[0].x, L.y2b); g.closePath();
    const sg = g.createLinearGradient(0, L.y2a, 0, L.y2b); sg.addColorStop(0, C_SRC + '30'); sg.addColorStop(1, C_SRC + '05'); g.fillStyle = sg; g.fill();
    g.beginPath(); sp.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.strokeStyle = C_SRC; g.lineWidth = 2; g.shadowColor = C_SRC; g.shadowBlur = 6; g.stroke(); g.shadowBlur = 0;
    g.restore();

    // ---- playhead (spans both graphs) + dots on the curves
    const px = Math.round(gx(S.ph)) + 0.5;
    if (px >= PADL - 2 && px <= w - PADR + 2) {
      g.strokeStyle = css('--amber'); g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, RULER); g.lineTo(px, L.y2b); g.stroke();
      g.fillStyle = css('--amber'); g.beginPath(); g.moveTo(px - 6, 2); g.lineTo(px + 6, 2); g.lineTo(px, 12); g.closePath(); g.fill();
      const v = SP.valueAt(S.curve, S.ph), sv = SP.sourceAt(st.tab, S.ph);
      [[gyS(v), C_SPEED], [gyT(sv), C_SRC]].forEach(([y, col]) => { g.beginPath(); g.arc(px, y, 4.5, 0, TAU); g.fillStyle = '#1b1c1f'; g.fill(); g.strokeStyle = col; g.lineWidth = 2; g.stroke(); });
      // value bubble at the speed dot
      const txt = fmtPct(v); g.font = '600 10px -apple-system, "Segoe UI", sans-serif'; const tw = g.measureText(txt).width + 12, bx = Math.min(w - PADR - tw, px + 9), by = Math.max(L.y1a + 6, Math.min(L.y1b - 6, gyS(v) - 14));
      roundRect(g, bx, by - 9, tw, 18, 5); g.fillStyle = 'rgba(20,21,24,.92)'; g.fill(); g.strokeStyle = C_SPEED; g.lineWidth = 1; g.stroke();
      g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(txt, bx + 6, by + 0.5); g.textBaseline = 'alphabetic';
    }
    if (drag && drag.type === 'box') {
      g.strokeStyle = css('--accent'); g.fillStyle = 'rgba(123,140,255,.12)'; g.lineWidth = 1;
      const r = drag.rect; g.fillRect(r.x, r.y, r.w, r.h); g.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    }
  }

  function setEmpty(on) {
    const e = $('#empty'); e.classList.toggle('hidden', !on); if (!on) return;
    if (e.dataset.err === S.error + S.clip) return;
    e.dataset.err = S.error + S.clip; e.textContent = '';
    e.appendChild(el('b', '', S.clip ? 'Speed property not found' : 'Select a clip'));
    e.appendChild(el('span', '', S.clip ? 'In Premiere: right-click the clip’s fx badge → Time Remapping → Speed (or Ctrl+click the speed line once to add a keyframe), then press ↻. Run diagnostics in Setup if it still isn’t found.'
      : (S.error || 'Click a video clip in the timeline — the panel follows your selection.')));
    const row = el('div', 'btn-row'); const b = el('button', '', 'Open Setup & diagnostics'); b.onclick = () => { S.tab = 'setup'; renderAll(); }; row.appendChild(b); e.appendChild(row);
  }

  // ------------------------------------------------------------------ SPEED tab interaction
  const cv = $('#cv');
  let drag = null;
  const pos = (e, canvas) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }; };
  const nearest = (list, p, rad) => list.map((o) => ({ o, d: Math.hypot(o.x - p.x, o.y - p.y) })).filter((x) => x.d <= rad).sort((a, b) => a.d - b.d)[0];
  const snapT = (t) => Math.round(t * S.fps) / S.fps;

  cv.addEventListener('pointerdown', (e) => {
    const p = pos(e, cv); cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
    if (!S.prop) return;
    if (p.y < RULER + 2 || p.y > L.y1b + 4) { drag = { type: 'scrub' }; seek(gt(p.x)); return; }
    const hd = nearest(hit.handles, p, 9);
    if (hd) { pushUndo(); drag = { type: 'handle', h: hd.o }; return; }
    const kk = nearest(hit.keys, p, 10);
    if (kk) {
      if (e.shiftKey) S.sel.has(kk.o.i) ? S.sel.delete(kk.o.i) : S.sel.add(kk.o.i); else if (!S.sel.has(kk.o.i)) { S.sel.clear(); S.sel.add(kk.o.i); }
      pushUndo();
      drag = { type: 'key', origin: p, yr: Object.assign({}, L.yr), starts: [...S.sel].map((i) => ({ i, t: S.curve.keys[i].time, v: S.curve.keys[i].value })) };
      renderAll(); return;
    }
    if (e.shiftKey) { drag = { type: 'box', origin: p, rect: { x: p.x, y: p.y, w: 0, h: 0 } }; return; }
    S.sel.clear(); drag = { type: 'pan', origin: p, v0: Object.assign({}, S.view) }; renderAll();
  });
  cv.addEventListener('pointermove', (e) => {
    const p = pos(e, cv);
    if (!drag) { cv.style.cursor = p.y < RULER + 2 ? 'ew-resize' : nearest(hit.handles, p, 9) ? 'crosshair' : nearest(hit.keys, p, 10) ? 'pointer' : 'default'; return; }
    if (drag.type === 'scrub') seek(gt(p.x));
    else if (drag.type === 'pan') { const dt = ((p.x - drag.origin.x) / (p.w - PADL - PADR)) * (drag.v0.t1 - drag.v0.t0); S.view = { t0: drag.v0.t0 - dt, t1: drag.v0.t1 - dt }; }
    else if (drag.type === 'box') {
      drag.rect = { x: Math.min(p.x, drag.origin.x), y: Math.min(p.y, drag.origin.y), w: Math.abs(p.x - drag.origin.x), h: Math.abs(p.y - drag.origin.y) };
      S.sel.clear(); hit.keys.forEach((k) => { const r = drag.rect; if (k.x >= r.x && k.x <= r.x + r.w && k.y >= r.y && k.y <= r.y + r.h) S.sel.add(k.i); });
    } else if (drag.type === 'key') {
      const ks = S.curve.keys, dt = gt(p.x) - gt(drag.origin.x), dv = gvS(p.y) - gvS(drag.origin.y), frame = 1 / S.fps;
      drag.starts.forEach((s) => {
        const lo = s.i > 0 ? ks[s.i - 1].time + frame : -Infinity, hi = s.i < ks.length - 1 ? ks[s.i + 1].time - frame : Infinity;
        if (!e.altKey) ks[s.i].time = snapT(Math.min(hi, Math.max(lo, s.t + dt)));
        if (!e.ctrlKey) ks[s.i].value = SP.clampSpeed(Math.round((s.v + dv) * 10) / 10);
      });
      touch(); markDirty();
    } else if (drag.type === 'handle') {
      const { i, which } = drag.h, a = S.curve.keys[i], b = S.curve.keys[i + 1];
      const x = Math.min(1, Math.max(0, (gt(p.x) - a.time) / (b.time - a.time)));
      let y = Math.abs(b.value - a.value) < 1e-6 ? S.curve.segs[i].p[which * 2 + 1] : (gvS(p.y) - a.value) / (b.value - a.value);
      y = Math.min(2.5, Math.max(-1.5, y));
      const q = S.curve.segs[i].p.slice(); q[which * 2] = x; q[which * 2 + 1] = y; S.curve.segs[i] = { kind: 'bezier', p: q };
      touch(); markDirty();
    }
    renderAll();
  });
  const endDrag = () => { drag = null; renderAll(); };
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('wheel', (e) => {
    e.preventDefault(); const p = pos(e, cv), t = gt(p.x), k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    S.view = { t0: t - (t - S.view.t0) * k, t1: t + (S.view.t1 - t) * k }; renderAll();
  }, { passive: false });
  cv.addEventListener('dblclick', (e) => {
    const p = pos(e, cv); if (!S.prop || p.y < RULER + 2 || p.y > L.y1b) return;
    const t = snapT(Math.min(S.D, Math.max(0, gt(p.x))));
    pushUndo(); addKeyAt(t); markDirty(); renderAll();
  });

  function addKeyAt(t) {
    S.curve = SP.splitAt(S.curve, t);
    touch(); S.sel.clear(); S.sel.add(S.curve.keys.findIndex((k) => Math.abs(k.time - t) < 1e-6));
  }
  function deleteSelected() {
    if (!S.sel.size) return; pushUndo();
    [...S.sel].sort((a, b) => b - a).forEach((i) => { S.curve.keys.splice(i, 1); S.curve.segs.splice(Math.min(i, S.curve.segs.length - 1), 1); });
    if (S.curve.keys.length === 1) S.curve.segs = [];
    if (!S.curve.keys.length) S.curve.segs = [];
    S.sel.clear(); touch(); markDirty(); renderAll();
  }
  function nudge(dt, dv) {
    if (!S.sel.size) return; pushUndo();
    S.sel.forEach((i) => { const k = S.curve.keys[i], prev = S.curve.keys[i - 1], next = S.curve.keys[i + 1], f = 1 / S.fps;
      if (dt) k.time = snapT(Math.min(next ? next.time - f : Infinity, Math.max(prev ? prev.time + f : -Infinity, k.time + dt)));
      if (dv) k.value = SP.clampSpeed(k.value + dv); });
    touch(); markDirty(); renderAll();
  }

  // ------------------------------------------------------------------ info card
  function renderInfo() {
    const box = $('#info'); box.textContent = '';
    if (!S.prop) { box.appendChild(el('div', 'chempty', S.clip ? 'No speed property' : 'No clip')); return; }
    const st = stats(), kv = (k, v, small) => { const d = el('div', 'kv'); d.appendChild(el('div', 'k', k)); const vv = el('div', 'v', v); if (small) vv.appendChild(el('small', '', ' ' + small)); d.appendChild(vv); box.appendChild(d); };
    kv('Clip length', fmtTC(S.D)); kv('Source used', fmtTC(st.sourceUsed), st.sourceUsed.toFixed(2) + 's');
    kv('Average speed', fmtPct(st.avg)); kv('Min / max', fmtPct(st.min) + ' / ' + fmtPct(st.max)); kv('Keyframes', String(S.curve.keys.length));
    if (S.origSource != null) {
      const b = el('button', '', 'Match original source (' + S.origSource.toFixed(1) + 's)'); b.title = 'Scale all speeds so the clip still ends on the same source frame it did when you opened it';
      b.onclick = () => { pushUndo(); S.curve = SP.rescaleToSource(S.curve, S.D, S.fps, S.origSource); touch(); markDirty(); renderAll(); status('Speeds scaled to keep the original source length.', 'ok'); };
      box.appendChild(b);
    }
  }

  // ------------------------------------------------------------------ easing presets
  function drawEaseIcon(cnv, ease, color) {
    const dpr = window.devicePixelRatio || 1, W = 34, H = 22; cnv.width = W * dpr; cnv.height = H * dpr;
    const g = cnv.getContext('2d'); g.scale(dpr, dpr);
    g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1; g.strokeRect(2.5, 3.5, W - 5, H - 7);
    g.strokeStyle = color || css('--text'); g.lineWidth = 1.8; g.lineJoin = 'round'; g.beginPath();
    for (let i = 0; i <= 32; i++) { const x = 4 + (i / 32) * (W - 8), y = H - 5 - E.evaluate(ease, i / 32) * (H - 10); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  function blend(ease, s) { if (ease.kind !== 'bezier' || s >= 100) return E.clone(ease); const k = s / 100, lin = [1 / 3, 1 / 3, 2 / 3, 2 / 3]; return { kind: 'bezier', p: ease.p.map((v, i) => lin[i] + (v - lin[i]) * k) }; }
  function targetSegs() { return S.sel.size ? [...S.sel].filter((i) => i < S.curve.segs.length) : S.curve.segs.map((_, i) => i); }
  function applyEase(ease) {
    const t = targetSegs(); if (!t.length) return status('Add at least two keyframes first (double-click the graph).', 'err');
    pushUndo(); const e = blend(ease, S.strength); t.forEach((i) => { S.curve.segs[i] = E.clone(e); }); touch(); markDirty(); renderAll();
  }
  function renderPresets() {
    const gb = $('#groups'); gb.textContent = '';
    E.GROUPS.forEach((g) => { const b = el('button', 'grp' + (S.group === g ? ' active' : ''), g === 'all' ? 'All' : g === 'custom' ? '★ Custom' : g[0].toUpperCase() + g.slice(1)); b.onclick = () => { S.group = g; renderPresets(); }; gb.appendChild(b); });
    const box = $('#presets'); box.textContent = '';
    const first = [...S.sel].sort((a, b) => a - b)[0], cur = first != null && first < S.curve.segs.length ? S.curve.segs[first] : null;
    const list = [...E.PRESETS, ...S.custom.map((p) => ({ label: p.label, group: 'custom', ease: p.ease, custom: true }))];
    const shown = list.filter((p) => S.group === 'all' || (S.group === 'custom' ? p.custom : (p.group === S.group || (p.group === 'inout' && (S.group === 'in' || S.group === 'out')))));
    shown.forEach((p) => {
      const on = cur && E.same(cur, p.ease), b = el('button', 'preset' + (on ? ' active' : ''));
      const ic = el('canvas'); drawEaseIcon(ic, p.ease, on ? '#c9d0ff' : null); b.appendChild(ic); b.appendChild(document.createTextNode(p.label));
      b.title = p.custom ? 'Right-click to delete' : 'Easing between the selected keyframe and the next one (none selected: all segments)';
      b.onclick = () => applyEase(p.ease);
      if (p.custom) b.oncontextmenu = (ev) => { ev.preventDefault(); S.custom = S.custom.filter((x) => x.label !== p.label); persistCustom(); renderPresets(); };
      box.appendChild(b);
    });
    if (!shown.length) box.appendChild(el('div', 'preset-empty', 'Select a keyframe, then press ★ to save its easing here.'));
  }
  const persistCustom = () => { try { localStorage.setItem('sc.custom', JSON.stringify(S.custom)); } catch (_) { /* storage unavailable */ } };

  // ------------------------------------------------------------------ KEYFRAMES tab (numeric)
  function renderKeys() {
    const t = $('#ktable'); t.textContent = '';
    const e = $('#kempty'); e.classList.toggle('hidden', !!S.prop && S.curve.keys.length > 0);
    if (!S.prop || !S.curve.keys.length) { e.textContent = ''; e.appendChild(el('b', '', S.prop ? 'No keyframes yet' : 'No speed property')); e.appendChild(el('span', '', S.prop ? 'Add one at the playhead with the ◆+ button, or apply a ramp.' : 'Select a clip with Time Remapping.')); }
    const head = el('tr'); ['#', 'Frame', 'Speed %', 'Easing →', 'Source', ''].forEach((h) => head.appendChild(el('th', '', h))); t.appendChild(head);
    const tab = S.prop ? stats().tab : null;
    S.curve.keys.forEach((k, i) => {
      const tr = el('tr', S.sel.has(i) ? 'sel' : ''); tr.onclick = (ev) => { if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return; S.sel.clear(); S.sel.add(i); renderAll(); };
      tr.appendChild(el('td', '', String(i + 1)));
      const fr = el('input'); fr.type = 'number'; fr.step = 1; fr.value = Math.round(k.time * S.fps);
      fr.onchange = () => { pushUndo(); const f = 1 / S.fps, prev = S.curve.keys[i - 1], next = S.curve.keys[i + 1]; k.time = snapT(Math.min(next ? next.time - f : S.D, Math.max(prev ? prev.time + f : 0, fr.value / S.fps))); touch(); markDirty(); renderAll(); };
      const sp = el('input'); sp.type = 'number'; sp.step = 1; sp.value = +k.value.toFixed(2);
      sp.onchange = () => { pushUndo(); k.value = SP.clampSpeed(parseFloat(sp.value) || 0); touch(); markDirty(); renderAll(); };
      const td1 = el('td'); td1.appendChild(fr); tr.appendChild(td1); const td2 = el('td'); td2.appendChild(sp); tr.appendChild(td2);
      const td3 = el('td');
      if (i < S.curve.segs.length) {
        const sel = el('select'), seg = S.curve.segs[i], match = E.PRESETS.find((p) => E.same(p.ease, seg)) || S.custom.find((p) => E.same(p.ease, seg));
        [...E.PRESETS, ...S.custom].forEach((p) => { const o = el('option', '', p.label); o.value = p.label; sel.appendChild(o); });
        if (!match) { const o = el('option', '', 'Custom curve'); o.value = '__c'; sel.appendChild(o); sel.value = '__c'; } else sel.value = match.label;
        sel.onchange = () => { const p = [...E.PRESETS, ...S.custom].find((x) => x.label === sel.value); if (p) { pushUndo(); S.curve.segs[i] = E.clone(p.ease); touch(); markDirty(); renderAll(); } };
        td3.appendChild(sel);
      } else td3.appendChild(el('span', 'dim', '—'));
      tr.appendChild(td3);
      tr.appendChild(el('td', '', tab ? fmtTC(S.inPoint + SP.sourceAt(tab, k.time)) : '—'));
      const del = el('td'), x = el('button', 'x', '✕'); x.title = 'Delete keyframe'; x.onclick = () => { S.sel.clear(); S.sel.add(i); deleteSelected(); }; del.appendChild(x); tr.appendChild(del);
      t.appendChild(tr);
    });
  }

  // ------------------------------------------------------------------ RAMPS tab
  const acv = $('#anim-cv');
  function rampIcon(cnv, def, on) {
    const dpr = window.devicePixelRatio || 1, W = 34, H = 22; cnv.width = W * dpr; cnv.height = H * dpr;
    const g = cnv.getContext('2d'); g.scale(dpr, dpr); const f = def.factor(SP.paramDefaults());
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.moveTo(3, H / 2 + 0.5); g.lineTo(W - 3, H / 2 + 0.5); g.stroke();
    g.strokeStyle = on ? '#c9d0ff' : css('--muted'); g.lineWidth = 1.6; g.lineJoin = 'round'; g.beginPath();
    for (let i = 0; i <= 40; i++) { const u = i / 40, v = Math.max(-1, Math.min(3, f(u))), x = 3 + u * (W - 6), y = H - 4 - (v + 1) / 4 * (H - 8); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  function renderRampList() {
    const box = $('#anim-list'); box.textContent = '';
    SP.RAMPS.forEach((d) => {
      const on = S.ramp.id === d.id, b = el('button', 'anim-item' + (on ? ' active' : ''));
      const ic = el('canvas'); rampIcon(ic, d, on); b.appendChild(ic); b.appendChild(document.createTextNode(d.label));
      b.onclick = () => { S.ramp.id = d.id; renderRampList(); renderRampSide(); }; box.appendChild(b);
    });
    const def = SP.RAMPS.find((d) => d.id === S.ramp.id);
    $('#anim-title').textContent = def.label; $('#anim-hint').textContent = def.hint;
  }
  const paint = (inp) => { const pct = ((inp.value - inp.min) / (inp.max - inp.min)) * 100; inp.style.setProperty('--fill', `linear-gradient(90deg, ${css('--accent')} ${pct}%, ${css('--surface3')} ${pct}%)`); };
  function renderRampSide() {
    const def = SP.RAMPS.find((d) => d.id === S.ramp.id), box = $('#anim-params'); box.textContent = '';
    def.params.forEach((id) => {
      const p = SP.PARAMS[id], wrap = el('div', 'param'), row = el('div', 'row'); row.appendChild(el('span', '', p.label));
      const val = el('span', 'v', String(S.ramp.params[id])); row.appendChild(val);
      const inp = el('input'); inp.type = 'range'; inp.min = p.min; inp.max = p.max; inp.step = p.step; inp.value = S.ramp.params[id]; paint(inp);
      inp.oninput = () => { S.ramp.params[id] = +inp.value; val.textContent = inp.value; paint(inp); };
      wrap.appendChild(row); wrap.appendChild(inp); box.appendChild(wrap);
    });
    $('#anim-note').textContent = def.hold ? 'This ramp keeps its target speed until the end of the clip.' : 'Applied on top of the current speed (it multiplies it), only inside the window.';
    $('#anim-apply').disabled = !S.prop; $('#anim-apply').style.opacity = S.prop ? 1 : .45;
  }
  function drawRamp(ts) {
    if (S.tab !== 'ramps') return;
    const { g, w, h } = setup(acv); g.clearRect(0, 0, w, h); g.fillStyle = '#212328'; g.fillRect(0, 0, w, h);
    const def = SP.RAMPS.find((d) => d.id === S.ramp.id), fn = def.factor(S.ramp.params);
    const X0 = 36, X1 = w - 16, topY = 18, plotH = Math.min(300, (h - 110) * 0.66), botY = topY + plotH + 34, trackY = botY + 30;
    const gyv = (v) => topY + plotH - ((Math.max(-1.2, Math.min(4, v)) + 1.2) / 5.2) * plotH;
    g.font = '9.5px -apple-system, "Segoe UI", sans-serif'; g.fillStyle = css('--faint'); g.fillText('SPEED (× normal)', X0, 11);
    [0, 1, 2, 3].forEach((v) => { const y = Math.round(gyv(v)) + 0.5; g.strokeStyle = v === 1 ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.06)'; g.setLineDash(v === 1 ? [5, 4] : []); g.beginPath(); g.moveTo(X0, y); g.lineTo(X1, y); g.stroke(); g.setLineDash([]); g.fillStyle = css('--faint'); g.fillText(v * 100 + '%', 4, y + 3); });
    g.beginPath(); for (let i = 0; i <= 160; i++) { const u = i / 160, x = X0 + u * (X1 - X0), y = gyv(fn(u)); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = C_SPEED; g.lineWidth = 2.4; g.shadowColor = C_SPEED; g.shadowBlur = 8; g.stroke(); g.shadowBlur = 0;
    // moving ball: x = integral of the speed => visibly slows / stops / reverses
    const cum = [0]; for (let i = 1; i <= 400; i++) cum.push(cum[i - 1] + (fn((i - 1) / 400) + fn(i / 400)) / 2 / 400);
    const total = Math.max(0.2, Math.abs(cum[400])), runMs = 2600, u = ((ts || 0) % (runMs + 700)) / runMs, uu = Math.min(1, u);
    const s = cum[Math.round(uu * 400)];
    g.fillStyle = css('--faint'); g.fillText('WHAT YOU SEE (source position)', X0, botY - 8);
    g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 2; g.lineCap = 'round'; g.beginPath(); g.moveTo(X0, trackY); g.lineTo(X1, trackY); g.stroke();
    const px = X0 + Math.max(0, Math.min(1, s / Math.max(1, total))) * (X1 - X0);
    g.shadowColor = css('--teal'); g.shadowBlur = 14; g.fillStyle = css('--teal'); g.beginPath(); g.arc(px, trackY, 8, 0, TAU); g.fill(); g.shadowBlur = 0;
    g.strokeStyle = css('--amber'); g.lineWidth = 1.5; const cx = X0 + uu * (X1 - X0); g.beginPath(); g.moveTo(cx, topY - 4); g.lineTo(cx, topY + plotH); g.stroke();
    requestAnimationFrame(drawRamp);
  }
  $('#anim-apply').onclick = () => {
    if (!S.prop) return status('Select a clip with Time Remapping first.', 'err');
    const def = SP.RAMPS.find((d) => d.id === S.ramp.id); pushUndo();
    S.curve = SP.applyRamp(S.curve, def, S.ramp.params, S.ph, S.D, S.fps); S.sel.clear(); touch(); markDirty();
    status(`${def.label} applied at ${fmtTC(S.ph)} · ${S.curve.keys.length} keyframes`, 'ok'); S.tab = 'speed'; fitView(); renderAll();
  };

  // ------------------------------------------------------------------ SETUP tab
  function renderSetup() {
    const sel = $('#s-cand'); sel.textContent = '';
    if (!S.candidates.length) { const o = el('option', '', S.clip ? 'Nothing found on this clip' : 'No clip'); sel.appendChild(o); }
    S.candidates.forEach((c) => { const o = el('option', '', `${c.label}  (${c.nkeys ? c.nkeys + ' keys' : 'static ' + c.value})`); o.value = c.ci + ':' + c.pi; sel.appendChild(o); });
    if (S.prop) sel.value = S.prop.ci + ':' + S.prop.pi;
    $('#s-timebase').value = S.timeBase; $('#s-unit').value = S.unit;
    $('#s-unit-note').textContent = S.prop ? `Using ${unit() === 'factor' ? 'factor (1 = normal)' : 'percent (100 = normal)'} — Premiere reports ${S.prop.value}` + (S.prop.tv ? ` and ${S.prop.keys.length} keyframe(s)` : ' (no keyframes)') + '.' : '';
  }
  $('#s-cand').onchange = (e) => { const [ci, pi] = e.target.value.split(':').map(Number); S.prefer = { ci, pi }; S.baked = null; scan(); };
  $('#s-timebase').onchange = (e) => { S.timeBase = e.target.value; S.baked = null; scan(); };
  $('#s-unit').onchange = (e) => { S.unit = e.target.value; S.baked = null; scan(); };
  $('#s-diag').onclick = async () => { $('#s-out').value = 'Running…'; try { $('#s-out').value = (await S.host.diagnostics()).join('\n'); } catch (e) { $('#s-out').value = 'Diagnostics failed: ' + (e.message || e); } };
  $('#s-copy').onclick = () => { const o = $('#s-out'); o.select(); try { document.execCommand('copy'); status('Report copied to the clipboard.', 'ok'); } catch (_) { status('Select the text and copy it manually.', 'err'); } };
  let resetArm = 0;
  $('#s-reset').onclick = async (e) => {
    if (!S.prop) return status('No speed property to reset.', 'err');
    if (now() - resetArm > 4000) { resetArm = now(); e.target.textContent = 'Click again to confirm'; setTimeout(() => (e.target.textContent = 'Reset speed to 100%'), 4000); return; }
    resetArm = 0; e.target.textContent = 'Reset speed to 100%';
    try { pushUndo(); await S.host.apply({ ci: S.prop.ci, pi: S.prop.pi, reset: true, resetValue: SP.toHost(100, unit()) }); S.baked = null; S.curve = { base: 100, keys: [], segs: [] }; touch(); status('Speed reset to 100% (keyframes removed).', 'ok'); await scan(); } catch (er) { status('Reset failed: ' + (er.message || er), 'err'); }
  };

  // ------------------------------------------------------------------ wiring
  function renderAll() {
    const cn = $('#clipname'); cn.classList.toggle('hidden', !S.clip); cn.textContent = S.clip;
    $('#hostbadge').textContent = S.host.name;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === S.tab));
    ['speed', 'keys', 'ramps', 'setup'].forEach((t) => $('#tab-' + t).classList.toggle('hidden', t !== S.tab));
    $('#hints').textContent = HINTS[S.tab];
    if (S.tab === 'speed') { renderInfo(); drawSpeed(); renderPresets(); updateHud(); }
    if (S.tab === 'keys') renderKeys();
    $('#btn-undo').classList.toggle('disabled', !S.undo.length); $('#btn-redo').classList.toggle('disabled', !S.redo.length);
    $('#btn-follow').classList.toggle('on', S.follow);
  }
  document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => {
    S.tab = t.dataset.tab; renderAll();
    if (S.tab === 'ramps') { renderRampList(); renderRampSide(); requestAnimationFrame(drawRamp); }
    if (S.tab === 'setup') renderSetup();
  }));
  $('#btn-scan').onclick = () => scan();
  $('#btn-fit').onclick = () => { fitView(); renderAll(); };
  $('#btn-follow').onclick = () => { S.follow = !S.follow; renderAll(); };
  $('#btn-undo').onclick = undo; $('#btn-redo').onclick = redo;
  $('#btn-live').onclick = (e) => { S.live = !S.live; e.currentTarget.classList.toggle('on', S.live); if (S.live) markDirty(true); };
  $('#btn-del').onclick = deleteSelected;
  $('#btn-add').onclick = () => { if (!S.prop) return status('Select a clip with Time Remapping first.', 'err'); pushUndo(); addKeyAt(snapT(Math.min(S.D, Math.max(0, S.ph)))); markDirty(); renderAll(); };
  $('#btn-save').onclick = () => {
    const i = [...S.sel].sort((a, b) => a - b)[0]; if (i == null || i >= S.curve.segs.length) return status('Select a keyframe with a segment after it first.', 'err');
    S.custom.push({ label: 'Custom ' + (S.custom.length + 1), ease: E.clone(S.curve.segs[i]) }); persistCustom(); S.group = 'custom'; renderAll(); status('Saved as custom preset.', 'ok');
  };
  $('#strength').oninput = (e) => { S.strength = +e.target.value; $('#strength-v').textContent = S.strength + '%'; paint(e.target); }; paint($('#strength'));
  document.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test((e.target || {}).tagName || '')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
    else if (e.key === 'f' || e.key === 'F') { fitView(); renderAll(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-1 / S.fps, 0); } else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(1 / S.fps, 0); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, e.shiftKey ? 10 : 1); } else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, e.shiftKey ? -10 : -1); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  });
  window.addEventListener('resize', renderAll);
  document.querySelectorAll('canvas[data-ico]').forEach(drawIcon);

  window.LG.app = { S, scan, commit, renderAll, seek, hit, setPlayhead, fmtTC };   // exposed for tests
  renderRampList(); renderRampSide(); scan().then(() => { loop(); });
})();
