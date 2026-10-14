/**
 * Couleurs : détection du tissu (fond), retrait des marges, réduction aux
 * fils réellement nécessaires.
 */
import { aplatir, recadrer, redimensionner, type Pixels, type RGB } from "./pixels.js";

/** Masque binaire : 1 = zone à broder, une case par pixel de la grille. */
export interface Masque {
  largeur: number;
  hauteur: number;
  cases: Uint8Array;
}

export interface Couche {
  rgb: RGB;
  masque: Masque;
  /** Part de la grille couverte (0..1). */
  part: number;
}

function distanceCouleur(a: RGB, b: RGB): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Couleur médiane des bords de l'image : c'est le tissu. */
export function couleurDesBords(img: Pixels): RGB {
  const r: number[] = [], g: number[] = [], b: number[] = [];
  const push = (x: number, y: number) => {
    const i = (y * img.largeur + x) * 4;
    r.push(img.donnees[i]!); g.push(img.donnees[i + 1]!); b.push(img.donnees[i + 2]!);
  };
  for (let x = 0; x < img.largeur; x++) { push(x, 0); push(x, img.hauteur - 1); }
  for (let y = 0; y < img.hauteur; y++) { push(0, y); push(img.largeur - 1, y); }
  const med = (v: number[]) => v.sort((p, q) => p - q)[Math.floor(v.length / 2)]!;
  return [med(r), med(g), med(b)];
}

/** Retire les marges unies autour du motif ; mémorise la couleur du tissu. */
export function recadrerMarges(img: Pixels, tolerance = 30): Pixels {
  const plat = aplatir(img);
  const fond = couleurDesBords(plat);
  let x0 = plat.largeur, y0 = plat.hauteur, x1 = -1, y1 = -1;
  for (let y = 0; y < plat.hauteur; y++) {
    for (let x = 0; x < plat.largeur; x++) {
      const i = (y * plat.largeur + x) * 4;
      const d = Math.abs(plat.donnees[i]! - fond[0]) + Math.abs(plat.donnees[i + 1]! - fond[1]) + Math.abs(plat.donnees[i + 2]! - fond[2]);
      if (d > tolerance) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return plat; // image unie : rien à recadrer
  const complet = x0 === 0 && y0 === 0 && x1 === plat.largeur - 1 && y1 === plat.hauteur - 1;
  const out = complet ? plat : recadrer(plat, x0, y0, x1 + 1, y1 + 1);
  if (!complet) out.fondRgb = fond;
  return out;
}

export function tailleProposee(img: Pixels, defautMm = 100, maxiMm = 450): [number, number] {
  let l: number, h: number;
  if (img.tailleMm) [l, h] = img.tailleMm;
  else { l = defautMm; h = (defautMm * img.hauteur) / img.largeur; }
  const f = Math.min(1, maxiMm / Math.max(l, h));
  return [Math.round(l * f * 10) / 10, Math.round(h * f * 10) / 10];
}

/**
 * Réduction de couleurs par découpe de boîtes (variante de la découpe médiane) :
 * à chaque étape on coupe la boîte de plus grande variance, le long de son canal
 * le plus dispersé, à l'endroit qui minimise la variance des deux moitiés.
 * Cela sépare correctement un grand fond uni d'une teinte voisine et isole les
 * petites couleurs franches, sans gaspiller de boîtes sur des nuances de bords flous.
 */
export function quantifier(img: Pixels, nbCouleurs: number): { palette: RGB[]; index: Uint8Array } {
  const n = img.largeur * img.hauteur;
  const pix = new Array<[number, number, number]>(n);
  for (let i = 0; i < n; i++) pix[i] = [img.donnees[i * 4]!, img.donnees[i * 4 + 1]!, img.donnees[i * 4 + 2]!];

  const variance = (b: [number, number, number][]): [number, number] => {
    // renvoie [somme des carrés des écarts (3 canaux), canal le plus dispersé]
    const m = [0, 0, 0];
    for (const p of b) { m[0]! += p[0]; m[1]! += p[1]; m[2]! += p[2]; }
    for (let c = 0; c < 3; c++) m[c]! /= b.length;
    const v = [0, 0, 0];
    for (const p of b) for (let c = 0; c < 3; c++) v[c]! += (p[c]! - m[c]!) ** 2;
    const canal = v.indexOf(Math.max(...v));
    return [v[0]! + v[1]! + v[2]!, canal];
  };

  let boites: { pix: [number, number, number][]; var: number; canal: number }[] = [];
  const pousser = (b: [number, number, number][]) => {
    if (!b.length) return;
    const [v, canal] = variance(b);
    boites.push({ pix: b, var: v, canal });
  };
  pousser(pix.slice());
  while (boites.length < nbCouleurs) {
    let iMax = -1, vMax = 1e-9;
    boites.forEach((b, i) => { if (b.var > vMax) { vMax = b.var; iMax = i; } });
    if (iMax < 0) break; // toutes les boîtes sont unies
    const { pix: b, canal } = boites[iMax]!;
    b.sort((p, q) => p[canal]! - q[canal]!);
    // Coupe optimale (minimise la variance intra des deux parties) sur le canal dominant
    const vals = b.map((p) => p[canal]!);
    let s1 = 0, s2 = 0;
    const total = vals.reduce((x, y) => x + y, 0);
    const total2 = vals.reduce((x, y) => x + y * y, 0);
    let meilleur = -1, coutMin = Infinity;
    for (let k = 1; k < vals.length; k++) {
      const v = vals[k - 1]!;
      s1 += v; s2 += v * v;
      if (vals[k] === v) continue; // ne coupe qu'entre deux valeurs différentes
      const g = s2 - (s1 * s1) / k;
      const d = (total2 - s2) - ((total - s1) * (total - s1)) / (vals.length - k);
      if (g + d < coutMin) { coutMin = g + d; meilleur = k; }
    }
    if (meilleur < 0) { boites[iMax]!.var = 0; continue; }
    boites.splice(iMax, 1);
    pousser(b.slice(0, meilleur));
    pousser(b.slice(meilleur));
  }
  const palette: RGB[] = boites.map(({ pix: b }) => {
    let r = 0, g = 0, bl = 0;
    for (const p of b) { r += p[0]; g += p[1]; bl += p[2]; }
    return [Math.round(r / b.length), Math.round(g / b.length), Math.round(bl / b.length)];
  });
  const index = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let best = 0, dmin = Infinity;
    for (let k = 0; k < palette.length; k++) {
      const d = distanceCouleur(pix[i]!, palette[k]!);
      if (d < dmin) { dmin = d; best = k; }
    }
    index[i] = best;
  }
  return { palette, index };
}

function masqueDepuisIndex(index: Uint8Array, largeur: number, hauteur: number, valeurs: Set<number>): Masque {
  const cases = new Uint8Array(index.length);
  for (let i = 0; i < index.length; i++) cases[i] = valeurs.has(index[i]!) ? 1 : 0;
  return { largeur, hauteur, cases };
}

function surface(m: Masque): number {
  let s = 0;
  for (const c of m.cases) s += c;
  return s;
}

/** Vrai si la zone n'est qu'un liseré : rognée d'une case, il n'en reste presque rien. */
function estLisere(m: Masque, seuil = 0.25): boolean {
  const total = surface(m);
  if (total === 0) return true;
  let coeur = 0;
  const { largeur: w, hauteur: h, cases } = m;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (cases[i] && cases[i - 1] && cases[i + 1] && cases[i - w] && cases[i + w]) coeur++;
    }
  }
  return coeur / total < seuil;
}

