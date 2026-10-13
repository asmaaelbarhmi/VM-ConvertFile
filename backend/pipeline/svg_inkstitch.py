"""Construit le SVG que lit Ink/Stitch : une forme = un chemin avec ses
paramètres de broderie (type de remplissage, densité, sous-couche, compensation)."""
from xml.sax.saxutils import quoteattr

NS = ('xmlns="http://www.w3.org/2000/svg" '
      'xmlns:inkstitch="http://inkstitch.org/namespace" '
      'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"')


def _chemin(poly):
    """Polygone Shapely → attribut `d` (coordonnées en mm)."""
    def anneau(coords):
        pts = list(coords)
        return "M " + " L ".join(f"{x:.3f},{y:.3f}" for x, y in pts[:-1]) + " Z"
    morceaux = [anneau(poly.exterior.coords)] + [anneau(i.coords) for i in poly.interiors]
    return " ".join(morceaux)


def _attributs_tatami(forme, tissu, angle_couche):
    """Remplissage tatami : densité, longueur de point, compensation et sous-couche
    perpendiculaire (la sous-couche stabilise le tissu sous le remplissage)."""
    angle = angle_couche
    a = {
        "inkstitch:fill_method": "tatami_fill",
        "inkstitch:angle": f"{angle:.0f}",
        "inkstitch:row_spacing_mm": tissu["row_spacing_mm"],
        "inkstitch:max_stitch_length_mm": tissu["max_stitch_length_mm"],
        "inkstitch:expand_mm": tissu["expand_mm"],
        "inkstitch:staggers": 4,
        "inkstitch:underpath": "True",
        "inkstitch:fill_underlay": "True" if tissu["underlay"] else "False",
        "inkstitch:fill_underlay_angle": f"{(angle + tissu['underlay_angle_delta']) % 180:.0f}",
        "inkstitch:fill_underlay_row_spacing_mm": tissu["underlay_row_spacing_mm"],
        "inkstitch:fill_underlay_inset_mm": tissu["underlay_inset_mm"],
    }
    return a


def _attributs_satin(forme, tissu):
    """Forme étroite : remplissage serré perpendiculaire à l'axe de la forme,
    ce qui donne l'aspect d'un satin (vraies colonnes satin : étape suivante)."""
    angle = (forme["angle"] + 90) % 180
    a = _attributs_tatami(forme, tissu, angle)
    a["inkstitch:row_spacing_mm"] = max(0.18, tissu["row_spacing_mm"] - 0.05)
    a["inkstitch:max_stitch_length_mm"] = max(1.0, min(forme["largeur"] * 1.5, tissu["max_stitch_length_mm"]))
    a["inkstitch:expand_mm"] = tissu["expand_mm"] + 0.1
    a["inkstitch:staggers"] = 1
    return a


def construire_svg(couches, largeur_mm, hauteur_mm, tissu, coupe_mm=8.0, angle_base=45):
    """[{'rgb', 'formes'}] → texte SVG prêt pour Ink/Stitch.
    Une couleur = un calque (<g>) ; l'ordre des calques est l'ordre de broderie."""
    lignes = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg {NS} width="{largeur_mm}mm" height="{hauteur_mm}mm" '
        f'viewBox="0 0 {largeur_mm} {hauteur_mm}">',
        "<metadata>",
        '<inkstitch:collapse_len_mm>3.0</inkstitch:collapse_len_mm>',
        '<inkstitch:min_stitch_len_mm>0.3</inkstitch:min_stitch_len_mm>',
        f'<inkstitch:min_jump_stitch_length_mm>{coupe_mm}</inkstitch:min_jump_stitch_length_mm>',
        "</metadata>",
    ]
    for n, couche in enumerate(couches):
        r, g, b = couche["rgb"]
        couleur = f"#{r:02x}{g:02x}{b:02x}"
        # L'angle change d'une couleur à l'autre : deux zones voisines de même angle se voient.
        angle_couche = (angle_base + 30 * n) % 180
        lignes.append(f'<g inkscape:groupmode="layer" inkscape:label="Fil {n + 1} {couleur}" id="fil{n + 1}">')
        for i, forme in enumerate(couche["formes"]):
            attrs = (_attributs_satin(forme, tissu) if forme["type"] == "satin"
                     else _attributs_tatami(forme, tissu, angle_couche))
            attrs_txt = " ".join(f"{k}={quoteattr(str(v))}" for k, v in attrs.items())
            lignes.append(f'<path id="f{n + 1}_{i + 1}" d="{_chemin(forme["poly"])}" '
                          f'style="fill:{couleur};stroke:none" {attrs_txt}/>')
        lignes.append("</g>")
    lignes.append("</svg>")
    return "\n".join(lignes)
