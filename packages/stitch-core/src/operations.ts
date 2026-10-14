/**
 * Opérations géométriques robustes, déléguées à des bibliothèques éprouvées :
 * - décalage (agrandir / rétrécir) : Clipper, utilisé pour la compensation de
 *   tirage et le retrait de la sous-couche ;
 * - intersection / union : polygon-clipping, utilisé pour le tuilage ;
 * - plus grand cercle inscrit : polylabel, utilisé pour classer les formes.
 */
import ClipperLib from "clipper-lib";
import polygonClipping from "polygon-clipping";
import polylabel from "polylabel";
import { aireSignee, type Polygon, type Pt, type Ring } from "./geometry.js";

const ECHELLE = 1000; // Clipper travaille en entiers : 1 unité = 0,001 mm

type CPt = { X: number; Y: number };

function versClipper(ring: Ring): CPt[] {
  return ring.map(([x, y]) => ({ X: Math.round(x * ECHELLE), Y: Math.round(y * ECHELLE) }));
}

function depuisClipper(path: CPt[]): Ring {
  return path.map((p) => [p.X / ECHELLE, p.Y / ECHELLE] as const);
}

/** Regroupe des anneaux (résultat Clipper) en polygones avec leurs trous. */
function assemblerPolygones(rings: Ring[]): Polygon[] {
  // Clipper renvoie les contours extérieurs et les trous avec des orientations opposées.
  const exterieurs: Polygon[] = [];
  const trous: Ring[] = [];
  const signeRef = rings.reduce((s, r) => (Math.abs(aireSignee(r)) > Math.abs(s) ? aireSignee(r) : s), 0);
  for (const r of rings) {
    if (r.length < 3) continue;
    if (Math.sign(aireSignee(r)) === Math.sign(signeRef)) exterieurs.push({ shell: r, holes: [] });
    else trous.push(r);
  }
  for (const t of trous) {
    // Un trou appartient au plus petit extérieur qui le contient.
    const p = t[0]!;
    let meilleur: Polygon | undefined;
    let aireMin = Infinity;
    for (const e of exterieurs) {
      const a = Math.abs(aireSignee(e.shell));
      if (a < aireMin && dansAnneauRapide(p, e.shell)) {
        aireMin = a;
        meilleur = e;
      }
    }
    (meilleur ?? exterieurs[0])?.holes.push(t);
  }
  return exterieurs;
}

function dansAnneauRapide(p: Pt, ring: Ring): boolean {
  let dedans = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) dedans = !dedans;
  }
  return dedans;
}

/**
 * Décale un polygone de `delta` mm (positif = agrandir, négatif = rétrécir).
 * Peut renvoyer plusieurs polygones (une forme fine se scinde) ou aucun.
 */
export function decaler(poly: Polygon, delta: number): Polygon[] {
  if (Math.abs(delta) < 1e-6) return [poly];
  const co = new ClipperLib.ClipperOffset(2, 0.1 * ECHELLE);
  co.AddPath(versClipper(poly.shell), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  for (const h of poly.holes) co.AddPath(versClipper(h), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const sortie = new ClipperLib.Paths();
  co.Execute(sortie, delta * ECHELLE);
  return assemblerPolygones((sortie as CPt[][]).map(depuisClipper));
}

/** Nettoie un polygone (auto-intersections, orientation) via une union avec lui-même. */
export function nettoyer(poly: Polygon): Polygon[] {
  const c = new ClipperLib.Clipper();
  c.AddPath(versClipper(poly.shell), ClipperLib.PolyType.ptSubject, true);
  for (const h of poly.holes) c.AddPath(versClipper(h), ClipperLib.PolyType.ptSubject, true);
  const sortie = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctUnion, sortie, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
  return assemblerPolygones((sortie as CPt[][]).map(depuisClipper));
}

type PCRing = [number, number][];
type PCPolygon = PCRing[];

function versPC(poly: Polygon): PCPolygon {
  const fermer = (r: Ring): PCRing => {
    const out = r.map(([x, y]) => [x, y] as [number, number]);
    const a = out[0]!;
    const z = out[out.length - 1]!;
    if (a[0] !== z[0] || a[1] !== z[1]) out.push([a[0], a[1]]);
    return out;
  };
  return [fermer(poly.shell), ...poly.holes.map(fermer)];
}

function depuisPC(multi: PCPolygon[]): Polygon[] {
  return multi.map((p) => {
    const ouvrir = (r: PCRing): Ring => {
      const out = r.map(([x, y]) => [x, y] as const);
      const a = out[0]!;
      const z = out[out.length - 1]!;
      if (out.length > 1 && a[0] === z[0] && a[1] === z[1]) out.pop();
      return out;
    };
    return { shell: ouvrir(p[0]!), holes: p.slice(1).map(ouvrir) };
  });
}

/** Partie du polygone contenue dans un rectangle. */
export function intersectionRectangle(poly: Polygon, x0: number, y0: number, x1: number, y1: number): Polygon[] {
  const boite: PCPolygon = [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
  const res = polygonClipping.intersection([versPC(poly)], [boite]);
  return depuisPC(res as PCPolygon[]);
}

export function union(polys: Polygon[]): Polygon[] {
  if (polys.length === 0) return [];
  const [premier, ...autres] = polys.map((p) => [versPC(p)] as PCPolygon[]);
  const res = polygonClipping.union(premier as never, ...(autres as never[]));
  return depuisPC(res as PCPolygon[]);
}

/** Diamètre du plus grand cercle inscrit : largeur « réelle » d'une forme, insensible aux trous. */
export function largeurMaxi(poly: Polygon, precision = 0.05): number {
  const r = polylabel(versPC(poly), precision) as number[] & { distance?: number };
  return 2 * (r.distance ?? 0);
}
