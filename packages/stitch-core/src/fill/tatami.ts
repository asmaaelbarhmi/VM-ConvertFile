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
  /** Point d'où vient l'aiguille : le remplissage commence par la section la plus proche. */
  depart?: Pt;
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
  deplacementMax: 12.0,
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

  // Ordre des sections : on part de la plus proche du point de départ, puis de
  // proche en proche. Deux sections consécutives sont reliées par un trajet le
  // long du contour (points de liaison) si la distance le permet, sinon par un saut.
  const restantes = new Set(sections);
  const chemins: Pt[][] = [];
  let courant: Pt[] = [];
  let position: Pt | undefined = p.depart;
  const extremites = (s: Section): [Pt, Pt] => {
    const f = s[0]!;
    return [tourner([f.x1, f.k * p.espacement], angleRad), tourner([f.x2, f.k * p.espacement], angleRad)];
  };
  const plusProche = (): Section | undefined => {
    let meilleure: Section | undefined;
    let dmin = Infinity;
    for (const s of restantes) {
      for (const e of extremites(s)) {
        const d = position ? distance(position, e) : 0;
        if (d < dmin) { dmin = d; meilleure = s; }
      }
    }
    return meilleure;
  };
  const contour = new Contour(poly);
  let section: Section | undefined = plusProche();
  while (section) {
    restantes.delete(section);
    const [debutGauche, debutDroite] = extremites(section);
    const commencerADroite = position ? distance(position, debutDroite) < distance(position, debutGauche) : false;
    const chemin = cheminSection(section, angleRad, p, commencerADroite);
    const cible = chemin[0]!;
    if (position && courant.length) {
      const trajet = contour.trajet(position, cible, p.deplacementMax);
      if (trajet) {
        let prec = position;
        for (const q of trajet) { courant.push(...relier(prec, q, p.longueurMax), q); prec = q; }
        courant.push(...relier(prec, cible, p.longueurMax), ...chemin);
      } else {
        chemins.push(courant);
        courant = chemin;
      }
    } else {
      if (courant.length) chemins.push(courant);
      courant = chemin;
    }
    position = courant[courant.length - 1];
    section = plusProche();
  }
  if (courant.length) chemins.push(courant);
  return chemins;
}

/**
 * Trajets le long du contour d'un polygone : les extrémités de sections sont
 * sur le bord, on peut donc relier deux sections en suivant le bord (trajet
 * discret sous le remplissage voisin, et jamais à travers un trou).
 */
class Contour {
  private readonly anneaux: Ring[];
  private readonly cumul: number[][];
  constructor(poly: Polygon) {
    this.anneaux = [poly.shell, ...poly.holes];
    this.cumul = this.anneaux.map((r) => {
      const c = [0];
      for (let i = 0; i < r.length; i++) c.push(c[i]! + distance(r[i]!, r[(i + 1) % r.length]!));
      return c;
    });
  }

  /** Anneau et abscisse curviligne du point du contour le plus proche de q. */
  private projeter(q: Pt): { anneau: number; t: number; d: number } {
    let meilleur = { anneau: 0, t: 0, d: Infinity };
    this.anneaux.forEach((r, ai) => {
      for (let i = 0; i < r.length; i++) {
        const a = r[i]!;
        const b = r[(i + 1) % r.length]!;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy;
        let u = l2 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2 : 0;
        u = Math.max(0, Math.min(1, u));
        const d = distance(q, [a[0] + u * dx, a[1] + u * dy]);
        if (d < meilleur.d) meilleur = { anneau: ai, t: this.cumul[ai]![i]! + u * Math.sqrt(l2), d };
      }
    });
    return meilleur;
  }

  /**
   * Points du contour à suivre pour aller de a à b (sans a ni b), ou undefined si
   * les deux points ne sont pas sur le même anneau ou si le trajet est trop long.
   */
  trajet(a: Pt, b: Pt, longueurMax: number): Pt[] | undefined {
    const pa = this.projeter(a);
    const pb = this.projeter(b);
    if (pa.d > 0.6 || pb.d > 0.6) {
      return distance(a, b) <= longueurMax ? [] : undefined; // pas sur le bord : ligne droite si court
    }
    if (pa.anneau !== pb.anneau) return distance(a, b) <= longueurMax ? [] : undefined;
    const r = this.anneaux[pa.anneau]!;
    const c = this.cumul[pa.anneau]!;
    const perimetre = c[r.length]!;
    const direct = (pb.t - pa.t + perimetre) % perimetre; // sens des sommets croissants
    const inverse = perimetre - direct;
    if (Math.min(direct, inverse) > longueurMax) return undefined;
    const points: Pt[] = [];
    if (direct <= inverse) {
      let i = (c.findIndex((v) => v > pa.t) + r.length) % r.length; // premier sommet après a
      while (((c[i]! - pa.t + perimetre) % perimetre) < direct) { points.push(r[i]!); i = (i + 1) % r.length; }
    } else {
      let i = (c.findIndex((v) => v > pa.t) - 1 + r.length) % r.length; // sommet avant a
      while (((pa.t - c[i]! + perimetre) % perimetre) < inverse) { points.push(r[i]!); i = (i - 1 + r.length) % r.length; }
    }
    return points;
  }
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
