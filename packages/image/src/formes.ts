/** Classement des formes (satin / tatami / ignorer), angle, tuilage, ordre de broderie. */
import { aire, bornes, centroide, distance, intersectionRectangle, largeurMaxi, type Polygon, type ProfilTissu, type Pt } from "@atelier/stitch-core";

export type TypeForme = "satin" | "tatami";

export interface Forme {
  poly: Polygon;
  type: TypeForme;
  largeur: number;
  /** Angle de l'axe principal en degrés (0 = horizontal). */
  angle: number;
  tuile: boolean;
}

export const TUILE_MM = 40;
export const SURFACE_TUILAGE_MM2 = 1200;
export const TROUS_TUILAGE = 6;

export function classer(poly: Polygon, tissu: ProfilTissu): TypeForme | "ignorer" {
  if (aire(poly) < tissu.surfaceMini) return "ignorer";
  const l = largeurMaxi(poly);
  if (l < tissu.largeurMini) return "ignorer";
  return l <= tissu.satinLargeurMax ? "satin" : "tatami";
}

/** Angle de l'axe principal du contour (analyse en composantes principales). */
export function anglePrincipal(poly: Polygon): number {
  const pts = poly.shell;
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= pts.length; my /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return (((angle * 180) / Math.PI) % 180 + 180) % 180;
}

export function aTuiler(poly: Polygon): boolean {
  return aire(poly) > SURFACE_TUILAGE_MM2 || poly.holes.length > TROUS_TUILAGE;
}

/** Découpe en tuiles carrées alignées sur une grille globale. */
export function tuiler(poly: Polygon, taille = TUILE_MM): Polygon[] {
  const b = bornes(poly);
  const out: Polygon[] = [];
  for (let x = Math.floor(b.minX / taille) * taille; x < b.maxX; x += taille) {
    for (let y = Math.floor(b.minY / taille) * taille; y < b.maxY; y += taille) {
      for (const m of intersectionRectangle(poly, x, y, x + taille, y + taille)) if (aire(m) > 0.5) out.push(m);
    }
  }
  return out;
}

/** Ordre de broderie : plus proche voisin à partir du coin haut-gauche. */
export function ordonner(formes: Forme[]): Forme[] {
  const restantes = [...formes];
  const ordre: Forme[] = [];
  let position: Pt = [0, 0];
  while (restantes.length) {
    let iMin = 0, dMin = Infinity;
    restantes.forEach((f, i) => { const d = distance(position, centroide(f.poly)); if (d < dMin) { dMin = d; iMin = i; } });
    const [f] = restantes.splice(iMin, 1);
    ordre.push(f!);
    position = centroide(f!.poly);
  }
  return ordre;
}

export function analyserFormes(polys: Polygon[], tissu: ProfilTissu): Forme[] {
  const formes: Forme[] = [];
  for (const poly of polys) {
    const type = classer(poly, tissu);
    if (type === "ignorer") continue;
    const largeur = largeurMaxi(poly);
    const angle = anglePrincipal(poly);
    const morceaux = type === "tatami" && aTuiler(poly) ? tuiler(poly) : [poly];
    for (const m of morceaux) formes.push({ poly: m, type, largeur, angle, tuile: morceaux.length > 1 });
  }
  return ordonner(formes);
}
