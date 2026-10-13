import math
from pyembroidery import EmbPattern, STITCH, JUMP, TRIM, END


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


def remplissage(masque, pas_mm=0.4, point_max_mm=3.0):
    """Remplissage ligne par ligne, en aller-retour.
    Unité de PyEmbroidery : 0,1 mm."""
    motif = EmbPattern()
    unite = pas_mm * 10
    longueur_max = point_max_mm * 10
    position = None

    for y, ligne in enumerate(masque):
        segments = trouver_segments(ligne)
        if y % 2 == 1:  # une ligne sur deux : de droite à gauche
            segments = [(b, a) for a, b in reversed(segments)]
        for a, b in segments:
            x1, x2, yy = a * unite, b * unite, y * unite
            if position is not None:
                distance = math.hypot(x1 - position[0], yy - position[1])
                if distance > longueur_max:
                    motif.add_stitch_absolute(TRIM, *position)  # couper le fil
                motif.add_stitch_absolute(JUMP, x1, yy)
            motif.add_stitch_absolute(STITCH, x1, yy)
            nb = max(1, math.ceil(abs(x2 - x1) / longueur_max))
            for i in range(1, nb + 1):
                motif.add_stitch_absolute(STITCH, x1 + (x2 - x1) * i / nb, yy)
            position = (x2, yy)

    motif.add_stitch_absolute(END, *(position or (0, 0)))
    return motif
