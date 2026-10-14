/** Web Worker : tout le calcul (analyse, vectorisation, points) hors du fil principal. */
import { MACHINES, TISSUS, apercuSvg, ecrireDst, type RGB } from "@atelier/stitch-core";
import { analyser, generer, type Pixels } from "@atelier/image";

export type MessageEntrant =
  | { type: "analyser"; pixels: Pixels; nbCouleurs?: number }
  | { type: "generer"; pixels: Pixels; largeurMm: number; tissu: string; machine: string; palette: RGB[]; nbCouleurs?: number; coupeAuDelaMm: number };

export type MessageSortant =
  | { type: "analyse"; image: Pixels; largeurMm: number; hauteurMm: number; tailleConnue: boolean; couleurs: { rgb: RGB; part: number }[] }
  | { type: "progression"; fraction: number; message: string }
  | { type: "resultat"; dst: Uint8Array; svg: string; rapport: unknown; fils: unknown; largeurMm: number; hauteurMm: number; dureesMs: Record<string, number> }
  | { type: "erreur"; message: string };

const envoyer = (m: MessageSortant, transfert: Transferable[] = []) => (postMessage as (m: unknown, t: Transferable[]) => void)(m, transfert);

onmessage = (e: MessageEvent<MessageEntrant>) => {
  const m = e.data;
  try {
    if (m.type === "analyser") {
      const a = analyser(m.pixels, m.nbCouleurs);
      envoyer({ type: "analyse", image: a.image, largeurMm: a.largeurMm, hauteurMm: a.hauteurMm, tailleConnue: a.tailleConnue, couleurs: a.couleurs }, [a.image.donnees.buffer]);
    } else if (m.type === "generer") {
      const tissu = TISSUS[m.tissu];
      const machine = MACHINES[m.machine];
      if (!tissu || !machine) throw new Error("Profil tissu ou machine inconnu.");
      const options = {
        largeurMm: m.largeurMm, tissu, machine, palette: m.palette, coupeAuDelaMm: m.coupeAuDelaMm,
        progression: (fraction: number, message: string) => envoyer({ type: "progression", fraction, message }),
        ...(m.nbCouleurs ? { nbCouleurs: m.nbCouleurs } : {}),
      };
      const r = generer(m.pixels, options);
      const dst = ecrireDst(r.plan, { nom: "motif" });
      const svg = apercuSvg(r.plan);
      envoyer({ type: "resultat", dst, svg, rapport: r.rapport, fils: r.fils, largeurMm: r.largeurMm, hauteurMm: r.hauteurMm, dureesMs: r.dureesMs }, [dst.buffer]);
    }
  } catch (err) {
    envoyer({ type: "erreur", message: err instanceof Error ? err.message : String(err) });
  }
};
