/** Profils machines et contrôle du plan par rapport au cadre. */
import { dureeMinutes, statistiques, type Plan, type Statistiques } from "./plan.js";

export interface ProfilMachine {
  nom: string;
  cadreLargeurMm: number;
  cadreHauteurMm: number;
  pointsParMinute: number;
  pointMaxMm: number;
  aiguilles: number;
}

export const MACHINES: Record<string, ProfilMachine> = {
  swf_k_450x300: { nom: "SWF K-series — cadre 450 × 300 mm", cadreLargeurMm: 450, cadreHauteurMm: 300, pointsParMinute: 800, pointMaxMm: 7, aiguilles: 15 },
  swf_k_casquette: { nom: "SWF K-series — cadre casquette 150 × 60 mm", cadreLargeurMm: 150, cadreHauteurMm: 60, pointsParMinute: 650, pointMaxMm: 7, aiguilles: 15 },
  generique_300x300: { nom: "Machine générique — cadre 300 × 300 mm", cadreLargeurMm: 300, cadreHauteurMm: 300, pointsParMinute: 700, pointMaxMm: 7, aiguilles: 12 },
  generique_100x100: { nom: "Machine générique — cadre 100 × 100 mm", cadreLargeurMm: 100, cadreHauteurMm: 100, pointsParMinute: 600, pointMaxMm: 7, aiguilles: 1 },
};

export interface Rapport extends Statistiques {
  minutes: number;
  alertes: string[];
}

export function controler(plan: Plan, machine: ProfilMachine, couverture?: number): Rapport {
  const s = statistiques(plan);
  const alertes: string[] = [];
  if (s.points === 0) alertes.push("Aucun point généré : image trop claire ou fond mal détecté.");
  if (couverture !== undefined && couverture > 0.6) {
    alertes.push(`${Math.round(couverture * 100)} % de la surface sera brodée : très dense, vérifiez que le fond n'a pas été pris pour le motif.`);
  }
  if (s.points > 50000) alertes.push(`Motif très dense (${s.points} points) : risque pour le tissu et temps long.`);
  if (s.largeurMm > machine.cadreLargeurMm || s.hauteurMm > machine.cadreHauteurMm) {
    alertes.push(`Motif (${s.largeurMm.toFixed(0)} × ${s.hauteurMm.toFixed(0)} mm) plus grand que le cadre (${machine.cadreLargeurMm} × ${machine.cadreHauteurMm} mm).`);
  }
  if (s.pointMaxMm > machine.pointMaxMm) alertes.push(`Point de ${s.pointMaxMm.toFixed(1)} mm : au-delà de ${machine.pointMaxMm} mm, le fil risque de boucler.`);
  if (s.coupes > 200) alertes.push(`${s.coupes} coupes de fil : motif très fragmenté, broderie lente.`);
  return { ...s, minutes: dureeMinutes(s, machine.pointsParMinute), alertes };
}
