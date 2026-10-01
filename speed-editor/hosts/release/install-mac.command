#!/bin/bash
# Speed Curves — installation macOS (double-clic). Copie l'extension CEP pour l'utilisateur courant.
set -e
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/extension-CEP/com.speedcurves.editor"
dest="$HOME/Library/Application Support/Adobe/CEP/extensions/com.speedcurves.editor"
[ -d "$src" ] || { echo "Dossier extension-CEP introuvable a cote de ce script."; read -n 1 -s -r -p "Appuyez sur une touche..."; exit 1; }
xattr -dr com.apple.quarantine "$src" 2>/dev/null || true
rm -rf "$dest"; mkdir -p "$dest"; cp -R "$src/." "$dest/"
for v in 9 10 11 12; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done
echo; echo "Installe dans : $dest"
echo "Quittez puis relancez Premiere Pro, puis : Fenetre > Extensions > Speed Curves"
read -n 1 -s -r -p "Appuyez sur une touche pour fermer..."
