// End-to-end CEP test: the real hosts/cep/jsx/host.jsx runs in a fake ExtendScript engine (node:vm) built like Premiere
// (French UI names, Time Remapping > Vitesse), and the real panel talks to it through window.__adobe_cep__.evalScript.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const TICKS = 254016000000;

function Time() { this.seconds = 0; }
function makeParam(name, matchName, value, keys) {
  const p = { displayName: name, matchName, value, keys: keys.map((k) => ({ t: k[0], v: k[1] })), tv: keys.length > 0, calls: [] };
  p.isTimeVarying = () => p.tv; p.setTimeVarying = (b) => { p.tv = b; };
  p.getValue = () => p.value; p.setValue = (v) => { p.calls.push('setValue'); p.value = v; };
  p.getKeys = () => p.keys.map((k) => { const t = new Time(); t.seconds = k.t; return t; });
  p.getValueAtKey = (t) => p.keys.find((k) => Math.abs(k.t - t.seconds) < 1e-6).v;
  p.removeKeyRange = (a, b) => { p.calls.push('removeRange'); p.keys = p.keys.filter((k) => k.t < a.seconds - 1e-9 || k.t > b.seconds + 1e-9); };
  p.addKey = (t) => { p.calls.push('addKey'); p.keys.push({ t: t.seconds, v: null }); p.keys.sort((x, y) => x.t - y.t); };
  p.setValueAtKey = (t, v) => { p.keys.find((k) => Math.abs(k.t - t.seconds) < 1e-9).v = v; };
  return p;
}
const col = (arr) => Object.assign(arr.slice(), { numItems: arr.length });
const speed = makeParam('Vitesse', 'ADBE Time Remapping', 100, []);
const motion = { displayName: 'Trajectoire', matchName: 'AE.ADBE Motion', properties: col([makeParam('Position', 'ADBE Position', [0.5, 0.5], [[0, [0.5, 0.5]], [1, [0.6, 0.5]]]), makeParam('Échelle', 'ADBE Scale', 100, [])]) };
const remap = { displayName: 'Remappage temporel', matchName: 'AE.ADBE Time Remapping', properties: col([speed]) };
const mkClip = (name, id, start, end, comps) => ({ name, nodeId: id, start: { seconds: start }, end: { seconds: end }, inPoint: { seconds: 0 }, outPoint: { seconds: end - start }, components: col(comps) });
const video = mkClip('dive.mp4', 'V1', 10, 16, [motion, remap]);
const plain = mkClip('title.png', 'V2', 20, 24, [{ displayName: 'Trajectoire', matchName: 'AE.ADBE Motion', properties: col([makeParam('Position', 'ADBE Position', [0.5, 0.5], [])]) }]);
let selection = [video], playhead = 12.4;
const seq = { name: 'Seq 01', timebase: String(TICKS / 30), getSelection: () => selection, getPlayerPosition: () => ({ seconds: playhead }),
  setPlayerPosition: (ticks) => { assert.strictEqual(typeof ticks, 'string'); playhead = Number(ticks) / TICKS; },
  videoTracks: { numTracks: 2, 0: { clips: col([video]) }, 1: { clips: col([plain]) } }, audioTracks: { numTracks: 0 } };
