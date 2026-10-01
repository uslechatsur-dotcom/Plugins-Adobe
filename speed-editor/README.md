# Speed Curves — éditeur de courbes de vitesse pour Premiere Pro

Extension CEP (Premiere Pro 2020 → 2026) pour éditer le **Remappage temporel > Vitesse** d'un clip avec un
graphe de courbes, dans l'esprit de *Legolas+ Curves* (`../curve-editor`), dont elle réutilise les easings.

## Comment Premiere gère la vitesse (et donc ce que fait le plugin)

- Un clip a une propriété **Vitesse** (Time Remapping), animée par keyframes : `100 %` = normal, `0 %` = image figée,
  négatif = lecture inversée.
- Ce que l'on voit à l'écran est le **temps source** : `source(t) = ∫ vitesse(τ)/100 dτ`. Le panneau affiche donc deux
  courbes liées : la vitesse (éditable, en haut) et le temps source (dérivé, en bas, avec la diagonale « 100 % » en
  pointillés). Cela montre immédiatement où le clip ralentit, s'arrête ou recule, et jusqu'où il consomme le média.
- Changer la vitesse change la quantité de média consommée ; **« Match original source »** met à l'échelle toutes les
  vitesses pour garder le même point de sortie source.
- Les scripts Premiere n'exposent pas les poignées bézier : chaque segment (easing) est écrit en keyframes de vitesse
  linéaires denses, réduits automatiquement (RDP).

## Curseur synchronisé en temps réel

Premiere n'émet aucun événement de tête de lecture ; le panneau l'interroge donc en boucle
(`SC_ph()` — un appel minuscule, ≈ 25–100 Hz selon l'activité, jamais deux appels simultanés) :
- la ligne ambre suit la tête de lecture de la timeline (lecture comprise) et la vue défile en mode *Follow* ;
- les puces **Speed / Source / Clip** donnent la vitesse et le temps source sous le curseur ;
- l'inverse fonctionne aussi : glisser la règle (ou le graphe du temps source) déplace la tête de lecture de Premiere
  (`sequence.setPlayerPosition`).
La sélection est surveillée à part (≈ 2 Hz) : le panneau suit le clip sélectionné, ou le clip sous la tête de lecture.

## Onglets

**Speed** (graphe + presets d'easing + fiche clip) · **Keyframes** (saisie numérique : image, vitesse, easing) ·
**Ramps** (Hero time, Speed burst, Ramp to speed, Freeze frame, Beat pulse, Rewind — appliqués au curseur) ·
**Setup** (propriété détectée, base de temps, unité, diagnostic, remise à 100 %).

La propriété est retrouvée **sans dépendre de la langue** (nom de composant/propriété en 12 langues + `matchName`),
et tout ce que Premiere expose est listé dans *Setup → Run diagnostics*.

## Build / tests

```
cd speed-editor
npm test            # build + moteur + interface (Chromium, hôte simulé) + CEP de bout en bout (faux ExtendScript)
npm run package     # release/SpeedCurves-v<version>.zip prêt à installer
```
`src/js/easing.js`, `src/js/bake.js` et `src/shared.css` sont **copiés** depuis `../curve-editor` (`scripts/sync-shared.js`).

## ⚠️ État de validation

| | |
|---|---|
| Moteur (vitesse, temps source, rampes, découpe sans changement de forme) | ✅ 15 tests Node |
| Interface + suivi temps réel du curseur | ✅ Chromium, hôte simulé en lecture |
| `host.jsx` + pont `evalScript` + panneau, de bout en bout | ✅ faux ExtendScript (noms français, matchName) |
| **Dans un vrai Premiere Pro** | ❌ non testé |

Inconnues à valider dans Premiere (le diagnostic les couvre) : la propriété Vitesse est-elle exposée dans
`clip.components` ; unité (% ou facteur) ; base de temps des keyframes (début du clip ou point d'entrée) ;
comportement de la durée du clip quand la vitesse change ; latence réelle de `evalScript`.
