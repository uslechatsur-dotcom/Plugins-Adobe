// Assembles the two distributable packages from the shared UI in src/.
//   dist/uxp  -> UXP panel (Premiere 25.6+):  UXP Developer Tool > Add Plugin > dist/uxp/manifest.json
//   dist/cep  -> CEP extension (Premiere 2020+): scripts/install-cep.(sh|bat)
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist');
const cp = (from, to) => fs.cpSync(path.join(root, from), path.join(dist, to), { recursive: true });
fs.rmSync(dist, { recursive: true, force: true });
cp('src', 'uxp'); cp('hosts/uxp/manifest.json', 'uxp/manifest.json');
cp('src', 'cep'); cp('hosts/cep/CSXS', 'cep/CSXS'); cp('hosts/cep/jsx', 'cep/jsx'); cp('hosts/cep/.debug', 'cep/.debug');
console.log('built dist/uxp and dist/cep');
