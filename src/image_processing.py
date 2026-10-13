"""Ouverture et préparation des images (pixels, PDF, SVG)."""
import io
import numpy as np
from PIL import Image

FORMATS_PIXELS = {"PNG", "JPEG", "WEBP", "BMP", "TIFF", "GIF"}
EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "gif", "pdf", "svg"]
DPI_VECTORIEL = 300  # finesse de conversion des PDF/SVG en pixels


def _rendre_pdf(donnees):
    import pypdfium2
    doc = pypdfium2.PdfDocument(donnees)
    if len(doc) == 0:
        raise ValueError("Le PDF ne contient aucune page.")
    image = doc[0].render(scale=DPI_VECTORIEL / 72).to_pil().convert("RGB")
    image.format = "PDF"
    return image


def _rendre_svg(donnees):
    import cairosvg
    png = cairosvg.svg2png(bytestring=donnees, output_width=2000)
    image = Image.open(io.BytesIO(png))
    image.load()
    image.format = "SVG"
    return image


def ouvrir_image(fichier, nom=None):
    """Ouvre un fichier image, PDF ou SVG. Renvoie une image Pillow.
    `nom` sert à reconnaître PDF/SVG par leur extension."""
    nom = (nom or getattr(fichier, "name", "") or "").lower()
    donnees = fichier.read() if hasattr(fichier, "read") else fichier
    if hasattr(fichier, "seek"):
        fichier.seek(0)
    try:
        if nom.endswith(".pdf") or donnees[:4] == b"%PDF":
            return _rendre_pdf(donnees)
        if nom.endswith(".svg") or b"<svg" in donnees[:2000]:
            return _rendre_svg(donnees)
        image = Image.open(io.BytesIO(donnees))
        image.load()
    except ValueError:
        raise
    except Exception:
        raise ValueError("Ce fichier n'est pas une image lisible.")
    if image.format not in FORMATS_PIXELS:
        raise ValueError(f"Format non pris en charge : {image.format}. "
                         "Formats acceptés : PNG, JPG, WebP, BMP, TIFF, GIF, PDF, SVG.")
    return image


def aplatir(image):
    """Remplace la transparence par du blanc et renvoie une image RGB."""
    img = image.convert("RGBA")
    fond = Image.new("RGBA", img.size, "white")
    return Image.alpha_composite(fond, img).convert("RGB")


def grille(largeur_mm, hauteur_mm, pas_mm):
    """Nombre de colonnes et de lignes de la grille de points."""
    return max(1, round(largeur_mm / pas_mm)), max(1, round(hauteur_mm / pas_mm))


def fond_sombre(image):
    """Vrai si les bords de l'image sont majoritairement sombres
    (fond noir ou foncé : il faudra inverser)."""
    g = np.array(aplatir(image).convert("L"))
    bords = np.concatenate([g[0], g[-1], g[:, 0], g[:, -1]])
    return bords.mean() < 128


def masque_logo(image, largeur_mm, hauteur_mm, seuil=128, pas_mm=0.4, inverser=False):
    """Grille True/False : True = zone à broder (1 case = pas_mm × pas_mm)."""
    colonnes, lignes = grille(largeur_mm, hauteur_mm, pas_mm)
    gris = aplatir(image).convert("L").resize((colonnes, lignes), Image.LANCZOS)
    masque = np.array(gris) < seuil
    return ~masque if inverser else masque


def couches_couleurs(image, largeur_mm, hauteur_mm, nb_couleurs=4, pas_mm=0.4, tolerance_fond=60):
    """Réduit l'image à `nb_couleurs` couleurs et renvoie une liste de
    (rgb, masque) sans le fond, de la plus grande zone à la plus petite.
    Les teintes proches du fond (distance < tolerance_fond) sont ignorées."""
    colonnes, lignes = grille(largeur_mm, hauteur_mm, pas_mm)
    img = aplatir(image).resize((colonnes, lignes), Image.LANCZOS)
    quant = img.quantize(colors=nb_couleurs + 4, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    index = np.array(quant)
    palette = np.array(quant.getpalette()[: 3 * (index.max() + 1)]).reshape(-1, 3)
    bords = np.concatenate([index[0], index[-1], index[:, 0], index[:, -1]])
    fond = np.bincount(bords).argmax()  # couleur la plus présente sur les bords = tissu
    couches = []
    for i in range(len(palette)):
        distance = np.linalg.norm(palette[i].astype(float) - palette[fond])
        masque = index == i
        if i == fond or distance < tolerance_fond or masque.sum() == 0:
            continue
        couches.append((tuple(int(v) for v in palette[i]), masque))
    couches.sort(key=lambda c: -c[1].sum())
    return couches[:nb_couleurs]
