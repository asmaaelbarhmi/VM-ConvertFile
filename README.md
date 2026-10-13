# VM-ConvertFile — Image vers DST

Deux applications cohabitent dans ce dépôt :

| | Prototype (racine) | **Outil professionnel** (`backend/` + `frontend/`) |
|---|---|---|
| Interface | Streamlit (`app.py`) | Web (HTML/JS) servie par une API FastAPI |
| Moteur | Remplissage maison | **Ink/Stitch** (vectorisation, satin/tatami, sous-couche, compensation) |
| Formats de sortie | DST | DST, PES, JEF, EXP… |
| Déploiement | Streamlit Community Cloud | Docker (serveur ou poste de l'atelier) |

## Outil professionnel : démarrage

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-backend.txt
engine/installer_inkstitch.sh          # télécharge Ink/Stitch (version figée) et ses dépendances
python -m pytest                       # 40 tests
uvicorn backend.api:app --reload       # puis ouvrir http://localhost:8000
```

Avec Docker : `docker build -t image-vers-dst . && docker run -p 8000:8000 -v dst_data:/data image-vers-dst`.

### Pipeline

```text
fichier (PNG/JPG/PDF/SVG…) → retrait des marges, taille proposée, détection des fils
  → vectorisation par couleur (vtracer) → classement des formes (satin si étroite, tatami si large)
  → SVG Ink/Stitch avec profil tissu (densité, sous-couche, compensation de tirage)
  → moteur Ink/Stitch (sans écran) → contrôle (cadre, points, coupes, durée) → aperçu → DST
```

- `backend/profils/tissus.json` : réglages par support (polo, jersey, polaire, casquette, toile).
- `backend/profils/machines.json` : cadres et vitesses (SWF K-series…).
- `engine/wxstub/` : faux module graphique permettant d'exécuter Ink/Stitch sur un serveur.
- `engine/config/` : journal du moteur désactivé (le journal de débogage coûtait ~70 % du temps).
- Vitesse : les grandes formes sont découpées en tuiles de 40 mm (rangées alignées sur une grille
  globale, donc sans couture) et une carte de fils réelle est imposée (Madeira, Isacord, Gunold)
  au lieu d'une recherche parmi 75 cartes. Motif de 21 × 28 cm, 100 000 points : ≈ 100 s.
- API : `GET /api/sante`, `GET /api/profils`, `POST /api/analyses`, `POST /api/motifs/{id}`,
  `GET /api/motifs/{id}`, `GET /api/motifs/{id}/motif.dst|pes|jef|exp|svg|apercu.png`.

Licence : Ink/Stitch est sous GPL-3 ; il est lancé comme un programme séparé. À vérifier avant
toute distribution commerciale de l'outil.

---

## Prototype Streamlit

Mini-application web locale qui prépare une image pour la broderie et exporte un fichier `.DST`.

> ⚠️ Un fichier DST contient des points de broderie, pas l'image. Le résultat n'est **pas garanti** :
> simulez toujours le motif dans un logiciel de broderie et faites un essai sur une chute de tissu
> avant la production.

## Fonctionnalités (prototype)

- Import PNG, JPG, WebP, BMP, TIFF, GIF, **PDF** (1re page) et **SVG** (10 Mo max).
- Marges retirées automatiquement et **taille proposée d'après le fichier** (page PDF, largeur/hauteur SVG, résolution DPI), modifiable ensuite ; la hauteur suit les proportions. Profil machine dans la barre latérale.
- Mode **logo 1 couleur** : seuil noir/blanc, détection automatique d'un fond sombre.
- Mode **logo plusieurs couleurs** : réduction à N fils, le fond (couleur des bords) n'est pas brodé,
  un arrêt de changement de fil entre chaque couleur, ordre des fils affiché pour l'opérateur.
- Remplissage zone par zone, piqûres décalées d'une ligne à l'autre, coupe de fil seulement
  pour les grands déplacements.
- **Aperçu des points** tel que la machine les coudra.
- Export `.DST` relu automatiquement pour vérifier sa validité.
- Diagnostic : nombre de points, sauts, coupes, couleurs, dimensions, durée estimée, avertissements
  (motif vide ou trop dense, plus grand que le cadre, points trop longs, trop de coupes).
- Mode photo : prévu (phase 3).

## Ce que contient (et ne contient pas) un DST

Le DST contient les positions des points, les sauts, les coupes et les **arrêts de changement de
couleur**, mais **pas les couleurs elles-mêmes** : l'opérateur associe chaque arrêt à une aiguille
sur la machine (SWF, Tajima…). L'app affiche l'ordre des fils pour faciliter ce réglage.

## Limites

Le remplissage est un simple « tatami » horizontal sans sous-couche ni compensation. Les motifs
complexes (plusieurs types de points, satin, dégradés, textes fins) demandent une numérisation
manuelle dans un logiciel spécialisé (Wilcom, Hatch, Ink/Stitch).

## Lancer en local

macOS / Linux :

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m pytest
streamlit run app.py
```

Windows PowerShell :

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m pytest
python -m streamlit run app.py
```

Ouvrir ensuite http://localhost:8501.

## Déployer

Sur https://share.streamlit.io : *Create app* → dépôt `VM-ConvertFile`, branche `main`, fichier `app.py`.

## Structure

```text
app.py                  interface Streamlit
src/image_processing.py ouverture et préparation de l'image
src/digitizing.py       génération des points
src/dst_export.py       écriture et relecture du DST
src/validation.py       contrôles, avertissements et profil machine
src/apercu.py           dessin des points pour l'aperçu
packages.txt            bibliothèque système (cairo) pour les SVG sur Streamlit Cloud
tests/                  tests automatisés (pytest)
```
