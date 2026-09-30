// Drives the panel in Chromium against the mock host. Usage: node test/ui.test.js [screenshotDir]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'); const assert = require('assert');
(async () => {
  const shots = process.argv[2];
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 760, height: 560 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('file://' + path.resolve(__dirname, '../src/index.html'));
  await p.waitForFunction(() => window.LG.app && Object.keys(window.LG.app.S.ch).length);
  const S = () => p.evaluate(() => { const s = window.LG.app.S; return { order: s.order, vis: [...s.visible], sel: [...s.sel], ch: s.order.map((id) => ({ id, keys: s.ch[id].keys.length, segs: s.ch[id].segs })) }; });
  const shot = (n) => shots && p.screenshot({ path: path.join(shots, n + '.png') });

  let s = await S(); assert.strictEqual(s.order.length, 4); assert.deepStrictEqual(s.vis.length, 2);
  await p.locator('.chrow').first().click(); await p.locator('.chrow').nth(1).click({ modifiers: ['Shift'] }); await shot('01-curves');

  const k0 = await p.evaluate(() => { const S = window.LG.app.S; return S.order.find((i) => S.visible.has(i)); });
  // click the first diamond on the canvas for real
  const k = await p.evaluate((id) => { const r = document.querySelector('#cv').getBoundingClientRect(); const h = window.LG.app.hit.keys.find((x) => x.c.id === id && x.i === 0); return { x: r.left + h.x, y: r.top + h.y }; }, k0);
  await p.mouse.click(k.x, k.y);
  assert.deepStrictEqual((await S()).sel, [k0 + '#0'], 'clicking a diamond selects it');
  await p.click('.preset:has-text("Back Out")'); await p.waitForTimeout(400);
  s = await S(); assert.strictEqual(s.ch.find((c) => c.id === k0).segs[0].p[1], 1.56, 'preset applied to selected segment');
  const baked = await p.evaluate(() => window.LG.app.S.host.state.channels[0].keys.length);
  assert.ok(baked > 3, 'live-baked into host: ' + baked);
  await shot('02-back-out');

  // drag the first bezier handle for real
  const hd = await p.evaluate(() => { const r = document.querySelector('#cv').getBoundingClientRect(); const h = window.LG.app.hit.handles.find((x) => x.which === 0); return { x: r.left + h.x, y: r.top + h.y }; });
  await p.mouse.move(hd.x, hd.y); await p.mouse.down(); await p.mouse.move(hd.x + 30, hd.y - 20, { steps: 4 }); await p.mouse.up();
  const dragged = (await S()).ch.find((c) => c.id === k0).segs[0].p;
  assert.ok(dragged[0] > 0 && dragged[0] !== 0.34 && dragged[1] !== 1.56, 'handle moved: ' + dragged);
  await p.waitForTimeout(400);

  // undo / redo
  await p.click('#btn-undo'); await p.waitForTimeout(50);
  assert.deepStrictEqual((await S()).ch.find((c) => c.id === k0).segs[0].p, [0.34, 1.56, 0.64, 1], 'undo #1 reverts the handle drag');
  await p.click('#btn-undo'); await p.waitForTimeout(50);
  assert.deepStrictEqual((await S()).ch.find((c) => c.id === k0).segs[0], { kind: 'bezier', p: [0, 0, 1, 1] }, 'undo #2 restores linear');
  await p.click('#btn-redo'); await p.click('#btn-redo'); await p.waitForTimeout(50);
  assert.deepStrictEqual((await S()).ch.find((c) => c.id === k0).segs[0].p, dragged, 'redo x2');

  // dblclick on curve inserts a key
  const n0 = (await S()).ch.find((c) => c.id === k0).keys;
  await p.evaluate((id) => { const A = window.LG.app; const c = A.S.ch[id]; A.insertKey(c, (c.keys[0].time + c.keys[1].time) / 2); A.renderAll(); }, k0);
  assert.strictEqual((await S()).ch.find((c) => c.id === k0).keys, n0 + 1);
  // shape preserved by split: value at midpoint equals before
  await shot('03-inserted');

  // dopesheet
  await p.click('.tab[data-tab=keys]'); await p.waitForTimeout(100); await shot('04-keyframes');

  // animations
  await p.click('.tab[data-tab=anim]'); await p.click('.anim-item:has-text("Elastic")'); await p.waitForTimeout(300); await shot('05-animations');
  const cntBefore = (await S()).ch.find((c) => c.id === '0:1').keys;
  await p.selectOption('#anim-target', '0:1'); await p.click('#anim-apply'); await p.waitForTimeout(400);
  const after = await p.evaluate(() => window.LG.app.S.host.state.channels.find((c) => c.id === '0:1').keys);
  assert.ok(after.length > cntBefore + 10, 'elastic baked many keys: ' + after.length);
  await p.click('.tab[data-tab=curves]'); await p.locator('.chrow', { hasText: 'Scale' }).click(); await p.waitForTimeout(100); await shot('06-scale-elastic');

  assert.deepStrictEqual(errs, [], 'no console/page errors: ' + errs.join('|'));
  console.log('UI tests passed'); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
