"""Ouverture et préparation des images (pixels, PDF, SVG)."""
import io
import numpy as np
from PIL import Image

FORMATS_PIXELS = {"PNG", "JPEG", "WEBP", "BMP", "TIFF", "GIF"}
EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "gif", "pdf", "svg"]
DPI_VECTORIEL = 300  # finesse de conversion des PDF/SVG en pixels


import re

UNITES_MM = {"mm": 1.0, "cm": 10.0, "in": 25.4, "pt": 25.4 / 72, "pc": 25.4 / 6, "px": 25.4 / 96, "": 25.4 / 96}


def _rendre_pdf(donnees):
    import pypdfium2
    doc = pypdfium2.PdfDocument(donnees)
    if len(doc) == 0:
        raise ValueError("Le PDF ne contient aucune page.")
    page = doc[0]
    image = page.render(scale=DPI_VECTORIEL / 72).to_pil().convert("RGB")
    image.format = "PDF"
    l_pt, h_pt = page.get_size()
    image.info["taille_mm"] = (l_pt * 25.4 / 72, h_pt * 25.4 / 72)
    return image


def _longueur_svg(texte, attribut):
    m = re.search(attribut + r'\s*=\s*["\']\s*([0-9.]+)\s*([a-z%]*)', texte)
    if not m or m.group(2) == "%":
        return None
    return float(m.group(1)) * UNITES_MM.get(m.group(2), 25.4 / 96)


def _rendre_svg(donnees):
    import cairosvg
    png = cairosvg.svg2png(bytestring=donnees, output_width=2000)
    image = Image.open(io.BytesIO(png))
    image.load()
    image.format = "SVG"
    entete = donnees[:3000].decode("utf-8", "ignore")
    l, h = _longueur_svg(entete, "width"), _longueur_svg(entete, "height")
    if l and h:
        image.info["taille_mm"] = (l, h)
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


def taille_mm(image):
    """Taille réelle (largeur, hauteur) en mm si le fichier la connaît
    (page PDF, attributs SVG, résolution DPI d'une image), sinon None."""
    if "taille_mm" in image.info:
        return image.info["taille_mm"]
    dpi = image.info.get("dpi")
    if dpi and dpi[0] > 1 and dpi[1] > 1:
        return (image.width * 25.4 / dpi[0], image.height * 25.4 / dpi[1])
    return None


def recadrer_marges(image, tolerance=30):
    """Enlève les marges unies (blanches, transparentes ou de la couleur des
    bords) autour du motif. Renvoie (image recadrée, boîte (x1, y1, x2, y2))."""
    rgb = aplatir(image)
    tableau = np.array(rgb).astype(int)
    bords = np.concatenate([tableau[0], tableau[-1], tableau[:, 0], tableau[:, -1]])
    fond = np.median(bords, axis=0)
    difference = np.abs(tableau - fond).sum(axis=2) > tolerance
    ys, xs = np.nonzero(difference)
    if len(xs) == 0:
        return image, (0, 0, image.width, image.height)
    boite = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    recadree = image.crop(boite)
    recadree.format = image.format
    recadree.info = dict(image.info)
    # Couleur du tissu, mémorisée avant que les marges disparaissent
    if boite != (0, 0, image.width, image.height):
        recadree.info["fond_rgb"] = tuple(int(v) for v in fond)
    if "taille_mm" in image.info or image.info.get("dpi"):
        l, h = taille_mm(image)
        recadree.info["taille_mm"] = (l * recadree.width / image.width, h * recadree.height / image.height)
    return recadree, boite


def taille_proposee(image, defaut_mm=100.0, maxi_mm=400.0):
    """Largeur et hauteur à proposer : la taille réelle si connue (plafonnée),
    sinon `defaut_mm` de largeur en gardant les proportions."""
    reelle = taille_mm(image)
    if reelle:
        l, h = reelle
    else:
        l, h = defaut_mm, defaut_mm * image.height / image.width
    facteur = min(1.0, maxi_mm / max(l, h))
    return round(l * facteur, 1), round(h * facteur, 1)


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


def couches_par_palette(image, largeur_mm, hauteur_mm, palette, pas_mm=0.4, tolerance_fond=60):
    """Découpe l'image selon une palette de fils déjà connue (celle montrée à
    l'utilisateur lors de l'analyse) : chaque case prend la couleur de fil la
    plus proche, ou le fond si elle en est plus proche."""
    colonnes, lignes = grille(largeur_mm, hauteur_mm, pas_mm)
    img = np.array(aplatir(image).resize((colonnes, lignes), Image.LANCZOS)).astype(float)
    fond_rgb = image.info.get("fond_rgb")
    candidats = [np.array(c, dtype=float) for c in palette]
    if fond_rgb is not None:
        candidats.append(np.array(fond_rgb, dtype=float))
    distances = np.stack([np.linalg.norm(img - c, axis=2) for c in candidats], axis=0)
    index = distances.argmin(axis=0)
    if fond_rgb is not None:
        index[distances[-1] < tolerance_fond] = len(palette)  # proche du tissu → fond
    couches = [(tuple(int(v) for v in c), index == i) for i, c in enumerate(palette)]
    return [(rgb, m) for rgb, m in couches if m.any()]


