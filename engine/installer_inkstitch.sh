#!/usr/bin/env bash
# Installe le moteur Ink/Stitch (version figée) pour un usage serveur, sans Inkscape ni interface.
# Usage : engine/installer_inkstitch.sh [python]   (par défaut : le python de l'environnement courant)
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
PY="${1:-python}"
COMMIT="a6a3d480f006292c709a145f56a4e1cabbd5cf8a"   # Ink/Stitch main, 12 oct. 2026
DEST="$ICI/inkstitch"

if [ ! -d "$DEST/.git" ]; then
  git clone --quiet https://github.com/inkstitch/inkstitch "$DEST"
fi
git -C "$DEST" fetch --quiet --depth 1 origin "$COMMIT"
git -C "$DEST" checkout --quiet "$COMMIT"

# inkex sans PyGObject (bibliothèques graphiques inutiles sur un serveur)
"$PY" -m pip install --quiet --no-deps \
  "inkex @ git+https://gitlab.com/CapellanCitizen/extensions.git@a887f9d4c8adacd62786e4f46c8ef1467bedc1df"
"$PY" -m pip install --quiet -r "$ICI/requirements-moteur.txt"

echo "Ink/Stitch installé dans $DEST ($COMMIT)"
