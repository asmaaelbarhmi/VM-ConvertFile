/** Interface : 1 fichier → 2 réglages → 3 génération (worker) → 4 résultat. */
import { MACHINES, TISSUS, type RGB, type Rapport } from "@atelier/stitch-core";
import type { Pixels } from "@atelier/image";
import { decoderFichier } from "./decodage.js";
import type { MessageEntrant, MessageSortant } from "./worker.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const TAILLE_MAX = 20 * 1024 * 1024;

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
let analyse: Extract<MessageSortant, { type: "analyse" }> | undefined;
let nomFichier = "motif";
let chrono = 0;

// --- Profils ---
function remplir(select: HTMLSelectElement, dico: Record<string, { nom: string }>) {
  select.innerHTML = "";
  for (const [cle, v] of Object.entries(dico)) {
    const o = document.createElement("option");
    o.value = cle;
    o.textContent = v.nom;
    select.appendChild(o);
  }
}
remplir($<HTMLSelectElement>("tissu"), TISSUS);
remplir($<HTMLSelectElement>("machine"), MACHINES);

function majAide() {
  const t = TISSUS[$<HTMLSelectElement>("tissu").value];
  $("tissu-conseil").textContent = t?.conseil ?? "";
  if (!analyse) return;
  const m = MACHINES[$<HTMLSelectElement>("machine").value];
  const l = Number($<HTMLInputElement>("largeur").value) || 0;
  const h = Math.round((l * analyse.hauteurMm / analyse.largeurMm) * 10) / 10;
  let txt = `Hauteur : ${h} mm (proportions conservées). `;
  txt += analyse.tailleConnue ? "Taille lue dans le fichier." : "Taille par défaut : le fichier n'indique pas de dimensions.";
  if (m && (l > m.cadreLargeurMm || h > m.cadreHauteurMm)) txt += ` ⚠ Plus grand que le cadre ${m.cadreLargeurMm} × ${m.cadreHauteurMm} mm.`;
  $("taille-aide").textContent = txt;
}
$("tissu").addEventListener("change", majAide);
$("machine").addEventListener("change", majAide);
$("largeur").addEventListener("input", majAide);
majAide();

// --- Étape 1 : fichier ---
const zone = $("zone-depot");
for (const ev of ["dragenter", "dragover"]) zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("survol"); });
for (const ev of ["dragleave", "drop"]) zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("survol"); });
zone.addEventListener("drop", (e) => { const f = (e as DragEvent).dataTransfer?.files[0]; if (f) void chargerFichier(f); });
$<HTMLInputElement>("fichier").addEventListener("change", function () { if (this.files?.[0]) void chargerFichier(this.files[0]); });

async function chargerFichier(fichier: File) {
  $("erreur-fichier").hidden = true;
  $("etape-reglages").hidden = true;
  $("etape-resultat").hidden = true;
  if (fichier.size > TAILLE_MAX) return montrerErreurFichier("Fichier trop volumineux (20 Mo maximum).");
  $("analyse-attente").hidden = false;
  nomFichier = fichier.name.replace(/\.[^.]+$/, "") || "motif";
  try {
    const pixels = await decoderFichier(fichier);
    const nb = Number($<HTMLInputElement>("nb-couleurs").value) || undefined;
    envoyer({ type: "analyser", pixels, ...(nb ? { nbCouleurs: nb } : {}) }, [pixels.donnees.buffer]);
  } catch (e) {
    montrerErreurFichier(e instanceof Error ? e.message : "Ce fichier n'est pas une image lisible.");
  }
}

function montrerErreurFichier(message: string) {
  $("analyse-attente").hidden = true;
  $("erreur-fichier").textContent = message;
  $("erreur-fichier").hidden = false;
}

function hex(rgb: RGB) {
  return "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

function dessinerVignette(img: Pixels) {
  const canvas = $<HTMLCanvasElement>("vignette");
  const f = Math.min(1, 600 / Math.max(img.largeur, img.hauteur));
  const tmp = document.createElement("canvas");
  tmp.width = img.largeur;
  tmp.height = img.hauteur;
  tmp.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.donnees), img.largeur, img.hauteur), 0, 0);
  canvas.width = Math.round(img.largeur * f);
  canvas.height = Math.round(img.hauteur * f);
  canvas.getContext("2d")!.drawImage(tmp, 0, 0, canvas.width, canvas.height);
}

