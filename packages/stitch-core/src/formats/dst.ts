/**
 * Format Tajima DST : en-tête de 512 octets puis enregistrements de 3 octets.
 * Unité : 0,1 mm. Axe Y vers le HAUT (on inverse par rapport à notre plan).
 * Un déplacement est limité à ±121 unités par enregistrement : les mouvements
 * plus longs sont découpés en plusieurs sauts.
 */
import type { Plan, Point, RGB } from "../plan.js";

const MAX_UNITES = 121;

function encoder(dx: number, dy: number, b2Base: number): [number, number, number] {
  let x = dx;
  let y = dy;
  let b0 = 0;
  let b1 = 0;
  let b2 = b2Base;
  if (x > 40) { b2 |= 0x04; x -= 81; }
  if (x < -40) { b2 |= 0x08; x += 81; }
  if (y > 40) { b2 |= 0x20; y -= 81; }
  if (y < -40) { b2 |= 0x10; y += 81; }
  if (x > 13) { b1 |= 0x04; x -= 27; }
  if (x < -13) { b1 |= 0x08; x += 27; }
  if (y > 13) { b1 |= 0x20; y -= 27; }
  if (y < -13) { b1 |= 0x10; y += 27; }
  if (x > 4) { b0 |= 0x04; x -= 9; }
  if (x < -4) { b0 |= 0x08; x += 9; }
  if (y > 4) { b0 |= 0x20; y -= 9; }
  if (y < -4) { b0 |= 0x10; y += 9; }
  if (x > 1) { b1 |= 0x01; x -= 3; }
  if (x < -1) { b1 |= 0x02; x += 3; }
  if (y > 1) { b1 |= 0x80; y -= 3; }
  if (y < -1) { b1 |= 0x40; y += 3; }
  if (x > 0) { b0 |= 0x01; x -= 1; }
  if (x < 0) { b0 |= 0x02; x += 1; }
  if (y > 0) { b0 |= 0x80; y -= 1; }
  if (y < 0) { b0 |= 0x40; y += 1; }
  if (x !== 0 || y !== 0) throw new Error(`Déplacement DST trop long : ${dx}, ${dy}`);
  return [b0, b1, b2];
}

const POINT = 0x03;
const SAUT = 0x83;
const CHANGEMENT = 0xc3;

function champ(texte: string, longueur: number): string {
  return (texte + " ".repeat(longueur)).slice(0, longueur);
}

export interface OptionsDst {
  /** Nom du motif (16 caractères max). */
  nom?: string;
  /** Nombre de sauts consécutifs émis pour une coupe de fil (réglage machine courant : 3). */
  sautsPourCoupe?: number;
}

export function ecrireDst(plan: Plan, options: OptionsDst = {}): Uint8Array {
  const sautsPourCoupe = options.sautsPourCoupe ?? 3;
  const corps: number[] = [];
  let x = 0;
  let y = 0;
  let nbPoints = 0;
  let nbCouleurs = 0;
  let minX = 0, maxX = 0, minY = 0, maxY = 0;

  const emettre = (px: number, py: number, type: number) => {
    // px, py en unités DST (0,1 mm), y déjà inversé
    let dx = px - x;
    let dy = py - y;
    while (Math.abs(dx) > MAX_UNITES || Math.abs(dy) > MAX_UNITES) {
      const f = Math.max(Math.abs(dx), Math.abs(dy)) / MAX_UNITES;
      const sx = Math.trunc(dx / f);
      const sy = Math.trunc(dy / f);
      corps.push(...encoder(sx, sy, SAUT));
      x += sx; y += sy; dx -= sx; dy -= sy;
    }
    corps.push(...encoder(dx, dy, type));
    x += dx; y += dy;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    if (type === POINT) nbPoints++;
  };

  plan.blocs.forEach((bloc, i) => {
    if (i > 0) {
      corps.push(...encoder(0, 0, CHANGEMENT));
      nbCouleurs++;
    }
    for (const p of bloc.points) {
      const px = Math.round(p.x * 10);
      const py = -Math.round(p.y * 10);
      if (p.type === "point") emettre(px, py, POINT);
      else if (p.type === "saut") emettre(px, py, SAUT);
      else if (p.type === "coupe") for (let k = 0; k < sautsPourCoupe; k++) corps.push(...encoder(0, 0, SAUT));
    }
  });
  corps.push(0x00, 0x00, 0xf3); // fin

  const signe = (v: number) => (v >= 0 ? "+" : "-") + String(Math.abs(v)).padStart(5, "0");
  const entete =
    "LA:" + champ(options.nom ?? "motif", 16) + "\r" +
    "ST:" + String(nbPoints).padStart(7, "0") + "\r" +
    "CO:" + String(nbCouleurs).padStart(3, "0") + "\r" +
    "+X:" + String(maxX).padStart(5, "0") + "\r" +
    "-X:" + String(Math.abs(minX)).padStart(5, "0") + "\r" +
    "+Y:" + String(maxY).padStart(5, "0") + "\r" +
    "-Y:" + String(Math.abs(minY)).padStart(5, "0") + "\r" +
    "AX:" + signe(x) + "\r" +
    "AY:" + signe(y) + "\r" +
    "MX:+00000\r" + "MY:+00000\r" + "PD:******\r" + "\x1a";
  const sortie = new Uint8Array(512 + corps.length);
  sortie.fill(0x20, 0, 512);
  for (let i = 0; i < entete.length; i++) sortie[i] = entete.charCodeAt(i);
  sortie.set(corps, 512);
  return sortie;
}

