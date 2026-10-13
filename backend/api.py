"""API web : analyse d'un fichier, génération du motif, téléchargements.

Lancer :  uvicorn backend.api:app --reload
"""
import json
import shutil
import threading
import time
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from backend import config
from backend.pipeline import moteur, traitement
from src.image_processing import EXTENSIONS

app = FastAPI(title="Image vers DST", version="0.2")
_verrou = threading.Lock()
_etats = {}  # id → état du motif (en mémoire ; les fichiers sont sur disque)


def _dossier(id_):
    d = config.DOSSIER_DONNEES / "motifs" / id_
    d.mkdir(parents=True, exist_ok=True)
    return d


def _nettoyer():
    """Supprime les motifs plus vieux que la durée de conservation."""
    racine = config.DOSSIER_DONNEES / "motifs"
    if not racine.exists():
        return
    limite = time.time() - config.DUREE_CONSERVATION_S
    for d in racine.iterdir():
        if d.is_dir() and d.stat().st_mtime < limite:
            shutil.rmtree(d, ignore_errors=True)
            _etats.pop(d.name, None)


@app.get("/api/sante")
def sante():
    return {"ok": True, "moteur": moteur.disponible(), "formats": sorted(moteur.FORMATS)}


@app.get("/api/profils")
def profils():
    tissus, machines = traitement.charger_profils()
    return {"tissus": {k: {"nom": v["nom"], "conseil": v["conseil"]} for k, v in tissus.items()},
            "machines": {k: {"nom": v["nom"], "cadre_l_mm": v["cadre_l_mm"], "cadre_h_mm": v["cadre_h_mm"]}
                         for k, v in machines.items()},
            "extensions": EXTENSIONS, "taille_max_mo": config.TAILLE_MAX_OCTETS // (1024 * 1024)}


@app.post("/api/analyses")
async def analyser(fichier: UploadFile = File(...), nb_couleurs: int | None = Form(None)):
    """Étape 1 : lit le fichier, propose une taille et détecte les fils."""
    _nettoyer()
    donnees = await fichier.read()
    if len(donnees) > config.TAILLE_MAX_OCTETS:
        raise HTTPException(413, "Fichier trop volumineux (10 Mo maximum).")
    ext = (fichier.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in EXTENSIONS:
        raise HTTPException(415, f"Extension .{ext} non acceptée. Formats : {', '.join(EXTENSIONS)}.")
    try:
        image, analyse = traitement.analyser(donnees, fichier.filename, nb_couleurs or None)
    except ValueError as e:
        raise HTTPException(422, str(e))
    id_ = uuid.uuid4().hex[:12]
    d = _dossier(id_)
    (d / "source.png").write_bytes(traitement.vignette(image, 2400))
    (d / "vignette.png").write_bytes(traitement.vignette(image))
    (d / "analyse.json").write_text(json.dumps(analyse), encoding="utf-8")
    with _verrou:
        _etats[id_] = {"etat": "analyse", "analyse": analyse}
    return {"id": id_, **analyse}


def _generer(id_, largeur_mm, tissu_cle, machine_cle, nb_couleurs, coupe_mm, formats):
    d = _dossier(id_)
    try:
        tissus, machines = traitement.charger_profils()
        from PIL import Image
        image = Image.open(d / "source.png")
        image.load()
        analyse = json.loads((d / "analyse.json").read_text(encoding="utf-8"))
        if analyse.get("fond_rgb"):
            image.info["fond_rgb"] = tuple(analyse["fond_rgb"])
        resultat = traitement.traiter(image, largeur_mm, tissus[tissu_cle], machines[machine_cle],
                                      nb_couleurs, coupe_mm, formats)
        for f, octets in resultat["fichiers"].items():
            (d / f"motif.{f}").write_bytes(octets)
        (d / "motif.svg").write_text(resultat["svg"], encoding="utf-8")
        (d / "apercu.png").write_bytes(resultat["apercu_png"])
        etat = {"etat": "termine", "rapport": resultat["rapport"], "fils": resultat["fils"],
                "etapes": resultat["etapes"], "largeur_mm": resultat["largeur_mm"],
                "hauteur_mm": resultat["hauteur_mm"], "formats": list(resultat["fichiers"]),
                "tissu": tissus[tissu_cle]["nom"], "machine": machines[machine_cle]["nom"]}
    except moteur.MoteurIndisponible as e:
        etat = {"etat": "erreur", "erreur": str(e), "code": "moteur_absent"}
    except (moteur.ErreurMoteur, ValueError) as e:
        etat = {"etat": "erreur", "erreur": str(e)}
    except Exception as e:  # noqa: BLE001 — on veut toujours un état lisible côté client
        etat = {"etat": "erreur", "erreur": f"Erreur interne : {type(e).__name__}: {e}"}
    with _verrou:
        _etats[id_].update(etat)
    (d / "etat.json").write_text(json.dumps(_etats[id_]), encoding="utf-8")


@app.post("/api/motifs/{id_}")
def generer(id_: str, taches: BackgroundTasks, largeur_mm: float = Form(...),
            tissu: str = Form("polo_pique"), machine: str = Form("swf_k_450x300"),
            nb_couleurs: int | None = Form(None), coupe_mm: float = Form(8.0),
            formats: str = Form("dst")):
    """Étape 2 : lance la génération en arrière-plan."""
    if id_ not in _etats:
        raise HTTPException(404, "Analyse inconnue ou expirée.")
    tissus, machines = traitement.charger_profils()
    if tissu not in tissus or machine not in machines:
        raise HTTPException(422, "Profil tissu ou machine inconnu.")
    if not 5 <= largeur_mm <= config.TAILLE_MAX_MM:
        raise HTTPException(422, f"Largeur entre 5 et {config.TAILLE_MAX_MM:.0f} mm.")
    liste_formats = [f for f in formats.split(",") if f in moteur.FORMATS] or ["dst"]
    if "dst" not in liste_formats:
        liste_formats.insert(0, "dst")
    with _verrou:
        _etats[id_].update({"etat": "en_cours"})
    taches.add_task(_generer, id_, largeur_mm, tissu, machine, nb_couleurs or None, coupe_mm, liste_formats)
    return {"id": id_, "etat": "en_cours"}


@app.get("/api/motifs/{id_}")
def etat(id_: str):
    if id_ not in _etats:
        raise HTTPException(404, "Motif inconnu ou expiré.")
    return JSONResponse(_etats[id_])


@app.get("/api/motifs/{id_}/{nom}")
def fichier(id_: str, nom: str):
    autorises = {"vignette.png", "apercu.png", "motif.svg"} | {f"motif.{f}" for f in moteur.FORMATS}
    if nom not in autorises:
        raise HTTPException(404)
    chemin = config.DOSSIER_DONNEES / "motifs" / id_ / nom
    if not chemin.exists():
        raise HTTPException(404, "Fichier pas encore disponible.")
    types = {"png": "image/png", "svg": "image/svg+xml"}
    return FileResponse(chemin, media_type=types.get(nom.rsplit(".", 1)[-1], "application/octet-stream"),
                        filename=nom)


if config.DOSSIER_FRONTEND.exists():
    app.mount("/", StaticFiles(directory=config.DOSSIER_FRONTEND, html=True), name="frontend")
