/**
 * Outil en ligne de commande (Node) pour tester le pipeline sans interface :
 *   node packages/image/dist/cli.js image.png largeur_mm dossier_sortie [tissu] [machine]
 * Produit motif.dst, apercu.svg et rapport.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MACHINES, TISSUS, apercuSvg, ecrireDst } from "@atelier/stitch-core";
import { decoderNode } from "./node.js";
import { analyser, generer } from "./pipeline.js";

const [, , entree, largeurArg, sortie = "sortie", tissuCle = "polo_pique", machineCle = "swf_k_450x300"] = process.argv;
if (!entree) {
  console.error("Usage : cli image.png [largeur_mm] [dossier_sortie] [tissu] [machine]");
  process.exit(1);
}
const t0 = performance.now();
const pixels = decoderNode(new Uint8Array(readFileSync(entree)), entree);
const analyse = analyser(pixels);
const largeurMm = largeurArg ? Number(largeurArg) : analyse.largeurMm;
console.log(`Analyse : ${analyse.image.largeur}×${analyse.image.hauteur} px, proposition ${analyse.largeurMm}×${analyse.hauteurMm} mm, ` +
  `${analyse.couleurs.length} fil(s) : ${analyse.couleurs.map((c) => `#${c.rgb.map((v) => v.toString(16).padStart(2, "0")).join("")} (${Math.round(c.part * 100)} %)`).join(", ")}`);
const resultat = generer(analyse.image, {
  largeurMm, tissu: TISSUS[tissuCle]!, machine: MACHINES[machineCle]!, palette: analyse.couleurs.map((c) => c.rgb),
  progression: (f, m) => process.stdout.write(`\r${Math.round(f * 100).toString().padStart(3)} % ${m}            `),
});
console.log();
mkdirSync(sortie, { recursive: true });
writeFileSync(join(sortie, "motif.dst"), ecrireDst(resultat.plan, { nom: "motif" }));
writeFileSync(join(sortie, "apercu.svg"), apercuSvg(resultat.plan));
writeFileSync(join(sortie, "rapport.json"), JSON.stringify({ rapport: resultat.rapport, fils: resultat.fils, dureesMs: resultat.dureesMs }, null, 2));
const r = resultat.rapport;
console.log(`${r.points} points — ${r.largeurMm.toFixed(1)} × ${r.hauteurMm.toFixed(1)} mm — ${r.couleurs} fil(s) — ${r.sauts} sauts — ${r.coupes} coupes — ≈ ${r.minutes.toFixed(0)} min`);
for (const f of resultat.fils) console.log(`  fil #${f.rgb.map((v) => v.toString(16).padStart(2, "0")).join("")} : ${f.tatami} tatami, ${f.satin} satin, ${f.tuiles} tuiles`);
for (const a of r.alertes) console.log("  ! " + a);
console.log(`Durées : ${Object.entries(resultat.dureesMs).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)} s`).join(", ")} — total ${((performance.now() - t0) / 1000).toFixed(1)} s`);
