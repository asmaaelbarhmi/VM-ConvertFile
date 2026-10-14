# VM-ConvertFile — Image vers DST

Outil web de préparation de motifs de broderie : une image (logo, PDF, SVG) devient un fichier
machine (`.DST`, puis PES/JEF/EXP) avec sous-couche, compensation de tirage, satin pour les
formes étroites et tatami pour les surfaces.

**Tout est écrit en TypeScript.** Le moteur est une bibliothèque pure (sans dépendance au
navigateur ni au serveur) : il tourne dans le navigateur de l'utilisateur, donc les images ne
quittent pas son ordinateur et la montée en charge est gratuite. L'ancienne version Python
(prototype Streamlit + moteur Ink/Stitch) est conservée sous l'étiquette Git `python-v1`.

> ⚠️ Un fichier de broderie n'est jamais « prêt à broder » sans simulation et essai sur une
> chute de tissu.

## Structure

```text
packages/stitch-core   moteur : géométrie, tatami aligné sur grille globale, sous-couche,
                       compensation, plan de points (arrêts, sauts, coupes), DST, aperçu SVG,
                       profils tissus et machines, contrôle
packages/image         préparation d'image : décodage, fond, fils, vectorisation, classement, tuilage
web                    interface web (Vite), moteur exécuté dans un Web Worker
```

## Développement

```bash
npm install
npm test          # tests (vitest)
npm run typecheck
npm run dev       # interface sur http://localhost:5173
```

Node 20 ou plus récent. Aucune autre installation.
