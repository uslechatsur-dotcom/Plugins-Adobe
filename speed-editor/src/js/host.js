/* Host adapters for the Speed panel. The panel only talks to this interface (all async):
 *   scan(opts)     -> { clip, node, how, sig, fps, abs, start, end, inPoint, outPoint, speed|null, candidates[] }
 *   ph()           -> number   sequence playhead in seconds — polled many times per second, keep it light
 *   probe()        -> { sig }  selection signature, polled ~2x per second
 *   seek(abs)      -> moves the Premiere playhead
 *   apply(w)       -> w = { ci, pi, keys:[{time,value}] } or { ci, pi, reset:true, resetValue }
 *   diagnostics()  -> string[]  what Premiere exposes for the clip (to debug a setup)
 * `cep` = CEP extension (ExtendScript through evalScript); `mock` = in-memory stand-in for a browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.LG = root.LG || {}).host = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function cep(bridge) {
    let node = null;
    const evalRaw = (call) => new Promise((resolve) => bridge.evalScript(call, resolve));
    const run = async (fn, arg) => {
      const raw = await evalRaw('SC_' + fn + '(' + (arg === undefined ? '' : JSON.stringify(JSON.stringify(arg))) + ')');
      let r; try { r = JSON.parse(raw); } catch (_) { throw new Error('ExtendScript: ' + raw); }
      if (!r || !r.ok) throw new Error((r && r.error) || 'ExtendScript error');
      return r;
    };
    return {
      name: 'Premiere Pro · CEP', live: true,
      async scan(opts) { const r = await run('scan', opts || {}); node = r.node; return r; },
      async ph() { const v = parseFloat(await evalRaw('SC_ph()')); if (!Number.isFinite(v)) throw new Error('no sequence'); return v; },
      async probe() { return run('probe'); },
      async seek(abs) { await run('seek', { abs }); },
      async apply(w) { await run('apply', Object.assign({ node }, w)); },
      async diagnostics() { return (await run('diag')).lines; },
    };
  }

  function mock() {
    const state = {
      fps: 30, start: 10, end: 16, inPoint: 0, abs: 12.4, playing: false, playedAt: 0, playFrom: 0, sig: 'mock',
      unit: 'percent', speedKeys: [{ time: 0, value: 100 }, { time: 1.2, value: 100 }, { time: 2.4, value: 25 }, { time: 3.6, value: 25 }, { time: 4.8, value: 220 }, { time: 6, value: 100 }],
      calls: [],
    };
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const copy = (x) => JSON.parse(JSON.stringify(x));
    const api = {
      name: 'Preview (no Premiere)', live: false, state,
      play() { state.playing = true; state.playedAt = now(); state.playFrom = state.abs; },
      pause() { state.abs = api._abs(); state.playing = false; },
      _abs() {
        if (!state.playing) return state.abs;
        const len = state.end - state.start, t = state.playFrom - state.start + (now() - state.playedAt) / 1000;
        return state.start + (t % len);
      },
      async scan() {
        const keys = copy(state.speedKeys), toHost = (v) => (state.unit === 'factor' ? v / 100 : v);
        return { clip: 'dive_shot_slo.mp4', node: 'N1', how: 'selection', sig: state.sig, fps: state.fps, abs: api._abs(),
          start: state.start, end: state.end, inPoint: state.inPoint, outPoint: 30,
          speed: { ci: 3, pi: 0, label: 'Time Remapping › Speed', tv: keys.length > 0, value: toHost(100), keys: keys.map((k) => ({ time: k.time, value: toHost(k.value) })) },
          candidates: [{ ci: 3, pi: 0, label: 'Time Remapping › Speed', tv: true, value: 100, nkeys: keys.length }] };
      },
      async ph() { return api._abs(); },
      async probe() { return { sig: state.sig }; },
      async seek(abs) { state.abs = abs; state.playFrom = abs; state.playedAt = now(); state.calls.push(['seek', abs]); },
      async apply(w) {
        state.calls.push(['apply', w.reset ? 'reset' : w.keys.length]);
        state.speedKeys = w.reset ? [] : w.keys.map((k) => ({ time: k.time, value: state.unit === 'factor' ? k.value * 100 : k.value }));
      },
      async diagnostics() { return ['Premiere 26.0 · sequence "Seq 01" · timebase 8467200000', 'clip "dive_shot_slo.mp4" start 10 end 16 in 0 out 30', '[3] Time Remapping  (match: AE.ADBE Time Remapping)  <= looks like Time Remapping', '    (3:0) Speed  value 100  KEYFRAMED x6  <= named Speed']; },
    };
    return api;
  }

  function detect() {
    if (typeof window !== 'undefined' && window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === 'function') return cep(window.__adobe_cep__);
    return mock();
  }
  return { cep, mock, detect };
});
