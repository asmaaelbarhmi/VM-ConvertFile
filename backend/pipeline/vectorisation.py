"""Vectorisation : transforme chaque couche de couleur (grille de pixels)
en formes géométriques (polygones) en millimètres."""
import io
import re
import numpy as np
from PIL import Image
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union
import vtracer

_NOMBRE = re.compile(r"-?\d+(?:\.\d+)?")


def _anneaux(d):
    """Découpe l'attribut `d` d'un chemin (M x,y L x,y … Z) en listes de points."""
    anneaux, courant = [], []
    for commande, coords in re.findall(r"([MLZmlz])([^MLZmlz]*)", d):
        nombres = [float(n) for n in _NOMBRE.findall(coords)]
        points = list(zip(nombres[0::2], nombres[1::2]))
        if commande in "Mm":
            if len(courant) >= 3:
                anneaux.append(courant)
            courant = points
        elif commande in "Ll":
            courant += points
        else:
            if len(courant) >= 3:
                anneaux.append(courant)
            courant = []
    if len(courant) >= 3:
        anneaux.append(courant)
    return anneaux


def _polygone(anneaux, decalage, echelle):
    """Construit un polygone (extérieur + trous) à partir des anneaux d'un chemin."""
    def conv(points):
        return [((x + decalage[0]) * echelle, (y + decalage[1]) * echelle) for x, y in points]
    anneaux = sorted(anneaux, key=lambda a: -abs(Polygon(a).area))
    poly = Polygon(conv(anneaux[0]), [conv(a) for a in anneaux[1:]])
    if not poly.is_valid:
        poly = poly.buffer(0)
    return poly


def vectoriser_masque(masque, echelle_mm, filtre_poussiere=4):
    """Masque booléen → liste de polygones Shapely en mm.
    `echelle_mm` = taille d'une case du masque en mm."""
    if not masque.any():
        return []
    image = Image.fromarray(np.where(masque, 0, 255).astype("uint8")).convert("RGB")
    tampon = io.BytesIO()
    image.save(tampon, "PNG")
    svg = vtracer.convert_raw_image_to_svg(
        tampon.getvalue(), img_format="png", colormode="binary", mode="polygon",
        filter_speckle=filtre_poussiere, corner_threshold=60, length_threshold=3.5,
        splice_threshold=45, path_precision=2)
    polygones = []
    for d, transform in re.findall(r'<path d="([^"]+)"[^>]*?(?:transform="([^"]*)")?/?>', svg):
        m = re.search(r"translate\(([-\d.]+),([-\d.]+)\)", transform or "")
        decalage = (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)
        anneaux = _anneaux(d)
        if not anneaux:
            continue
        poly = _polygone(anneaux, decalage, echelle_mm)
        if poly.is_empty:
            continue
        if isinstance(poly, MultiPolygon):
            polygones.extend(p for p in poly.geoms if not p.is_empty)
        else:
            polygones.append(poly)
    return polygones


def vectoriser_couches(couches, largeur_mm, hauteur_mm):
    """[(rgb, masque)] → [(rgb, [polygones mm])]. Le masque couvre
    largeur_mm × hauteur_mm."""
    resultat = []
    for rgb, masque in couches:
        echelle = largeur_mm / masque.shape[1]
        polys = vectoriser_masque(masque, echelle)
        if polys:
            fusion = unary_union(polys)
            polys = list(fusion.geoms) if isinstance(fusion, MultiPolygon) else [fusion]
        resultat.append((rgb, [p for p in polys if not p.is_empty]))
    return resultat
