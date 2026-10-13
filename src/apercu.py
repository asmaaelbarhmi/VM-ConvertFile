"""Aperçu des points tel que la machine les coudra."""
from PIL import Image, ImageDraw
from pyembroidery import STITCH, JUMP, COLOR_CHANGE


def dessiner(motif, largeur_px=800, fond=(255, 255, 255)):
    """Dessine chaque point comme un trait ; renvoie une image Pillow."""
    min_x, min_y, max_x, max_y = motif.bounds()
    echelle = largeur_px / max(1, max_x - min_x)
    marge = 10
    image = Image.new("RGB", (int((max_x - min_x) * echelle) + 2 * marge,
                              int((max_y - min_y) * echelle) + 2 * marge), fond)
    dessin = ImageDraw.Draw(image)
    fils = motif.threadlist or []
    couleur_index = 0
    couleur = _rgb(fils, 0)
    precedent = None
    for x, y, code in motif.stitches:
        p = ((x - min_x) * echelle + marge, (y - min_y) * echelle + marge)
        if code == STITCH and precedent is not None:
            dessin.line([precedent, p], fill=couleur, width=1)
        if code == COLOR_CHANGE:
            couleur_index += 1
            couleur = _rgb(fils, couleur_index)
        precedent = p if code in (STITCH, JUMP) else precedent
    return image


def _rgb(fils, i):
    if i < len(fils):
        f = fils[i]
        return (f.get_red(), f.get_green(), f.get_blue())
    return (200, 0, 0)
