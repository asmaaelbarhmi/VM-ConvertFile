/**
 * Plan de points : la suite exacte d'instructions que la machine exécutera,
 * organisée en blocs de couleur. Unité mm, Y vers le bas.
 */
import { distance, type Pt } from "./geometry.js";
import { relier } from "./fill/tatami.js";

export type TypePoint = "point" | "saut" | "coupe" | "fin";

export interface Point {
  x: number;
  y: number;
  type: TypePoint;
}

export type RGB = readonly [number, number, number];

export interface BlocCouleur {
  couleur: RGB;
  nom: string;
  points: Point[];
}

export interface Plan {
  blocs: BlocCouleur[];
}

export interface OptionsPlan {
  /** Longueur maximale d'un point de liaison (mm). */
  longueurMax: number;
  /** Déplacement au-delà duquel on coupe le fil avant de sauter (mm). */
  coupeAuDela: number;
  /** Déplacement au-delà duquel on saute au lieu de coudre des points de liaison (mm). */
  sautAuDela: number;
  /** Points d'arrêt au début et à la fin de chaque couture continue. */
  pointsArret: boolean;
}

export const PLAN_DEFAUT: OptionsPlan = {
  longueurMax: 3.0,
  coupeAuDela: 8.0,
  sautAuDela: 3.0,
  pointsArret: true,
};

/**
 * Construit un plan en ajoutant des chemins de couture. Gère automatiquement
 * les déplacements entre chemins, les coupes de fil et les points d'arrêt.
 */
export class ConstructeurPlan {
  private readonly opts: OptionsPlan;
  private readonly blocs: BlocCouleur[] = [];
  private bloc: BlocCouleur | undefined;
  private position: Pt | undefined;
  private filEnPlace = false;
  private debutDeBloc = false;

  constructor(options: Partial<OptionsPlan> = {}) {
    this.opts = { ...PLAN_DEFAUT, ...options };
  }

  /** Démarre un nouveau bloc de couleur (changement de fil sur la machine). */
  nouvelleCouleur(couleur: RGB, nom = ""): void {
    this.terminerCouture();
    this.bloc = { couleur, nom, points: [] };
    this.blocs.push(this.bloc);
    this.debutDeBloc = true; // la machine coupe le fil au changement de couleur
  }

  /** Coud une polyligne continue. */
  coudre(chemin: readonly Pt[]): void {
    if (!this.bloc) throw new Error("Appelez nouvelleCouleur() avant coudre().");
    if (chemin.length === 0) return;
    const debut = chemin[0]!;
    if (this.position) {
      const d = distance(this.position, debut);
      if (d > this.opts.sautAuDela || this.debutDeBloc) {
        this.terminerCouture();
        if (d > this.opts.coupeAuDela && !this.debutDeBloc) this.ajouter(this.position, "coupe");
        this.ajouter(debut, "saut");
      } else if (d > this.opts.longueurMax) {
        for (const p of relier(this.position, debut, this.opts.longueurMax)) this.ajouter(p, "point");
      }
    } else {
      this.ajouter(debut, "saut");
    }
    this.debutDeBloc = false;
    if (!this.filEnPlace) {
      this.pointsArret(debut, chemin[1] ?? debut);
      this.filEnPlace = true;
    }
    let precedent = this.position ?? debut;
    for (const p of chemin) {
      if (distance(precedent, p) > this.opts.longueurMax + 1e-6) {
        for (const q of relier(precedent, p, this.opts.longueurMax)) this.ajouter(q, "point");
      }
      this.ajouter(p, "point");
      precedent = p;
    }
  }

  positionCourante(): Pt | undefined {
    return this.position;
  }

  terminer(): Plan {
    this.terminerCouture();
    if (this.position) this.ajouter(this.position, "fin");
    return { blocs: this.blocs.filter((b) => b.points.length > 0) };
  }

  private terminerCouture(): void {
    if (this.filEnPlace && this.position && this.bloc) {
      const pts = this.bloc.points;
      const avant = pts.length >= 2 ? pts[pts.length - 2]! : undefined;
      this.pointsArret(this.position, avant ? [avant.x, avant.y] : this.position);
      this.filEnPlace = false;
    }
  }

  /** Trois petits points en aller-retour (≈ 0,5 mm) pour bloquer le fil. */
  private pointsArret(ou: Pt, vers: Pt): void {
    if (!this.opts.pointsArret) return;
    const d = distance(ou, vers);
    const ux = d > 1e-6 ? (vers[0] - ou[0]) / d : 1;
    const uy = d > 1e-6 ? (vers[1] - ou[1]) / d : 0;
    const l = 0.5;
    const a: Pt = [ou[0] + ux * l, ou[1] + uy * l];
    this.ajouter(a, "point");
    this.ajouter(ou, "point");
    this.ajouter(a, "point");
    this.ajouter(ou, "point");
  }

  private ajouter(p: Pt, type: TypePoint): void {
    this.bloc!.points.push({ x: p[0], y: p[1], type });
    this.position = p;
  }
}

export interface Statistiques {
  points: number;
  sauts: number;
  coupes: number;
  couleurs: number;
  largeurMm: number;
  hauteurMm: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pointMaxMm: number;
}

export function statistiques(plan: Plan): Statistiques {
  const s: Statistiques = {
    points: 0, sauts: 0, coupes: 0, couleurs: plan.blocs.length,
    largeurMm: 0, hauteurMm: 0, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, pointMaxMm: 0,
  };
  for (const b of plan.blocs) {
    let prec: Point | undefined;
    for (const p of b.points) {
      if (p.type === "point") {
        s.points++;
        if (prec && prec.type === "point") s.pointMaxMm = Math.max(s.pointMaxMm, Math.hypot(p.x - prec.x, p.y - prec.y));
      } else if (p.type === "saut") s.sauts++;
      else if (p.type === "coupe") s.coupes++;
      if (p.type !== "fin") {
        s.minX = Math.min(s.minX, p.x);
        s.maxX = Math.max(s.maxX, p.x);
        s.minY = Math.min(s.minY, p.y);
        s.maxY = Math.max(s.maxY, p.y);
      }
      prec = p;
    }
  }
  if (s.points === 0) s.minX = s.minY = s.maxX = s.maxY = 0;
  s.largeurMm = s.maxX - s.minX;
  s.hauteurMm = s.maxY - s.minY;
  return s;
}

/** Durée estimée en minutes : points / vitesse + arrêts pour changements et coupes. */
export function dureeMinutes(stats: Statistiques, pointsParMinute: number): number {
  return stats.points / pointsParMinute + (stats.couleurs - 1) * 0.5 + stats.coupes * 0.05;
}
