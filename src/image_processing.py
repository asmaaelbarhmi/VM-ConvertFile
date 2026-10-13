from PIL import Image
import numpy as np

FORMATS_ACCEPTES = {"PNG", "JPEG", "WEBP", "BMP", "TIFF"}


def ouvrir_image(fichier):
    """Ouvre l'image et refuse les formats non prévus."""
    try:
        image = Image.open(fichier)
        image.load()
    except Exception:
        raise ValueError("Ce fichier n'est pas une image lisible.")
    if image.format not in FORMATS_ACCEPTES:
        raise ValueError(f"Format non pris en charge : {image.format}. "
                         "Formats acceptés : PNG, JPG, WebP, BMP, TIFF.")
    return image


def masque_logo(image, largeur_mm, hauteur_mm, seuil=128, pas_mm=0.4):
    """Renvoie une grille True/False : True = zone à broder.
    Chaque case mesure pas_mm × pas_mm."""
    colonnes = max(1, round(largeur_mm / pas_mm))
    lignes = max(1, round(hauteur_mm / pas_mm))
    img = image.convert("RGBA")
    fond_blanc = Image.new("RGBA", img.size, "white")
    img = Image.alpha_composite(fond_blanc, img).convert("L")  # transparent -> blanc, puis gris
    img = img.resize((colonnes, lignes))
    return np.array(img) < seuil
