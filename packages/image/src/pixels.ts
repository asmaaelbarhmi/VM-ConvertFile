/**
 * Image en pixels, indépendante de la plateforme : RGBA 8 bits, ligne par ligne.
 * Le décodage des fichiers est fait par `node.ts` (serveur/tests) ou par le
 * navigateur (canvas) ; le reste du paquet ne manipule que cette structure.
 */
export interface Pixels {
  largeur: number;
  hauteur: number;
  /** RGBA, 4 octets par pixel. */
  donnees: Uint8ClampedArray;
  /** Taille réelle en mm si le fichier la connaît (résolution, page PDF, attributs SVG). */
  tailleMm?: readonly [number, number];
  /** Couleur du tissu mémorisée lors du retrait des marges. */
  fondRgb?: readonly [number, number, number];
  format?: string;
}

export type RGB = readonly [number, number, number];

export function creerPixels(largeur: number, hauteur: number, remplissage: RGB = [255, 255, 255]): Pixels {
  const donnees = new Uint8ClampedArray(largeur * hauteur * 4);
  for (let i = 0; i < donnees.length; i += 4) {
    donnees[i] = remplissage[0];
    donnees[i + 1] = remplissage[1];
    donnees[i + 2] = remplissage[2];
    donnees[i + 3] = 255;
  }
  return { largeur, hauteur, donnees };
}

export function lirePixel(img: Pixels, x: number, y: number): [number, number, number, number] {
  const i = (y * img.largeur + x) * 4;
  return [img.donnees[i]!, img.donnees[i + 1]!, img.donnees[i + 2]!, img.donnees[i + 3]!];
}

export function ecrirePixel(img: Pixels, x: number, y: number, rgb: RGB, a = 255): void {
  const i = (y * img.largeur + x) * 4;
  img.donnees[i] = rgb[0];
  img.donnees[i + 1] = rgb[1];
  img.donnees[i + 2] = rgb[2];
  img.donnees[i + 3] = a;
}

/** Remplace la transparence par du blanc (le tissu sera détecté ensuite). */
export function aplatir(img: Pixels): Pixels {
  const out = new Uint8ClampedArray(img.donnees.length);
  for (let i = 0; i < img.donnees.length; i += 4) {
    const a = img.donnees[i + 3]! / 255;
    out[i] = Math.round(img.donnees[i]! * a + 255 * (1 - a));
    out[i + 1] = Math.round(img.donnees[i + 1]! * a + 255 * (1 - a));
    out[i + 2] = Math.round(img.donnees[i + 2]! * a + 255 * (1 - a));
    out[i + 3] = 255;
  }
  return { ...img, donnees: out };
}

/** Redimensionne par moyenne de zones (réduction) ou plus proche voisin (agrandissement). */
export function redimensionner(img: Pixels, largeur: number, hauteur: number): Pixels {
  const out = new Uint8ClampedArray(largeur * hauteur * 4);
  const sx = img.largeur / largeur;
  const sy = img.hauteur / hauteur;
  for (let y = 0; y < hauteur; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < largeur; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < img.hauteur; yy++) {
        for (let xx = x0; xx < x1 && xx < img.largeur; xx++) {
          const i = (yy * img.largeur + xx) * 4;
          r += img.donnees[i]!; g += img.donnees[i + 1]!; b += img.donnees[i + 2]!; a += img.donnees[i + 3]!;
          n++;
        }
      }
      const o = (y * largeur + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  const res: Pixels = { largeur, hauteur, donnees: out };
  if (img.tailleMm) res.tailleMm = img.tailleMm;
  if (img.fondRgb) res.fondRgb = img.fondRgb;
  if (img.format) res.format = img.format;
  return res;
}

export function recadrer(img: Pixels, x0: number, y0: number, x1: number, y1: number): Pixels {
  const largeur = x1 - x0;
  const hauteur = y1 - y0;
  const out = new Uint8ClampedArray(largeur * hauteur * 4);
  for (let y = 0; y < hauteur; y++) {
    const src = ((y + y0) * img.largeur + x0) * 4;
    out.set(img.donnees.subarray(src, src + largeur * 4), y * largeur * 4);
  }
  const res: Pixels = { largeur, hauteur, donnees: out };
  if (img.tailleMm) res.tailleMm = [img.tailleMm[0] * largeur / img.largeur, img.tailleMm[1] * hauteur / img.hauteur];
  if (img.fondRgb) res.fondRgb = img.fondRgb;
  if (img.format) res.format = img.format;
  return res;
}
