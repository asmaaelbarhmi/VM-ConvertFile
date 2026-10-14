/** Aperçu du plan de points en SVG : chaque point est un trait, couleur par bloc. */
import { statistiques, type Plan } from "../plan.js";

export interface OptionsApercu {
  /** Afficher les sauts en pointillés. */
  sauts?: boolean;
  /** Épaisseur du fil dessiné (mm). */
  epaisseur?: number;
  fond?: string;
  marge?: number;
}

export function apercuSvg(plan: Plan, options: OptionsApercu = {}): string {
  const s = statistiques(plan);
  const marge = options.marge ?? 2;
  const ep = options.epaisseur ?? 0.3;
  const l = s.largeurMm + 2 * marge;
  const h = s.hauteurMm + 2 * marge;
  const parties: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${l.toFixed(1)}mm" height="${h.toFixed(1)}mm" ` +
      `viewBox="${(s.minX - marge).toFixed(2)} ${(s.minY - marge).toFixed(2)} ${l.toFixed(2)} ${h.toFixed(2)}">`,
    `<rect x="${(s.minX - marge).toFixed(2)}" y="${(s.minY - marge).toFixed(2)}" width="${l.toFixed(2)}" height="${h.toFixed(2)}" fill="${options.fond ?? "#ffffff"}"/>`,
  ];
  for (const bloc of plan.blocs) {
    const [r, g, b] = bloc.couleur;
    const couleur = `#${hex(r)}${hex(g)}${hex(b)}`;
    let coutures = "";
    let sauts = "";
    let prec: { x: number; y: number } | undefined;
    for (const p of bloc.points) {
      if (p.type === "fin" || p.type === "coupe") continue;
      if (prec) {
        const seg = `M${prec.x.toFixed(2)} ${prec.y.toFixed(2)}L${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
        if (p.type === "point") coutures += seg;
        else sauts += seg;
      }
      prec = p;
    }
    parties.push(`<path d="${coutures}" fill="none" stroke="${couleur}" stroke-width="${ep}" stroke-linecap="round"/>`);
    if (options.sauts && sauts) parties.push(`<path d="${sauts}" fill="none" stroke="#999" stroke-width="0.1" stroke-dasharray="0.6 0.4"/>`);
  }
  parties.push("</svg>");
  return parties.join("\n");
}

function hex(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
}
