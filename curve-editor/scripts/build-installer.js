// Builds the Windows installer:  release/Legolas-Curves-Setup-<version>.exe
//  1. build the UXP panel  2. zip it as a .ccx payload  3. unit-test the installer core  4. cross-compile with Go
// Needs: node, zip, go (>=1.21). Run: node scripts/build-installer.js
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..'), inst = path.resolve(root, '../installer');
const version = require(path.join(root, 'package.json')).version;
const sh = (cmd, args, opts) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

sh('node', [path.join(__dirname, 'build.js')]);
const ccx = path.join(inst, 'payload/plugin.ccx');
fs.mkdirSync(path.dirname(ccx), { recursive: true }); fs.rmSync(ccx, { force: true });
sh('zip', ['-r', '-X', '-q', ccx, '.'], { cwd: path.join(root, 'dist/uxp') });     // manifest.json at the archive root

const env = { ...process.env, GOFLAGS: '-mod=mod' };
sh('go', ['test', './...'], { cwd: inst, env });
// Windows resources (manifest: DPI awareness / no elevation, and the app icon)
sh('go', ['run', 'github.com/akavel/rsrc@v0.10.2', '-manifest', 'assets/app.manifest', '-ico', 'assets/icon.ico', '-o', 'rsrc_windows_amd64.syso'], { cwd: inst, env });
const out = path.join(root, 'release'); fs.mkdirSync(out, { recursive: true });
const exe = path.join(out, `Legolas-Curves-Setup-${version}.exe`);
sh('go', ['build', '-trimpath', '-ldflags', `-s -w -H windowsgui -X main.version=${version}`, '-o', exe, '.'],
  { cwd: inst, env: { ...env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' } });
console.log('created', path.relative(root, exe), (fs.statSync(exe).size / 1048576).toFixed(1) + ' MB');
