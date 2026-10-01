// Assembles dist/cep (the extension folder) from src/ + hosts/cep.  Run: node scripts/build.js
const fs = require('fs'), path = require('path');
require('./sync-shared');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist');
const cp = (from, to, opts) => fs.cpSync(path.join(root, from), path.join(dist, to), { recursive: true, ...opts });
fs.rmSync(dist, { recursive: true, force: true });
cp('src', 'cep'); cp('hosts/cep/CSXS', 'cep/CSXS'); cp('hosts/cep/jsx', 'cep/jsx'); cp('hosts/cep/.debug', 'cep/.debug');
console.log('built dist/cep');
