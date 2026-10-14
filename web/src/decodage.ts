/** Lecture des fichiers dans le navigateur : images, PDF (1re page), SVG. */
import { tailleDepuisJpeg, tailleDepuisPng, tailleDepuisSvg, type Pixels } from "@atelier/image";

const DPI_VECTORIEL = 300;
const LARGEUR_MAX_PX = 2500;

function depuisCanvas(source: CanvasImageSource, largeur: number, hauteur: number): Pixels {
  const f = Math.min(1, LARGEUR_MAX_PX / Math.max(largeur, hauteur));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(largeur * f));
  canvas.height = Math.max(1, Math.round(hauteur * f));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { largeur: canvas.width, hauteur: canvas.height, donnees: d.data };
}

async function decoderImage(fichier: File, octets: Uint8Array): Promise<Pixels> {
  const bitmap = await createImageBitmap(fichier);
  const px = depuisCanvas(bitmap, bitmap.width, bitmap.height);
  px.format = (fichier.type.split("/")[1] ?? "image").toUpperCase();
  const t = octets[0] === 0x89 ? tailleDepuisPng(octets, bitmap.width, bitmap.height)
    : octets[0] === 0xff ? tailleDepuisJpeg(octets, bitmap.width, bitmap.height) : undefined;
  if (t) px.tailleMm = t;
  bitmap.close();
  return px;
}

async function decoderSvg(fichier: File): Promise<Pixels> {
  const texte = await fichier.text();
  const taille = tailleDepuisSvg(texte);
  const url = URL.createObjectURL(new Blob([texte], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((ok, ko) => { img.onload = () => ok(); img.onerror = () => ko(new Error("SVG illisible")); img.src = url; });
    const largeurPx = 2000;
    const ratio = img.naturalHeight && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1;
    const px = depuisCanvas(img, largeurPx, Math.round(largeurPx * ratio));
    px.format = "SVG";
    if (taille) px.tailleMm = taille;
    return px;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decoderPdf(octets: Uint8Array): Promise<Pixels> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: octets }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const echelle = Math.min(DPI_VECTORIEL / 72, LARGEUR_MAX_PX / Math.max(base.width, base.height));
  const vue = page.getViewport({ scale: echelle });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vue.width);
  canvas.height = Math.round(vue.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  await page.render({ canvasContext: ctx, viewport: vue, canvas }).promise;
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { largeur: canvas.width, hauteur: canvas.height, donnees: d.data, format: "PDF", tailleMm: [(base.width * 25.4) / 72, (base.height * 25.4) / 72] };
}

export async function decoderFichier(fichier: File): Promise<Pixels> {
  const octets = new Uint8Array(await fichier.arrayBuffer());
  const nom = fichier.name.toLowerCase();
  if (nom.endsWith(".pdf") || (octets[0] === 0x25 && octets[1] === 0x50)) return decoderPdf(octets);
  if (nom.endsWith(".svg") || fichier.type === "image/svg+xml") return decoderSvg(fichier);
  return decoderImage(fichier, octets);
}
