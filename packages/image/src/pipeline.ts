/**
 * Enchaînement complet : image → analyse (taille, fils) → formes → plan de points.
 * Fonctionne tel quel dans le navigateur (Web Worker) ou sous Node.
 */
import {
  ConstructeurPlan, MACHINES, TISSUS, broderForme, controler, type Plan, type ProfilMachine,
  type ProfilTissu, type Rapport,
} from "@atelier/stitch-core";
import { couchesCouleurs, couchesParPalette, recadrerMarges, tailleProposee, type Couche } from "./couleurs.js";
import type { Pixels, RGB } from "./pixels.js";
import { analyserFormes, type Forme } from "./formes.js";
import { vectoriser } from "./vectoriser.js";

export interface Analyse {
  image: Pixels;
  largeurMm: number;
  hauteurMm: number;
  tailleConnue: boolean;
  couleurs: { rgb: RGB; part: number }[];
}

const GRILLE_ANALYSE = 400; // cases sur la plus grande dimension pour l'analyse rapide
const PAS_GENERATION_MM = 0.2;

function grille(largeurMm: number, hauteurMm: number, pasMm: number): [number, number] {
  return [Math.max(2, Math.round(largeurMm / pasMm)), Math.max(2, Math.round(hauteurMm / pasMm))];
}

/** Étape 1, rapide : marges retirées, taille proposée, fils détectés. */
export function analyser(source: Pixels, nbCouleurs?: number): Analyse {
  const image = recadrerMarges(source);
  const [largeurMm, hauteurMm] = tailleProposee(image);
  const pas = Math.max(largeurMm, hauteurMm) / GRILLE_ANALYSE;
  const [gl, gh] = grille(largeurMm, hauteurMm, pas);
  const opts = nbCouleurs ? { nbCouleurs } : {};
  const couches = couchesCouleurs(image, gl, gh, opts);
  return {
    image, largeurMm, hauteurMm, tailleConnue: !!image.tailleMm,
    couleurs: couches.map((c) => ({ rgb: c.rgb, part: c.part })),
  };
}

export interface OptionsGeneration {
  largeurMm: number;
  tissu: ProfilTissu;
  machine: ProfilMachine;
  /** Palette issue de l'analyse : garantit les mêmes fils que ceux affichés. */
  palette?: readonly RGB[];
  nbCouleurs?: number;
  coupeAuDelaMm?: number;
  angleBase?: number;
  /** Rappel de progression (0..1, message). */
  progression?: (fraction: number, message: string) => void;
}

export interface Resultat {
  plan: Plan;
  rapport: Rapport;
  largeurMm: number;
  hauteurMm: number;
  fils: { rgb: RGB; satin: number; tatami: number; tuiles: number }[];
  dureesMs: Record<string, number>;
}

/** Étape 2 : génération complète du plan de points. */
export function generer(image: Pixels, o: OptionsGeneration): Resultat {
  const dureesMs: Record<string, number> = {};
  const top = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const progression = o.progression ?? (() => undefined);
  let t = top();

  const hauteurMm = Math.round(((o.largeurMm * image.hauteur) / image.largeur) * 10) / 10;
  const pas = Math.max(PAS_GENERATION_MM, o.largeurMm / 1500);
  const [gl, gh] = grille(o.largeurMm, hauteurMm, pas);
  progression(0.05, "Séparation des couleurs");
  const couches: Couche[] = o.palette
    ? couchesParPalette(image, gl, gh, o.palette)
    : couchesCouleurs(image, gl, gh, o.nbCouleurs ? { nbCouleurs: o.nbCouleurs } : {});
  if (!couches.length) throw new Error("Aucune zone à broder trouvée dans l'image.");
  dureesMs.couleurs = top() - t; t = top();

  progression(0.2, "Vectorisation");
  const tailleCase = o.largeurMm / gl;
  const parCouche = couches.map((c) => ({ rgb: c.rgb, formes: analyserFormes(vectoriser(c.masque, { tailleCaseMm: tailleCase }), o.tissu) }))
    .filter((c) => c.formes.length);
  if (!parCouche.length) throw new Error("Toutes les formes sont trop petites ou trop fines pour être brodées à cette taille : agrandissez le motif.");
  dureesMs.vectorisation = top() - t; t = top();

  const constructeur = new ConstructeurPlan({ longueurMax: o.tissu.longueurMax, coupeAuDela: o.coupeAuDelaMm ?? 8 });
  const totalFormes = parCouche.reduce((s, c) => s + c.formes.length, 0);
  let faites = 0;
  const fils: Resultat["fils"] = [];
  parCouche.forEach((couche, n) => {
    constructeur.nouvelleCouleur(couche.rgb, `Fil ${n + 1}`);
    const angleCouche = ((o.angleBase ?? 45) + 30 * n) % 180;
    const resume = { rgb: couche.rgb, satin: 0, tatami: 0, tuiles: 0 };
    for (const f of couche.formes) {
      const angle = f.type === "satin" ? (f.angle + 90) % 180 : angleCouche;
      const depart = constructeur.positionCourante();
      const chemins = broderForme(f.poly, o.tissu, { angleDeg: angle, satin: f.type === "satin", ...(depart ? { depart } : {}) });
      for (const chemin of chemins) constructeur.coudre(chemin);
      resume[f.type]++;
      if (f.tuile) resume.tuiles++;
      faites++;
      if (faites % 10 === 0) progression(0.2 + (0.75 * faites) / totalFormes, `Broderie des formes (${faites}/${totalFormes})`);
    }
    fils.push(resume);
  });
  const plan = constructeur.terminer();
  dureesMs.broderie = top() - t;

  const surface = gl * gh;
  const couverture = couches.reduce((s, c) => s + c.part * surface, 0) / surface;
  const rapport = controler(plan, o.machine, couverture);
  progression(1, "Terminé");
  return { plan, rapport, largeurMm: o.largeurMm, hauteurMm, fils, dureesMs };
}

export { TISSUS, MACHINES };
export type { Forme };
