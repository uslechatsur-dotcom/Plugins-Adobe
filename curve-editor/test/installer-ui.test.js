// Drives the installer window HTML in Chromium with a fake Go backend (window.lg_*), to check every screen.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), assert = require('assert');
(async () => {
  const shots = process.argv[2];
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 580, height: 560 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => {
    window.__calls = []; window.__fail = sessionStorage.getItem('fail') === '1'; window.__installed = sessionStorage.getItem('inst') === '1'; window.__method = 'manual';
    window.lg_info = async () => ({ name: 'Legolas+ Curve Editor', version: '0.3.0', minVersion: '25.6.0', installed: window.__installed, premiereRunning: true, upia: true, setup: '0.3.0' });
    window.lg_log_path = async () => 'C:\\Users\\me\\AppData\\Local\\Temp\\LegolasCurves-setup.log';
    window.lg_close = () => window.__calls.push('close');
    const run = (action) => {
      window.__calls.push(action);
      const seq = [['prepare', 'run', ''], ['prepare', 'ok', 'Legolas+ Curve Editor 0.3.0'], ['install', 'run', 'Copie des fichiers'], ['install', window.__fail ? 'err' : 'ok', window.__fail ? 'accès refusé' : 'C:\\Users\\me\\AppData\\Roaming\\Adobe\\UXP\\Plugins\\External\\com.legolasplus.curveeditor_0.3.0']];
      if (!window.__fail) seq.push(['register', 'run', 'PPRO.json'], ['register', 'ok', 'Enregistré']);
      seq.forEach((s, i) => setTimeout(() => window.__lg.on('progress', { step: s[0], state: s[1], detail: s[2] }), 120 * (i + 1)));
      setTimeout(() => window.__lg.on('done', window.__fail ? { ok: false, action, error: "copie des fichiers: accès refusé" } : { ok: true, action, method: window.__method, warnings: window.__method === 'manual' ? ["L'installateur Adobe n'a pas confirmé l'installation (--install: code 3). Installation manuelle utilisée."] : [] }), 120 * seq.length + 80);
    };
    window.lg_install = () => run('install'); window.lg_uninstall = () => run('uninstall');
  });
  const shot = (n) => shots && p.screenshot({ path: path.join(shots, 'inst-' + n + '.png') });
  const on = () => p.evaluate(() => document.querySelector('.screen.on').id);
  await p.goto('file://' + path.resolve(__dirname, '../../installer/ui/index.html'));
  await p.waitForTimeout(700);
  assert.strictEqual(await on(), 's-home'); assert.ok(await p.isVisible('#running')); assert.ok(!(await p.isVisible('#b-uninstall')));
  assert.ok((await p.textContent('#req')).includes('25.6.0')); await shot('1-home');
  await p.click('#b-install'); await p.waitForTimeout(330); assert.strictEqual(await on(), 's-progress'); await shot('2-progress');
  await p.waitForSelector('#s-done.on', { timeout: 4000 }); await p.waitForTimeout(300);
  assert.ok((await p.textContent('#d-body')).includes('Plug-ins UXP')); assert.ok((await p.textContent('#d-body')).includes('Installation manuelle')); await shot('3-done');
  await p.click('#b-close2'); assert.deepStrictEqual(await p.evaluate(() => window.__calls), ['install', 'close']);

  await p.evaluate(() => sessionStorage.setItem('fail', '1')); await p.reload(); await p.waitForTimeout(300);
  await p.click('#b-install'); await p.waitForSelector('#s-error.on', { timeout: 4000 }); await p.waitForTimeout(250);
  assert.ok((await p.textContent('#e-msg')).includes('accès refusé')); assert.ok((await p.textContent('#e-log')).includes('LegolasCurves-setup.log')); await shot('4-error');
  await p.evaluate(() => { window.__fail = false; sessionStorage.setItem('fail', '0'); }); await p.click('#b-retry'); await p.waitForSelector('#s-done.on', { timeout: 4000 });

  await p.evaluate(() => sessionStorage.setItem('inst', '1')); await p.reload(); await p.waitForTimeout(300);
  assert.ok(await p.isVisible('#b-uninstall')); assert.strictEqual(await p.textContent('#b-install'), 'Réinstaller'); await shot('5-installed');
  await p.click('#b-uninstall'); await p.waitForSelector('#s-done.on', { timeout: 4000 });
  assert.ok((await p.textContent('#d-title')).includes('Désinstallation'));
  assert.deepStrictEqual(errs, [], errs.join('|')); console.log('Installer UI tests passed'); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
