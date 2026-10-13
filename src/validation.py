"""Contrôles techniques du motif et rapport pour l'opérateur."""
from pyembroidery import STITCH, JUMP, TRIM, COLOR_CHANGE

# Profil par défaut : à ajuster selon le cadre monté sur la machine.
PROFIL_DEFAUT = {"nom": "SWF K-series (cadre à vérifier)", "cadre_l_mm": 300,
                 "cadre_h_mm": 300, "vitesse_ppm": 700, "point_max_mm": 7.0}


def verifier(motif, profil=PROFIL_DEFAUT, couverture=None):
    """Compte les points, mesure le motif et liste les avertissements."""
    alertes = []
    nb = {STITCH: 0, JUMP: 0, TRIM: 0, COLOR_CHANGE: 0}
    plus_long = 0.0
    precedent = None
    for x, y, code in motif.stitches:
        nb[code] = nb.get(code, 0) + 1
        if code == STITCH and precedent is not None:
            plus_long = max(plus_long, ((x - precedent[0]) ** 2 + (y - precedent[1]) ** 2) ** 0.5)
        precedent = (x, y) if code in (STITCH, JUMP) else precedent
    min_x, min_y, max_x, max_y = motif.bounds()
    l_mm, h_mm = (max_x - min_x) / 10, (max_y - min_y) / 10
    minutes = nb[STITCH] / profil["vitesse_ppm"] + nb[COLOR_CHANGE] * 0.5 + nb[TRIM] * 0.05

    if nb[STITCH] == 0:
        alertes.append("Aucun point généré : image trop claire ou fond mal détecté "
                       "(ajustez le seuil ou cochez « inverser »).")
    if couverture is not None and couverture > 0.6:
        alertes.append(f"{couverture:.0%} de la surface sera brodée : c'est très dense. "
                       "Vérifiez que le fond n'a pas été pris pour le motif.")
    if nb[STITCH] > 50000:
        alertes.append(f"Motif très dense ({nb[STITCH]} points) : risque pour le tissu et temps long.")
    if l_mm > profil["cadre_l_mm"] or h_mm > profil["cadre_h_mm"]:
        alertes.append(f"Motif ({l_mm:.0f} × {h_mm:.0f} mm) plus grand que le cadre "
                       f"({profil['cadre_l_mm']} × {profil['cadre_h_mm']} mm).")
    if plus_long / 10 > profil["point_max_mm"]:
        alertes.append(f"Point de {plus_long / 10:.1f} mm : au-delà de {profil['point_max_mm']} mm, "
                       "le fil risque de boucler.")
    if nb[TRIM] > 200:
        alertes.append(f"{nb[TRIM]} coupes de fil : motif très fragmenté, broderie lente.")
    return {"points": nb[STITCH], "sauts": nb[JUMP], "coupes": nb[TRIM],
            "couleurs": nb[COLOR_CHANGE] + 1, "largeur_mm": l_mm, "hauteur_mm": h_mm,
            "point_max_mm": plus_long / 10, "minutes": minutes, "alertes": alertes}
