#!/usr/bin/env bash
# Installs the CEP build for the current user (macOS) and enables unsigned extensions.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
[ -d "$here/dist/cep" ] || (cd "$here" && node scripts/build.js)
dest="$HOME/Library/Application Support/Adobe/CEP/extensions/com.legolasplus.curveeditor"
rm -rf "$dest"; mkdir -p "$dest"; cp -R "$here/dist/cep/." "$dest/"
for v in 9 10 11 12; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done
echo "Installed to: $dest"
echo "Restart Premiere Pro, then: Window > Extensions > Legolas+ Curves"
