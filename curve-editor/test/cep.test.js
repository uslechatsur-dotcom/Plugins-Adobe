// End-to-end CEP test: the real hosts/cep/jsx/host.jsx runs inside a fake ExtendScript engine (node:vm),
// and the real panel talks to it through window.__adobe_cep__.evalScript, exactly as CEP does.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');

// ---- fake Premiere object model (ExtendScript flavour) ----
function Time() { this.seconds = 0; }
function makeParam(name, keys) {
  const p = { displayName: name, keys: keys.map((k) => ({ t: k[0], v: k[1] })), tv: keys.length > 0, calls: [] };
  p.isTimeVarying = () => p.tv; p.setTimeVarying = (b) => { p.tv = b; };
  p.getKeys = () => p.keys.map((k) => { const t = new Time(); t.seconds = k.t; return t; });
  p.getValueAtKey = (t) => p.keys.find((k) => Math.abs(k.t - t.seconds) < 1e-6).v;
  p.removeKeyRange = (a, b) => { p.calls.push('removeRange'); p.keys = p.keys.filter((k) => k.t < a.seconds - 1e-9 || k.t > b.seconds + 1e-9); };
  p.addKey = (t) => { p.calls.push('addKey'); p.keys.push({ t: t.seconds, v: null }); p.keys.sort((x, y) => x.t - y.t); };
  p.setValueAtKey = (t, v) => { p.keys.find((k) => Math.abs(k.t - t.seconds) < 1e-9).v = v; };
  return p;
}
const collection = (arr) => Object.assign(arr.slice(), { numItems: arr.length });
const position = makeParam('Position', [[0, [0.5, 0.5]], [2, [0.8, 0.4]]]);
const scale = makeParam('Scale', [[0, 40], [2, 100]]);
const motion = { displayName: 'Motion', properties: collection([position, scale, makeParam('Anchor', [])]) };
const mkClip = (name, id, start, end, comps) => ({ name, nodeId: id, start: { seconds: start }, end: { seconds: end }, inPoint: { seconds: 0 }, components: collection(comps) });
const video = mkClip('hero.mp4', 'V1', 10, 14, [motion]);
const audio = mkClip('music.wav', 'A1', 10, 14, [{ displayName: 'Volume', properties: collection([makeParam('Level', [])]) }]);
let selection = [], playhead = 11.2;
const seq = { timebase: String(254016000000 / 25), getSelection: () => selection, getPlayerPosition: () => ({ seconds: playhead }),
  videoTracks: { numTracks: 1, 0: { clips: collection([video]) } }, audioTracks: { numTracks: 1, 0: { clips: collection([audio]) } } };
const ctx = vm.createContext({ app: { project: { activeSequence: seq } }, Time });
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../hosts/cep/jsx/host.jsx'), 'utf8'), ctx);

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 760, height: 560 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const calls = [];
  await p.exposeFunction('__evalScript', (script) => { calls.push(script.slice(0, 12)); try { return String(vm.runInContext(script, ctx)); } catch (e) { return 'EvalScript error.'; } });
  await p.addInitScript(() => { window.LG_POLL_MS = 150; window.__adobe_cep__ = { evalScript: (s, cb) => window.__evalScript(s).then(cb) }; });
  await p.goto('file://' + (process.env.CEP_INDEX || path.resolve(__dirname, '../dist/cep/index.html')));
  const S = (f) => p.evaluate(f);
  const status = () => p.textContent('#status-text');

  // 1) nothing selected → falls back to the clip under the playhead
  await p.waitForFunction(() => window.LG.app && window.LG.app.S.order.length);
  let st = await S(() => { const s = window.LG.app.S; return { host: s.host.name, ids: s.order, fps: s.fps, ph: s.playhead, clip: s.clip, how: s.how }; });
  assert.strictEqual(st.host, 'Premiere Pro · CEP'); assert.deepStrictEqual(st.ids, ['0:0', '0:1']); assert.strictEqual(st.how, 'playhead');
  assert.strictEqual(st.fps, 25); assert.ok(Math.abs(st.ph - 1.2) < 1e-9, 'playhead is clip-local: ' + st.ph); assert.strictEqual(st.clip, 'hero.mp4');
  assert.ok((await status()).includes('under the playhead'));

  // 2) playhead moves in Premiere → the panel's playhead follows without pressing rescan
  playhead = 12.0; await p.waitForFunction(() => Math.abs(window.LG.app.S.playhead - 2.0) < 1e-6, null, { timeout: 3000 });

  // 3) user selects an audio clip AND the video clip → panel auto-refreshes and picks the clip with animated properties
  selection = [audio, video];
  await p.waitForFunction(() => window.LG.app.S.how === 'selection', null, { timeout: 3000 });
  assert.deepStrictEqual(await S(() => window.LG.app.S.order), ['0:0', '0:1']);

  // 4) nothing selected AND playhead outside every clip → clear message
  selection = []; playhead = 30;
  await p.waitForFunction(() => window.LG.app.S.error, null, { timeout: 3000 });
  assert.ok((await status()).includes('No clip selected'), await status());
  // selecting an item without effects is reported precisely
  selection = [{ name: 'gap' }]; await p.waitForFunction(() => /no effects/.test(window.LG.app.S.error || ''), null, { timeout: 3000 });

  // 5) back to a real selection; apply an easing through the UI → JSX rewrites the Scale keyframes
  selection = [video]; playhead = 11.2;
  await p.waitForFunction(() => window.LG.app.S.order.length && !window.LG.app.S.error, null, { timeout: 3000 });
  await p.evaluate(() => { const A = window.LG.app; A.S.visible.clear(); A.S.visible.add('0:1'); A.S.sel.clear(); A.renderAll(); });
  await p.click('.preset:has-text("Cubic Out")'); await p.waitForTimeout(700);
  assert.ok(scale.keys.length > 5, 'scale re-baked: ' + scale.keys.length);
  assert.ok(scale.calls.includes('removeRange') && scale.keys.every((k) => k.v !== null), 'old keys removed, all new keys have values');
  assert.strictEqual(scale.keys[0].t, 0); assert.strictEqual(scale.keys[scale.keys.length - 1].v, 100);
  assert.ok(scale.keys[Math.floor(scale.keys.length / 2)].v > 70, 'cubic-out is front-loaded');
  assert.deepStrictEqual(position.keys.map((k) => k.t), [0, 2], 'untouched channel is left alone');
  assert.strictEqual(await S(() => window.LG.app.S.ch['0:1'].keys.length), 2, 'control keys preserved after rescan');
  // our own write must not trigger a needless rescan loop: signature unchanged, panel stays on the same clip
  await p.waitForTimeout(500); assert.strictEqual(await S(() => window.LG.app.S.ch['0:1'].keys.length), 2);

  // 6) manual rescan button still works and errors surface in the status bar
  selection = []; playhead = 99; await p.click('#btn-scan'); await p.waitForTimeout(250);
  assert.ok((await status()).includes('No clip selected'));
  if (process.argv[2]) await p.screenshot({ path: path.join(process.argv[2], '07-cep-error.png') });
  assert.deepStrictEqual(errs, [], errs.join('|'));
  console.log('CEP tests passed (' + calls.filter((c) => c.startsWith('LG_probe')).length + ' probes)'); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
