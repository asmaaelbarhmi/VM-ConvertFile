import io
import pytest
from PIL import Image
from src.image_processing import ouvrir_image, masque_logo


def image_en_memoire(fmt):
    tampon = io.BytesIO()
    Image.new("RGB", (20, 10), "black").save(tampon, fmt)
    tampon.seek(0)
    return tampon


@pytest.mark.parametrize("fmt", ["PNG", "JPEG", "WEBP", "BMP", "TIFF"])
def test_formats_acceptes(fmt):
    assert ouvrir_image(image_en_memoire(fmt)).format == fmt


def test_format_refuse():
    with pytest.raises(ValueError):
        ouvrir_image(image_en_memoire("GIF"))


def test_fichier_illisible():
    with pytest.raises(ValueError):
        ouvrir_image(io.BytesIO(b"pas une image"))


def test_dimensions_du_masque():
    masque = masque_logo(Image.new("RGB", (100, 50), "black"), 40, 20, pas_mm=0.4)
    assert masque.shape == (50, 100)
    assert masque.all()
