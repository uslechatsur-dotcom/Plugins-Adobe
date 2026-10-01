// Drives the Speed panel in Chromium against the mock host (simulated playback). Usage: node test/ui.test.js [screenshotDir]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), assert = require('assert');
(async () => {
  const shots = process.argv[2];
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 780, height: 600 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('file://' + path.resolve(__dirname, '../dist/cep/index.html'));
  await p.waitForFunction(() => window.LG.app && window.LG.app.S.prop);
  const S = (f, a) => p.evaluate(f, a);
  const shot = (n) => shots && p.screenshot({ path: path.join(shots, n + '.png') });
  const mock = () => 'window.LG.app.S.host';
  await p.waitForTimeout(300);

  // ---- initial state: curve loaded, HUD shows the speed under the cursor (playhead at 12.4 → clip time 2.4 s = 25%)
  let st = await S(() => { const s = window.LG.app.S; return { keys: s.curve.keys.length, D: s.D, ph: s.ph, hud: document.querySelector('#h-speed').textContent, src: document.querySelector('#h-src').textContent }; });
  assert.strictEqual(st.keys, 6); assert.strictEqual(st.D, 6); assert.ok(Math.abs(st.ph - 2.4) < 1e-6); assert.strictEqual(st.hud, '25.0%');
  await shot('01-speed');

  // ---- REAL-TIME: while "Premiere" plays, the cursor must follow continuously
  await S(() => window.LG.app.S.host.play());
  const samples = await S(() => new Promise((res) => { const out = [], t0 = performance.now(); const id = setInterval(() => { out.push(window.LG.app.S.ph); if (performance.now() - t0 > 700) { clearInterval(id); res(out); } }, 16); }));
  const distinct = new Set(samples.map((x) => x.toFixed(4))).size;
  assert.ok(distinct >= 15, 'cursor updated ' + distinct + ' times in 700 ms');
  assert.ok(samples.every((v, i) => i === 0 || v >= samples[i - 1] - 1e-6 || samples[i - 1] > 5.5), 'monotonic while playing');
  await shot('02-playing');
  const hudSpeedPlaying = await S(() => document.querySelector('#h-speed').textContent); assert.ok(/%$/.test(hudSpeedPlaying));
  assert.ok(await S(() => document.querySelector('#h-live').classList.contains('on')), 'live chip lit while the playhead moves');
  await S(() => window.LG.app.S.host.pause());
  await p.waitForTimeout(900); assert.ok(!(await S(() => document.querySelector('#h-live').classList.contains('on'))), 'live chip off when still');

  // ---- scrubbing the ruler moves the Premiere playhead
  const geo = await S(() => { const r = document.querySelector('#cv').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width }; });
  const gxOf = await S(() => { const S = window.LG.app.S; return null; });
  await p.mouse.move(geo.l + 300, geo.t + 10); await p.mouse.down(); await p.mouse.move(geo.l + 420, geo.t + 10, { steps: 5 }); await p.mouse.up();
  const seeks = await S(() => window.LG.app.S.host.state.calls.filter((c) => c[0] === 'seek').length);
  assert.ok(seeks >= 1, 'seek calls: ' + seeks);
  const absAfter = await S(() => window.LG.app.S.host.state.abs); assert.ok(absAfter > 10 && absAfter < 16, 'playhead inside the clip: ' + absAfter);
  assert.ok(Math.abs((await S(() => window.LG.app.S.phAbs)) - absAfter) < 0.2, 'panel cursor and Premiere playhead agree');

  // ---- drag a key (time + speed) → curve changes and is written to the host (debounced)
  const k2 = await S(() => { const r = document.querySelector('#cv').getBoundingClientRect(), h = window.LG.app.hit.keys.find((k) => k.i === 2); return { x: r.left + h.x, y: r.top + h.y }; });
  const before = await S(() => JSON.stringify(window.LG.app.S.curve.keys[2]));
  await p.mouse.move(k2.x, k2.y); await p.mouse.down(); await p.mouse.move(k2.x + 25, k2.y - 40, { steps: 6 }); await p.mouse.up();
  const after = await S(() => window.LG.app.S.curve.keys[2]); assert.ok(after.value > 25 + 5, 'speed raised: ' + after.value); assert.ok(after.time > 2.4, 'time moved: ' + after.time);
  await p.waitForTimeout(600);
  const written = await S(() => window.LG.app.S.host.state.calls.filter((c) => c[0] === 'apply').length); assert.ok(written >= 1, 'applied to host');
  assert.strictEqual(await S(() => window.LG.app.S.curve.keys.length), 6, 'control keys kept after the host rescan');

  // ---- easing preset on the selected segment, undo / redo
  await p.click('.preset:has-text("Ease In-Out")'); await p.waitForTimeout(400);
  assert.deepStrictEqual(await S(() => window.LG.app.S.curve.segs[2].p), [0.42, 0, 0.58, 1]);
  await shot('03-ease');
  await p.click('#btn-undo'); await p.waitForTimeout(80); assert.notDeepStrictEqual(await S(() => window.LG.app.S.curve.segs[2].p), [0.42, 0, 0.58, 1]);
  await p.click('#btn-redo'); await p.waitForTimeout(80); assert.deepStrictEqual(await S(() => window.LG.app.S.curve.segs[2].p), [0.42, 0, 0.58, 1]);

  // ---- keyboard nudge
  await S(() => { const A = window.LG.app; A.S.sel.clear(); A.S.sel.add(1); A.renderAll(); });
  const v1 = await S(() => window.LG.app.S.curve.keys[1].value); await p.keyboard.press('ArrowUp'); await p.keyboard.press('Shift+ArrowUp');
  assert.ok(Math.abs((await S(() => window.LG.app.S.curve.keys[1].value)) - (v1 + 11)) < 1e-6, 'nudge +1 and +10');

  // ---- keyframes tab: type exact values
  await p.click('.tab[data-tab=keys]'); await p.waitForTimeout(100);
  assert.strictEqual(await p.locator('#ktable tr').count(), 7); await shot('04-keys');
  const inp = p.locator('#ktable tr').nth(5).locator('input').nth(1); await inp.fill('450'); await inp.dispatchEvent('change');
  assert.strictEqual(await S(() => window.LG.app.S.curve.keys[4].value), 450);

  // ---- ramps tab: apply "Hero time" at the playhead
  await p.click('.tab[data-tab=ramps]'); await p.waitForTimeout(500); await shot('05-ramps');
  const nBefore = await S(() => window.LG.app.S.curve.keys.length);
  await p.click('#anim-apply'); await p.waitForTimeout(500);
  assert.strictEqual(await S(() => window.LG.app.S.tab), 'speed');
  assert.ok(await S(() => window.LG.app.S.curve.keys.length) !== nBefore, 'ramp changed the curve'); await shot('06-after-ramp');
  await p.waitForTimeout(500); assert.ok(await S(() => window.LG.app.S.host.state.speedKeys.length) > 3, 'ramp written to host');

  // ---- setup tab: time base + unit + diagnostics + guarded reset
  await p.click('.tab[data-tab=setup]'); await p.selectOption('#s-unit', 'factor'); await p.waitForTimeout(250);
  assert.ok((await p.textContent('#s-unit-note')).includes('factor')); await p.selectOption('#s-unit', 'auto'); await p.waitForTimeout(200);
  await p.click('#s-diag'); await p.waitForTimeout(200); assert.ok((await p.inputValue('#s-out')).includes('Time Remapping')); await shot('07-setup');
  await p.click('#s-reset'); assert.ok((await p.textContent('#s-reset')).includes('confirm')); await p.click('#s-reset'); await p.waitForTimeout(400);
  assert.strictEqual(await S(() => window.LG.app.S.host.state.speedKeys.length), 0, 'reset removed keyframes');

  // ---- "Match original source": edit then restore the consumed source length
  await p.click('.tab[data-tab=speed]'); await p.waitForTimeout(150);
  assert.deepStrictEqual(errs, [], errs.join('|')); console.log('Speed UI tests passed (cursor updates in 700ms: ' + distinct + ')'); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
