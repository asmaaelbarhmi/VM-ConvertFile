/** Décodage de fichiers côté Node (tests, outils en ligne de commande, futur serveur). */
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import type { Pixels } from "./pixels.js";

/** Résolution PNG (chunk pHYs) → taille en mm, si présente et en mètres. */
function tailleDepuisPng(donnees: Uint8Array, largeur: number, hauteur: number): [number, number] | undefined {
  let i = 8;
  const vue = new DataView(donnees.buffer, donnees.byteOffset, donnees.byteLength);
  while (i + 8 <= donnees.length) {
    const longueur = vue.getUint32(i);
    const type = String.fromCharCode(donnees[i + 4]!, donnees[i + 5]!, donnees[i + 6]!, donnees[i + 7]!);
    if (type === "pHYs" && longueur >= 9) {
      const ppx = vue.getUint32(i + 8);
      const ppy = vue.getUint32(i + 12);
      const unite = donnees[i + 16];
      if (unite === 1 && ppx > 0 && ppy > 0) return [(largeur * 1000) / ppx, (hauteur * 1000) / ppy];
      return undefined;
    }
    if (type === "IDAT" || type === "IEND") return undefined;
    i += 12 + longueur;
  }
  return undefined;
}

/** Densité JFIF (segment APP0) → taille en mm. */
function tailleDepuisJpeg(donnees: Uint8Array, largeur: number, hauteur: number): [number, number] | undefined {
  let i = 2;
  while (i + 4 <= donnees.length && donnees[i] === 0xff) {
    const marqueur = donnees[i + 1]!;
    const longueur = (donnees[i + 2]! << 8) | donnees[i + 3]!;
    if (marqueur === 0xe0 && String.fromCharCode(...donnees.subarray(i + 4, i + 8)) === "JFIF") {
      const unites = donnees[i + 11]!;
      const dx = (donnees[i + 12]! << 8) | donnees[i + 13]!;
      const dy = (donnees[i + 14]! << 8) | donnees[i + 15]!;
      if (dx > 1 && dy > 1) {
        if (unites === 1) return [(largeur * 25.4) / dx, (hauteur * 25.4) / dy];
        if (unites === 2) return [(largeur * 10) / dx, (hauteur * 10) / dy];
      }
      return undefined;
    }
    if (marqueur === 0xda) return undefined;
    i += 2 + longueur;
  }
  return undefined;
}

export function decoderNode(donnees: Uint8Array, nom = ""): Pixels {
  const estPng = donnees[0] === 0x89 && donnees[1] === 0x50;
  const estJpeg = donnees[0] === 0xff && donnees[1] === 0xd8;
  if (estPng) {
    const png = PNG.sync.read(Buffer.from(donnees));
    const img: Pixels = { largeur: png.width, hauteur: png.height, donnees: new Uint8ClampedArray(png.data), format: "PNG" };
    const t = tailleDepuisPng(donnees, png.width, png.height);
    if (t) img.tailleMm = t;
    return img;
  }
  if (estJpeg) {
    const j = jpeg.decode(donnees, { useTArray: true, formatAsRGBA: true });
    const img: Pixels = { largeur: j.width, hauteur: j.height, donnees: new Uint8ClampedArray(j.data), format: "JPEG" };
    const t = tailleDepuisJpeg(donnees, j.width, j.height);
    if (t) img.tailleMm = t;
    return img;
  }
  throw new Error(`Format non pris en charge pour « ${nom} » : PNG ou JPEG attendu (PDF et SVG : via le navigateur).`);
}

export function encoderPng(img: Pixels): Uint8Array {
  const png = new PNG({ width: img.largeur, height: img.hauteur });
  png.data = Buffer.from(img.donnees.buffer, img.donnees.byteOffset, img.donnees.byteLength);
  return new Uint8Array(PNG.sync.write(png));
}
