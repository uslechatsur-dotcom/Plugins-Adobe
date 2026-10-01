/* Speed Curves \u2014 ExtendScript side (ES3: no let/const/arrow/JSON). Names are prefixed SC_ because every CEP
 * extension shares one ExtendScript engine. Entry points return a JSON string {"ok":true,...} / {"error":"..."},
 * except SC_ph which returns a bare number (it is polled many times per second).
 * Times are seconds. */

var SC_TICKS = 254016000000;
var SC_TR_NAMES = ['time remapping', 'remappage temporel', 'zeitremapping', 'remapeo de tiempo', 'remapeamento de tempo',
  'riallineamento temporale', 'tijdsremapping', 'tidsomformning', '\u0442\u0430\u0439\u043c-\u0440\u0435\u043c\u0430\u043f\u043f\u0438\u043d\u0433', '\u30bf\u30a4\u30e0\u30ea\u30de\u30c3\u30d7', '\u65f6\u95f4\u91cd\u6620\u5c04', '\uc2dc\uac04 \ub9ac\ub9e4\ud551'];
var SC_SPEED_NAMES = ['speed', 'vitesse', 'geschwindigkeit', 'velocidad', 'velocidade', 'velocit\u00e0', 'velocita', 'snelheid',
  'hastighet', '\u0441\u043a\u043e\u0440\u043e\u0441\u0442\u044c', '\u30b9\u30d4\u30fc\u30c9', '\u901f\u5ea6', '\uc18d\ub3c4'];

function SC_isArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
function SC_json(v) {
  var t = typeof v, i, out;
  if (v === null || v === undefined) return 'null';
  if (t === 'number') return isFinite(v) ? String(v) : 'null';
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'string') return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
  if (SC_isArray(v)) { out = []; for (i = 0; i < v.length; i++) out.push(SC_json(v[i])); return '[' + out.join(',') + ']'; }
  out = [];
  for (i in v) if (v.hasOwnProperty(i)) out.push(SC_json(String(i)) + ':' + SC_json(v[i]));
  return '{' + out.join(',') + '}';
}
function SC_fail(msg) { return SC_json({ error: String(msg) }); }
function SC_parse(s) { return eval('(' + s + ')'); }     // payload comes from our own panel

function SC_sequence() {
  if (!app.project || !app.project.activeSequence) throw 'Open a sequence first.';
  return app.project.activeSequence;
}
function SC_lower(s) { try { return String(s).toLowerCase(); } catch (e) { return ''; } }
function SC_inList(list, s) { var i; s = SC_lower(s); for (i = 0; i < list.length; i++) if (list[i] === s) return true; return false; }

// ---------------------------------------------------------------- timeline / selection
function SC_ph() {                                   // polled ~30x/s: keep it tiny
  try { return String(app.project.activeSequence.getPlayerPosition().seconds); } catch (e) { return 'ERR'; }
}
function SC_seek(payload) {
  try {
    var d = SC_parse(payload), seq = SC_sequence();
    seq.setPlayerPosition(String(Math.round(d.abs * SC_TICKS)));
    return SC_json({ ok: true });
  } catch (e) { return SC_fail(e); }
}

function SC_selection(seq) {
  var sel = seq.getSelection(), out = [], i;
  for (i = 0; sel && i < sel.length; i++) if (sel[i] && sel[i].components) out.push(sel[i]);
  return out;
}
function SC_selectionSize(seq) { var sel = seq.getSelection(); return sel ? sel.length : 0; }
function SC_underPlayhead(seq) {
  var ph = seq.getPlayerPosition().seconds, out = [], t, c, cl;
  for (t = seq.videoTracks.numTracks - 1; t >= 0; t--) {
    for (c = 0; c < seq.videoTracks[t].clips.numItems; c++) {
      cl = seq.videoTracks[t].clips[c];
      if (cl.start.seconds <= ph && ph < cl.end.seconds) out.push(cl);
    }
  }
  return out;
}
function SC_sig(seq) {
  var sel = SC_selection(seq), list = sel.length ? sel : (SC_selectionSize(seq) ? [] : SC_underPlayhead(seq)), ids = [], i;
  for (i = 0; i < list.length; i++) ids.push(list[i].nodeId);
  return (sel.length ? 's:' : 'p:') + ids.join(',');
}
function SC_probe() {                                // ~2x/s: has the selection changed?
  try { return SC_json({ ok: true, sig: SC_sig(SC_sequence()) }); } catch (e) { return SC_fail(e); }
}
function SC_findByNodeId(seq, nodeId) {
  var t, c, tr;
  for (t = 0; t < seq.videoTracks.numTracks; t++) {
    tr = seq.videoTracks[t];
    for (c = 0; c < tr.clips.numItems; c++) if (tr.clips[c].nodeId === nodeId) return tr.clips[c];
  }
  return null;
}