export interface DiagnosticCouleurs {
  palette: { rgb: RGB; part: number; role: "fond" | "proche_fond" | "lisere" | "teinte" }[];
  fond?: RGB;
  fils: { rgb: RGB; part: number }[];
}

/** Détail de la détection des fils, pour comprendre un résultat surprenant. */
export function diagnostiquerCouleurs(img: Pixels, largeurGrille: number, hauteurGrille: number, opts: OptionsCouches = {}): DiagnosticCouleurs {
  const journal: DiagnosticCouleurs = { palette: [], fils: [] };
  const couches = couchesCouleurs(img, largeurGrille, hauteurGrille, { ...opts, journal });
  journal.fils = couches.map((c) => ({ rgb: c.rgb, part: c.part }));
  return journal;
}

export interface OptionsCouches {
  /** Reçoit le détail des étapes (diagnostic). */
  journal?: DiagnosticCouleurs;
  /** Nombre de fils imposé ; sinon détection automatique. */
  nbCouleurs?: number;
  toleranceFond?: number;
  fusion?: number;
  surfaceMini?: number;
}

/**
 * Détecte les fils : réduit l'image à 16 teintes, retire le fond, écarte les
 * liserés (bords flous), fusionne les teintes proches et rattache les couleurs
 * marginales. Renvoie les couches de la plus grande à la plus petite.
 */
