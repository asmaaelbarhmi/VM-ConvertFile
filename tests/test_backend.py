"""Tests du pipeline professionnel (vectorisation, SVG Ink/Stitch, API).
Les tests qui lancent le moteur sont ignorés s'il n'est pas installé."""
import io
import numpy as np
import pytest
from PIL import Image
from shapely.geometry import Polygon

from backend.pipeline import vectorisation, formes, svg_inkstitch, moteur, traitement


def tissu():
    return traitement.charger_profils()[0]["polo_pique"]


def test_vectorisation_rectangle():
    masque = np.zeros((100, 200), dtype=bool)
    masque[20:80, 20:120] = True  # 100 × 60 cases de 0,2 mm = 20 × 12 mm
    polys = vectorisation.vectoriser_masque(masque, 0.2)
    assert len(polys) == 1
    assert abs(polys[0].area - 20 * 12) < 5


def test_vectorisation_trou():
    masque = np.zeros((100, 100), dtype=bool)
    masque[10:90, 10:90] = True
    masque[40:60, 40:60] = False  # anneau avec un trou
    polys = vectorisation.vectoriser_masque(masque, 0.2)
    assert len(polys) == 1 and len(polys[0].interiors) == 1


def test_classement_des_formes():
    t = tissu()
    assert formes.classer(Polygon([(0, 0), (50, 0), (50, 30), (0, 30)]), t) == "tatami"
    assert formes.classer(Polygon([(0, 0), (40, 0), (40, 3), (0, 3)]), t) == "satin"
    assert formes.classer(Polygon([(0, 0), (1, 0), (1, 1), (0, 1)]), t) == "ignorer"
    assert abs(formes.angle_principal(Polygon([(0, 0), (40, 0), (40, 3), (0, 3)]))) < 1


def test_grande_forme_a_trous_reste_tatami():
    """Une grande plaque percée de trous a un périmètre énorme mais reste large :
    elle doit être remplie en tatami, pas traitée comme un satin."""
    plaque = Polygon([(0, 0), (80, 0), (80, 60), (0, 60)])
    for y in range(3, 58, 3):  # 19 fentes fines dans la moitié gauche
        plaque = plaque.difference(Polygon([(5, y), (35, y), (35, y + 0.6), (5, y + 0.6)]))
    assert formes.largeur_moyenne(plaque) < 7      # trompeur : périmètre gonflé par les fentes
    assert formes.largeur_maxi(plaque) > 30        # la moitié droite est une vraie plaque
    assert formes.classer(plaque, tissu()) == "tatami"


def test_svg_inkstitch():
    t = tissu()
    couches = [{"rgb": (200, 0, 0), "formes": [
        {"poly": Polygon([(2, 2), (30, 2), (30, 20), (2, 20)]), "type": "tatami", "largeur": 10, "angle": 0}]}]
    svg = svg_inkstitch.construire_svg(couches, 40, 25, t)
    assert 'width="40mm"' in svg and 'inkstitch:fill_method="tatami_fill"' in svg
    assert 'inkstitch:fill_underlay="True"' in svg and f'inkstitch:expand_mm="{t["expand_mm"]}"' in svg
    assert "#c80000" in svg


def test_analyse_rapide():
    tampon = io.BytesIO()
    img = Image.new("RGB", (300, 150), "white")
    img.paste((200, 0, 0), (30, 30, 150, 120))
    img.save(tampon, "PNG", dpi=(300, 300))
    image, analyse = traitement.analyser(tampon.getvalue(), "logo.png")
    assert analyse["taille_connue"] and len(analyse["couleurs"]) == 1
    assert abs(analyse["largeur_mm"] - 120 * 25.4 / 300) < 0.2  # marges retirées


moteur_requis = pytest.mark.skipif(not moteur.disponible(), reason="moteur Ink/Stitch non installé")


@moteur_requis
def test_pipeline_complet():
    img = Image.new("RGB", (300, 200), "white")
    img.paste((0, 60, 160), (20, 20, 160, 180))     # bloc bleu → tatami
    img.paste((200, 0, 0), (200, 20, 230, 180))     # barre rouge → satin
    tissus, machines = traitement.charger_profils()
    r = traitement.traiter(img, 45.0, tissus["polo_pique"], machines["generique_100x100"], formats=("dst",))
    assert r["rapport"]["points"] > 500
    assert r["rapport"]["couleurs"] == 2
    assert r["rapport"]["largeur_mm"] <= 46
    assert any(f["formes"].get("satin") for f in r["fils"])
    assert r["fichiers"]["dst"][:3] == b"LA:"  # en-tête DST


@moteur_requis
def test_api():
    from fastapi.testclient import TestClient
    from backend.api import app
    client = TestClient(app)
    assert client.get("/api/sante").json()["moteur"] is True
    tampon = io.BytesIO()
    img = Image.new("RGB", (160, 120), "white")
    img.paste("black", (20, 20, 140, 100))  # logo noir avec marges blanches
    img.save(tampon, "PNG")
    r = client.post("/api/analyses", files={"fichier": ("carre.png", tampon.getvalue(), "image/png")})
    assert r.status_code == 200, r.text
    id_ = r.json()["id"]
    r = client.post(f"/api/motifs/{id_}", data={"largeur_mm": "30", "machine": "generique_100x100"})
    assert r.status_code == 200
    etat = client.get(f"/api/motifs/{id_}").json()  # TestClient exécute les tâches de fond avant de répondre
    assert etat["etat"] == "termine", etat
    assert client.get(f"/api/motifs/{id_}/motif.dst").status_code == 200
    assert client.get(f"/api/motifs/{id_}/apercu.png").status_code == 200


def test_api_refuse_extension():
    from fastapi.testclient import TestClient
    from backend.api import app
    r = TestClient(app).post("/api/analyses", files={"fichier": ("x.exe", b"abc", "application/octet-stream")})
    assert r.status_code == 415


def test_tuilage_des_grandes_formes():
    grande = Polygon([(0, 0), (100, 0), (100, 90), (0, 90)])
    assert formes.a_tuiler(grande)
    tuiles = formes.tuiler(grande, 40)
    assert len(tuiles) == 9 and abs(sum(t.area for t in tuiles) - grande.area) < 0.01
    assert not formes.a_tuiler(Polygon([(0, 0), (30, 0), (30, 30), (0, 30)]))
    couches = formes.analyser([((0, 0, 0), [grande])], tissu())
    assert len(couches[0]["formes"]) == 9 and all(f["tuile"] for f in couches[0]["formes"])
    assert len({f["angle"] for f in couches[0]["formes"]}) == 1  # même angle : rangées alignées


def test_tuilage_garde_toute_la_surface_des_formes_irregulieres():
    """Une forme en étoile : l'intersection avec certaines tuiles donne un mélange
    de polygones et de segments ; rien ne doit être perdu."""
    import math
    pts = []
    for i in range(16):
        r = 60 if i % 2 == 0 else 20
        pts.append((50 + r * math.cos(i * math.pi / 8), 50 + r * math.sin(i * math.pi / 8)))
    etoile = Polygon(pts).buffer(0)
    tuiles = formes.tuiler(etoile, 40)
    assert abs(sum(t.area for t in tuiles) - etoile.area) < 0.5


def test_carte_de_fils_dans_le_svg():
    svg = svg_inkstitch.construire_svg([], 10, 10, tissu(), carte_fils="Isacord Polyester")
    assert '<inkstitch:thread-palette>"Isacord Polyester"</inkstitch:thread-palette>' in svg
