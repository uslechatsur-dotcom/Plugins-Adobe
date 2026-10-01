// Copies the code shared with ../curve-editor (easing library, bake helpers, base theme) into src/.
// These copies are generated — they are git-ignored; run by build.js and the tests.
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..'), shared = path.resolve(root, '../curve-editor/src');
fs.copyFileSync(path.join(shared, 'js/easing.js'), path.join(root, 'src/js/easing.js'));
fs.copyFileSync(path.join(shared, 'js/bake.js'), path.join(root, 'src/js/bake.js'));
fs.copyFileSync(path.join(shared, 'styles.css'), path.join(root, 'src/shared.css'));
