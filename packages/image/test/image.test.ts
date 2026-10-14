import { describe, expect, it } from "vitest";
import { aire, apercuSvg, ecrireDst, lireDst, statistiques, TISSUS, MACHINES } from "@atelier/stitch-core";
import {
  analyser, analyserFormes, boucles, classer, couchesCouleurs, couchesParPalette, creerPixels, ecrirePixel,
  generer, recadrerMarges, tailleProposee, tuiler, vectoriser, type Masque, type Pixels,
} from "../src/index.js";
import { decoderNode, encoderPng } from "../src/node.js";

function rectangle(img: Pixels, x0: number, y0: number, x1: number, y1: number, rgb: readonly [number, number, number]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ecrirePixel(img, x, y, rgb);
}

function masque(w: number, h: number, pleine: (x: number, y: number) => boolean): Masque {
  const cases = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cases[y * w + x] = pleine(x, y) ? 1 : 0;
  return { largeur: w, hauteur: h, cases };
}

describe("couleurs", () => {
  it("retire les marges et mémorise le fond", () => {
    const img = creerPixels(300, 150);
    rectangle(img, 30, 30, 150, 120, [200, 0, 0]);
    const r = recadrerMarges(img);
    expect([r.largeur, r.hauteur]).toEqual([120, 90]);
    expect(r.fondRgb).toEqual([255, 255, 255]);
    const couches = couchesCouleurs(r, 120, 90);
    expect(couches).toHaveLength(1);
    expect(couches[0]!.part).toBe(1); // tout le rectangle rouge est brodé
  });

  it("détecte deux fils et ignore les bords flous", () => {
    const img = creerPixels(200, 100);
    rectangle(img, 10, 10, 90, 90, [255, 0, 0]);
    rectangle(img, 110, 10, 190, 90, [0, 0, 255]);
    // liseré gris d'un pixel autour du carré rouge (anticrénelage simulé)
    for (let x = 9; x <= 90; x++) { ecrirePixel(img, x, 9, [255, 150, 150]); ecrirePixel(img, x, 90, [255, 150, 150]); }
    const couches = couchesCouleurs(img, 200, 100);
    expect(couches).toHaveLength(2);
    const hex = couches.map((c) => c.rgb.join(",")).sort();
    expect(hex).toEqual(["0,0,255", "255,0,0"]); // le liseré rose a été rattaché au rouge
    const palette = couches.map((c) => c.rgb);
    const fine = couchesParPalette(recadrerMarges(img), 400, 200, palette);
    expect(fine.map((c) => c.rgb)).toEqual(palette);
  });

  it("propose une taille d'après la résolution du fichier", () => {
    const img = creerPixels(300, 150);
    rectangle(img, 0, 0, 300, 150, [0, 0, 0]);
    img.tailleMm = [25.4, 12.7];
    expect(tailleProposee(img)).toEqual([25.4, 12.7]);
    const sans = creerPixels(200, 100);
    expect(tailleProposee(sans)).toEqual([100, 50]);
  });
});

describe("vectorisation", () => {
  it("trace un rectangle", () => {
    const m = masque(50, 30, (x, y) => x >= 10 && x < 40 && y >= 5 && y < 25);
    const polys = vectoriser(m, { tailleCaseMm: 0.5 });
    expect(polys).toHaveLength(1);
    expect(polys[0]!.holes).toHaveLength(0);
    expect(aire(polys[0]!)).toBeCloseTo(30 * 20 * 0.25, 0);
  });

  it("reconnaît un trou et deux formes séparées", () => {
    const m = masque(60, 60, (x, y) => {
      const anneau = x >= 5 && x < 35 && y >= 5 && y < 35 && !(x >= 15 && x < 25 && y >= 15 && y < 25);
      const carre = x >= 45 && x < 55 && y >= 45 && y < 55;
      return anneau || carre;
    });
    expect(boucles(m)).toHaveLength(3);
    const polys = vectoriser(m, { tailleCaseMm: 1 });
    expect(polys).toHaveLength(2);
    const grand = polys.find((p) => p.holes.length === 1)!;
    expect(grand).toBeDefined();
    expect(aire(grand)).toBeCloseTo(900 - 100, 0);
  });

  it("lisse les escaliers d'un disque", () => {
    const m = masque(80, 80, (x, y) => Math.hypot(x + 0.5 - 40, y + 0.5 - 40) < 30);
    const [disque] = vectoriser(m, { tailleCaseMm: 0.25 });
    expect(disque!.shell.length).toBeLessThan(120); // bien moins que les ~240 marches
    expect(aire(disque!)).toBeCloseTo(Math.PI * 30 * 30 * 0.0625, -1);
  });
});

describe("formes", () => {
  const t = TISSUS.polo_pique!;
  it("classe satin / tatami / ignorer et tuile les grandes formes", () => {
    const large = { shell: [[0, 0], [50, 0], [50, 30], [0, 30]] as const, holes: [] };
    const etroite = { shell: [[0, 0], [40, 0], [40, 3], [0, 3]] as const, holes: [] };
    const minuscule = { shell: [[0, 0], [1, 0], [1, 1], [0, 1]] as const, holes: [] };
    expect(classer({ shell: [...large.shell], holes: [] }, t)).toBe("tatami");
    expect(classer({ shell: [...etroite.shell], holes: [] }, t)).toBe("satin");
    expect(classer({ shell: [...minuscule.shell], holes: [] }, t)).toBe("ignorer");
    const grande = { shell: [[0, 0], [100, 0], [100, 90], [0, 90]] as [number, number][], holes: [] };
    const tuiles = tuiler(grande, 40);
    expect(tuiles).toHaveLength(9);
    expect(tuiles.reduce((s, p) => s + aire(p), 0)).toBeCloseTo(9000, 0);
    const formes = analyserFormes([grande], t);
    expect(formes).toHaveLength(9);
    expect(new Set(formes.map((f) => f.angle)).size).toBe(1);
  });
});

describe("pipeline complet", () => {
  it("logo deux couleurs → plan, DST relisible, aperçu", () => {
    const img = creerPixels(600, 300);
    rectangle(img, 20, 20, 300, 280, [0, 70, 150]);
    rectangle(img, 60, 130, 260, 170, [255, 255, 255]);
    rectangle(img, 340, 40, 560, 260, [200, 0, 0]);
    rectangle(img, 365, 65, 535, 235, [255, 255, 255]); // anneau rouge
    const a = analyser(img);
    expect(a.couleurs).toHaveLength(2);
    expect(a.largeurMm).toBe(100);
    const r = generer(a.image, { largeurMm: 60, tissu: TISSUS.polo_pique!, machine: MACHINES.generique_100x100!, palette: a.couleurs.map((c) => c.rgb) });
    expect(r.rapport.couleurs).toBe(2);
    expect(r.rapport.points).toBeGreaterThan(1500);
    expect(r.rapport.largeurMm).toBeLessThan(62);
    expect(r.rapport.alertes).toEqual([]);
    expect(r.fils.some((f) => f.satin > 0)).toBe(true);
    const dst = ecrireDst(r.plan, { nom: "logo" });
    const relu = lireDst(dst);
    expect(statistiques(relu.plan).points).toBe(r.rapport.points);
    expect(apercuSvg(r.plan)).toContain("<svg");
  });

  it("décode un PNG avec sa résolution", () => {
    const img = creerPixels(120, 60);
    rectangle(img, 10, 10, 110, 50, [0, 0, 0]);
    const png = encoderPng(img);
    const relu = decoderNode(png, "x.png");
    expect([relu.largeur, relu.hauteur, relu.format]).toEqual([120, 60, "PNG"]);
  });
});
