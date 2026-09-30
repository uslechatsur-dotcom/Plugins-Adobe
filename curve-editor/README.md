# Legolas+ Curves — éditeur de courbes pour Premiere Pro

Panneau d'éditeur de courbes façon After Effects, livré en **deux versions** générées depuis le même code :

| Version | Pour | Où dans Premiere |
|---|---|---|
| **Extension CEP** (`dist/cep`) | Premiere Pro 2020 → 2025 (ExtendScript) | Fenêtre → Extensions → *Legolas+ Curves* |
| **Panneau UXP** (`dist/uxp`) | Premiere Pro 25.6+ | Fenêtre → Plug-ins UXP → *Legolas+ Curves* |

## Fonctions

- **Curves** — graphe des propriétés animées du clip sélectionné, poignées bézier, ~28 presets d'easing
  (Ease, Sine, Cubic, Quart, Expo, Circ, Back, Bounce, Elastic, Hold…), slider *Strength*, presets
  personnalisés (★, clic droit pour supprimer), double-clic = ajouter un keyframe sans changer la forme,
  molette = zoom, glisser = déplacer la vue, `F` = tout afficher.
- **Keyframes** — dopesheet : déplacer les keyframes, sélection au rectangle (Maj), suppression (Suppr).
- **Animations** — Bounce, Elastic, Overshoot, Wiggle, Shake, Pulse, Spiral, Orbit avec aperçu animé et
  réglages Cycles / Height / Damping / Duration / Variation, appliqués au playhead.
- Annuler / rétablir, mode **Live** (écrit dans Premiere pendant l'édition).

## Installateur Windows (.exe)

```
cd curve-editor && npm run installer     # -> release/Legolas-Curves-Setup-<version>.exe
```
Installateur graphique (Go + WebView2, ~3 Mo, sans droits administrateur) qui embarque le panneau UXP en `.ccx` :
1. tente l'installateur Adobe (`UnifiedPluginInstallerAgent.exe --install`) et vérifie avec `--list all` ;
2. sinon copie dans `%APPDATA%\Adobe\UXP\Plugins\External\<id>_<version>` et ajoute l'entrée dans
   `%APPDATA%\Adobe\UXP\PluginsInfo\v1\PPRO.json` (autres plugins conservés, sauvegarde `.legolas-curves.bak`).
Options : `--silent` (ou `/S`), `--uninstall`. Journal : `%TEMP%\LegolasCurves-setup.log`.
Code : `../installer/` (tests : `cd ../installer && go test ./...`).

**Non signé** : Windows (SmartScreen / Contrôle intelligent des applications) peut le bloquer ; seule une signature
de code (certificat) règle ça. **Non testé sous Windows / dans un vrai Premiere.**

## Build

```
cd curve-editor
node scripts/build.js        # -> dist/cep  et  dist/uxp
```

## Installer l'extension CEP

```
macOS   :  ./scripts/install-cep.sh
Windows :  scripts\install-cep.bat
```
Le script copie l'extension dans le dossier CEP de l'utilisateur et active `PlayerDebugMode`
(nécessaire pour charger une extension non signée). Redémarrer Premiere, puis
**Fenêtre → Extensions → Legolas+ Curves**. Sélectionner un clip qui a déjà des keyframes, cliquer ↻.

## Installer le panneau UXP

UXP Developer Tool → *Add Plugin* → `dist/uxp/manifest.json` → *Load*.

## Comment ça marche (important)

Ni ExtendScript ni l'API UXP n'exposent les **poignées bézier** des keyframes. Le panneau garde la courbe
d'easing de chaque segment de son côté et l'écrit dans Premiere en **keyframes linéaires denses**
(réduits automatiquement : ~1 par image, beaucoup moins sur les courbes douces).

- Le panneau reconnaît ce qu'il a écrit et garde des keyframes de contrôle éditables tant que vous ne
  les modifiez pas dans Premiere. Si vous les modifiez à la main, il repart des keyframes présents.
- Le glissement vertical d'un keyframe ne concerne que les propriétés scalaires ; pour Position (2D),
  seuls le temps et les courbes sont éditables dans le graphe.

## ⚠️ État de validation

| Élément | Validé |
|---|---|
| Moteur (easings, bake, animations) | ✅ tests Node |
| Interface | ✅ Chromium, hôte simulé (`Preview (no Premiere)`) |
| CEP : `host.jsx` + pont `evalScript` + panneau | ✅ de bout en bout contre un **faux** ExtendScript ; `host.jsx` vérifié ES3 |
| **Dans un vrai Premiere Pro** (CEP et UXP) | ❌ **non testé** — pas d'accès à Premiere ici |

À vérifier au premier lancement dans Premiere : la base de temps des keyframes (relative au clip — le
panneau suppose `temps = séquence − début du clip + point d'entrée`, à ajuster dans `LG_scan` /
`host.js` sinon), la valeur des propriétés 2D, et pour UXP le rendu `<canvas>`. Le pied du panneau affiche
l'erreur exacte renvoyée par Premiere.

## Tests

```
cd curve-editor && npm test     # build + moteur + interface + CEP
```
