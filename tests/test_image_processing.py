import io
import pytest
from PIL import Image
from src.image_processing import (ouvrir_image, masque_logo, couches_couleurs, fond_sombre,
                                  taille_mm, taille_proposee, recadrer_marges)


def image_en_memoire(fmt, couleur="black", taille=(20, 10)):
    tampon = io.BytesIO()
    Image.new("RGB", taille, couleur).save(tampon, fmt)
    tampon.seek(0)
    return tampon


@pytest.mark.parametrize("fmt", ["PNG", "JPEG", "WEBP", "BMP", "TIFF", "GIF"])
def test_formats_pixels(fmt):
    assert ouvrir_image(image_en_memoire(fmt)).format == fmt


def test_pdf():
    image = ouvrir_image(image_en_memoire("PDF"), "logo.pdf")
    assert image.format == "PDF" and image.width > 20


def test_svg():
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20"/></svg>'
    image = ouvrir_image(io.BytesIO(svg), "logo.svg")
    assert image.format == "SVG" and image.width == 2000


def test_format_refuse():
    with pytest.raises(ValueError):
        ouvrir_image(image_en_memoire("ICO"))


def test_fichier_illisible():
    with pytest.raises(ValueError):
        ouvrir_image(io.BytesIO(b"pas une image"))


def test_dimensions_du_masque():
    masque = masque_logo(Image.new("RGB", (100, 50), "black"), 40, 20, pas_mm=0.4)
    assert masque.shape == (50, 100)
    assert masque.all()


def test_fond_sombre_et_inversion():
    img = Image.new("RGB", (100, 100), "black")
    img.paste("white", (40, 40, 60, 60))
    assert fond_sombre(img)
    masque = masque_logo(img, 40, 40, pas_mm=0.4, inverser=True)
    assert 0.02 < masque.mean() < 0.06  # seul le carré blanc central est brodé


def test_couches_couleurs_sans_fond():
    img = Image.new("RGB", (100, 100), "white")
    img.paste((255, 0, 0), (10, 10, 60, 90))
    img.paste((0, 0, 255), (70, 10, 90, 30))
    couches = couches_couleurs(img, 40, 40, pas_mm=0.4)  # détection automatique
    assert len(couches) == 2
    assert couches[0][1].sum() > couches[1][1].sum()  # la plus grande zone d'abord
    assert couches[0][0][0] > 200  # rouge


def test_taille_pdf():
    tampon = io.BytesIO()
    Image.new("RGB", (100, 50), "black").save(tampon, "PDF", resolution=100)  # 25,4 × 12,7 mm
    tampon.seek(0)
    l, h = taille_mm(ouvrir_image(tampon, "a.pdf"))
    assert abs(l - 25.4) < 0.5 and abs(h - 12.7) < 0.5


def test_taille_svg_en_mm():
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="4cm"><rect width="10" height="10"/></svg>'
    assert taille_mm(ouvrir_image(io.BytesIO(svg), "a.svg")) == (80.0, 40.0)


def test_taille_png_par_dpi():
    tampon = io.BytesIO()
    Image.new("RGB", (300, 150), "black").save(tampon, "PNG", dpi=(300, 300))
    tampon.seek(0)
    l, h = taille_mm(ouvrir_image(tampon))
    assert abs(l - 25.4) < 0.1 and abs(h - 12.7) < 0.1


def test_taille_inconnue_proposition_par_defaut():
    img = Image.new("RGB", (200, 100), "black")
    assert taille_mm(img) is None
    assert taille_proposee(img) == (100.0, 50.0)


def test_taille_proposee_plafonnee():
    img = Image.new("RGB", (100, 100), "black")
    img.info["taille_mm"] = (800.0, 800.0)
    assert taille_proposee(img, maxi_mm=400) == (400.0, 400.0)


def test_recadrer_marges():
    img = Image.new("RGB", (100, 100), "white")
    img.paste("black", (20, 30, 60, 70))
    img.info["dpi"] = (254, 254)  # 10 mm pour 100 px
    recadree, boite = recadrer_marges(img)
    assert boite == (20, 30, 60, 70) and recadree.size == (40, 40)
    l, h = taille_mm(recadree)
    assert abs(l - 4.0) < 0.01 and abs(h - 4.0) < 0.01


def test_logo_noir_flou_donne_une_seule_couleur():
    from PIL import ImageFilter
    img = Image.new("RGB", (200, 100), "white")
    img.paste("black", (20, 20, 180, 80))
    img = img.filter(ImageFilter.GaussianBlur(3))  # bords gris comme un vrai logo
    couches = couches_couleurs(img, 40, 20, pas_mm=0.4)
    assert len(couches) == 1
    assert max(couches[0][0]) < 60  # un fil noir


def test_nombre_de_couleurs_force():
    img = Image.new("RGB", (100, 100), "white")
    img.paste((255, 0, 0), (10, 10, 50, 90))
    img.paste((0, 0, 255), (60, 10, 90, 90))
    assert len(couches_couleurs(img, 40, 40, nb_couleurs=1, pas_mm=0.4)) == 1


def test_fond_memorise_apres_recadrage():
    img = Image.new("RGB", (300, 150), "white")
    img.paste((200, 0, 0), (30, 30, 150, 120))
    recadree, _ = recadrer_marges(img)
    assert recadree.info["fond_rgb"] == (255, 255, 255)
    couches = couches_couleurs(recadree, 24, 18, pas_mm=0.2)
    assert len(couches) == 1 and couches[0][1].all()  # tout le rectangle rouge est brodé


def test_image_unie_sans_marges():
    """Une image d'une seule couleur sans marge est ambiguë (tout motif ou tout
    tissu ?) : on ne brode rien et l'interface affiche « aucune zone à broder »."""
    img = Image.new("RGB", (100, 50), (0, 0, 200))
    recadree, _ = recadrer_marges(img)
    assert "fond_rgb" not in recadree.info
    assert couches_couleurs(img, 20, 10, pas_mm=0.2) == []


def test_logo_sans_marges_sur_fond_blanc():
    img = Image.new("RGB", (100, 50), "white")
    img.paste((0, 0, 200), (0, 0, 100, 25))  # moitié haute bleue, touche le bord
    couches = couches_couleurs(img, 20, 10, pas_mm=0.2)
    assert len(couches) == 1 and 0.45 < couches[0][1].mean() < 0.55
