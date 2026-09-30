/* Legolas+ panel: state, curve editor, dopesheet, animations. */
(function () {
  'use strict';
  const { easing: E, bake: K, animations: A, host: H } = window.LG;
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const COLORS = ['#7b8cff', '#52d1b2', '#f5a94a', '#f472b6', '#a3e635', '#38bdf8', '#c084fc', '#fbbf24'];
  const YMIN = -0.3, YMAX = 1.3;
  const TAU = Math.PI * 2;

  const S = {
    host: H.detect(), fps: 30, playhead: 0, clip: '',
    order: [], ch: {},              // ch[id] = { id,name,group,dims,ref,color,keys,segs,bakedKeys }
    visible: new Set(), sel: new Set(),   // sel entries: 'id#keyIndex'
    tab: 'curves', group: 'all', strength: 100, live: true,
    undo: [], redo: [], custom: [],
    view: { t0: 0, t1: 1 },
    anim: { id: 'bounce', params: A.defaults() },
  };
  try { S.custom = JSON.parse(localStorage.getItem('lg.custom') || '[]'); } catch (_) { S.custom = []; }

  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';

  // ------------------------------------------------------------------ icons (canvas, so they work in CEP and UXP alike)
  const ICONS = {
    refresh: (g) => { g.beginPath(); g.arc(12, 12, 7, 0.7, 5.4); g.stroke(); g.beginPath(); g.moveTo(16.4, 2.8); g.lineTo(16.6, 7.6); g.lineTo(11.8, 7.4); g.stroke(); },
    fit: (g) => { [[4, 9, 4, 4, 9, 4], [15, 4, 20, 4, 20, 9], [20, 15, 20, 20, 15, 20], [9, 20, 4, 20, 4, 15]].forEach((p) => { g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[2], p[3]); g.lineTo(p[4], p[5]); g.stroke(); }); },
    keyadd: (g) => { g.beginPath(); g.moveTo(10, 4); g.lineTo(17, 11); g.lineTo(10, 18); g.lineTo(3, 11); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(19, 3); g.lineTo(19, 9); g.moveTo(16, 6); g.lineTo(22, 6); g.stroke(); },
    trash: (g) => { g.beginPath(); g.moveTo(4.5, 7); g.lineTo(19.5, 7); g.moveTo(9.5, 7); g.lineTo(9.5, 4); g.lineTo(14.5, 4); g.lineTo(14.5, 7); g.moveTo(6.5, 7); g.lineTo(7.5, 20); g.lineTo(16.5, 20); g.lineTo(17.5, 7); g.stroke(); },
    star: (g) => { g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 4.6 : 9.6, a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(12 + r * Math.cos(a), 12.6 + r * Math.sin(a)); } g.closePath(); g.stroke(); },
    undo: (g) => { g.beginPath(); g.moveTo(9, 6); g.lineTo(4, 11); g.lineTo(9, 16); g.moveTo(4, 11); g.lineTo(14, 11); g.bezierCurveTo(19, 11, 20.5, 14.5, 20, 19); g.stroke(); },
    redo: (g) => { g.beginPath(); g.moveTo(15, 6); g.lineTo(20, 11); g.lineTo(15, 16); g.moveTo(20, 11); g.lineTo(10, 11); g.bezierCurveTo(5, 11, 3.5, 14.5, 4, 19); g.stroke(); },
    logo: (g) => {
      const gr = g.createLinearGradient(0, 0, 24, 24); gr.addColorStop(0, '#7b8cff'); gr.addColorStop(1, '#52d1b2');
      g.fillStyle = gr; g.beginPath(); g.moveTo(6, 0.5); g.lineTo(18, 0.5); g.quadraticCurveTo(23.5, 0.5, 23.5, 6); g.lineTo(23.5, 18); g.quadraticCurveTo(23.5, 23.5, 18, 23.5); g.lineTo(6, 23.5); g.quadraticCurveTo(0.5, 23.5, 0.5, 18); g.lineTo(0.5, 6); g.quadraticCurveTo(0.5, 0.5, 6, 0.5); g.fill();
      g.strokeStyle = '#0f1420'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(4.5, 18); g.bezierCurveTo(10, 18, 9, 6, 19.5, 6); g.stroke();
      g.fillStyle = '#0f1420'; [[4.5, 18], [19.5, 6]].forEach((p) => { g.beginPath(); g.arc(p[0], p[1], 2.1, 0, TAU); g.fill(); });
    },
  };
  function drawIcon(cv) {
    const size = cv.classList.contains('logo') ? 22 : 16, dpr = window.devicePixelRatio || 1;
    cv.width = size * dpr; cv.height = size * dpr;
    const g = cv.getContext('2d'); g.scale((size * dpr) / 24, (size * dpr) / 24);
    g.lineWidth = 1.9; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = css('--text');
    ICONS[cv.dataset.ico](g);
  }

  // ------------------------------------------------------------------ helpers
  const axisOf = (c) => {            // which component drives the graph, and its range
    const comp = (v, a) => (K.isVec(v) ? v[a] : v);
    let best = 0, bestRange = -1, lo = 0, hi = 1;
    for (let a = 0; a < c.dims; a++) {
      const vals = c.keys.map((k) => comp(k.value, a));
      const l = Math.min(...vals), h = Math.max(...vals);
      if (h - l > bestRange) { bestRange = h - l; best = a; lo = l; hi = h; }
    }
    return { axis: best, lo, hi, flat: hi - lo < 1e-9, comp };
  };
  const norm = (c, v) => { const ax = axisOf(c); return ax.flat ? 0.5 : (ax.comp(v, ax.axis) - ax.lo) / (ax.hi - ax.lo); };
  const active = () => S.order.filter((id) => S.visible.has(id)).map((id) => S.ch[id]);
  const selKeys = () => [...S.sel].map((s) => { const [id, i] = s.split('#'); return { c: S.ch[id], i: +i }; }).filter((x) => x.c && x.i < x.c.keys.length);
  const valueAt = (c, t) => {
    const ks = c.keys;
    if (t <= ks[0].time) return ks[0].value;
    if (t >= ks[ks.length - 1].time) return ks[ks.length - 1].value;
    let i = 0; while (ks[i + 1].time < t) i++;
    const x = (t - ks[i].time) / (ks[i + 1].time - ks[i].time);
    return K.lerp(ks[i].value, ks[i + 1].value, E.evaluate(c.segs[i], x));
  };
  const fmt = (t) => { const fr = Math.round(S.fps), f = Math.round(t * S.fps); return Math.floor(f / fr) + 's ' + String(((f % fr) + fr) % fr).padStart(2, '0') + 'f'; };
  const fmtVal = (v) => (K.isVec(v) ? v.map((x) => (+x).toFixed(2)).join(', ') : (+v).toFixed(2));
  function status(msg, kind) { $('#status-text').textContent = msg; $('#status').className = kind || ''; }
  const HINTS = {
    curves: 'Drag: pan · Wheel: zoom · Shift+drag: select · Double-click: add key · Del: delete · F: fit',
    keys: 'Drag keys to retime · Shift+drag: box select · Click ruler: move playhead · Del: delete',
    anim: 'Pick an animation, tune it, then apply it at the playhead',
  };

  // ------------------------------------------------------------------ history
  const snap = () => JSON.stringify(S.order.map((id) => ({ id, keys: S.ch[id].keys, segs: S.ch[id].segs })));
  function restore(json) { JSON.parse(json).forEach((r) => { const c = S.ch[r.id]; if (c) { c.keys = r.keys; c.segs = r.segs; } }); S.sel.clear(); }
  function pushUndo() { S.undo.push(snap()); if (S.undo.length > 100) S.undo.shift(); S.redo = []; }
  function undo() { if (!S.undo.length) return; S.redo.push(snap()); restore(S.undo.pop()); changed(true); }
  function redo() { if (!S.redo.length) return; S.undo.push(snap()); restore(S.redo.pop()); changed(true); }

  // ------------------------------------------------------------------ host sync
  const near = (a, b) => a.length === b.length && a.every((k, i) => Math.abs(k.time - b[i].time) < 2e-3 &&
    [].concat(k.value).every((v, j) => Math.abs(v - [].concat(b[i].value)[j]) < 1e-3 * Math.max(1, Math.abs(v))));

  async function scan(quiet) {
    try {
      const r = await S.host.scan();
      S.fps = r.fps || 30; S.playhead = r.playhead || 0; S.clip = r.clip; S.sig = r.sig; S.offset = r.offset; S.how = r.how;
      const next = {}; const order = [];
      r.channels.forEach((m, n) => {
        const prev = S.ch[m.id];
        // keep our editable control keys when Premiere still holds exactly what we baked last
        const keep = prev && prev.bakedKeys && near(prev.bakedKeys, m.keys);
        next[m.id] = Object.assign({}, m, {
          color: COLORS[n % COLORS.length],
          keys: keep ? prev.keys : m.keys,
          segs: keep ? prev.segs : m.keys.slice(1).map(() => E.clone(E.LINEAR)),
          bakedKeys: keep ? prev.bakedKeys : null,
        });
        order.push(m.id);
      });
      S.ch = next; S.order = order;
      S.visible = new Set([...S.visible].filter((id) => next[id]));
      if (!S.visible.size) order.slice(0, 2).forEach((id) => S.visible.add(id));
      S.sel = new Set([...S.sel].filter((s) => next[s.split('#')[0]]));
      S.error = order.length ? '' : 'No animated properties on “' + S.clip + '”.\nAdd at least two keyframes (e.g. Position or Scale), then rescan.';
      if (!quiet) { fitView(); status(order.length ? `${order.length} animated channel(s) on “${S.clip}”${S.how === 'playhead' ? ' (clip under the playhead — nothing selected)' : ''}` : 'Clip has no keyframes', order.length ? 'ok' : 'err'); }
    } catch (e) {
      S.ch = {}; S.order = []; S.visible.clear(); S.sel.clear(); S.clip = ''; S.error = e.message || String(e); S.sig = null;
      status(S.error, 'err');
    }
    renderAll(); renderAnimSide();
  }

  let commitTimer = 0;
  const dirty = new Set();
  function changed(immediate) { S.order.forEach((id) => dirty.add(id)); scheduleCommit(immediate); renderAll(); }
  function scheduleCommit(immediate) { if (!S.live) return; clearTimeout(commitTimer); commitTimer = setTimeout(commit, immediate ? 0 : 250); }
  async function commit() {
    if (!dirty.size) return;
    const ids = [...dirty]; dirty.clear();
    const edits = ids.filter((id) => S.ch[id]).map((id) => {
      const c = S.ch[id], keys = K.bakeChannel(c.keys, c.segs, S.fps);
      c.bakedKeys = keys; return { id, keys };
    });
    if (!edits.length) return;
    S.busy = true;
    try {
      await S.host.apply(edits, 'Legolas curves');
      status(`Baked ${edits.length} channel(s) · ${edits.reduce((n, e) => n + e.keys.length, 0)} keyframes`, 'ok');
      if (S.host.live) await scan(true);
    } catch (e) { status('Apply failed: ' + (e.message || e), 'err'); }
    finally { S.busy = false; }
  }
  const markDirty = (c) => { dirty.add(c.id); scheduleCommit(); };

  // Follow the timeline: when the selection changes, rescan; keep the playhead line in sync.
  async function poll() {
    if (!S.host.probe || S.busy || drag || dirty.size || document.hidden) return;
    S.busy = true;
    try {
      const r = await S.host.probe();
      if (r.sig !== S.sig) { S.busy = false; return scan(); }
      if (typeof r.abs === 'number' && typeof S.offset === 'number') {
        const ph = r.abs - S.offset;
        if (Math.abs(ph - S.playhead) > 1e-4) { S.playhead = ph; renderAll(); }
      }
    } catch (e) { /* host busy or panel hidden: try again next tick */ }
    S.busy = false;
  }
  setInterval(poll, S.pollMs = window.LG_POLL_MS || 1200);

  // ------------------------------------------------------------------ canvas plumbing
  function setup(canvas) {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(50, Math.round(r.width)), h = Math.max(50, Math.round(r.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h };
  }
  function fitView() {
    const cs = active().length ? active() : S.order.map((i) => S.ch[i]);
    if (!cs.length) { S.view = { t0: 0, t1: 3 }; return; }
    let t0 = Infinity, t1 = -Infinity;
    cs.forEach((c) => { t0 = Math.min(t0, c.keys[0].time); t1 = Math.max(t1, c.keys[c.keys.length - 1].time); });
    if (t1 - t0 < 0.1) t1 = t0 + 1;
    const pad = (t1 - t0) * 0.08;
    S.view = { t0: t0 - pad, t1: t1 + pad };
  }
  const PADX = 34, PADT = 16, PADB = 22;
  const gx = (t, w) => PADX + ((t - S.view.t0) / (S.view.t1 - S.view.t0)) * (w - PADX - 16);
  const gt = (x, w) => S.view.t0 + ((x - PADX) / (w - PADX - 16)) * (S.view.t1 - S.view.t0);
  const gy = (n, h) => PADT + (1 - (n - YMIN) / (YMAX - YMIN)) * (h - PADT - PADB);
  const gn = (y, h) => YMIN + (1 - (y - PADT) / (h - PADT - PADB)) * (YMAX - YMIN);

  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }
  function label(g, text, x, y, color, bg) {
    g.font = '600 10px -apple-system, "Segoe UI", sans-serif'; const w = g.measureText(text).width + 12;
    roundRect(g, x, y - 9, w, 18, 5); g.fillStyle = bg || 'rgba(20,21,24,.92)'; g.fill(); g.strokeStyle = color || css('--border2'); g.lineWidth = 1; g.stroke();
    g.fillStyle = color ? '#fff' : css('--text'); g.textBaseline = 'middle'; g.fillText(text, x + 6, y + 0.5); g.textBaseline = 'alphabetic';
  }
  function grid(g, w, h, hlines) {
    const span = S.view.t1 - S.view.t0;
    const step = [1 / S.fps, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60].find((s) => span / s <= 9) || 120;
    g.lineWidth = 1; g.font = '9.5px -apple-system, "Segoe UI", sans-serif';
    for (let t = Math.ceil(S.view.t0 / step) * step; t <= S.view.t1; t += step) {
      const x = Math.round(gx(t, w)) + 0.5;
      g.strokeStyle = 'rgba(255,255,255,.055)'; g.beginPath(); g.moveTo(x, PADT); g.lineTo(x, h - PADB); g.stroke();
      g.fillStyle = css('--faint'); g.fillText(fmt(t), x + 3, h - 7);
    }
    if (hlines) {
      [0, 0.25, 0.5, 0.75, 1].forEach((n) => {
        const y = Math.round(gy(n, h)) + 0.5, major = n === 0 || n === 1;
        g.strokeStyle = major ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.045)'; g.setLineDash(major ? [4, 4] : []);
        g.beginPath(); g.moveTo(PADX, y); g.lineTo(w - 16, y); g.stroke(); g.setLineDash([]);
        if (major) { g.fillStyle = css('--faint'); g.fillText(n === 0 ? 'min' : 'max', 4, y + 3); }
      });
    }
  }
  function playheadLine(g, w, h) {
    const x = Math.round(gx(S.playhead, w)) + 0.5;
    if (x < PADX - 2 || x > w - 10) return;
    g.strokeStyle = css('--amber'); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, PADT); g.lineTo(x, h - PADB); g.stroke();
    g.fillStyle = css('--amber'); g.beginPath(); g.moveTo(x - 6, PADT - 8); g.lineTo(x + 6, PADT - 8); g.lineTo(x, PADT + 1); g.closePath(); g.fill();
  }
  function diamond(g, x, y, r, fill, stroke, glow) {
    if (glow) { g.shadowColor = glow; g.shadowBlur = 10; }
    g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath();
    g.fillStyle = fill; g.fill(); g.shadowBlur = 0;
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); }
  }
  function setEmpty(id, on, title, body) {
    const e = $(id); e.classList.toggle('hidden', !on); if (!on) return;
    e.textContent = ''; const b = el('b', '', title); e.appendChild(b); e.appendChild(el('span', '', body));
  }

  // ------------------------------------------------------------------ CURVES tab
  const cv = $('#cv');
  const hit = { keys: [], handles: [] };

  function segHandles(c, i) {            // absolute handle points of segment i (bezier only)
    const s = c.segs[i]; if (s.kind !== 'bezier') return null;
    const a = c.keys[i], b = c.keys[i + 1], na = norm(c, a.value), nb = norm(c, b.value), dt = b.time - a.time;
    return [{ t: a.time + s.p[0] * dt, n: na + (nb - na) * s.p[1] }, { t: a.time + s.p[2] * dt, n: na + (nb - na) * s.p[3] }];
  }

  function drawCurves() {
    const { g, w, h } = setup(cv);
    g.clearRect(0, 0, w, h);
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#25272c'); bg.addColorStop(1, '#1f2126'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    hit.keys = []; hit.handles = [];
    grid(g, w, h, true);
    const cs = active();
    setEmpty('#empty', !cs.length, S.order.length ? 'Pick a channel' : (S.error ? 'Nothing to edit yet' : 'Select an animated clip'),
      S.order.length ? 'Choose a property in the list on the left.' : (S.error || 'Select a clip with keyframes in the timeline, then press ↻.'));
    if (!cs.length) return;
    cs.forEach((c, ci) => {
      const pts = K.sampleChannel(c.keys, c.segs, Math.max(80, Math.round(w / 2)));
      const path = () => { g.beginPath(); pts.forEach((p, i) => { const x = gx(p.time, w), y = gy(norm(c, p.value), h); i ? g.lineTo(x, y) : g.moveTo(x, y); }); };
      if (ci < 2) {   // soft area under the first channels
        path(); g.lineTo(gx(pts[pts.length - 1].time, w), gy(0, h)); g.lineTo(gx(pts[0].time, w), gy(0, h)); g.closePath();
        const fg = g.createLinearGradient(0, PADT, 0, h - PADB); fg.addColorStop(0, c.color + '38'); fg.addColorStop(1, c.color + '05'); g.fillStyle = fg; g.fill();
      }
      path(); g.strokeStyle = c.color; g.lineWidth = 2.2; g.lineJoin = 'round'; g.shadowColor = c.color; g.shadowBlur = 8; g.stroke(); g.shadowBlur = 0;
      // handles for segments touching a selected key
      c.segs.forEach((s, i) => {
        if (!(S.sel.has(c.id + '#' + i) || S.sel.has(c.id + '#' + (i + 1)))) return;
        const hh = segHandles(c, i); if (!hh) return;
        [[c.keys[i], hh[0], 0], [c.keys[i + 1], hh[1], 1]].forEach(([k, p, which]) => {
          const kx = gx(k.time, w), ky = gy(norm(c, k.value), h), px = gx(p.t, w), py = gy(p.n, h);
          g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1; g.beginPath(); g.moveTo(kx, ky); g.lineTo(px, py); g.stroke();
          g.beginPath(); g.arc(px, py, 5, 0, TAU); g.fillStyle = '#1b1c1f'; g.fill(); g.strokeStyle = c.color; g.lineWidth = 2; g.stroke();
          g.beginPath(); g.arc(px, py, 1.8, 0, TAU); g.fillStyle = c.color; g.fill();
          hit.handles.push({ c, i, which, x: px, y: py });
        });
      });
      c.keys.forEach((k, i) => {
        const x = gx(k.time, w), y = gy(norm(c, k.value), h), on = S.sel.has(c.id + '#' + i);
        diamond(g, x, y, on ? 6.5 : 5.2, on ? css('--amber') : '#f4f5f7', on ? '#fff' : c.color, on ? css('--amber') : null);
        hit.keys.push({ c, i, x, y });
      });
    });
    playheadLine(g, w, h);
    const s0 = selKeys()[0];    // value read-out of the first selected key
    if (s0) { const k = s0.c.keys[s0.i]; label(g, `${fmt(k.time)}  ·  ${fmtVal(k.value)}`, Math.min(w - 150, Math.max(PADX, gx(k.time, w) + 10)), Math.max(PADT + 10, gy(norm(s0.c, k.value), h) - 18), s0.c.color); }
    if (drag && drag.type === 'box') {
      g.strokeStyle = css('--accent'); g.fillStyle = 'rgba(123,140,255,.12)'; g.lineWidth = 1;
      const r = drag.rect; g.fillRect(r.x, r.y, r.w, r.h); g.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    }
  }

  let drag = null;
  const pos = (e, canvas) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }; };
  const nearest = (list, p, rad) => list.map((o) => ({ o, d: Math.hypot(o.x - p.x, o.y - p.y) })).filter((x) => x.d <= rad).sort((a, b) => a.d - b.d)[0];

  cv.addEventListener('pointerdown', (e) => {
    const p = pos(e, cv); cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
    const hd = nearest(hit.handles, p, 9);
    if (hd) { pushUndo(); drag = { type: 'handle', h: hd.o }; return; }
    const kk = nearest(hit.keys, p, 10);
    if (kk) {
      const id = kk.o.c.id + '#' + kk.o.i;
      if (e.shiftKey) S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id);
      else if (!S.sel.has(id)) { S.sel.clear(); S.sel.add(id); }
      pushUndo();
      drag = { type: 'key', origin: p, starts: selKeys().map(({ c, i }) => ({ c, i, t: c.keys[i].time, v: c.keys[i].value })) };
      renderAll(); return;
    }
    if (e.shiftKey) { drag = { type: 'box', origin: p, rect: { x: p.x, y: p.y, w: 0, h: 0 } }; return; }
    S.sel.clear(); drag = { type: 'pan', origin: p, v0: Object.assign({}, S.view) }; renderAll();
  });
  cv.addEventListener('pointermove', (e) => {
    const p = pos(e, cv);
    if (!drag) { cv.style.cursor = nearest(hit.handles, p, 9) ? 'crosshair' : nearest(hit.keys, p, 10) ? 'pointer' : 'default'; return; }
    if (drag.type === 'pan') {
      const dt = ((p.x - drag.origin.x) / (p.w - PADX - 16)) * (drag.v0.t1 - drag.v0.t0);
      S.view = { t0: drag.v0.t0 - dt, t1: drag.v0.t1 - dt };
    } else if (drag.type === 'box') {
      drag.rect = { x: Math.min(p.x, drag.origin.x), y: Math.min(p.y, drag.origin.y), w: Math.abs(p.x - drag.origin.x), h: Math.abs(p.y - drag.origin.y) };
      S.sel.clear();
      hit.keys.forEach((k) => { if (k.x >= drag.rect.x && k.x <= drag.rect.x + drag.rect.w && k.y >= drag.rect.y && k.y <= drag.rect.y + drag.rect.h) S.sel.add(k.c.id + '#' + k.i); });
    } else if (drag.type === 'key') {
      const dt = gt(p.x, p.w) - gt(drag.origin.x, p.w), dn = gn(p.y, p.h) - gn(drag.origin.y, p.h);
      drag.starts.forEach((s) => {
        const ks = s.c.keys, frame = 1 / S.fps;
        const lo = s.i > 0 ? ks[s.i - 1].time + frame : -Infinity, hi = s.i < ks.length - 1 ? ks[s.i + 1].time - frame : Infinity;
        ks[s.i].time = Math.round(Math.min(hi, Math.max(lo, s.t + dt)) * S.fps) / S.fps;
        if (s.c.dims === 1) { const ax = axisOf(s.c); if (!ax.flat) ks[s.i].value = s.v + dn * (ax.hi - ax.lo); }   // value drag: scalar channels only
      });
      drag.starts.forEach((s) => markDirty(s.c));
    } else if (drag.type === 'handle') {
      const { c, i, which } = drag.h, a = c.keys[i], b = c.keys[i + 1];
      const na = norm(c, a.value), nb = norm(c, b.value);
      const x = Math.min(1, Math.max(0, (gt(p.x, p.w) - a.time) / (b.time - a.time)));
      let y = Math.abs(nb - na) < 1e-9 ? c.segs[i].p[which * 2 + 1] : (gn(p.y, p.h) - na) / (nb - na);
      y = Math.min(2.5, Math.max(-1.5, y));
      const q = c.segs[i].p.slice(); q[which * 2] = x; q[which * 2 + 1] = y; c.segs[i] = { kind: 'bezier', p: q };
      markDirty(c);
    }
    renderAll();
  });
  const endDrag = () => { drag = null; renderAll(); };
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('wheel', (e) => {
    e.preventDefault(); const p = pos(e, cv), t = gt(p.x, p.w), k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    S.view = { t0: t - (t - S.view.t0) * k, t1: t + (S.view.t1 - t) * k }; renderAll();
  }, { passive: false });
  cv.addEventListener('dblclick', (e) => {
    const p = pos(e, cv), cs = active(); if (!cs.length) return;
    let best = null;   // channel whose curve is closest to the click
    cs.forEach((c) => {
      const t = gt(p.x, p.w); if (t < c.keys[0].time || t > c.keys[c.keys.length - 1].time) return;
      const d = Math.abs(gy(norm(c, valueAt(c, t)), p.h) - p.y);
      if (!best || d < best.d) best = { c, d, t };
    });
    if (!best || best.d > 24) return;
    pushUndo(); insertKey(best.c, Math.round(best.t * S.fps) / S.fps); S.sel.clear(); markDirty(best.c); renderAll();
  });

  /* Insert a key on the curve without changing its shape (de Casteljau split for bezier segments). */
  function insertKey(c, t) {
    let i = 0; while (i < c.keys.length - 2 && c.keys[i + 1].time < t) i++;
    const a = c.keys[i], b = c.keys[i + 1]; if (t <= a.time || t >= b.time) return;
    const x = (t - a.time) / (b.time - a.time), e = c.segs[i], v = valueAt(c, t);
    let left = E.clone(E.LINEAR), right = E.clone(E.LINEAR);
    if (e.kind === 'bezier') {
      const [x1, y1, x2, y2] = e.p;   // solve x(s) = x by bisection
      const bx = (s) => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
      let lo = 0, hi = 1, s = x; for (let n = 0; n < 40; n++) { s = (lo + hi) / 2; bx(s) < x ? (lo = s) : (hi = s); }
      const L = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
      const P0 = [0, 0], P1 = [x1, y1], P2 = [x2, y2], P3 = [1, 1];
      const A1 = L(P0, P1, s), B1 = L(P1, P2, s), C1 = L(P2, P3, s), A2 = L(A1, B1, s), B2 = L(B1, C1, s), M = L(A2, B2, s);
      const rel = (pt, o, sx, sy) => [(pt[0] - o[0]) / sx, (pt[1] - o[1]) / sy];
      if (M[0] > 1e-6 && 1 - M[0] > 1e-6 && Math.abs(M[1]) > 1e-6 && Math.abs(1 - M[1]) > 1e-6) {
        left = { kind: 'bezier', p: [...rel(A1, [0, 0], M[0], M[1]), ...rel(A2, [0, 0], M[0], M[1])] };
        right = { kind: 'bezier', p: [...rel(B2, M, 1 - M[0], 1 - M[1]), ...rel(C1, M, 1 - M[0], 1 - M[1])] };
      }
    }
    c.keys.splice(i + 1, 0, { time: t, value: v });
    c.segs.splice(i, 1, left, right);
  }

  // ------------------------------------------------------------------ channel list
  function renderChannels() {
    const box = $('#chlist'); box.textContent = '';
    if (!S.order.length) { box.appendChild(el('div', 'chempty', 'No animated channels')); return; }
    let last = null;
    S.order.forEach((id) => {
      const c = S.ch[id];
      if (c.group !== last) { box.appendChild(el('div', 'chgroup', c.group)); last = c.group; }
      const on = S.visible.has(id), row = el('div', 'chrow' + (on ? ' on' : ''));
      const dot = el('span', 'dot'); dot.style.background = on ? c.color : 'transparent'; dot.style.border = '1.5px solid ' + c.color;
      row.appendChild(dot); row.appendChild(el('span', '', c.name));
      row.title = 'Click: solo · Shift/Ctrl+click: add or remove';
      row.onclick = (e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) S.visible.has(id) ? S.visible.delete(id) : S.visible.add(id);
        else { S.visible.clear(); S.visible.add(id); }
        S.sel.clear(); fitView(); renderAll();
      };
      box.appendChild(row);
    });
  }

  // ------------------------------------------------------------------ presets
  function drawEaseIcon(cnv, ease, color) {
    const dpr = window.devicePixelRatio || 1, W = 34, H = 22; cnv.width = W * dpr; cnv.height = H * dpr;
    const g = cnv.getContext('2d'); g.scale(dpr, dpr);
    g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1; g.strokeRect(2.5, 3.5, W - 5, H - 7);
    g.strokeStyle = color || css('--text'); g.lineWidth = 1.8; g.lineJoin = 'round'; g.beginPath();
    for (let i = 0; i <= 32; i++) { const x = 4 + (i / 32) * (W - 8), y = H - 5 - (E.evaluate(ease, i / 32) * (H - 10)); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  function blend(ease, s) {
    if (ease.kind !== 'bezier' || s >= 100) return E.clone(ease);
    const k = s / 100, lin = [1 / 3, 1 / 3, 2 / 3, 2 / 3];
    return { kind: 'bezier', p: ease.p.map((v, i) => lin[i] + (v - lin[i]) * k) };
  }
  function targetSegs() {                // segments affected by a preset
    const out = [], sel = selKeys();
    if (sel.length) sel.forEach(({ c, i }) => { if (i < c.segs.length) out.push({ c, i }); });
    else active().forEach((c) => c.segs.forEach((_, i) => out.push({ c, i })));
    return out;
  }
  function applyEase(ease) {
    const t = targetSegs(); if (!t.length) return status('Nothing to ease — pick a channel with 2+ keyframes.', 'err');
    pushUndo(); const e = blend(ease, S.strength);
    t.forEach(({ c, i }) => { c.segs[i] = E.clone(e); markDirty(c); });
    renderAll();
  }
  function renderPresets() {
    const gb = $('#groups'); gb.textContent = '';
    E.GROUPS.forEach((g) => {
      const b = el('button', 'grp' + (S.group === g ? ' active' : ''), g === 'all' ? 'All' : g === 'custom' ? '★ Custom' : g[0].toUpperCase() + g.slice(1));
      b.onclick = () => { S.group = g; renderPresets(); }; gb.appendChild(b);
    });
    const box = $('#presets'); box.textContent = '';
    const first = selKeys()[0], cur = first && first.i < first.c.segs.length ? first.c.segs[first.i] : null;
    const list = [...E.PRESETS, ...S.custom.map((p) => ({ label: p.label, group: 'custom', ease: p.ease, custom: true }))];
    const shown = list.filter((p) => S.group === 'all' || (S.group === 'custom' ? p.custom : (p.group === S.group || (p.group === 'inout' && (S.group === 'in' || S.group === 'out')))));
    shown.forEach((p) => {
      const on = cur && E.same(cur, p.ease), b = el('button', 'preset' + (on ? ' active' : ''));
      const ic = el('canvas'); drawEaseIcon(ic, p.ease, on ? '#c9d0ff' : null); b.appendChild(ic); b.appendChild(document.createTextNode(p.label));
      b.title = p.custom ? 'Right-click to delete' : p.label;
      b.onclick = () => applyEase(p.ease);
      if (p.custom) b.oncontextmenu = (ev) => { ev.preventDefault(); S.custom = S.custom.filter((x) => x.label !== p.label); persistCustom(); renderPresets(); };
      box.appendChild(b);
    });
    if (!shown.length) box.appendChild(el('div', 'preset-empty', 'Select a keyframe, then press ★ to save its easing here.'));
  }
  const persistCustom = () => { try { localStorage.setItem('lg.custom', JSON.stringify(S.custom)); } catch (_) { /* storage unavailable */ } };

  // ------------------------------------------------------------------ KEYFRAMES tab (dopesheet)
  const dope = $('#dope'); const dhit = [];
  const ROW = 26;
  function drawDope() {
    const { g, w, h } = setup(dope); g.clearRect(0, 0, w, h); dhit.length = 0;
    g.fillStyle = '#212328'; g.fillRect(0, 0, w, h);
    grid(g, w, h, false);
    const cs = S.order.map((id) => S.ch[id]);
    setEmpty('#empty2', !cs.length, 'No animated channels', S.error || 'Select a clip with keyframes and press ↻.');
    cs.forEach((c, r) => {
      const y = PADT + 10 + r * ROW;
      g.fillStyle = r % 2 ? 'rgba(255,255,255,.015)' : 'rgba(255,255,255,.04)'; g.fillRect(0, y - ROW / 2, w, ROW);
      g.fillStyle = css('--muted'); g.font = '10px -apple-system, "Segoe UI", sans-serif'; g.fillText(c.name, 8, y + 3.5);
      const x0 = gx(c.keys[0].time, w), x1 = gx(c.keys[c.keys.length - 1].time, w);
      g.fillStyle = c.color + '26'; roundRect(g, x0, y - 5, Math.max(1, x1 - x0), 10, 5); g.fill();
      c.keys.forEach((k, i) => {
        const x = gx(k.time, w), on = S.sel.has(c.id + '#' + i);
        diamond(g, x, y, on ? 6.2 : 5, on ? css('--amber') : c.color, on ? '#fff' : '#1b1c1f', on ? css('--amber') : null); dhit.push({ c, i, x, y });
      });
    });
    playheadLine(g, w, h);
    if (drag && drag.type === 'dbox') {
      const r = drag.rect; g.strokeStyle = css('--accent'); g.fillStyle = 'rgba(123,140,255,.12)'; g.fillRect(r.x, r.y, r.w, r.h); g.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    }
  }
  dope.addEventListener('pointerdown', (e) => {
    const p = pos(e, dope); dope.setPointerCapture && dope.setPointerCapture(e.pointerId);
    const k = nearest(dhit, p, 10);
    if (k) {
      const id = k.o.c.id + '#' + k.o.i;
      if (e.shiftKey) S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); else if (!S.sel.has(id)) { S.sel.clear(); S.sel.add(id); }
      pushUndo(); drag = { type: 'dkey', origin: p, starts: selKeys().map(({ c, i }) => ({ c, i, t: c.keys[i].time })) }; renderAll(); return;
    }
    if (p.y < PADT + 2) { S.playhead = gt(p.x, p.w); renderAll(); return; }
    drag = { type: 'dbox', origin: p, rect: { x: p.x, y: p.y, w: 0, h: 0 } }; if (!e.shiftKey) S.sel.clear();
  });
  dope.addEventListener('pointermove', (e) => {
    const p = pos(e, dope);
    if (!drag) { dope.style.cursor = nearest(dhit, p, 10) ? 'ew-resize' : 'default'; return; }
    if (drag.type === 'dkey') {
      const dt = gt(p.x, p.w) - gt(drag.origin.x, p.w);
      drag.starts.forEach((s) => {
        const ks = s.c.keys, f = 1 / S.fps;
        const lo = s.i > 0 ? ks[s.i - 1].time + f : -Infinity, hi = s.i < ks.length - 1 ? ks[s.i + 1].time - f : Infinity;
        ks[s.i].time = Math.round(Math.min(hi, Math.max(lo, s.t + dt)) * S.fps) / S.fps; markDirty(s.c);
      });
    } else if (drag.type === 'dbox') {
      drag.rect = { x: Math.min(p.x, drag.origin.x), y: Math.min(p.y, drag.origin.y), w: Math.abs(p.x - drag.origin.x), h: Math.abs(p.y - drag.origin.y) };
      dhit.forEach((k) => { const r = drag.rect, id = k.c.id + '#' + k.i; (k.x >= r.x && k.x <= r.x + r.w && k.y >= r.y && k.y <= r.y + r.h) ? S.sel.add(id) : S.sel.delete(id); });
    }
    renderAll();
  });
  dope.addEventListener('pointerup', endDrag); dope.addEventListener('pointercancel', endDrag);

  // ------------------------------------------------------------------ ANIMATIONS tab
  const acv = $('#anim-cv');
  function animIcon(cnv, id, on) {
    const dpr = window.devicePixelRatio || 1, W = 34, H = 22; cnv.width = W * dpr; cnv.height = H * dpr;
    const g = cnv.getContext('2d'); g.scale(dpr, dpr); const d = A.DEFS.find((x) => x.id === id), a = A.build(id, A.defaults(), 1);
    g.strokeStyle = on ? '#c9d0ff' : css('--muted'); g.lineWidth = 1.6; g.lineJoin = 'round'; g.beginPath();
    for (let i = 0; i <= 40; i++) { const u = i / 40, v = [].concat(a.at(u))[d.dims === 2 ? 1 : 0]; const x = 3 + u * (W - 6), y = H / 2 + Math.max(-1, Math.min(1, v)) * 7; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  function renderAnimList() {
    const box = $('#anim-list'); box.textContent = '';
    A.DEFS.forEach((d) => {
      const on = S.anim.id === d.id, b = el('button', 'anim-item' + (on ? ' active' : ''));
      const ic = el('canvas'); animIcon(ic, d.id, on); b.appendChild(ic); b.appendChild(document.createTextNode(d.label));
      b.onclick = () => { S.anim.id = d.id; renderAnimList(); }; box.appendChild(b);
    });
    const def = A.DEFS.find((d) => d.id === S.anim.id);
    $('#anim-title').textContent = def.label; $('#anim-hint').textContent = def.hint;
  }
  const paint = (inp) => { const pct = ((inp.value - inp.min) / (inp.max - inp.min)) * 100; inp.style.setProperty('--fill', `linear-gradient(90deg, ${css('--accent')} ${pct}%, ${css('--surface3')} ${pct}%)`); };
  function renderAnimSide() {
    const box = $('#anim-params'); box.textContent = '';
    A.PARAMS.forEach((p) => {
      const wrap = el('div', 'param'), row = el('div', 'row'); row.appendChild(el('span', '', p.label));
      const val = el('span', 'v', String(S.anim.params[p.id])); row.appendChild(val);
      const inp = el('input'); inp.type = 'range'; inp.min = p.min; inp.max = p.max; inp.step = p.step; inp.value = S.anim.params[p.id]; paint(inp);
      inp.oninput = () => { S.anim.params[p.id] = +inp.value; val.textContent = inp.value; paint(inp); };
      wrap.appendChild(row); wrap.appendChild(inp); box.appendChild(wrap);
    });
    const sel = $('#anim-target'); const prev = sel.value; sel.textContent = '';
    S.order.forEach((id) => { const o = el('option', '', `${S.ch[id].group} › ${S.ch[id].name}`); o.value = id; sel.appendChild(o); });
    if (prev && S.ch[prev]) sel.value = prev;
    $('#anim-apply').disabled = !S.order.length; $('#anim-apply').style.opacity = S.order.length ? 1 : .45;
  }
  function drawAnim(ts) {
    if (S.tab !== 'anim') return;
    const { g, w, h } = setup(acv); g.clearRect(0, 0, w, h);
    g.fillStyle = '#212328'; g.fillRect(0, 0, w, h);
    const def = A.DEFS.find((d) => d.id === S.anim.id), a = A.build(def.id, S.anim.params, 1);
    const cy = h * 0.5, amp = Math.min(h, w) * 0.3;
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(16, cy + 0.5); g.lineTo(w - 16, cy + 0.5); g.stroke(); g.setLineDash([]);
    const lineY = (d) => cy + [].concat(d)[def.dims === 2 ? 1 : 0] * amp;
    g.beginPath(); for (let i = 0; i <= 140; i++) { const u = i / 140, x = 16 + u * (w - 32), y = lineY(a.at(u)); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = css('--accent'); g.lineWidth = 2; g.shadowColor = css('--accent'); g.shadowBlur = 8; g.stroke(); g.shadowBlur = 0;
    const play = Math.max(0.3, S.anim.params.durationF / S.fps) * 1000, u = Math.min(1, ((ts || 0) % (play + 600)) / play), d = a.at(u);
    const px = def.dims === 2 ? w / 2 + d[0] * amp : 16 + u * (w - 32), py = lineY(d);
    g.shadowColor = css('--teal'); g.shadowBlur = 14; g.fillStyle = css('--teal'); g.beginPath(); g.arc(px, py, 9, 0, TAU); g.fill(); g.shadowBlur = 0;
    requestAnimationFrame(drawAnim);
  }
  $('#anim-apply').onclick = () => {
    const c = S.ch[$('#anim-target').value];
    if (!c) return status('No target channel — scan a clip first.', 'err');
    const def = A.DEFS.find((d) => d.id === S.anim.id), t0 = Math.round(S.playhead * S.fps) / S.fps;
    const smp = A.sample(def.id, S.anim.params, c.ref, S.fps, t0), t1 = smp[smp.length - 1].time;
    const pick = (d) => (c.dims === 2 ? (def.dims === 2 ? d : [0, d]) : (def.dims === 2 ? d[0] : d));   // 1-D animation on a 2-D channel drives Y
    pushUndo();
    const before = c.keys.filter((k) => k.time < t0 - 1e-6), after = c.keys.filter((k) => k.time > t1 + 1e-6);
    const baked = smp.map((s) => ({ time: s.time, value: K.add(valueAt(c, s.time), pick(s.delta)) }));
    c.keys = [...before, ...baked, ...after];
    c.segs = c.keys.slice(1).map(() => E.clone(E.LINEAR));
    markDirty(c); S.visible.add(c.id); status(`${def.label} applied to ${c.name} · ${baked.length} keyframes`, 'ok'); renderAll();
  };

  // ------------------------------------------------------------------ wiring
  function renderAll() {
    const cn = $('#clipname'); cn.classList.toggle('hidden', !S.clip); cn.textContent = S.clip;
    $('#hostbadge').textContent = S.host.name;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === S.tab));
    ['curves', 'keys', 'anim'].forEach((t) => $('#tab-' + t).classList.toggle('hidden', t !== S.tab));
    $('#hints').textContent = HINTS[S.tab];
    if (S.tab === 'curves') { renderChannels(); drawCurves(); renderPresets(); }
    if (S.tab === 'keys') drawDope();
    $('#btn-undo').classList.toggle('disabled', !S.undo.length); $('#btn-redo').classList.toggle('disabled', !S.redo.length);
  }
  document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => {
    S.tab = t.dataset.tab; renderAll();
    if (S.tab === 'anim') { renderAnimList(); renderAnimSide(); requestAnimationFrame(drawAnim); }
  }));
  $('#btn-scan').onclick = () => scan();
  $('#btn-fit').onclick = () => { fitView(); renderAll(); };
  $('#btn-undo').onclick = undo; $('#btn-redo').onclick = redo;
  $('#btn-live').onclick = (e) => { S.live = !S.live; e.currentTarget.classList.toggle('on', S.live); if (S.live) { S.order.forEach((id) => dirty.add(id)); scheduleCommit(true); } };
  $('#btn-del').onclick = () => deleteSelected();
  $('#btn-add').onclick = () => {
    const c = active()[0] || S.ch[S.order[0]]; if (!c) return status('Scan a clip first.', 'err');
    pushUndo(); const t = Math.round(S.playhead * S.fps) / S.fps;
    if (t > c.keys[0].time && t < c.keys[c.keys.length - 1].time) insertKey(c, t);
    else if (t <= c.keys[0].time) { c.keys.unshift({ time: t, value: c.keys[0].value }); c.segs.unshift(E.clone(E.LINEAR)); }
    else { c.keys.push({ time: t, value: c.keys[c.keys.length - 1].value }); c.segs.push(E.clone(E.LINEAR)); }
    markDirty(c); renderAll();
  };
  $('#btn-save').onclick = () => {
    const s = selKeys()[0]; if (!s || s.i >= s.c.segs.length) return status('Select a keyframe with an outgoing segment first.', 'err');
    S.custom.push({ label: 'Custom ' + (S.custom.length + 1), ease: E.clone(s.c.segs[s.i]) }); persistCustom(); S.group = 'custom'; renderAll(); status('Saved as custom preset.', 'ok');
  };
  function deleteSelected() {
    const sel = selKeys(); if (!sel.length) return;
    pushUndo();
    const byCh = new Map(); sel.forEach(({ c, i }) => { if (!byCh.has(c)) byCh.set(c, []); byCh.get(c).push(i); });
    byCh.forEach((idx, c) => {
      idx.sort((a, b) => b - a).forEach((i) => { if (c.keys.length > 2) { c.keys.splice(i, 1); c.segs.splice(Math.min(i, c.segs.length - 1), 1); } });
      markDirty(c);
    });
    S.sel.clear(); renderAll();
  }
  $('#strength').oninput = (e) => { S.strength = +e.target.value; $('#strength-v').textContent = S.strength + '%'; paint(e.target); };
  paint($('#strength'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
    if (e.key === 'f' || e.key === 'F') { fitView(); renderAll(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  });
  window.addEventListener('resize', renderAll);
  document.querySelectorAll('canvas[data-ico]').forEach(drawIcon);

  window.LG.app = { S, scan, commit, applyEase, insertKey, renderAll, hit };   // exposed for tests
  renderAnimList(); renderAnimSide(); scan();
})();
