# Legolas+ Curve Editor — panneau UXP pour Premiere Pro

Éditeur de courbes façon After Effects pour Premiere Pro (≥ 25.6), en 3 onglets :

| Onglet | Ce qu'il fait |
|---|---|
| **Curves** | Graphe des propriétés animées du clip sélectionné (Position, Échelle, Rotation, Opacité…). Sélection multi-canaux, poignées bézier déplaçables, ~28 presets d'easing (Ease, Cubic, Quart, Expo, Back, Bounce, Elastic, Hold…), slider *Strength*, presets personnalisés (★), double-clic = ajouter un keyframe sans changer la forme de la courbe, molette = zoom, glisser = déplacer la vue. |
| **Keyframes** | Dopesheet : tous les canaux en lignes, déplacement des keyframes (sélection au rectangle avec Maj), suppression (Suppr). |
| **Animations** | Bounce, Elastic, Overshoot, Wiggle, Shake, Pulse, Spiral, Orbit — aperçu animé, réglages Cycles / Height / Damping / Duration / Variation, bouton **Apply at playhead** sur le canal choisi. |

Barre d'outils : ↻ rescanner · ★ enregistrer l'easing · ◆+ keyframe au playhead · ✕ supprimer · annuler/rétablir · **LIVE** (écriture dans Premiere pendant l'édition).

## Installation (développement)

1. Installer **UXP Developer Tool** (Creative Cloud Desktop → Tous les apps).
2. Premiere Pro ≥ 25.6 lancé, ouvrir une séquence.
3. UXP Developer Tool → *Add Plugin* → choisir `curve-editor/manifest.json` → *Load*.
4. Premiere : **Fenêtre → Plugins UXP → Legolas+ Curves**.
5. Sélectionner un clip qui a déjà des keyframes, cliquer ↻.

## Comment ça marche (important)

L'API UXP de Premiere n'expose **pas** les poignées bézier des keyframes. Le panneau garde donc
la courbe d'easing de chaque segment de son côté et l'écrit dans Premiere sous forme de
**keyframes linéaires denses** (réduits automatiquement : ~1 par image, moins sur les courbes douces).
Conséquences :

- Après un « bake », Premiere contient beaucoup de keyframes ; le panneau reconnaît ce qu'il a écrit
  et garde les keyframes de contrôle éditables tant que vous ne les modifiez pas dans Premiere.
  Si vous les modifiez à la main, le panneau repart des keyframes présents (courbes linéaires).
- Le glissement vertical d'un keyframe ne concerne que les propriétés scalaires ; pour Position
  (2D) seuls le temps et les courbes sont éditables dans le graphe.

## ⚠️ État de validation

- Moteur (easings, bake, animations) : testé en Node (`node test/engine.test.js`).
- Interface : testée dans Chromium contre un hôte simulé (`node test/ui.test.js`), affiché en mode
  « Preview (no Premiere) » quand le panneau est ouvert hors Premiere.
- **Couche Premiere (`js/host.js`) : écrite d'après l'API UXP publique mais NON testée dans un vrai
  Premiere** (pas d'accès à l'application ni à la doc Adobe depuis l'environnement de développement).
  Points à vérifier au premier lancement : lecture des valeurs de keyframes 2D (`PointF`), base de
  temps des keyframes (relative au clip vs séquence), `createRemoveKeyframeRangeAction`,
  et le rendu `<canvas>` dans le panneau. Le statut en bas du panneau affiche l'erreur exacte
  en cas de problème ; ces fonctions sont isolées dans `host.js` pour être ajustées facilement.

## Tests

```
cd curve-editor && npm test
```