export interface MotifLu {
  nom: string;
  pointsAnnonces: number;
  couleursAnnoncees: number;
  plan: Plan;
}

/** Relit un DST (contrôle du fichier produit). Les couleurs sont inconnues : gris par défaut. */
export function lireDst(donnees: Uint8Array, couleurs: RGB[] = []): MotifLu {
  if (donnees.length < 512) throw new Error("Fichier DST trop court.");
  const texte = new TextDecoder("latin1").decode(donnees.subarray(0, 512));
  const lire = (cle: string) => {
    const i = texte.indexOf(cle + ":");
    return i < 0 ? "" : texte.slice(i + 3, texte.indexOf("\r", i)).trim();
  };
  let x = 0;
  let y = 0;
  const blocs: Plan["blocs"] = [{ couleur: couleurs[0] ?? [128, 128, 128], nom: "", points: [] }];
  let sautsConsecutifs = 0;
  for (let i = 512; i + 2 < donnees.length; i += 3) {
    const b0 = donnees[i]!;
    const b1 = donnees[i + 1]!;
    const b2 = donnees[i + 2]!;
    if (b2 === 0xf3) break;
    let dx = 0;
    let dy = 0;
    if (b0 & 0x01) dx += 1; if (b0 & 0x02) dx -= 1; if (b0 & 0x04) dx += 9; if (b0 & 0x08) dx -= 9;
    if (b0 & 0x80) dy += 1; if (b0 & 0x40) dy -= 1; if (b0 & 0x20) dy += 9; if (b0 & 0x10) dy -= 9;
    if (b1 & 0x01) dx += 3; if (b1 & 0x02) dx -= 3; if (b1 & 0x04) dx += 27; if (b1 & 0x08) dx -= 27;
    if (b1 & 0x80) dy += 3; if (b1 & 0x40) dy -= 3; if (b1 & 0x20) dy += 27; if (b1 & 0x10) dy -= 27;
    if (b2 & 0x04) dx += 81; if (b2 & 0x08) dx -= 81; if (b2 & 0x20) dy += 81; if (b2 & 0x10) dy -= 81;
    x += dx;
    y += dy;
    const pt = { x: x / 10, y: -y / 10 };
    if ((b2 & 0xc3) === 0xc3) {
      blocs.push({ couleur: couleurs[blocs.length] ?? [128, 128, 128], nom: "", points: [] });
      sautsConsecutifs = 0;
    } else if ((b2 & 0x83) === 0x83) {
      sautsConsecutifs++;
      blocs[blocs.length - 1]!.points.push({ ...pt, type: "saut" });
    } else {
      sautsConsecutifs = 0;
      blocs[blocs.length - 1]!.points.push({ ...pt, type: "point" });
    }
  }
  void sautsConsecutifs;
  const plan: Plan = { blocs: blocs.filter((b) => b.points.length) };
  return { nom: lire("LA"), pointsAnnonces: Number(lire("ST")), couleursAnnoncees: Number(lire("CO")), plan };
}

export type { Point };
