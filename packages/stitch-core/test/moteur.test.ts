import { describe, expect, it } from "vitest";
import {
  ConstructeurPlan, TISSUS, MACHINES, aire, apercuSvg, broderForme, controler, dansPolygone, decaler,
  ecrireDst, intersectionRectangle, largeurMaxi, lireDst, remplirTatami, segmentsDeRangees, statistiques,
  type Polygon,
} from "../src/index.js";

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => ({
  shell: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], holes: [],
});

describe("géométrie", () => {
  it("aire et cercle inscrit", () => {
    const r = rect(0, 0, 40, 10);
    expect(aire(r)).toBe(400);
    expect(largeurMaxi(r)).toBeCloseTo(10, 0);
    const troue: Polygon = { shell: rect(0, 0, 40, 40).shell, holes: [rect(10, 10, 30, 30).shell] };
    expect(aire(troue)).toBe(1600 - 400);
    expect(dansPolygone([20, 20], troue)).toBe(false);
    expect(dansPolygone([5, 5], troue)).toBe(true);
  });

  it("décalage (compensation) et intersection (tuilage)", () => {
    const [plus] = decaler(rect(0, 0, 20, 10), 0.5);
    expect(aire(plus!)).toBeGreaterThan(200 + 2 * 0.5 * 30);
    const [moins] = decaler(rect(0, 0, 20, 10), -1);
    expect(aire(moins!)).toBeCloseTo(18 * 8, 0);
    const morceaux = intersectionRectangle(rect(0, 0, 100, 10), 40, -5, 80, 15);
    expect(morceaux).toHaveLength(1);
    expect(aire(morceaux[0]!)).toBeCloseTo(400, 1);
  });
});

describe("remplissage tatami", () => {
  it("couvre un rectangle avec le bon nombre de points", () => {
    const chemins = remplirTatami(rect(0, 0, 20, 10), { angleDeg: 0, espacement: 0.25, longueurMax: 3 });
    expect(chemins).toHaveLength(1); // une seule section, un seul chemin continu
    const pts = chemins[0]!;
    // 40 rangées × (20 mm / 3 mm ≈ 7 à 8 points par rangée)
    expect(pts.length).toBeGreaterThan(40 * 7);
    expect(pts.length).toBeLessThan(40 * 9 + 10);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(x).toBeLessThanOrEqual(20 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(10);
    }
  });

  it("ne coud jamais à l'intérieur d'un trou", () => {
    const troue: Polygon = { shell: rect(0, 0, 40, 40).shell, holes: [rect(10, 10, 30, 30).shell] };
    for (const chemin of remplirTatami(troue, { angleDeg: 30 })) {
      for (const [x, y] of chemin) {
        const dedansTrou = x > 10.3 && x < 29.7 && y > 10.3 && y < 29.7;
        expect(dedansTrou).toBe(false);
      }
    }
  });

  it("aligne les rangées sur une grille globale (deux formes voisines se raccordent)", () => {
    const a = segmentsDeRangees(rect(0, 0, 10, 10), 0, 0.4);
    const b = segmentsDeRangees(rect(10, 3.1, 20, 7.3), 0, 0.4);
    for (const k of b.keys()) expect(a.has(k)).toBe(true); // mêmes indices de rangées
  });

  it("gère un angle quelconque et une forme en L", () => {
    const L: Polygon = { shell: [[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]], holes: [] };
    const chemins = remplirTatami(L, { angleDeg: 45 });
    const total = chemins.reduce((s, c) => s + c.length, 0);
    expect(total).toBeGreaterThan(500);
    for (const c of chemins) for (const p of c) expect(dansPolygone([p[0], p[1]], decaler(L, 0.05)[0]!)).toBe(true);
  });
});

describe("plan et DST", () => {
  it("construit un plan avec points d'arrêt, sauts et coupes, et le DST se relit", () => {
    const c = new ConstructeurPlan({ coupeAuDela: 8 });
    c.nouvelleCouleur([200, 0, 0], "rouge");
    c.coudre([[0, 0], [2, 0], [4, 0]]);
    c.coudre([[30, 0], [32, 0]]); // loin : coupe + saut
    c.nouvelleCouleur([0, 0, 200], "bleu");
    c.coudre([[0, 20], [2, 20]]);
    const plan = c.terminer();
    const s = statistiques(plan);
    expect(s.couleurs).toBe(2);
    expect(s.coupes).toBe(1);
    expect(s.sauts).toBeGreaterThanOrEqual(2);
    expect(s.points).toBeGreaterThan(7 + 3 * 4); // 7 points + arrêts
    const dst = ecrireDst(plan, { nom: "test" });
    expect(dst.length).toBeGreaterThan(512);
    expect(String.fromCharCode(...dst.subarray(0, 3))).toBe("LA:");
    const relu = lireDst(dst);
    expect(relu.nom).toBe("test");
    expect(relu.plan.blocs).toHaveLength(2);
    expect(relu.pointsAnnonces).toBe(s.points);
    const st = statistiques(relu.plan);
    expect(st.largeurMm).toBeCloseTo(s.largeurMm, 1);
    expect(st.hauteurMm).toBeCloseTo(s.hauteurMm, 1);
  });

  it("découpe les longs déplacements en plusieurs sauts DST", () => {
    const c = new ConstructeurPlan();
    c.nouvelleCouleur([0, 0, 0]);
    c.coudre([[0, 0], [1, 0]]);
    c.coudre([[200, 150], [201, 150]]);
    const dst = ecrireDst(c.terminer());
    const relu = lireDst(dst);
    const s = statistiques(relu.plan);
    expect(s.largeurMm).toBeCloseTo(201, 0);
    expect(s.hauteurMm).toBeCloseTo(150, 0);
  });
});

describe("forme complète", () => {
  it("brode un carré avec sous-couche et compensation, contrôle machine", () => {
    const chemins = broderForme(rect(0, 0, 20, 20), TISSUS.polo_pique!, { angleDeg: 45 });
    const c = new ConstructeurPlan();
    c.nouvelleCouleur([0, 60, 160]);
    for (const ch of chemins) c.coudre(ch);
    const plan = c.terminer();
    const r = controler(plan, MACHINES.generique_100x100!);
    expect(r.points).toBeGreaterThan(700);
    expect(r.largeurMm).toBeCloseTo(20.4, 0); // 20 + 2 × 0,2 de compensation
    expect(r.pointMaxMm).toBeLessThanOrEqual(3.01);
    expect(r.alertes).toEqual([]);
    const svg = apercuSvg(plan);
    expect(svg).toContain("<svg");
    expect(svg).toContain("#003ca0");
  });

  it("signale un motif plus grand que le cadre", () => {
    const chemins = broderForme(rect(0, 0, 120, 30), TISSUS.toile_sac!, { angleDeg: 0 });
    const c = new ConstructeurPlan();
    c.nouvelleCouleur([0, 0, 0]);
    for (const ch of chemins) c.coudre(ch);
    const r = controler(c.terminer(), MACHINES.generique_100x100!);
    expect(r.alertes.some((a) => a.includes("cadre"))).toBe(true);
  });
});
