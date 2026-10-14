/**
 * Broderie complète d'une forme selon un profil tissu :
 * 1. sous-couche (rangées espacées, perpendiculaires, en retrait du bord) qui
 *    stabilise le tissu ;
 * 2. remplissage tatami élargi de la compensation de tirage (le tissu se resserre
 *    sous les points : on élargit légèrement chaque forme).
 */
import type { Polygon, Pt } from "../geometry.js";
import { decaler } from "../operations.js";
import { remplirTatami, type ParamsTatami } from "./tatami.js";

export interface ProfilTissu {
  nom: string;
  /** Écart entre rangées du remplissage (mm). */
  espacement: number;
  longueurMax: number;
  /** Compensation de tirage (mm ajoutés de chaque côté). */
  compensation: number;
  sousCouche: boolean;
  sousCoucheEspacement: number;
  sousCoucheRetrait: number;
  /** Largeur en dessous de laquelle une forme est traitée en satin (mm). */
  satinLargeurMax: number;
  largeurMini: number;
  surfaceMini: number;
  conseil: string;
}

export const TISSUS: Record<string, ProfilTissu> = {
  polo_pique: {
    nom: "Polo piqué (coton)", espacement: 0.25, longueurMax: 3.0, compensation: 0.2,
    sousCouche: true, sousCoucheEspacement: 2.0, sousCoucheRetrait: 0.4,
    satinLargeurMax: 7.0, largeurMini: 1.0, surfaceMini: 2.0,
    conseil: "Stabilisateur déchirable, sous-couche indispensable sur la maille.",
  },
  tshirt_jersey: {
    nom: "T-shirt jersey", espacement: 0.28, longueurMax: 3.0, compensation: 0.25,
    sousCouche: true, sousCoucheEspacement: 2.0, sousCoucheRetrait: 0.5,
    satinLargeurMax: 6.0, largeurMini: 1.2, surfaceMini: 3.0,
    conseil: "Tissu extensible : stabilisateur coupé (cut-away), densité réduite.",
  },
  sweat_polaire: {
    nom: "Sweat / polaire", espacement: 0.22, longueurMax: 3.0, compensation: 0.3,
    sousCouche: true, sousCoucheEspacement: 1.5, sousCoucheRetrait: 0.5,
    satinLargeurMax: 7.0, largeurMini: 1.5, surfaceMini: 4.0,
    conseil: "Poil : sous-couche serrée pour éviter que le tissu ressorte entre les points.",
  },
  casquette: {
    nom: "Casquette (sergé)", espacement: 0.25, longueurMax: 2.5, compensation: 0.2,
    sousCouche: true, sousCoucheEspacement: 2.0, sousCoucheRetrait: 0.4,
    satinLargeurMax: 6.0, largeurMini: 1.0, surfaceMini: 2.0,
    conseil: "Broder du centre vers l'extérieur ; motif limité par le cadre casquette.",
  },
  toile_sac: {
    nom: "Toile / sac (coton épais)", espacement: 0.25, longueurMax: 3.5, compensation: 0.15,
    sousCouche: true, sousCoucheEspacement: 2.5, sousCoucheRetrait: 0.3,
    satinLargeurMax: 8.0, largeurMini: 0.8, surfaceMini: 1.5,
    conseil: "Tissu stable : réglages standards.",
  },
};

export interface OptionsForme {
  angleDeg: number;
  /** Position de l'aiguille avant cette forme (pour commencer au plus près). */
  depart?: Pt;
  /** Forme étroite : densité plus forte et piqûres non décalées (aspect satin). */
  satin?: boolean;
  /** Nombre de décalages de piqûres (sillons) */
  decalages?: number;
}

/** Chemins de couture (sous-couche puis remplissage) pour une forme. */
export function broderForme(poly: Polygon, tissu: ProfilTissu, opts: OptionsForme): Pt[][] {
  const chemins: Pt[][] = [];
  let depart = opts.depart;
  const ajouter = (nouveaux: Pt[][]) => {
    chemins.push(...nouveaux);
    const dernier = nouveaux[nouveaux.length - 1];
    if (dernier?.length) depart = dernier[dernier.length - 1]!;
  };
  if (tissu.sousCouche) {
    for (const p of decaler(poly, -tissu.sousCoucheRetrait)) {
      ajouter(remplirTatami(p, {
        angleDeg: (opts.angleDeg + 90) % 180,
        espacement: tissu.sousCoucheEspacement,
        longueurMax: tissu.longueurMax,
        decalages: 2,
        ...(depart ? { depart } : {}),
      }));
    }
  }
  const compensation = tissu.compensation + (opts.satin ? 0.1 : 0);
  const base: Partial<ParamsTatami> = opts.satin
    ? { angleDeg: opts.angleDeg, espacement: Math.max(0.18, tissu.espacement - 0.05), longueurMax: tissu.longueurMax, decalages: 1 }
    : { angleDeg: opts.angleDeg, espacement: tissu.espacement, longueurMax: tissu.longueurMax, decalages: opts.decalages ?? 4 };
  for (const p of decaler(poly, compensation)) ajouter(remplirTatami(p, { ...base, ...(depart ? { depart } : {}) }));
  return chemins;
}
