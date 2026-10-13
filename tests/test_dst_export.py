import numpy as np
from pyembroidery import STITCH, JUMP, TRIM, COLOR_CHANGE
from src.digitizing import remplissage, motif_couches, trouver_segments, zones
from src.dst_export import exporter_dst
from src.validation import verifier
from src.apercu import dessiner


def test_trouver_segments():
    assert trouver_segments([False, True, True, False, True]) == [(1, 2), (4, 4)]


def test_carre_produit_un_dst_relisible():
    masque = np.ones((50, 50), dtype=bool)  # carré plein de 20 mm
    donnees, relu = exporter_dst(remplissage(masque))
    assert len(donnees) > 512  # l'en-tête DST fait 512 octets
    rapport = verifier(relu)
    assert rapport["points"] > 0
    assert abs(rapport["largeur_mm"] - 19.6) < 0.5  # 49 cases × 0,4 mm
    assert rapport["point_max_mm"] <= 3.05


def test_commence_par_un_saut():
    motif = remplissage(np.ones((5, 5), dtype=bool))
    assert motif.stitches[0][2] == JUMP


def test_masque_vide_signale_une_alerte():
    rapport = verifier(remplissage(np.zeros((10, 10), dtype=bool)))
    assert rapport["points"] == 0 and rapport["alertes"]


def test_multicolore():
    a = np.zeros((10, 10), dtype=bool); a[:, :5] = True
    b = ~a
    motif = motif_couches([((255, 0, 0), a), ((0, 0, 255), b)])
    assert sum(1 for s in motif.stitches if s[2] == COLOR_CHANGE) == 1
    donnees, relu = exporter_dst(motif)
    assert verifier(relu)["couleurs"] == 2
    assert dessiner(motif, 100).size[0] > 0


def test_alerte_cadre_trop_petit():
    rapport = verifier(remplissage(np.ones((50, 50), dtype=bool)),
                       {"cadre_l_mm": 10, "cadre_h_mm": 10, "vitesse_ppm": 700, "point_max_mm": 7})
    assert any("cadre" in a for a in rapport["alertes"])


def test_zones_separees_brodees_une_par_une():
    m = np.zeros((10, 30), dtype=bool)
    m[:, 0:5] = True
    m[:, 25:30] = True  # deux rectangles à 8 mm d'écart
    assert len(zones(m)) == 2
    motif = remplissage(m, coupe_mm=5.0)
    assert sum(1 for s in motif.stitches if s[2] == TRIM) == 1  # une seule coupe entre les deux


def test_poussieres_ignorees():
    m = np.zeros((10, 10), dtype=bool)
    m[5, 5] = True
    assert zones(m) == []
