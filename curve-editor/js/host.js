/* Host adapters. `premiere` talks to the UXP `premierepro` module; `mock` is an in-memory
 * stand-in used when the panel is opened in a plain browser (dev / tests / screenshots).
 *
 * Common interface (all async):
 *   scan()            -> { clip, fps, playhead, channels:[{id,name,group,dims,ref,keys:[{time,value}]}] }
 *   apply(edits,label)-> writes  edits:[{id, keys:[{time,value}]}]  (replaces the channel's keyframes)
 *   addKey(id,time)   -> adds a keyframe holding the current value
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.LG = root.LG || {}).host = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------ Premiere (UXP)
  function premiere(ppro) {
    const T = (s) => ppro.TickTime.createWithSeconds(s);
    const secs = (t) => (t && typeof t.seconds === 'number' ? t.seconds : Number(t));
    const unwrap = (kf) => { let v = kf && kf.value; if (v && typeof v === 'object' && 'value' in v) v = v.value; return v; };
    const toJs = (v) => (v && typeof v === 'object' && 'x' in v ? [v.x, v.y] : v);
    const toHost = (v) => (Array.isArray(v) ? new ppro.PointF(v[0], v[1]) : v);
    const dimsOf = (v) => (Array.isArray(v) ? 2 : 1);
    const refOf = (v) => (Array.isArray(v) ? Math.max(Math.hypot(v[0], v[1]) * 0.25, 50) : Math.max(Math.abs(v), 100) * (Math.abs(v) < 5 ? 1 : 0.5));

    let handles = new Map();   // channel id -> { project, param, item }

    async function context() {
      const project = await ppro.Project.getActiveProject();
      const seq = project && (await project.getActiveSequence());
      if (!seq) throw new Error('Open a sequence first.');
      return { project, seq };
    }

    async function scan() {
      const { project, seq } = await context();
      const sel = await seq.getSelection();
      const items = (await sel.getTrackItems()) || [];
      const item = items.find((i) => i && typeof i.getComponentChain === 'function');
      if (!item) throw new Error('Select a clip in the timeline.');
      const chain = await item.getComponentChain();
      const nComp = await chain.getComponentCount();
      handles = new Map();
      const channels = [];
      for (let ci = 0; ci < nComp; ci++) {
        const comp = await chain.getComponentAtIndex(ci);
        const cname = (await comp.getDisplayName()) || 'Effect';
        const nPar = await comp.getParamCount();
        for (let pi = 0; pi < nPar; pi++) {
          const param = await comp.getParam(pi);
          if (!param || !(await param.areKeyframesSupported())) continue;
          if (!(await param.isTimeVarying())) continue;
          const times = (await param.getKeyframeListAsArray()) || [];
          if (!times.length) continue;
          const keys = [];
          for (const t of times) keys.push({ time: secs(t), value: toJs(unwrap(await param.getKeyframePtr(t))) });
          keys.sort((a, b) => a.time - b.time);
          const id = ci + ':' + pi;
          handles.set(id, { project, param, item, times });
          channels.push({ id, name: param.displayName || 'Param ' + pi, group: cname, dims: dimsOf(keys[0].value), ref: refOf(keys[0].value), keys });
        }
      }
      let fps = 30;
      try { const ts = await seq.getSettings(); fps = 1 / secs(await ts.getVideoFrameRate()) || 30; } catch (_) { /* keep default */ }
      let playhead = 0;
      try { playhead = secs(await seq.getPlayerPosition()) - secs(await item.getStartTime()) + secs(await item.getInPoint()); } catch (_) { /* keep 0 */ }
      return { clip: (await item.getName()) || 'Clip', fps, playhead, channels };
    }

    async function apply(edits, label) {
      const { project } = await context();
      const errors = [];
      project.lockedAccess(() => {
        project.executeTransaction((ca) => {
          for (const e of edits) {
            const h = handles.get(e.id);
            if (!h) { errors.push('stale channel ' + e.id); continue; }
            const { param } = h;
            const prev = h.times;   // keyframe times captured at scan(); the panel rescans after every apply
            if (Array.isArray(prev) && prev.length && param.createRemoveKeyframeRangeAction) {
              ca.addAction(param.createRemoveKeyframeRangeAction(prev[0], prev[prev.length - 1], true));
            }
            for (const k of e.keys) {
              const kf = param.createKeyframe(toHost(k.value));
              kf.position = T(k.time);
              ca.addAction(param.createAddKeyframeAction(kf));
            }
          }
        }, label || 'Legolas Curves');
      });
      if (errors.length) throw new Error(errors.join('; '));
    }

    async function addKey(id, time) {
      const h = handles.get(id);
      if (!h) return;
      const { project, param } = h;
      const cur = unwrap(await param.getValueAtTime(T(time)));
      project.lockedAccess(() => project.executeTransaction((ca) => {
        const kf = param.createKeyframe(cur); kf.position = T(time); ca.addAction(param.createAddKeyframeAction(kf));
      }, 'Add keyframe'));
    }

    return { name: 'Premiere Pro', scan, apply, addKey, live: true };
  }

  // ------------------------------------------------------------------ Mock (browser / tests)
  function mock() {
    const fps = 30;
    const state = {
      playhead: 1.2,
      channels: [
        { id: '0:0', name: 'Position', group: 'Motion', dims: 2, ref: 240, keys: [{ time: 0, value: [960, 540] }, { time: 1.5, value: [1300, 470] }, { time: 3, value: [1500, 620] }] },
        { id: '0:1', name: 'Scale', group: 'Motion', dims: 1, ref: 100, keys: [{ time: 0, value: 40 }, { time: 1.5, value: 100 }, { time: 3, value: 90 }] },
        { id: '0:2', name: 'Rotation', group: 'Motion', dims: 1, ref: 100, keys: [{ time: 0, value: 0 }, { time: 3, value: 180 }] },
        { id: '1:0', name: 'Opacity', group: 'Opacity', dims: 1, ref: 100, keys: [{ time: 0, value: 0 }, { time: 0.8, value: 100 }] },
      ],
    };
    const copy = (x) => JSON.parse(JSON.stringify(x));
    return {
      name: 'Preview (no Premiere)', live: false, state,
      async scan() { return { clip: 'demo_clip.mp4', fps, playhead: state.playhead, channels: copy(state.channels) }; },
      async apply(edits) { edits.forEach((e) => { const c = state.channels.find((x) => x.id === e.id); if (c) c.keys = copy(e.keys); }); },
      async addKey(id, time) { const c = state.channels.find((x) => x.id === id); if (!c) return; c.keys.push({ time, value: copy(c.keys[c.keys.length - 1].value) }); c.keys.sort((a, b) => a.time - b.time); },
    };
  }

  function detect() {
    try { if (typeof require === 'function') { const p = require('premierepro'); if (p) return premiere(p); } } catch (_) { /* not in UXP */ }
    return mock();
  }

  return { premiere, mock, detect };
});
