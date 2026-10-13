from pyembroidery import STITCH


def verifier(motif):
    """Compte les points, mesure le motif et liste les avertissements."""
    alertes = []
    nb_points = sum(1 for s in motif.stitches if s[2] == STITCH)
    min_x, min_y, max_x, max_y = motif.bounds()
    l_mm, h_mm = (max_x - min_x) / 10, (max_y - min_y) / 10
    if nb_points == 0:
        alertes.append("Aucun point généré : l'image est peut-être trop claire (ajustez le seuil).")
    if nb_points > 50000:
        alertes.append(f"Motif très dense ({nb_points} points) : risque pour le tissu et temps long.")
    if l_mm > 300 or h_mm > 300:
        alertes.append("Motif plus grand que 30 cm : vérifiez la taille de votre cadre.")
    return {"points": nb_points, "largeur_mm": l_mm, "hauteur_mm": h_mm, "alertes": alertes}
