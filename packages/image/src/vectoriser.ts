/**
 * Vectorisation d'un masque binaire : suit les frontières entre cases pleines
 * et vides, assemble les boucles (contours extérieurs et trous), lisse les
 * escaliers et convertit en millimètres.
 */
import { aireSignee, dansAnneau, simplifierAnneau, type Polygon, type Ring } from "@atelier/stitch-core";
import type { Masque } from "./couleurs.js";

/**
 * Boucles de frontière en coordonnées de grille (coins de cases).
 * Chaque arête est orientée de façon à garder la matière à sa droite
 * (repère Y vers le bas) : les extérieurs et les trous ont des sens opposés.
 */
export function boucles(m: Masque): Ring[] {
  const { largeur: w, hauteur: h, cases } = m;
  const plein = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && cases[y * w + x] === 1;
  // arête dirigée : clé du sommet de départ → sommet d'arrivée
  const suivant = new Map<number, number[]>();
  const cle = (x: number, y: number) => y * (w + 1) + x;
  const ajouter = (x0: number, y0: number, x1: number, y1: number) => {
    const k = cle(x0, y0);
    const l = suivant.get(k);
    if (l) l.push(cle(x1, y1)); else suivant.set(k, [cle(x1, y1)]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!plein(x, y)) continue;
      if (!plein(x, y - 1)) ajouter(x, y, x + 1, y);         // haut : vers la droite
      if (!plein(x + 1, y)) ajouter(x + 1, y, x + 1, y + 1); // droite : vers le bas
      if (!plein(x, y + 1)) ajouter(x + 1, y + 1, x, y + 1); // bas : vers la gauche
      if (!plein(x - 1, y)) ajouter(x, y + 1, x, y);         // gauche : vers le haut
    }
  }
  const resultat: Ring[] = [];
  for (const [depart, cibles] of suivant) {
    while (cibles.length) {
      const anneau: Ring = [];
      let courant = depart;
      let precedent = -1;
      for (;;) {
        const x = courant % (w + 1);
        const y = Math.floor(courant / (w + 1));
        anneau.push([x, y]);
        const l = suivant.get(courant);
        if (!l || l.length === 0) break;
        // Aux sommets où deux contours se touchent en diagonale, on tourne
        // toujours du même côté pour ne pas mélanger deux boucles.
        let choix = 0;
        if (l.length > 1 && precedent >= 0) {
          const px = precedent % (w + 1), py = Math.floor(precedent / (w + 1));
          const dirIn = [x - px, y - py];
          let meilleur = -Infinity;
          l.forEach((c, i) => {
            const cx = c % (w + 1), cy = Math.floor(c / (w + 1));
            const croix = dirIn[0]! * (cy - y) - dirIn[1]! * (cx - x); // > 0 : tourne à droite
            if (croix > meilleur) { meilleur = croix; choix = i; }
          });
        }
        const prochain = l.splice(choix, 1)[0]!;
        precedent = courant;
        courant = prochain;
        if (courant === depart) break;
      }
      if (anneau.length >= 4) resultat.push(anneau);
    }
  }
  return resultat;
}

export interface OptionsVectorisation {
  /** Taille d'une case en mm. */
  tailleCaseMm: number;
  /** Tolérance de lissage en cases (0,7 gomme les escaliers sans déformer). */
  lissage?: number;
  /** Surface minimale d'un contour, en cases. */
  surfaceMiniCases?: number;
}

/** Masque → polygones (avec trous) en millimètres. */
export function vectoriser(m: Masque, opts: OptionsVectorisation): Polygon[] {
  const lissage = opts.lissage ?? 0.7;
  const mini = opts.surfaceMiniCases ?? 4;
  const anneaux = boucles(m)
    .map((r) => simplifierAnneau(r, lissage))
    .filter((r) => Math.abs(aireSignee(r)) >= mini);
  // Sens : matière à droite en Y vers le bas → extérieurs horaires (aire signée > 0)
  const exterieurs = anneaux.filter((r) => aireSignee(r) > 0);
  const trous = anneaux.filter((r) => aireSignee(r) < 0);
  const polys: Polygon[] = exterieurs.map((shell) => ({ shell, holes: [] }));
  for (const t of trous) {
    let meilleur: Polygon | undefined;
    let aireMin = Infinity;
    const p = t[0]!;
    for (const e of polys) {
      const a = aireSignee(e.shell);
      if (a < aireMin && dansAnneau(p, e.shell)) { aireMin = a; meilleur = e; }
    }
    meilleur?.holes.push(t);
  }
  const s = opts.tailleCaseMm;
  return polys.map((p) => ({
    shell: p.shell.map(([x, y]) => [x * s, y * s] as const),
    holes: p.holes.map((h) => h.map(([x, y]) => [x * s, y * s] as const)),
  }));
}