const ctx = vm.createContext({ app: { version: '26.0.0', project: { activeSequence: seq } }, Time });
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../hosts/cep/jsx/host.jsx'), 'utf8'), ctx);

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 780, height: 600 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const counts = {};
  await p.exposeFunction('__evalScript', (script) => { const fn = script.split('(')[0]; counts[fn] = (counts[fn] || 0) + 1; try { return String(vm.runInContext(script, ctx)); } catch (e) { return 'EvalScript error.'; } });
  await p.addInitScript(() => { window.__adobe_cep__ = { evalScript: (s, cb) => window.__evalScript(s).then(cb) }; });
  await p.goto('file://' + (process.env.CEP_INDEX || path.resolve(__dirname, '../dist/cep/index.html')));
  const S = (f, a) => p.evaluate(f, a);
  const status = () => p.textContent('#status-text');

  // 1) Finds "Remappage temporel > Vitesse" by matchName/French name; no keyframes yet → static 100%
  await p.waitForFunction(() => window.LG.app && window.LG.app.S.prop, null, { timeout: 5000 });
  let st = await S(() => { const s = window.LG.app.S; return { host: s.host.name, label: s.prop.label, D: s.D, fps: s.fps, base: s.curve.base, keys: s.curve.keys.length, ph: s.ph, cands: s.candidates.length }; });
  assert.strictEqual(st.host, 'Premiere Pro · CEP'); assert.ok(st.label.includes('Vitesse')); assert.strictEqual(st.D, 6); assert.strictEqual(st.fps, 30);
  assert.strictEqual(st.base, 100); assert.strictEqual(st.keys, 0); assert.ok(Math.abs(st.ph - 2.4) < 1e-9); assert.strictEqual(st.cands, 1, 'Position is not a speed candidate');

  // 2) REAL-TIME: Premiere's playhead moves (as in playback) → the panel's cursor follows continuously
  const t0 = Date.now(); const lags = []; let last = playhead;
  const track = (async () => { while (Date.now() - t0 < 900) { playhead = 12.4 + (Date.now() - t0) / 1000; await new Promise((r) => setTimeout(r, 12)); } })();
  const seen = new Set();
  while (Date.now() - t0 < 900) { const v = await S(() => window.LG.app.S.phAbs); seen.add(v.toFixed(3)); lags.push(playhead - v); await new Promise((r) => setTimeout(r, 25)); }
  await track;
  assert.ok(seen.size >= 15, 'cursor positions seen: ' + seen.size);
  const med = lags.sort((a, b) => a - b)[Math.floor(lags.length / 2)]; assert.ok(med < 0.12, 'median lag ' + (med * 1000).toFixed(0) + ' ms');
  assert.ok((counts.SC_ph || 0) > 20, 'SC_ph polled ' + counts.SC_ph + ' times');
  assert.ok((counts.SC_scan || 0) <= 2, 'the heavy scan must not be polled: ' + counts.SC_scan);

  // 3) Panel → Premiere: scrubbing the ruler moves Premiere's playhead (ticks are sent as a string)
  const geo = await S(() => { const r = document.querySelector('#cv').getBoundingClientRect(); return { l: r.left, t: r.top }; });
  await p.mouse.move(geo.l + 400, geo.t + 10); await p.mouse.down(); await p.mouse.move(geo.l + 520, geo.t + 10, { steps: 6 }); await p.mouse.up();
  await p.waitForTimeout(150);
  assert.ok(playhead > 10 && playhead < 16, 'Premiere playhead set by the panel: ' + playhead);
  assert.ok(Math.abs((await S(() => window.LG.app.S.phAbs)) - playhead) < 0.1);

  // 4) Apply a ramp → keyframes are written to Vitesse (percent), times clip-relative, then the panel keeps its control keys
  await S(() => window.LG.app.seek(2.0)); await p.waitForTimeout(200);
  await p.click('.tab[data-tab=ramps]'); await p.waitForTimeout(100); await p.click('#anim-apply'); await p.waitForTimeout(900);
  assert.ok(speed.tv && speed.keys.length >= 4, 'keys written: ' + speed.keys.length);
  assert.ok(speed.calls.includes('addKey') && speed.keys.every((k) => k.v !== null && k.t >= 0 && k.t <= 6 + 1e-9), 'valid keys');
  const minV = Math.min(...speed.keys.map((k) => k.v)); assert.ok(Math.abs(minV - 25) < 0.5, 'hero dip reached 25%: ' + minV);
  assert.ok(speed.keys.some((k) => k.t > 1.9 && k.t < 2.1), 'ramp starts at the cursor (2.0 s)');
  assert.ok(await S(() => window.LG.app.S.curve.keys.length) === speed.keys.length || true);
  const ctl = await S(() => window.LG.app.S.curve.keys.length); assert.ok(ctl === speed.keys.length, 'control keys == host keys after rescan: ' + ctl);
  const hostWrites = speed.calls.filter((c) => c === 'removeRange').length;

  // 5) Time base "source in-point": keys move with the in-point offset
  video.inPoint.seconds = 5; await S(() => window.LG.app.scan());
  await p.click('.tab[data-tab=setup]'); await p.selectOption('#s-timebase', 'inpoint'); await p.waitForTimeout(300);
  assert.ok(Math.abs((await S(() => window.LG.app.S.curve.keys[0].time)) - (speed.keys[0].t - 5)) < 1e-6, 'keys shifted by the in-point');
  await p.selectOption('#s-timebase', 'start'); video.inPoint.seconds = 0; await p.waitForTimeout(200);

  // 6) Diagnostics list components/properties with match names; reset restores a static 100%
  await p.click('#s-diag'); await p.waitForTimeout(300);
  const diag = await p.inputValue('#s-out'); assert.ok(diag.includes('Remappage temporel') && diag.includes('Vitesse') && diag.includes('<= named Speed') && diag.includes('KEYFRAMED'), diag);
  await p.click('#s-reset'); await p.click('#s-reset'); await p.waitForTimeout(500);
  assert.ok(!speed.tv && speed.keys.length === 0 && speed.value === 100, 'reset: static 100');

  // 7) The panel follows the selection to a clip WITHOUT time remapping → clear message + setup guidance
  selection = [plain]; await p.waitForFunction(() => window.LG.app.S.error, null, { timeout: 3000 });
  assert.ok((await status()).includes('Could not find')); await p.click('.tab[data-tab=speed]'); await p.waitForTimeout(150); assert.ok((await p.textContent('#empty')).includes('Time Remapping'));
  if (process.argv[2]) await p.screenshot({ path: path.join(process.argv[2], '08-not-found.png') });
  // ...and back
  selection = [video]; await p.waitForFunction(() => window.LG.app.S.prop, null, { timeout: 3000 });
  assert.deepStrictEqual(errs, [], errs.join('|'));
  console.log(`Speed CEP tests passed (SC_ph x${counts.SC_ph}, median cursor lag ${(med * 1000).toFixed(0)} ms)`); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
