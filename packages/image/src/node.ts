/** Décodage de fichiers côté Node (tests, outils en ligne de commande, futur serveur). */
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import type { Pixels } from "./pixels.js";
import { tailleDepuisJpeg, tailleDepuisPng } from "./resolution.js";

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
