"""Analyse des formes vectorisées : type de point à utiliser et ordre de broderie."""
import math
import shapely
from shapely.geometry import Polygon, Point, box, MultiPolygon

TUILE_MM = 40.0          # taille des tuiles pour les grandes formes
SURFACE_TUILAGE_MM2 = 1200.0
TROUS_TUILAGE = 6


def largeur_maxi(poly):
    """Largeur maximale d'une forme : diamètre du plus grand cercle que l'on
    peut y inscrire. Insensible aux trous et aux contours découpés."""
    if poly.is_empty or poly.area == 0:
        return 0.0
    return 2 * shapely.maximum_inscribed_circle(poly, 0.05).length


def largeur_moyenne(poly):
    """Largeur moyenne : 2 × surface / périmètre (exacte pour une bande)."""
    if poly.length == 0:
        return 0.0
    return 2 * poly.area / poly.length


def angle_principal(poly):
    """Angle (degrés) de l'axe le plus long du rectangle englobant minimal."""
    rect = poly.minimum_rotated_rectangle
    if not isinstance(rect, Polygon):
        return 0.0
    pts = list(rect.exterior.coords)[:4]
    cotes = [(math.dist(pts[i], pts[i + 1]), pts[i], pts[i + 1]) for i in range(3)]
    _, a, b = max(cotes)
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180


def classer(poly, tissu):
    """Décide du traitement d'une forme selon le profil tissu :
    - 'ignorer'  : trop petite ou trop fine pour être brodée
    - 'satin'    : étroite (texte, contour) → points en zigzag serrés
    - 'tatami'   : large → remplissage"""
    if poly.area < tissu["surface_mini_mm2"]:
        return "ignorer"
    largeur = largeur_maxi(poly)
    if largeur < tissu["largeur_mini_mm"]:
        return "ignorer"
    if largeur <= tissu["satin_largeur_max_mm"]:
        return "satin"
    return "tatami"


def tuiler(poly, taille=TUILE_MM):
    """Découpe un polygone en tuiles carrées. Le moteur est très lent sur les
    grandes formes à trous (temps plus que proportionnel à la taille) ; les
    rangées de tatami étant alignées sur une grille globale, les tuiles
    voisines se raccordent sans couture visible."""
    minx, miny, maxx, maxy = poly.bounds
    tuiles = []
    x = math.floor(minx / taille) * taille
    while x < maxx:
        y = math.floor(miny / taille) * taille
        while y < maxy:
            morceau = poly.intersection(box(x, y, x + taille, y + taille))
            tuiles.extend(g for g in _polygones(morceau) if g.area > 0.5)
            y += taille
        x += taille
    return tuiles


def _polygones(geom):
    """Tous les polygones d'une géométrie (polygone, multi-polygone ou
    collection mélangeant polygones et segments)."""
    if isinstance(geom, Polygon):
        return [geom] if not geom.is_empty else []
    if hasattr(geom, "geoms"):
        return [p for g in geom.geoms for p in _polygones(g)]
    return []


def a_tuiler(poly):
    return poly.area > SURFACE_TUILAGE_MM2 or len(poly.interiors) > TROUS_TUILAGE


def ordonner(formes):
    """Ordre de broderie dans une même couleur : du plus proche au plus proche
    (voisin le plus proche à partir du coin haut-gauche) pour limiter les sauts."""
    restantes = list(formes)
    ordre = []
    position = (0.0, 0.0)
    while restantes:
        suivante = min(restantes, key=lambda f: f["poly"].centroid.distance(_point(position)))
        restantes.remove(suivante)
        ordre.append(suivante)
        c = suivante["poly"].centroid
        position = (c.x, c.y)
    return ordre


def _point(xy):
    return Point(xy)


def analyser(couches_vectorielles, tissu):
    """[(rgb, [polygones])] → [{'rgb', 'formes': [{'poly', 'type', 'angle', 'largeur'}]}]
    Les couleurs sont gardées dans l'ordre reçu (grande zone d'abord)."""
    resultat = []
    for rgb, polys in couches_vectorielles:
        formes = []
        for poly in polys:
            type_ = classer(poly, tissu)
            if type_ == "ignorer":
                continue
            largeur, angle = largeur_maxi(poly), angle_principal(poly)
            morceaux = tuiler(poly) if type_ == "tatami" and a_tuiler(poly) else [poly]
            for m in morceaux:
                formes.append({"poly": m, "type": type_, "largeur": largeur, "angle": angle,
                               "tuile": len(morceaux) > 1})
        if formes:
            resultat.append({"rgb": rgb, "formes": ordonner(formes)})
    return resultat
