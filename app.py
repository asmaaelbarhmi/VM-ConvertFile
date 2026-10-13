import streamlit as st
from src.image_processing import (ouvrir_image, masque_logo, couches_couleurs,
                                  fond_sombre, EXTENSIONS)
from src.digitizing import remplissage, motif_couches
from src.dst_export import exporter_dst
from src.validation import verifier, PROFIL_DEFAUT
from src.apercu import dessiner

st.set_page_config(page_title="Image vers DST", page_icon="🧵", layout="wide")
st.title("Conversion d'image vers DST")
st.warning("Un fichier DST n'est pas « prêt à broder » : vérifiez l'aperçu des points, "
           "simulez-le sur la machine et faites un essai sur une chute de tissu.")

# --- Profil machine (barre latérale) ---
st.sidebar.header("Machine")
profil = dict(PROFIL_DEFAUT)
profil["cadre_l_mm"] = st.sidebar.number_input("Largeur du cadre (mm)", 50, 1200, profil["cadre_l_mm"])
profil["cadre_h_mm"] = st.sidebar.number_input("Hauteur du cadre (mm)", 50, 1200, profil["cadre_h_mm"])
profil["vitesse_ppm"] = st.sidebar.number_input("Vitesse (points/min)", 300, 1500, profil["vitesse_ppm"])
st.sidebar.caption("Valeurs par défaut prudentes pour une SWF K-series : "
                   "mettez la taille réelle du cadre monté.")

fichier = st.file_uploader("Importer une image, un PDF ou un SVG", type=EXTENSIONS)
if not fichier:
    st.stop()

try:
    image = ouvrir_image(fichier, fichier.name)
except ValueError as e:
    st.error(str(e))
    st.stop()

col_image, col_params = st.columns(2)
with col_image:
    st.image(image, caption=f"{image.format} — {image.width} × {image.height} px")

with col_params:
    mode = st.radio("Type d'image", ["Logo 1 couleur", "Logo plusieurs couleurs", "Photo (expérimental)"])
    if mode.startswith("Photo"):
        st.info("Le mode photo n'est pas encore disponible (phase 3). "
                "Essayez « Logo plusieurs couleurs » sur une image très simplifiée.")
        st.stop()
    largeur = st.number_input("Largeur finale (mm)", 10.0, 1200.0, 80.0)
    ratio = image.height / image.width
    hauteur = st.number_input("Hauteur finale (mm)", 10.0, 1200.0,
                              min(1200.0, max(10.0, round(largeur * ratio, 1))))
    pas = st.slider("Écart entre les lignes (mm)", 0.3, 1.0, 0.4, 0.05)
    point_max = st.slider("Longueur maximale d'un point (mm)", 1.0, 7.0, 3.0, 0.5)
    coupe = st.slider("Couper le fil pour un déplacement de plus de (mm)", 3.0, 30.0, 8.0, 1.0)

    if mode == "Logo 1 couleur":
        seuil = st.slider("Seuil noir/blanc", 0, 255, 128)
        sombre = fond_sombre(image)
        inverser = st.checkbox("Inverser (le motif est clair sur fond sombre)", value=sombre)
        if sombre:
            st.caption("Fond sombre détecté : l'inversion a été cochée automatiquement.")
        masque = masque_logo(image, largeur, hauteur, seuil, pas, inverser)
        couches = [((0, 0, 0), masque)]
    else:
        nb = st.slider("Nombre de couleurs de fil", 2, 8, 4)
        couches = couches_couleurs(image, largeur, hauteur, nb, pas)
        st.caption("La couleur la plus présente sur les bords est considérée comme le tissu "
                   "et n'est pas brodée.")

# --- Diagnostic avant génération ---
if not couches:
    st.error("Aucune zone à broder trouvée.")
    st.stop()
surface = couches[0][1].size
couverture = sum(c[1].sum() for c in couches) / surface
st.subheader("Diagnostic")
st.write(f"Surface brodée : **{couverture:.0%}** de la zone — {len(couches)} couleur(s)")
if mode != "Logo 1 couleur":
    for n, (rgb, m) in enumerate(couches):
        hexa = "#%02x%02x%02x" % rgb
        st.markdown(f'<span style="display:inline-block;width:1em;height:1em;background:{hexa};'
                    f'border:1px solid #888"></span> Fil {n + 1} : {hexa} — {m.sum() / surface:.0%}',
                    unsafe_allow_html=True)

if st.button("Générer le DST", type="primary"):
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
