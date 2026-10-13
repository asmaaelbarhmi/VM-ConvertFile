# VM-ConvertFile — Image vers DST

Mini-application web locale qui prépare une image pour la broderie et exporte un fichier `.DST`.

> ⚠️ Un fichier DST contient des points de broderie, pas l'image. Le résultat n'est **pas garanti** :
> simulez toujours le motif dans un logiciel de broderie et faites un essai sur une chute de tissu
> avant la production.

## Fonctionnalités (prototype)

- Import PNG, JPG, WebP, BMP, TIFF (10 Mo max).
- Dimensions finales en millimètres.
- Mode **logo / dessin simple** : seuil noir/blanc puis remplissage ligne par ligne.
- Export `.DST` relu automatiquement pour vérifier sa validité.
- Avertissements : motif vide, trop dense, trop grand.
- Mode photo : prévu (phase 3).

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
src/validation.py       contrôles et avertissements
tests/                  tests automatisés (pytest)
```