export function couchesCouleurs(img: Pixels, largeurGrille: number, hauteurGrille: number, opts: OptionsCouches = {}): Couche[] {
  const toleranceFond = opts.toleranceFond ?? 60;
  const fusion = opts.fusion ?? 80;
  const surfaceMini = opts.surfaceMini ?? 0.01;
  const petit = redimensionner(aplatir(img), largeurGrille, hauteurGrille);
  const { palette, index } = quantifier(petit, 16);

  let fond: number | undefined;
  if (img.fondRgb) {
    let dmin = Infinity;
    palette.forEach((c, i) => { const d = distanceCouleur(c, img.fondRgb!); if (d < dmin) { dmin = d; fond = i; } });
    if (dmin >= toleranceFond) fond = undefined;
  } else {
    const compte = new Map<number, number>();
    const bordsIdx: number[] = [];
    for (let x = 0; x < largeurGrille; x++) bordsIdx.push(index[x]!, index[(hauteurGrille - 1) * largeurGrille + x]!);
    for (let y = 0; y < hauteurGrille; y++) bordsIdx.push(index[y * largeurGrille]!, index[y * largeurGrille + largeurGrille - 1]!);
    for (const i of bordsIdx) compte.set(i, (compte.get(i) ?? 0) + 1);
    fond = [...compte.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  }

  type Teinte = { rgb: [number, number, number]; idx: number[]; surf: number };
  const teintes: Teinte[] = [];
  const liseres: Teinte[] = [];
  const total0 = largeurGrille * hauteurGrille;
  if (opts.journal && fond !== undefined) opts.journal.fond = palette[fond]!;
  palette.forEach((c, i) => {
    const m = masqueDepuisIndex(index, largeurGrille, hauteurGrille, new Set([i]));
    const s = surface(m);
    if (s === 0) return;
    const lisere = estLisere(m);
    // Une teinte proche du tissu est ignorée si elle en est très proche ou si ce
    // n'est qu'un liseré (bord flou) ; une vraie zone claire reste un fil.
    const dFond = fond === undefined ? Infinity : distanceCouleur(c, palette[fond]!);
    if (fond !== undefined && (i === fond || dFond < toleranceFond / 2 || (dFond < toleranceFond && lisere))) {
      opts.journal?.palette.push({ rgb: c, part: s / total0, role: i === fond ? "fond" : "proche_fond" });
      return;
    }
    opts.journal?.palette.push({ rgb: c, part: s / total0, role: lisere ? "lisere" : "teinte" });
    (lisere ? liseres : teintes).push({ rgb: [c[0], c[1], c[2]], idx: [i], surf: s });
  });
  teintes.sort((a, b) => b.surf - a.surf);
  let base = teintes;
  let restes: Teinte[] = liseres;
  if (base.length === 0) { base = liseres; restes = []; }

  const groupes: Teinte[] = [];
  for (const t of base) {
    const g = groupes.find((x) => distanceCouleur(x.rgb, t.rgb) < fusion);
    if (g) {
      const tot = g.surf + t.surf;
      g.rgb = [(g.rgb[0] * g.surf + t.rgb[0] * t.surf) / tot, (g.rgb[1] * g.surf + t.rgb[1] * t.surf) / tot, (g.rgb[2] * g.surf + t.rgb[2] * t.surf) / tot];
      g.idx.push(...t.idx);
      g.surf = tot;
    } else groupes.push({ rgb: [...t.rgb], idx: [...t.idx], surf: t.surf });
  }
  groupes.sort((a, b) => b.surf - a.surf);
  const total = groupes.reduce((s, g) => s + g.surf, 0) || 1;
  const limite = opts.nbCouleurs ?? groupes.length;
  let gardes = groupes.slice(0, limite);
  const rejets = [...groupes.slice(limite), ...restes];
  for (const g of [...gardes]) {
    if (g !== gardes[0] && g.surf / total < surfaceMini) { gardes = gardes.filter((x) => x !== g); rejets.push(g); }
  }
  for (const r of rejets) {
    if (!gardes.length) break;
    const proche = gardes.reduce((a, b) => (distanceCouleur(a.rgb, r.rgb) <= distanceCouleur(b.rgb, r.rgb) ? a : b));
    proche.idx.push(...r.idx);
    proche.surf += r.surf;
  }
  const n = largeurGrille * hauteurGrille;
  return gardes.map((g) => ({
    rgb: [Math.round(g.rgb[0]), Math.round(g.rgb[1]), Math.round(g.rgb[2])] as RGB,
    masque: masqueDepuisIndex(index, largeurGrille, hauteurGrille, new Set(g.idx)),
    part: g.surf / n,
  }));
}

/** Découpe l'image selon une palette de fils déjà connue (celle montrée à l'utilisateur). */
export function couchesParPalette(img: Pixels, largeurGrille: number, hauteurGrille: number, palette: readonly RGB[], toleranceFond = 60): Couche[] {
  const petit = redimensionner(aplatir(img), largeurGrille, hauteurGrille);
  const n = largeurGrille * hauteurGrille;
  const masques = palette.map(() => new Uint8Array(n));
  const surfaces = palette.map(() => 0);
  for (let i = 0; i < n; i++) {
    const p: RGB = [petit.donnees[i * 4]!, petit.donnees[i * 4 + 1]!, petit.donnees[i * 4 + 2]!];
    let best = -1, dmin = Infinity;
    palette.forEach((c, k) => { const d = distanceCouleur(p, c); if (d < dmin) { dmin = d; best = k; } });
    if (img.fondRgb) {
      // Tissu si c'est la couleur la plus proche (ou quasi identique) : une teinte
      // claire légitime reste attribuée à son fil.
      const df = distanceCouleur(p, img.fondRgb);
      if (df < dmin || df < toleranceFond / 2) best = -1;
    }
    if (best >= 0) { masques[best]![i] = 1; surfaces[best]!++; }
  }
  return palette
    .map((rgb, k) => ({ rgb, masque: { largeur: largeurGrille, hauteur: hauteurGrille, cases: masques[k]! }, part: surfaces[k]! / n }))
    .filter((c) => c.part > 0);
}
