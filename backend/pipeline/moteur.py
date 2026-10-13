"""Lancement du moteur Ink/Stitch en ligne de commande (sans Inkscape ni écran)."""
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from backend import config

DOSSIER_CONFIG = config.RACINE / "engine" / "config"

FORMATS = {"dst", "pes", "jef", "exp", "vp3", "xxx"}


class MoteurIndisponible(RuntimeError):
    pass


class ErreurMoteur(RuntimeError):
    pass


def disponible():
    return (config.DOSSIER_INKSTITCH / "inkstitch.py").exists()


def verifier_installation():
    if not disponible():
        raise MoteurIndisponible(
            "Le moteur de broderie Ink/Stitch n'est pas installé. "
            "Lancez `engine/installer_inkstitch.sh` ou définissez INKSTITCH_DIR.")


def _installer_config():
    """Copie DEBUG.toml / LOGGING.toml dans le dossier du moteur (journal coupé)."""
    for nom in ("DEBUG.toml", "LOGGING.toml"):
        cible = config.DOSSIER_INKSTITCH / nom
        if not cible.exists() and (DOSSIER_CONFIG / nom).exists():
            shutil.copy(DOSSIER_CONFIG / nom, cible)


def generer(svg_texte, format_="dst", delai_s=None):
    """SVG Ink/Stitch → octets du fichier de broderie."""
    verifier_installation()
    _installer_config()
    if format_ not in FORMATS:
        raise ValueError(f"Format non pris en charge : {format_}")
    env = dict(os.environ)
    env["INKSTITCH_OFFLINE_SCRIPT"] = "1"
    env["PYTHONPATH"] = str(config.DOSSIER_WXSTUB) + os.pathsep + env.get("PYTHONPATH", "")
    with tempfile.TemporaryDirectory() as dossier:
        chemin = Path(dossier) / "motif.svg"
        chemin.write_text(svg_texte, encoding="utf-8")
        try:
            resultat = subprocess.run(
                [config.PYTHON_INKSTITCH, "inkstitch.py", "--extension=output", f"--format={format_}",
                 str(chemin)],
                cwd=config.DOSSIER_INKSTITCH, env=env, capture_output=True,
                timeout=delai_s or config.DELAI_MOTEUR_S)
        except subprocess.TimeoutExpired:
            raise ErreurMoteur("Le moteur a dépassé le temps maximal : motif trop complexe.")
    if resultat.returncode != 0 or not resultat.stdout:
        details = resultat.stderr.decode("utf-8", "ignore").strip().splitlines()[-5:]
        raise ErreurMoteur("Le moteur n'a pas produit de fichier. " + " | ".join(details))
    return resultat.stdout
