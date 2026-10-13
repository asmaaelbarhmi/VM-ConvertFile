import numpy as np
from src.digitizing import remplissage, trouver_segments
from src.dst_export import exporter_dst
from src.validation import verifier


def test_trouver_segments():
    assert trouver_segments([False, True, True, False, True]) == [(1, 2), (4, 4)]


def test_carre_produit_un_dst_relisible():
    masque = np.ones((50, 50), dtype=bool)  # carré plein de 20 mm
    donnees, relu = exporter_dst(remplissage(masque))
    assert len(donnees) > 512  # l'en-tête DST fait 512 octets
    rapport = verifier(relu)
    assert rapport["points"] > 0
    assert abs(rapport["largeur_mm"] - 19.6) < 0.5  # 49 cases × 0,4 mm


def test_masque_vide_signale_une_alerte():
    masque = np.zeros((10, 10), dtype=bool)
    rapport = verifier(remplissage(masque))
    assert rapport["points"] == 0
    assert rapport["alertes"]
