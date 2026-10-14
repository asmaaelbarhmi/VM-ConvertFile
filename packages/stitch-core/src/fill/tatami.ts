/**
 * Remplissage tatami : rangées parallèles à un angle donné, piqûres décalées
 * d'une rangée à l'autre, rangées et piqûres alignées sur une grille GLOBALE
 * (deux formes voisines remplies au même angle se raccordent sans couture).
 *
 * Résultat : une liste de chemins (polylignes de points de couture) ; c'est le
 * constructeur de plan qui ajoute les déplacements, coupes et points d'arrêt.
 */
import { distance, tourner, tournerAnneau, type Polygon, type Pt, type Ring } from "../geometry.js";

export interface ParamsTatami {
  /** Angle des rangées en degrés (0 = horizontal). */
  angleDeg: number;
  /** Écart entre rangées en mm (densité). */
  espacement: number;
  /** Longueur maximale d'un point en mm. */
  longueurMax: number;
  /** Nombre de rangées avant que les piqûres se réalignent (évite les sillons). */
  decalages: number;
  /** Au-delà de cette distance, on ne relie plus deux sections par des points : saut. */
  deplacementMax: number;
}

export const TATAMI_DEFAUT: ParamsTatami = {
  angleDeg: 45,
  espacement: 0.25,
  longueurMax: 3.0,
  decalages: 4,
  deplacementMax: 5.0,
};

/** Segment d'une rangée, en repère tourné : y constant, de x1 à x2. */
interface Segment {
  k: number; // index global de la rangée
  x1: number;
  x2: number;
}

/** Tous les segments de rangées traversant le polygone (repère tourné). */
export function segmentsDeRangees(poly: Polygon, angleRad: number, espacement: number): Map<number, Segment[]> {
  const anneaux = [poly.shell, ...poly.holes].map((r) => tournerAnneau(r, -angleRad));
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of anneaux) for (const [, y] of r) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const kMin = Math.ceil(minY / espacement);
  const kMax = Math.floor(maxY / espacement);
  const parRangee = new Map<number, Segment[]>();
  for (let k = kMin; k <= kMax; k++) {
    const y = k * espacement;
    const xs: number[] = [];
    for (const r of anneaux) {
      for (let i = 0, n = r.length; i < n; i++) {
        const a = r[i]!;
        const b = r[(i + 1) % n]!;
        if (a[1] === b[1]) continue;
        // Convention demi-ouverte : évite de compter deux fois un sommet exactement sur la rangée
        if (y >= Math.min(a[1], b[1]) && y < Math.max(a[1], b[1])) {
          xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
        }
      }
    }
    xs.sort((p, q) => p - q);
    const segs: Segment[] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x1 = xs[i]!;
      const x2 = xs[i + 1]!;
      if (x2 - x1 > 1e-6) segs.push({ k, x1, x2 });
    }
    if (segs.length) parRangee.set(k, segs);
  }
  return parRangee;
}

/** Piqûres le long d'un segment, sur une grille globale décalée selon la rangée. */
function piqures(seg: Segment, versLaDroite: boolean, p: ParamsTatami): number[] {
  const L = p.longueurMax;
  const phase = ((((seg.k % p.decalages) + p.decalages) % p.decalages) * L) / p.decalages;
  const xs: number[] = [];
  let x = (Math.floor((seg.x1 - phase) / L) + 1) * L + phase;
  while (x < seg.x2 - 1e-6) {
    if (x > seg.x1 + 1e-6) xs.push(x);
    x += L;
  }
  // Évite une piqûre collée au bord (point minuscule) : on la fusionne avec le bord.
  if (xs.length && xs[0]! - seg.x1 < 0.3) xs.shift();
  if (xs.length && seg.x2 - xs[xs.length - 1]! < 0.3) xs.pop();
  const points = [seg.x1, ...xs, seg.x2];
  return versLaDroite ? points : points.reverse();
}

/** Une section = suite de segments de rangées consécutives qui se chevauchent. */
type Section = Segment[];

