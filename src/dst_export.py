import os
import tempfile
import pyembroidery


def exporter_dst(motif):
    """Écrit le motif en DST, le relit pour vérifier, et renvoie (octets, motif relu)."""
    with tempfile.TemporaryDirectory() as dossier:  # supprimé automatiquement
        chemin = os.path.join(dossier, "motif.dst")
        pyembroidery.write_dst(motif, chemin)
        relu = pyembroidery.read_dst(chemin)
        if relu is None or len(relu.stitches) == 0:
            raise RuntimeError("Le fichier DST produit n'a pas pu être relu.")
        with open(chemin, "rb") as f:
            return f.read(), relu