// ---------------------------------------------------------------- finding Time Remapping > Speed
function SC_looksLikeTimeRemap(comp) {
  var mn = SC_lower(comp.matchName);
  if (mn.indexOf('time remap') >= 0 || mn.indexOf('timeremap') >= 0) return true;
  return SC_inList(SC_TR_NAMES, comp.displayName);
}

function SC_readProp(p) {
  var tv = false, val = null, keys = [], ks, i, v;
  try { tv = p.isTimeVarying(); } catch (e) { tv = false; }
  try { val = p.getValue(); } catch (e2) { val = null; }
  if (tv) {
    ks = p.getKeys();
    for (i = 0; ks && i < ks.length; i++) {
      v = p.getValueAtKey(ks[i]);
      if (typeof v !== 'number' || !isFinite(v)) return null;
      keys.push({ time: ks[i].seconds, value: v });
    }
  }
  if (!keys.length && (typeof val !== 'number' || !isFinite(val))) return null;
  return { tv: tv && keys.length > 0, value: typeof val === 'number' ? val : (keys.length ? keys[0].value : null), keys: keys };
}

/* All numeric properties that could be the speed: those of a Time Remapping component, and any property
 * named "Speed" (in any supported language) elsewhere. The best guess is flagged. */
function SC_candidates(clip) {
  var out = [], ci, pi, comp, p, isTR, named, info, hasStatic;
  for (ci = 0; ci < clip.components.numItems; ci++) {
    comp = clip.components[ci]; isTR = SC_looksLikeTimeRemap(comp);
    for (pi = 0; pi < comp.properties.numItems; pi++) {
      p = comp.properties[pi]; named = SC_inList(SC_SPEED_NAMES, p.displayName);
      if (!isTR && !named) continue;
      info = SC_readProp(p);
      if (!info) continue;
      out.push({ ci: ci, pi: pi, comp: comp.displayName, prop: p.displayName, label: comp.displayName + ' \u203a ' + p.displayName,
        score: (isTR ? 2 : 0) + (named ? 2 : 0), tv: info.tv, value: info.value, keys: info.keys });
    }
  }
  return out;
}
function SC_best(cands, prefer) {
  var i, best = null;
  if (prefer) for (i = 0; i < cands.length; i++) if (cands[i].ci === prefer.ci && cands[i].pi === prefer.pi) return cands[i];
  for (i = 0; i < cands.length; i++) if (!best || cands[i].score > best.score) best = cands[i];
  return best;
}

/* arg (optional JSON): {prefer:{ci,pi}}.  -> {ok, clip, node, how, sig, fps, abs, start, end, inPoint, outPoint,
 *   speed:{ci,pi,label,tv,value,keys}|null, candidates:[{ci,pi,label,tv,value,nkeys}]} */
function SC_scan(arg) {
  try {
    var seq = SC_sequence(), opts = (typeof arg === 'string' && arg.length) ? SC_parse(arg) : {}, sel = SC_selection(seq),
      how = 'selection', list = sel, chosen = null, cands = [], best = null, i, c, ts, abs, cl;
    if (!list.length) {
      if (SC_selectionSize(seq)) return SC_fail('The selected item has no effects \u2014 select a video clip (' + SC_selectionSize(seq) + ' selected).');
      list = SC_underPlayhead(seq); how = 'playhead';
      if (!list.length) return SC_fail('No clip selected in the timeline, and no clip under the playhead.');
    }
    for (i = 0; i < list.length; i++) {
      c = SC_candidates(list[i]);
      if (SC_best(c, null)) { chosen = list[i]; cands = c; break; }
    }
    if (!chosen) chosen = list[0];
    best = SC_best(cands, opts.prefer);
    ts = Number(seq.timebase); abs = seq.getPlayerPosition().seconds; cl = chosen;
    var summary = [];
    for (i = 0; i < cands.length; i++) summary.push({ ci: cands[i].ci, pi: cands[i].pi, label: cands[i].label, tv: cands[i].tv, value: cands[i].value, nkeys: cands[i].keys.length });
    return SC_json({
      ok: true, clip: cl.name, node: cl.nodeId, how: how, sig: SC_sig(seq),
      fps: ts > 0 ? SC_TICKS / ts : 30, abs: abs,
      start: cl.start.seconds, end: cl.end.seconds, inPoint: cl.inPoint.seconds, outPoint: cl.outPoint ? cl.outPoint.seconds : null,
      speed: best ? { ci: best.ci, pi: best.pi, label: best.label, tv: best.tv, value: best.value, keys: best.keys } : null,
      candidates: summary
    });
  } catch (e3) { return SC_fail(e3); }
}