def _est_lisere(masque, seuil=0.25):
    """Vrai si la zone est un simple liseré : rognée d'une case de chaque
    côté, il n'en reste presque rien (bord flou autour d'une autre couleur)."""
    if masque.sum() == 0:
        return True
    m = np.pad(masque, 1)
    coeur = m[1:-1, 1:-1] & m[:-2, 1:-1] & m[2:, 1:-1] & m[1:-1, :-2] & m[1:-1, 2:]
    return coeur.sum() / masque.sum() < seuil


def couches_couleurs(image, largeur_mm, hauteur_mm, nb_couleurs=None, pas_mm=0.4,
                     tolerance_fond=60, fusion=80, surface_mini=0.01):
    """Découpe l'image en couches de couleur (rgb, masque), sans le fond,
    de la plus grande zone à la plus petite.

    - nb_couleurs=None : nombre détecté automatiquement. Les teintes dont la
      distance est inférieure à `fusion` sont considérées comme le même fil
      (bords flous, dégradés légers) et les couleurs qui couvrent moins de
      `surface_mini` du motif sont rattachées à la couleur la plus proche.
    - Une teinte qui ne forme qu'un liseré fin (bord flou) n'est jamais un fil.
    - nb_couleurs=N : au plus N fils, les plus présents."""
    colonnes, lignes = grille(largeur_mm, hauteur_mm, pas_mm)
    img = aplatir(image).resize((colonnes, lignes), Image.LANCZOS)
    quant = img.quantize(colors=16, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    index = np.array(quant)
    palette = np.array(quant.getpalette()[: 3 * (index.max() + 1)]).reshape(-1, 3).astype(float)
    fond_rgb = image.info.get("fond_rgb")
    if fond_rgb is not None:
        # Fond connu (mémorisé lors du retrait des marges) : la teinte la plus proche,
        # si elle est assez proche ; sinon il n'y a pas de fond, tout est brodé.
        distances = np.linalg.norm(palette - np.array(fond_rgb, dtype=float), axis=1)
        fond = int(distances.argmin()) if distances.min() < tolerance_fond else None
    else:
        bords = np.concatenate([index[0], index[-1], index[:, 0], index[:, -1]])
        fond = int(np.bincount(bords).argmax())  # couleur la plus présente sur les bords = tissu

    # 1. Teintes du motif (hors fond), avec leur surface
    teintes, liseres = [], []
    for i in range(len(palette)):
        if fond is not None and (i == fond or np.linalg.norm(palette[i] - palette[fond]) < tolerance_fond):
            continue
        masque = index == i
        surface = int(masque.sum())
        if surface == 0:
            continue
        (liseres if _est_lisere(masque) else teintes).append([palette[i].copy(), [i], surface])
    teintes.sort(key=lambda t: -t[2])
    if not teintes:  # motif fait uniquement de traits fins : on garde tout
        teintes, liseres = liseres, []

    # 2. Fusion des teintes proches (en partant des plus présentes)
    groupes = []
    for couleur, idx, surface in teintes:
        for g in groupes:
            if np.linalg.norm(g[0] - couleur) < fusion:
                g[0] = (g[0] * g[2] + couleur * surface) / (g[2] + surface)  # moyenne pondérée
                g[1] += idx
                g[2] += surface
                break
        else:
            groupes.append([couleur, list(idx), surface])

    # 3. Les toutes petites couleurs rejoignent la plus proche ; limite à N
    total = sum(g[2] for g in groupes) or 1
    groupes.sort(key=lambda g: -g[2])
    limite = nb_couleurs or len(groupes)
    gardes, restes = groupes[:limite], groupes[limite:] + liseres
    for g in list(gardes):
        if g is not gardes[0] and g[2] / total < surface_mini:
            gardes.remove(g)
            restes.append(g)
    for g in restes:
        proche = min(gardes, key=lambda k: np.linalg.norm(k[0] - g[0]))
        proche[1] += g[1]
        proche[2] += g[2]

    return [(tuple(int(round(v)) for v in g[0]), np.isin(index, g[1])) for g in gardes]
