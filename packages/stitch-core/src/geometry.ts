/**
 * Géométrie de base. Unité : le millimètre. Axe Y vers le bas (convention SVG).
 * Un anneau est une liste de points ; il est fermé implicitement
 * (on ne répète pas le premier point à la fin).
 */
export type Pt = readonly [number, number];
export type Ring = Pt[];

/** Polygone = contour extérieur + trous. */
export interface Polygon {
  shell: Ring;
  holes: Ring[];
}

export interface Bornes {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function distance(a: Pt, b: Pt): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Aire signée d'un anneau (formule du lacet). Positive si sens horaire en repère Y vers le bas. */
export function aireSignee(ring: Ring): number {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

export function aire(poly: Polygon): number {
  let a = Math.abs(aireSignee(poly.shell));
  for (const h of poly.holes) a -= Math.abs(aireSignee(h));
  return Math.max(0, a);
}

export function longueurAnneau(ring: Ring): number {
  let l = 0;
  for (let i = 0, n = ring.length; i < n; i++) l += distance(ring[i]!, ring[(i + 1) % n]!);
  return l;
}

export function perimetre(poly: Polygon): number {
  return longueurAnneau(poly.shell) + poly.holes.reduce((s, h) => s + longueurAnneau(h), 0);
}

export function bornesAnneaux(rings: Iterable<Ring>): Bornes {
  const b: Bornes = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const r of rings) {
    for (const [x, y] of r) {
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
    }
  }
  return b;
}

export function bornes(poly: Polygon): Bornes {
  return bornesAnneaux([poly.shell]);
}

export function centroide(poly: Polygon): Pt {
  // Centre de masse du contour extérieur (suffisant pour ordonner les formes).
  const r = poly.shell;
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const p = r[i]!;
    const q = r[(i + 1) % n]!;
    const f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) {
    const b = bornes(poly);
    return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Rotation d'un point autour de l'origine. */
export function tourner(p: Pt, angleRad: number): Pt {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
}

export function tournerAnneau(ring: Ring, angleRad: number): Ring {
  return ring.map((p) => tourner(p, angleRad));
}

/** Vrai si le point est à l'intérieur de l'anneau (règle pair-impair). */
export function dansAnneau(p: Pt, ring: Ring): boolean {
  let dedans = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      dedans = !dedans;
    }
  }
  return dedans;
}

export function dansPolygone(p: Pt, poly: Polygon): boolean {
  if (!dansAnneau(p, poly.shell)) return false;
  return !poly.holes.some((h) => dansAnneau(p, h));
}

/** Simplification de Douglas-Peucker : enlève les points qui s'écartent de moins de `tolerance`. */
export function simplifierAnneau(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 4) return ring;
  const garder = new Array<boolean>(ring.length).fill(false);
  garder[0] = true;
  garder[ring.length - 1] = true;
  const pile: Array<[number, number]> = [[0, ring.length - 1]];
  while (pile.length) {
    const [i0, i1] = pile.pop()!;
    const a = ring[i0]!;
    const b = ring[i1]!;
    let dmax = 0;
    let imax = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = distanceSegment(ring[i]!, a, b);
      if (d > dmax) {
        dmax = d;
        imax = i;
      }
    }
    if (dmax > tolerance && imax > 0) {
      garder[imax] = true;
      pile.push([i0, imax], [imax, i1]);
    }
  }
  const out = ring.filter((_, i) => garder[i]);
  return out.length >= 3 ? out : ring;
}

export function distanceSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return distance(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return distance(p, [a[0] + t * dx, a[1] + t * dy]);
}