function construireSections(parRangee: Map<number, Segment[]>): Section[] {
  const sections: Section[] = [];
  const ouvertes: Section[] = [];
  const cles = [...parRangee.keys()].sort((a, b) => a - b);
  for (const k of cles) {
    const segs = parRangee.get(k)!;
    const utilises = new Set<Segment>();
    const encoreOuvertes: Section[] = [];
    for (const s of ouvertes) {
      const dernier = s[s.length - 1]!;
      if (dernier.k !== k - 1) {
        sections.push(s);
        continue;
      }
      // Meilleur recouvrement horizontal avec un segment libre de la rangée k
      let meilleur: Segment | undefined;
      let rec = 0;
      for (const c of segs) {
        if (utilises.has(c)) continue;
        const r = Math.min(dernier.x2, c.x2) - Math.max(dernier.x1, c.x1);
        if (r > rec) {
          rec = r;
          meilleur = c;
        }
      }
      // Un segment ne peut prolonger qu'une section ; les autres sections se ferment
      // (une rangée coupée en deux par un trou ouvre de nouvelles sections)
      if (meilleur && rec > 0.2) {
        utilises.add(meilleur);
        s.push(meilleur);
        encoreOuvertes.push(s);
      } else {
        sections.push(s);
      }
    }
    for (const c of segs) if (!utilises.has(c)) encoreOuvertes.push([c]);
    ouvertes.length = 0;
    ouvertes.push(...encoreOuvertes);
  }
  sections.push(...ouvertes);
  return sections;
}

/** Chemin de couture d'une section : va-et-vient d'une rangée à la suivante. */
function cheminSection(section: Section, angleRad: number, p: ParamsTatami, commencerADroite: boolean): Pt[] {
  const chemin: Pt[] = [];
  let versLaDroite = !commencerADroite;
  for (const seg of section) {
    const y = seg.k * p.espacement;
    for (const x of piqures(seg, versLaDroite, p)) chemin.push(tourner([x, y], angleRad));
    versLaDroite = !versLaDroite;
  }
  return chemin;
}

/**
 * Remplit le polygone. Renvoie des chemins ; entre deux chemins, le plan fera un
 * déplacement (points de liaison si court, saut sinon).
 */
export function remplirTatami(poly: Polygon, params: Partial<ParamsTatami> = {}): Pt[][] {
  const p: ParamsTatami = { ...TATAMI_DEFAUT, ...params };
  const angleRad = (p.angleDeg * Math.PI) / 180;
  const parRangee = segmentsDeRangees(poly, angleRad, p.espacement);
  const sections = construireSections(parRangee).filter((s) => s.length > 0);
  if (sections.length === 0) return [];

  // Ordre des sections : plus proche voisin à partir de la première, en reliant
  // les chemins consécutifs lorsqu'ils sont proches (un seul chemin continu).
  const restantes = new Set(sections);
  const chemins: Pt[][] = [];
  let courant: Pt[] = [];
  let position: Pt | undefined;
  let section: Section | undefined = sections[0];
  while (section) {
    restantes.delete(section);
    const premier = section[0]!;
    const debutGauche = tourner([premier.x1, premier.k * p.espacement], angleRad);
    const debutDroite = tourner([premier.x2, premier.k * p.espacement], angleRad);
    const commencerADroite = position ? distance(position, debutDroite) < distance(position, debutGauche) : false;
    const chemin = cheminSection(section, angleRad, p, commencerADroite);
    if (position && distance(position, chemin[0]!) <= p.deplacementMax) {
      courant.push(...relier(position, chemin[0]!, p.longueurMax), ...chemin);
    } else {
      if (courant.length) chemins.push(courant);
      courant = chemin;
    }
    position = courant[courant.length - 1];
    // Section suivante : la plus proche d'une de ses extrémités
    let meilleure: Section | undefined;
    let dmin = Infinity;
    for (const s of restantes) {
      const f = s[0]!;
      for (const x of [f.x1, f.x2]) {
        const d = distance(position!, tourner([x, f.k * p.espacement], angleRad));
        if (d < dmin) {
          dmin = d;
          meilleure = s;
        }
      }
    }
    section = meilleure;
  }
  if (courant.length) chemins.push(courant);
  return chemins;
}

/** Points intermédiaires pour aller de a à b sans dépasser la longueur maximale (a exclu, b exclu). */
export function relier(a: Pt, b: Pt, longueurMax: number): Pt[] {
  const d = distance(a, b);
  const n = Math.ceil(d / longueurMax);
  const out: Pt[] = [];
  for (let i = 1; i < n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  return out;
}

export type { Ring };
