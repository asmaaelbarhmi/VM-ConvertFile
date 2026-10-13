"""Chemins et limites du service."""
import os
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
DOSSIER_DONNEES = Path(os.environ.get("DONNEES_DIR", RACINE / "data"))
DOSSIER_INKSTITCH = Path(os.environ.get("INKSTITCH_DIR", RACINE / "engine" / "inkstitch"))
PYTHON_INKSTITCH = os.environ.get("INKSTITCH_PYTHON", sys.executable)
DOSSIER_WXSTUB = RACINE / "engine" / "wxstub"
DOSSIER_FRONTEND = RACINE / "frontend"
DOSSIER_PROFILS = RACINE / "backend" / "profils"

TAILLE_MAX_OCTETS = 10 * 1024 * 1024
TAILLE_MAX_MM = 450.0
DELAI_MOTEUR_S = 600
DUREE_CONSERVATION_S = 6 * 3600  # les fichiers d'un motif sont supprimés après 6 h
