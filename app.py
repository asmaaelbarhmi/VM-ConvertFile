import streamlit as st
from src.image_processing import (ouvrir_image, masque_logo, couches_couleurs, fond_sombre,
                                  recadrer_marges, taille_proposee, taille_mm, EXTENSIONS)
from src.digitizing import motif_couches
from src.dst_export import exporter_dst
from src.validation import verifier, PROFIL_DEFAUT
from src.apercu import dessiner

st.set_page_config(page_title="Image vers DST", page_icon="🧵", layout="wide")
st.title("Conversion d'image vers DST")

# --- Profil machine (barre latérale, replié par défaut) ---
profil = dict(PROFIL_DEFAUT)
with st.sidebar.expander("Machine", expanded=False):
    profil["cadre_l_mm"] = st.number_input("Largeur du cadre (mm)", 50, 1200, profil["cadre_l_mm"])
    profil["cadre_h_mm"] = st.number_input("Hauteur du cadre (mm)", 50, 1200, profil["cadre_h_mm"])
    profil["vitesse_ppm"] = st.number_input("Vitesse (points/min)", 300, 1500, profil["vitesse_ppm"])
    st.caption("Valeurs prudentes pour une SWF K-series : mettez la taille réelle du cadre monté.")

fichier = st.file_uploader("1. Importer une image, un PDF ou un SVG", type=EXTENSIONS)
if not fichier:
    st.info("Formats acceptés : PNG, JPG, WebP, BMP, TIFF, GIF, PDF, SVG. "
            "La taille est proposée automatiquement d'après le fichier.")
    st.stop()

try:
    originale = ouvrir_image(fichier, fichier.name)
except ValueError as e:
    st.error(str(e))
    st.stop()

image, boite = recadrer_marges(originale)
largeur_defaut, hauteur_defaut = taille_proposee(image)
origine = ("taille lue dans le fichier" if taille_mm(image)
           else "taille par défaut, le fichier n'indique pas de dimensions")

# Les valeurs par défaut sont recalculées quand on change de fichier.
cle = fichier.name + str(fichier.size)
if st.session_state.get("fichier_courant") != cle:
    st.session_state["fichier_courant"] = cle
    st.session_state["largeur_mm"] = largeur_defaut

col_image, col_params = st.columns([1, 1])
with col_image:
    st.image(image, caption=f"{image.format} — {image.width} × {image.height} px, marges retirées")

with col_params:
    st.markdown("**2. Taille de la broderie**")
    largeur = st.number_input("Largeur (mm)", 10.0, 1200.0, key="largeur_mm", step=5.0)
    hauteur = round(largeur * image.height / image.width, 1)
    st.write(f"Hauteur : **{hauteur} mm** (proportions conservées) — "
             f"proposition : {largeur_defaut} × {hauteur_defaut} mm, {origine}")

    st.markdown("**3. Type de motif**")
    mode = st.radio("Type de motif", ["Logo plusieurs couleurs", "Logo 1 couleur", "Photo (expérimental)"],
                    label_visibility="collapsed", horizontal=True)
    if mode.startswith("Photo"):
        st.info("Le mode photo n'est pas encore disponible (phase 3). "
                "Essayez « Logo plusieurs couleurs » sur une image très simplifiée.")
        st.stop()

    with st.expander("Réglages avancés", expanded=False):
        pas = st.slider("Écart entre les lignes (mm)", 0.3, 1.0, 0.4, 0.05)
        point_max = st.slider("Longueur maximale d'un point (mm)", 1.0, 7.0, 3.0, 0.5)
        coupe = st.slider("Couper le fil pour un déplacement de plus de (mm)", 3.0, 30.0, 8.0, 1.0)
        if mode == "Logo 1 couleur":
            seuil = st.slider("Seuil noir/blanc", 0, 255, 128)
            sombre = fond_sombre(image)
            inverser = st.checkbox("Inverser (motif clair sur fond sombre)", value=sombre)
        else:
            choix = st.selectbox("Nombre de couleurs de fil", ["Automatique"] + list(range(1, 9)))
            nb = None if choix == "Automatique" else int(choix)

    if mode == "Logo 1 couleur":
        couches = [((0, 0, 0), masque_logo(image, largeur, hauteur, seuil, pas, inverser))]
    else:
        couches = couches_couleurs(image, largeur, hauteur, nb, pas)

if not couches:
    st.error("Aucune zone à broder trouvée.")
    st.stop()
surface = couches[0][1].size
couverture = sum(c[1].sum() for c in couches) / surface

pastilles = " ".join(
    f'<span style="display:inline-block;width:1em;height:1em;background:#{r:02x}{g:02x}{b:02x};'
    f'border:1px solid #888;vertical-align:middle"></span>' for (r, g, b), _ in couches)
st.markdown(f"{len(couches)} couleur(s) de fil {pastilles} — {couverture:.0%} de la surface brodée",
            unsafe_allow_html=True)
if mode != "Logo 1 couleur":
    st.caption("Couleurs détectées automatiquement (les teintes proches sont fusionnées). "
               "Pour forcer un nombre : Réglages avancés → Nombre de couleurs de fil.")

if st.button("4. Générer le DST", type="primary"):
    try:
        motif = motif_couches(couches, pas, point_max, coupe)
        donnees, relu = exporter_dst(motif)
    except Exception as e:
        st.error(f"Échec de la génération : {e}")
        st.stop()
    rapport = verifier(relu, profil, couverture)
    st.success(f"{rapport['points']} points — {rapport['largeur_mm']:.1f} × {rapport['hauteur_mm']:.1f} mm — "
               f"{rapport['couleurs']} couleur(s) — {rapport['coupes']} coupes — "
               f"≈ {rapport['minutes']:.0f} min à {profil['vitesse_ppm']} pts/min")
    for alerte in rapport["alertes"]:
        st.warning(alerte)
    st.image(dessiner(motif), caption="Aperçu des points (ce que la machine coudra)")
    if len(couches) > 1:
        st.markdown("**Ordre des fils pour l'opérateur :** " +
                    " → ".join("#%02x%02x%02x" % rgb for rgb, _ in couches))
    st.download_button("Télécharger le .DST", donnees, "motif.dst", "application/octet-stream")
    st.caption("Vérifiez l'aperçu, simulez sur la machine et faites un essai sur une chute de tissu "
               "avant la production.")
