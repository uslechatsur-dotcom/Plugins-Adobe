/* Legolas+ — ExtendScript side of the CEP extension (ES3: no let/const/arrow/JSON).
 * Every entry point returns a JSON string: {"ok":true,...} or {"error":"..."}.
 * Keyframe times are exchanged in seconds; 2-D properties (Position…) as [x, y]. */

var LG_TICKS_PER_SECOND = 254016000000;

function LG_isArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }

function LG_json(v) {
  var t = typeof v, i, out;
  if (v === null || v === undefined) return 'null';
  if (t === 'number') return isFinite(v) ? String(v) : 'null';
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'string') {
    return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
  }
  if (LG_isArray(v)) {
    out = [];
    for (i = 0; i < v.length; i++) out.push(LG_json(v[i]));
    return '[' + out.join(',') + ']';
  }
  out = [];
  for (i in v) if (v.hasOwnProperty(i)) out.push(LG_json(String(i)) + ':' + LG_json(v[i]));
  return '{' + out.join(',') + '}';
}
function LG_fail(msg) { return LG_json({ error: String(msg) }); }
function LG_parse(s) { return eval('(' + s + ')'); }   // payload is produced by our own panel

function LG_sequence() {
  if (!app.project || !app.project.activeSequence) throw 'Open a sequence first.';
  return app.project.activeSequence;
}

function LG_findByNodeId(seq, nodeId) {
  var kinds = [seq.videoTracks, seq.audioTracks], k, t, c, tr;
  for (k = 0; k < kinds.length; k++) {
    if (!kinds[k]) continue;
    for (t = 0; t < kinds[k].numTracks; t++) {
      tr = kinds[k][t];
      for (c = 0; c < tr.clips.numItems; c++) if (tr.clips[c].nodeId === nodeId) return tr.clips[c];
    }
  }
  return null;
}

/* Clips that have an effect stack, in the selection (may be empty). */
function LG_selection(seq) {
  var sel = seq.getSelection(), out = [], i;
  for (i = 0; sel && i < sel.length; i++) if (sel[i] && sel[i].components) out.push(sel[i]);
  return out;
}
function LG_selectionSize(seq) { var sel = seq.getSelection(); return sel ? sel.length : 0; }

/* Video clips under the playhead, top track first (fallback when nothing is selected). */
function LG_underPlayhead(seq) {
  var ph = seq.getPlayerPosition().seconds, out = [], t, c, cl;
  for (t = seq.videoTracks.numTracks - 1; t >= 0; t--) {
    for (c = 0; c < seq.videoTracks[t].clips.numItems; c++) {
      cl = seq.videoTracks[t].clips[c];
      if (cl.start.seconds <= ph && ph < cl.end.seconds) out.push(cl);
    }
  }
  return out;
}
/* Short description of what getSelection() returned, for error messages: "name(components:object), …" */
function LG_describeSelection(seq) {
  var sel = seq.getSelection(), out = [], i;
  for (i = 0; sel && i < sel.length && i < 4; i++) out.push(String(sel[i] && sel[i].name) + '(components:' + typeof (sel[i] && sel[i].components) + ')');
  return (sel ? sel.length : 0) + ' selected: ' + out.join(', ');
}
function LG_selectedClip(seq) { var s = LG_selection(seq); return s.length ? s[0] : null; }

/* Identity of "what the panel should be showing": the selection, or the clips under the playhead when nothing is selected. */
function LG_sig(seq) {
  var sel = LG_selection(seq), list = sel.length ? sel : (LG_selectionSize(seq) ? [] : LG_underPlayhead(seq)), ids = [], i;
  for (i = 0; i < list.length; i++) ids.push(list[i].nodeId);
  return (sel.length ? 's:' : 'p:') + ids.join(',');
}

function LG_isNum(v) { return typeof v === 'number' && isFinite(v); }
function LG_value(v) {          // number | [x,y] | null (unsupported: colours, bools, text…)
  if (LG_isNum(v)) return v;
  if (LG_isArray(v) && v.length === 2 && LG_isNum(v[0]) && LG_isNum(v[1])) return [v[0], v[1]];
  return null;
}
function LG_ref(v) {
  if (LG_isArray(v)) return Math.max(Math.sqrt(v[0] * v[0] + v[1] * v[1]) * 0.25, 0.25);
  return Math.max(Math.abs(v), 100) * (Math.abs(v) < 5 ? 1 : 0.5);
}

