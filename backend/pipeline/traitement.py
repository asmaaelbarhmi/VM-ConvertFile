"""Enchaînement complet : fichier → analyse → vectorisation → SVG → moteur → contrôle."""
import io
import json
import time
import pyembroidery
from PIL import Image

from backend import config
from backend.pipeline import vectorisation, formes, svg_inkstitch, moteur
from src.image_processing import (ouvrir_image, recadrer_marges, taille_proposee, taille_mm,
                                  couches_couleurs, couches_par_palette, aplatir)
from src.validation import verifier
from src.apercu import dessiner

PAS_GRILLE_MM = 0.2  # finesse de la grille de couleurs avant vectorisation


def charger_profils():
    tissus = json.loads((config.DOSSIER_PROFILS / "tissus.json").read_text(encoding="utf-8"))
    machines = json.loads((config.DOSSIER_PROFILS / "machines.json").read_text(encoding="utf-8"))
    return tissus, machines


def analyser(donnees, nom, nb_couleurs=None):
    """Première étape, rapide : image recadrée, taille proposée, fils détectés.
    Renvoie (image recadrée, dict d'analyse)."""
    image = ouvrir_image(io.BytesIO(donnees), nom)
    image, boite = recadrer_marges(image)
    largeur, hauteur = taille_proposee(image, maxi_mm=config.TAILLE_MAX_MM)
    couches = couches_couleurs(image, largeur, hauteur, nb_couleurs, pas_mm=max(PAS_GRILLE_MM, largeur / 600))
    surface = couches[0][1].size if couches else 1
    return image, {
        "format": image.format, "pixels": [image.width, image.height],
        "taille_connue": taille_mm(image) is not None,
        "fond_rgb": image.info.get("fond_rgb"),
        "largeur_mm": largeur, "hauteur_mm": hauteur,
        "couleurs": [{"hex": "#%02x%02x%02x" % rgb, "part": round(float(m.sum()) / surface, 3)}
                     for rgb, m in couches],
    }


def vignette(image, largeur_px=600):
    img = aplatir(image)
    img.thumbnail((largeur_px, largeur_px))
    tampon = io.BytesIO()
    img.save(tampon, "PNG")
    return tampon.getvalue()


def traiter(image, largeur_mm, tissu, machine, nb_couleurs=None, coupe_mm=8.0, formats=("dst",),
            carte_fils=svg_inkstitch.CARTES_FILS[0], palette=None):
    """Pipeline complet. Renvoie un dict : fichiers (octets par format), svg,
    rapport, formes, étapes (durées).
    `palette` : couleurs [(r, g, b)] issues de l'analyse ; si elle est donnée,
    la génération reprend exactement les fils montrés à l'utilisateur."""
    etapes = {}
    t = time.time()
    hauteur_mm = round(largeur_mm * image.height / image.width, 1)
    pas = max(PAS_GRILLE_MM, largeur_mm / 1500)
    if palette:
        couches = couches_par_palette(image, largeur_mm, hauteur_mm, palette, pas_mm=pas)
    else:
        couches = couches_couleurs(image, largeur_mm, hauteur_mm, nb_couleurs, pas_mm=pas)
    if not couches:
        raise ValueError("Aucune zone à broder trouvée dans l'image.")
    etapes["couleurs_s"] = round(time.time() - t, 2)

    t = time.time()
    vectorielles = vectorisation.vectoriser_couches(couches, largeur_mm, hauteur_mm)
    analysees = formes.analyser(vectorielles, tissu)
    if not analysees:
        raise ValueError("Toutes les formes sont trop petites ou trop fines pour être brodées "
                         "à cette taille : agrandissez le motif.")
    etapes["vectorisation_s"] = round(time.time() - t, 2)

    svg = svg_inkstitch.construire_svg(analysees, largeur_mm, hauteur_mm, tissu, coupe_mm,
                                       carte_fils=carte_fils)

    t = time.time()
    fichiers = {"dst": moteur.generer(svg, "dst")}
    etapes["moteur_s"] = round(time.time() - t, 2)

    motif = pyembroidery.read_dst(io.BytesIO(fichiers["dst"]))
    if motif is None or len(motif.stitches) == 0:
        raise moteur.ErreurMoteur("Le fichier DST produit n'a pas pu être relu.")
    for n, couche in enumerate(analysees):  # le DST ne stocke pas les couleurs : on les réinjecte
        fil = pyembroidery.EmbThread()
        fil.set_color(*couche["rgb"])
        fil.description = f"Fil {n + 1}"
        motif.add_thread(fil)
    # Les autres formats (PES, JEF…) sont dérivés du même plan de points, avec les couleurs
    for f in formats:
        if f != "dst":
            fichiers[f] = _convertir(motif, f)
    surface = couches[0][1].size
    couverture = sum(c[1].sum() for c in couches) / surface
    rapport = verifier(motif, machine, couverture)
    rapport["minutes"] = round(rapport["minutes"], 1)
    for cle in ("largeur_mm", "hauteur_mm", "point_max_mm"):
        rapport[cle] = round(rapport[cle], 1)

    resume_formes = []
    for n, couche in enumerate(analysees):
        types = {}
        for f in couche["formes"]:
            types[f["type"]] = types.get(f["type"], 0) + 1
        resume_formes.append({"fil": n + 1, "hex": "#%02x%02x%02x" % couche["rgb"], "formes": types,
                              "tuiles": sum(1 for f in couche["formes"] if f.get("tuile"))})

    return {"fichiers": fichiers, "svg": svg, "rapport": rapport, "fils": resume_formes,
            "apercu_png": _png(dessiner(motif, 900)), "etapes": etapes,
            "largeur_mm": largeur_mm, "hauteur_mm": hauteur_mm}


def _convertir(motif, format_):
    import os
    import tempfile
    with tempfile.TemporaryDirectory() as dossier:
        chemin = os.path.join(dossier, f"motif.{format_}")
        pyembroidery.write(motif, chemin)
        with open(chemin, "rb") as f:
            return f.read()


def _png(image):
    tampon = io.BytesIO()
    image.save(tampon, "PNG")
    return tampon.getvalue()
