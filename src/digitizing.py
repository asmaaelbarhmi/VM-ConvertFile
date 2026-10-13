"""Transformation des grilles en points de broderie."""
import math
import numpy as np
from pyembroidery import EmbPattern, EmbThread, STITCH, JUMP, TRIM, END, COLOR_CHANGE

UNITE_MM = 10  # PyEmbroidery travaille en dixièmes de millimètre


def trouver_segments(ligne):
    """Repère les morceaux continus de True dans une ligne."""
    segments, debut = [], None
    for i, valeur in enumerate(ligne):
        if valeur and debut is None:
            debut = i
        elif not valeur and debut is not None:
            segments.append((debut, i - 1))
            debut = None
    if debut is not None:
        segments.append((debut, len(ligne) - 1))
    return segments


def _penetrations(x1, x2, longueur_max, decalage):
    """Positions des piqûres entre x1 et x2, alignées sur une grille
    décalée d'une ligne à l'autre (évite les rangées de trous alignés)."""
    a, b = min(x1, x2), max(x1, x2)
    k = math.floor((a - decalage) / longueur_max) + 1
    points = []
    x = k * longueur_max + decalage
    while x < b:
        if x > a:
            points.append(x)
        x += longueur_max
    if x1 > x2:
        points.reverse()
    return points + [x2]


def zones(masque, min_cellules=4):
    """Découpe le masque en zones continues (voisins à 8 directions).
    Renvoie des (y0, x0, sous_masque) triés du haut vers le bas, sans les
    poussières de moins de `min_cellules` cases."""
    h, w = masque.shape
    vu = np.zeros_like(masque, dtype=bool)
    resultat = []
    for y0, x0 in zip(*np.nonzero(masque)):
        if vu[y0, x0]:
            continue
        pile, cellules = [(y0, x0)], []
        vu[y0, x0] = True
        while pile:
            y, x = pile.pop()
            cellules.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and masque[ny, nx] and not vu[ny, nx]:
                        vu[ny, nx] = True
                        pile.append((ny, nx))
        if len(cellules) < min_cellules:
            continue
        ys, xs = zip(*cellules)
        y1, y2, x1, x2 = min(ys), max(ys), min(xs), max(xs)
        sous = np.zeros((y2 - y1 + 1, x2 - x1 + 1), dtype=bool)
        sous[np.array(ys) - y1, np.array(xs) - x1] = True
        resultat.append((y1, x1, sous))
    resultat.sort(key=lambda z: (z[0], z[1]))
    return resultat


def remplir(motif, masque, pas_mm=0.4, point_max_mm=3.0, position=None, coupe_mm=8.0):
    """Ajoute au motif un remplissage zone par zone, chaque zone ligne par
    ligne en aller-retour. Le fil n'est coupé qu'avant un déplacement de plus
    de `coupe_mm`. Renvoie la dernière position."""
    for y0, x0, sous in zones(masque):
        position = _remplir_zone(motif, sous, pas_mm, point_max_mm, position, coupe_mm,
                                 x0 * pas_mm * UNITE_MM, y0 * pas_mm * UNITE_MM)
    return position


def _remplir_zone(motif, masque, pas_mm, point_max_mm, position, coupe_mm, ox, oy):
    unite = pas_mm * UNITE_MM
    longueur_max = point_max_mm * UNITE_MM
    for y, ligne in enumerate(masque):
        segments = trouver_segments(ligne)
        if y % 2 == 1:
            segments = [(b, a) for a, b in reversed(segments)]
        decalage = (y % 3) * longueur_max / 3
        for a, b in segments:
            x1, x2, yy = ox + a * unite, ox + b * unite, oy + y * unite
            saut = position is None or math.hypot(x1 - position[0], yy - position[1]) > longueur_max
            if saut:
                if position is not None and math.hypot(x1 - position[0], yy - position[1]) > coupe_mm * UNITE_MM:
                    motif.add_stitch_absolute(TRIM, *position)  # couper le fil
                motif.add_stitch_absolute(JUMP, x1, yy)  # déplacement sans coudre
            motif.add_stitch_absolute(STITCH, x1, yy)
            for x in _penetrations(x1, x2, longueur_max, decalage):
                motif.add_stitch_absolute(STITCH, x, yy)
            position = (x2, yy)
    return position


def _fil(rgb, nom):
    fil = EmbThread()
    fil.set_color(*rgb)
    fil.description = nom
    return fil


def remplissage(masque, pas_mm=0.4, point_max_mm=3.0, rgb=(0, 0, 0), coupe_mm=8.0):
    """Motif à une seule couleur."""
    return motif_couches([(rgb, masque)], pas_mm, point_max_mm, coupe_mm)


def motif_couches(couches, pas_mm=0.4, point_max_mm=3.0, coupe_mm=8.0):
    """Motif multicolore : une couche (rgb, masque) par couleur, avec un
    arrêt de changement de fil entre chaque couche."""
    motif = EmbPattern()
    position = None
    for n, (rgb, masque) in enumerate(couches):
        motif.add_thread(_fil(rgb, f"Couleur {n + 1}"))
        if position is not None:
            motif.add_stitch_absolute(TRIM, *position)
            motif.add_stitch_absolute(COLOR_CHANGE, *position)
        position = remplir(motif, masque, pas_mm, point_max_mm, position, coupe_mm)
    motif.add_stitch_absolute(END, *(position or (0, 0)))
    return motif
