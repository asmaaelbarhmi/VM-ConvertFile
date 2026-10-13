import streamlit as st
from src.image_processing import ouvrir_image, masque_logo
from src.digitizing import remplissage
from src.dst_export import exporter_dst
from src.validation import verifier

st.set_page_config(page_title="Image vers DST", page_icon="🧵")
st.title("Conversion d'image vers DST")
st.warning("Un fichier DST n'est pas « prêt à broder » : simulez-le dans un "
           "logiciel de broderie et faites un essai sur une chute de tissu.")

fichier = st.file_uploader("Importer une image",
                           type=["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"])
if fichier:
    try:
        image = ouvrir_image(fichier)
    except ValueError as e:
        st.error(str(e))
        st.stop()

    st.image(image, caption=f"{image.format} — {image.width} × {image.height} px")
    mode = st.radio("Type d'image", ["Logo / dessin simple", "Photo (expérimental)"])
    if mode.startswith("Photo"):
        st.info("Le mode photo n'est pas encore disponible (phase 3).")
        st.stop()

    largeur = st.number_input("Largeur finale (mm)", 10.0, 400.0, 80.0)
    ratio = image.height / image.width
    hauteur = st.number_input("Hauteur finale (mm)", 10.0, 400.0,
                              min(400.0, max(10.0, round(largeur * ratio, 1))))
    seuil = st.slider("Seuil noir/blanc", 0, 255, 128)
    pas = st.slider("Écart entre les lignes (mm)", 0.3, 1.0, 0.4, 0.05)

    masque = masque_logo(image, largeur, hauteur, seuil, pas)
    st.image((~masque).astype("uint8") * 255, caption="Aperçu des zones brodées (en noir)")

    if st.button("Générer le DST"):
        try:
            donnees, relu = exporter_dst(remplissage(masque, pas))
        except Exception as e:
            st.error(f"Échec de la génération : {e}")
            st.stop()
        rapport = verifier(relu)
        st.success(f"{rapport['points']} points — "
                   f"{rapport['largeur_mm']:.1f} × {rapport['hauteur_mm']:.1f} mm")
        for alerte in rapport["alertes"]:
            st.warning(alerte)
        st.download_button("Télécharger le .DST", donnees, "motif.dst",
                           "application/octet-stream")
