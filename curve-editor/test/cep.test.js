// End-to-end CEP test: the real hosts/cep/jsx/host.jsx runs inside a fake ExtendScript engine (node:vm),
// and the real panel talks to it through window.__adobe_cep__.evalScript, exactly as CEP does.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');

// ---- fake Premiere object model (ExtendScript flavour) ----
function Time() { this.seconds = 0; }
function makeParam(name, init, keys) {
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
const position = makeParam('Position', 0, [[0, [0.5, 0.5]], [2, [0.8, 0.4]]]);
const scale = makeParam('Scale', 0, [[0, 40], [2, 100]]);
const motion = { displayName: 'Motion', properties: collection([position, scale, makeParam('Anchor', 0, [])]) };
const clip = { name: 'hero.mp4', nodeId: 'N1', start: { seconds: 10 }, inPoint: { seconds: 0 }, components: collection([motion]) };
const seq = { timebase: String(254016000000 / 25), getSelection: () => [clip], getPlayerPosition: () => ({ seconds: 11.2 }),
  videoTracks: { numTracks: 1, 0: { clips: collection([clip]) } } };
const ctx = vm.createContext({ app: { project: { activeSequence: seq } }, Time });
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../hosts/cep/jsx/host.jsx'), 'utf8'), ctx);

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 760, height: 560 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const log = [];
  await p.exposeFunction('__evalScript', (script) => { log.push(script.slice(0, 40)); try { return String(vm.runInContext(script, ctx)); } catch (e) { return 'EvalScript error.'; } });
  await p.addInitScript(() => { window.__adobe_cep__ = { evalScript: (s, cb) => window.__evalScript(s).then(cb) }; });
  await p.goto('file://' + path.resolve(__dirname, '../dist/cep/index.html'));
  await p.waitForFunction(() => window.LG.app && (Object.keys(window.LG.app.S.ch).length || window.LG.app.S.error), null, { timeout: 5000 });

  const st = await p.evaluate(() => { const S = window.LG.app.S; return { host: S.host.name, ids: S.order, fps: S.fps, ph: S.playhead, clip: S.clip }; });
  assert.strictEqual(st.host, 'Premiere Pro · CEP'); assert.deepStrictEqual(st.ids, ['0:0', '0:1']);   // Anchor has no keys → skipped
  assert.strictEqual(st.fps, 25); assert.ok(Math.abs(st.ph - 1.2) < 1e-9, 'playhead is clip-local: ' + st.ph); assert.strictEqual(st.clip, 'hero.mp4');

  // apply an easing through the UI → JSX must rewrite the Scale keyframes
  await p.evaluate(() => { const A = window.LG.app; A.S.visible.clear(); A.S.visible.add('0:1'); A.S.sel.clear(); A.renderAll(); });
  await p.click('.preset:has-text("Cubic Out")'); await p.waitForTimeout(600);
  assert.ok(scale.keys.length > 5, 'scale re-baked: ' + scale.keys.length);
  assert.ok(scale.calls.includes('removeRange') && scale.keys.every((k) => k.v !== null), 'old keys removed, all new keys have values');
  assert.strictEqual(scale.keys[0].t, 0); assert.strictEqual(scale.keys[scale.keys.length - 1].v, 100);
  assert.ok(scale.keys[Math.floor(scale.keys.length / 2)].v > 70, 'cubic-out is front-loaded');
  assert.deepStrictEqual(position.keys.map((k) => k.t), [0, 2], 'untouched channel is left alone');
  // panel re-scanned and kept editable control keys (2 keys, not the dense bake)
  const ctl = await p.evaluate(() => window.LG.app.S.ch['0:1'].keys.length); assert.strictEqual(ctl, 2, 'control keys preserved after rescan');

  // errors surface in the status bar
  seq.getSelection = () => [];
  await p.click('#btn-scan'); await p.waitForTimeout(200);
  assert.ok((await p.textContent('#status-text')).includes('Select a clip'), 'status shows host error');
  await p.screenshot({ path: process.argv[2] ? path.join(process.argv[2], '07-cep-error.png') : '/dev/null' });
  assert.deepStrictEqual(errs, [], errs.join('|'));
  console.log('CEP tests passed'); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