function montrerAnalyse(a: Extract<MessageSortant, { type: "analyse" }>) {
  analyse = a;
  $("analyse-attente").hidden = true;
  dessinerVignette(a.image);
  $("infos-fichier").textContent = `${a.image.format ?? "Image"} — ${a.image.largeur} × ${a.image.hauteur} px, marges retirées — proposition : ${a.largeurMm} × ${a.hauteurMm} mm`;
  $<HTMLInputElement>("largeur").value = String(a.largeurMm);
  $("pastilles").innerHTML = a.couleurs.map((c) => `<span class="pastille" style="background:${hex(c.rgb)}" title="${hex(c.rgb)} — ${Math.round(c.part * 100)} %"></span>`).join("");
  $("nb-fils").textContent = `${a.couleurs.length} fil(s) détecté(s) automatiquement`;
  majAide();
  $("etape-reglages").hidden = false;
}

// --- Étape 3 : génération ---
$("form-reglages").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!analyse) return;
  const nb = Number($<HTMLInputElement>("nb-couleurs").value) || undefined;
  const palette = analyse.couleurs.map((c) => c.rgb);
  $<HTMLButtonElement>("bouton-generer").disabled = true;
  $("etape-resultat").hidden = false;
  $("resultat").hidden = true;
  $("erreur").hidden = true;
  $("progression").hidden = false;
  $<HTMLProgressElement>("barre").value = 0;
  chrono = performance.now();
  // L'image reste dans le fil principal (copie envoyée au worker)
  const copie: Pixels = { ...analyse.image, donnees: new Uint8ClampedArray(analyse.image.donnees) };
  envoyer({
    type: "generer", pixels: copie, largeurMm: Number($<HTMLInputElement>("largeur").value),
    tissu: $<HTMLSelectElement>("tissu").value, machine: $<HTMLSelectElement>("machine").value,
    palette: nb && nb !== palette.length ? [] : palette, coupeAuDelaMm: Number($<HTMLInputElement>("coupe").value) || 8,
    ...(nb ? { nbCouleurs: nb } : {}),
  }, [copie.donnees.buffer]);
});

function envoyer(m: MessageEntrant, transfert: Transferable[] = []) {
  worker.postMessage(m, transfert);
}

worker.onmessage = (e: MessageEvent<MessageSortant>) => {
  const m = e.data;
  if (m.type === "analyse") montrerAnalyse(m);
  else if (m.type === "progression") {
    $<HTMLProgressElement>("barre").value = m.fraction;
    $("progression-texte").textContent = `${m.message} — ${Math.round((performance.now() - chrono) / 1000)} s`;
  } else if (m.type === "resultat") montrerResultat(m);
  else if (m.type === "erreur") {
    if (!analyse || $("etape-resultat").hidden) montrerErreurFichier(m.message);
    else { finChrono(); $("erreur").textContent = m.message; $("erreur").hidden = false; }
  }
};

function finChrono() {
  $("progression").hidden = true;
  $<HTMLButtonElement>("bouton-generer").disabled = false;
}

function montrerResultat(m: Extract<MessageSortant, { type: "resultat" }>) {
  finChrono();
  const r = m.rapport as Rapport;
  const machine = MACHINES[$<HTMLSelectElement>("machine").value]!;
  const tissu = TISSUS[$<HTMLSelectElement>("tissu").value]!;
  $("resume").textContent = `${r.points} points — ${r.largeurMm.toFixed(1)} × ${r.hauteurMm.toFixed(1)} mm — ${r.couleurs} fil(s) — ${r.coupes} coupes — ≈ ${Math.round(r.minutes)} min sur ${machine.nom} — tissu : ${tissu.nom} — calculé en ${((performance.now() - chrono) / 1000).toFixed(1)} s`;
  $("alertes").innerHTML = r.alertes.map((a) => `<li>${echapper(a)}</li>`).join("");
  $("apercu").innerHTML = m.svg;
  const fils = m.fils as { rgb: RGB; satin: number; tatami: number; tuiles: number }[];
  $("ordre-fils").innerHTML = fils.map((f, i) => `<li><span class="pastille" style="background:${hex(f.rgb)}"></span> Fil ${i + 1} — ${hex(f.rgb)} <small>(${f.tatami} tatami, ${f.satin} satin)</small></li>`).join("");
  const urlDst = URL.createObjectURL(new Blob([new Uint8Array(m.dst)], { type: "application/octet-stream" }));
  const urlSvg = URL.createObjectURL(new Blob([m.svg], { type: "image/svg+xml" }));
  $("liens").innerHTML = `<a href="${urlDst}" download="${echapper(nomFichier)}.dst">Télécharger .DST</a>` +
    `<a class="secondaire" href="${urlSvg}" download="${echapper(nomFichier)}-apercu.svg">Aperçu SVG</a>`;
  $("resultat").hidden = false;
}

function echapper(t: string) {
  return t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
