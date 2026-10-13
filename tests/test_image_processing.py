import io
import pytest
from PIL import Image
from src.image_processing import ouvrir_image, masque_logo, couches_couleurs, fond_sombre


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
    couches = couches_couleurs(img, 40, 40, nb_couleurs=2, pas_mm=0.4)
    assert len(couches) == 2
    assert couches[0][1].sum() > couches[1][1].sum()  # la plus grande zone d'abord
    assert couches[0][0][0] > 200  # rouge