/* Animated (keyframed, numeric or 2-D) properties of a clip. */
function LG_channels(clip) {
  var channels = [], ci, pi, ki, comp, p, keys, out, v;
  for (ci = 0; ci < clip.components.numItems; ci++) {
    comp = clip.components[ci];
    for (pi = 0; pi < comp.properties.numItems; pi++) {
      p = comp.properties[pi];
      try { if (!p.isTimeVarying()) continue; keys = p.getKeys(); } catch (e) { continue; }
      if (!keys || !keys.length) continue;
      out = [];
      for (ki = 0; ki < keys.length; ki++) {
        v = LG_value(p.getValueAtKey(keys[ki]));
        if (v === null) { out = null; break; }
        out.push({ time: keys[ki].seconds, value: v });
      }
      if (!out) continue;
      channels.push({
        id: ci + ':' + pi, name: p.displayName, group: comp.displayName,
        dims: LG_isArray(out[0].value) ? 2 : 1, ref: LG_ref(out[0].value), keys: out
      });
    }
  }
  return channels;
}

/* Cheap poll (called about once a second): playhead + selection signature. */
function LG_probe() {
  try {
    var seq = LG_sequence();
    return LG_json({ ok: true, sig: LG_sig(seq), abs: seq.getPlayerPosition().seconds });
  } catch (e) { return LG_fail(e); }
}

/* -> {ok, clip, node, how, sig, fps, offset, abs, playhead, channels:[{id,name,group,dims,ref,keys:[{time,value}]}]}
 * Picks the first selected clip that has animated properties; with an empty selection, falls back to the
 * clips under the playhead. `offset` = clip.start - clip.inPoint, so clip-local time = sequence time - offset. */
function LG_scan() {
  try {
    var seq = LG_sequence(), sel = LG_selection(seq), how = 'selection', list = sel, chosen = null, channels = [], i, ch, ts, abs;
    if (!list.length) {
      if (LG_selectionSize(seq)) return LG_fail('The selected item has no effects — select a video clip. [' + LG_describeSelection(seq) + ']');
      list = LG_underPlayhead(seq); how = 'playhead';
      if (!list.length) return LG_fail('No clip selected in the timeline, and no clip under the playhead.');
    }
    for (i = 0; i < list.length; i++) {
      ch = LG_channels(list[i]);
      if (ch.length) { chosen = list[i]; channels = ch; break; }
    }
    if (!chosen) chosen = list[0];
    ts = Number(seq.timebase);
    abs = seq.getPlayerPosition().seconds;
    return LG_json({
      ok: true, clip: chosen.name, node: chosen.nodeId, how: how, sig: LG_sig(seq),
      fps: ts > 0 ? LG_TICKS_PER_SECOND / ts : 30,
      offset: chosen.start.seconds - chosen.inPoint.seconds, abs: abs,
      playhead: abs - chosen.start.seconds + chosen.inPoint.seconds,
      channels: channels
    });
  } catch (e) { return LG_fail(e); }
}

/* payload: {node, label, edits:[{id, keys:[{time,value}]}]} — replaces each channel's keyframes. */
function LG_apply(payload) {
  try {
    var d = LG_parse(payload), seq = LG_sequence(), clip = LG_findByNodeId(seq, d.node) || LG_selectedClip(seq);
    if (!clip) return LG_fail('Clip not found — rescan.');
    var e, k, ids, p, old, t, last, written = 0;
    for (e = 0; e < d.edits.length; e++) {
      ids = d.edits[e].id.split(':');
      p = clip.components[Number(ids[0])].properties[Number(ids[1])];
      p.setTimeVarying(true);
      old = p.getKeys();
      if (old && old.length) p.removeKeyRange(old[0], old[old.length - 1], false);
      p.setTimeVarying(true);
      for (k = 0; k < d.edits[e].keys.length; k++) {
        t = new Time(); t.seconds = d.edits[e].keys[k].time;
        last = (e === d.edits.length - 1 && k === d.edits[e].keys.length - 1);   // refresh the UI once, at the end
        p.addKey(t);
        p.setValueAtKey(t, d.edits[e].keys[k].value, last);
        written++;
      }
    }
    return LG_json({ ok: true, written: written });
  } catch (e2) { return LG_fail(e2); }
}
