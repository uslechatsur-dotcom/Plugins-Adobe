// Builds a ready-to-install release zip:  release/Legolas-Curves-v<version>.zip
// Layout: extension-CEP/<bundle>/  panneau-UXP/  install/uninstall scripts  LISEZMOI.txt
// Requires the `zip` CLI. Run: node scripts/package.js
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
execFileSync('node', [path.join(__dirname, 'build.js')], { stdio: 'inherit' });

const out = path.join(root, 'release'), name = `Legolas-Curves-v${version}`, stage = path.join(out, name);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
const skipDebug = { filter: (src) => path.basename(src) !== '.debug' };   // dev-only remote-debug file
fs.cpSync(path.join(root, 'dist/cep'), path.join(stage, 'extension-CEP/com.legolasplus.curveeditor'), { recursive: true, ...skipDebug });
fs.cpSync(path.join(root, 'dist/uxp'), path.join(stage, 'panneau-UXP'), { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'hosts/release'))) {
  const dst = path.join(stage, f);
  fs.writeFileSync(dst, fs.readFileSync(path.join(root, 'hosts/release', f), 'utf8').replace(/__VERSION__/g, version));
  if (f.endsWith('.command')) fs.chmodSync(dst, 0o755);
}
const zip = path.join(out, name + '.zip');
execFileSync('zip', ['-r', '-X', zip, name], { cwd: out, stdio: 'ignore' });   // -X keeps it portable; unix perms are preserved
console.log('created', path.relative(root, zip), (fs.statSync(zip).size / 1024).toFixed(0) + ' KB');