// ---------------------------------------------------------------- writing
/* payload: {node, ci, pi, keys:[{time,value}]}  or  {node, ci, pi, reset:true, resetValue:100}
 * Replaces the speed keyframes. Times are in the same base the scan returned them in. */
function SC_apply(payload) {
  try {
    var d = SC_parse(payload), seq = SC_sequence(), clip = SC_findByNodeId(seq, d.node);
    if (!clip) return SC_fail('Clip not found \u2014 rescan.');
    var p = clip.components[d.ci].properties[d.pi], old, k, t, last;
    p.setTimeVarying(true);
    old = p.getKeys();
    if (old && old.length) p.removeKeyRange(old[0], old[old.length - 1], false);
    if (d.reset) {
      p.setTimeVarying(false);
      p.setValue(d.resetValue, true);
      return SC_json({ ok: true, written: 0 });
    }
    p.setTimeVarying(true);
    for (k = 0; k < d.keys.length; k++) {
      t = new Time(); t.seconds = d.keys[k].time;
      last = (k === d.keys.length - 1);
      p.addKey(t);
      p.setValueAtKey(t, d.keys[k].value, last);
    }
    return SC_json({ ok: true, written: d.keys.length });
  } catch (e) { return SC_fail(e); }
}

// ---------------------------------------------------------------- diagnostics (so a user can send us what Premiere exposes)
function SC_diag() {
  try {
    var seq = SC_sequence(), lines = [], sel = seq.getSelection(), i, ci, pi, comp, p, clip, info, line, mn, pmn;
    lines.push('Premiere ' + (app.version || '?') + ' \u00b7 sequence "' + seq.name + '" \u00b7 timebase ' + seq.timebase);
    lines.push('playhead ' + seq.getPlayerPosition().seconds + ' s \u00b7 selection ' + (sel ? sel.length : 0) + ' item(s) \u00b7 video tracks ' + seq.videoTracks.numTracks);
    for (i = 0; sel && i < sel.length && i < 4; i++) lines.push('selected[' + i + '] ' + sel[i].name + ' (components: ' + typeof sel[i].components + ')');
    clip = SC_selection(seq)[0] || SC_underPlayhead(seq)[0];
    if (!clip) { lines.push('no clip with effects selected or under the playhead'); return SC_json({ ok: true, lines: lines }); }
    lines.push('clip "' + clip.name + '" start ' + clip.start.seconds + ' end ' + clip.end.seconds + ' in ' + clip.inPoint.seconds + ' out ' + (clip.outPoint ? clip.outPoint.seconds : '?'));
    for (ci = 0; ci < clip.components.numItems; ci++) {
      comp = clip.components[ci]; mn = ''; try { mn = comp.matchName; } catch (e1) { mn = '?'; }
      lines.push('[' + ci + '] ' + comp.displayName + '  (match: ' + mn + ')' + (SC_looksLikeTimeRemap(comp) ? '  <= looks like Time Remapping' : ''));
      for (pi = 0; pi < comp.properties.numItems && pi < 40; pi++) {
        p = comp.properties[pi]; pmn = ''; try { pmn = p.matchName; } catch (e2) { pmn = '?'; }
        info = SC_readProp(p);
        line = '    (' + ci + ':' + pi + ') ' + p.displayName + (pmn ? '  (match: ' + pmn + ')' : '');
        line += info ? '  value ' + info.value + (info.tv ? '  KEYFRAMED x' + info.keys.length : '') : '  (not numeric)';
        if (SC_inList(SC_SPEED_NAMES, p.displayName)) line += '  <= named Speed';
        lines.push(line);
      }
    }
    return SC_json({ ok: true, lines: lines });
  } catch (e) { return SC_fail(e); }
}
