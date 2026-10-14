/** Lecture de la taille réelle (mm) dans les métadonnées des fichiers, sans dépendance. */

/** Résolution PNG (chunk pHYs) → taille en mm, si présente et exprimée en mètres. */
export function tailleDepuisPng(donnees: Uint8Array, largeur: number, hauteur: number): [number, number] | undefined {
  const vue = new DataView(donnees.buffer, donnees.byteOffset, donnees.byteLength);
  let i = 8;
  while (i + 8 <= donnees.length) {
    const longueur = vue.getUint32(i);
    const type = String.fromCharCode(donnees[i + 4]!, donnees[i + 5]!, donnees[i + 6]!, donnees[i + 7]!);
    if (type === "pHYs" && longueur >= 9) {
      const ppx = vue.getUint32(i + 8);
      const ppy = vue.getUint32(i + 12);
      const unite = donnees[i + 16];
      if (unite === 1 && ppx > 0 && ppy > 0) return [(largeur * 1000) / ppx, (hauteur * 1000) / ppy];
      return undefined;
    }
    if (type === "IDAT" || type === "IEND") return undefined;
    i += 12 + longueur;
  }
  return undefined;
}

/** Densité JFIF (segment APP0) → taille en mm. */
export function tailleDepuisJpeg(donnees: Uint8Array, largeur: number, hauteur: number): [number, number] | undefined {
  let i = 2;
  while (i + 4 <= donnees.length && donnees[i] === 0xff) {
    const marqueur = donnees[i + 1]!;
    const longueur = (donnees[i + 2]! << 8) | donnees[i + 3]!;
    if (marqueur === 0xe0 && String.fromCharCode(...donnees.subarray(i + 4, i + 8)) === "JFIF") {
      const unites = donnees[i + 11]!;
      const dx = (donnees[i + 12]! << 8) | donnees[i + 13]!;
      const dy = (donnees[i + 14]! << 8) | donnees[i + 15]!;
      if (dx > 1 && dy > 1) {
        if (unites === 1) return [(largeur * 25.4) / dx, (hauteur * 25.4) / dy];
        if (unites === 2) return [(largeur * 10) / dx, (hauteur * 10) / dy];
      }
      return undefined;
    }
    if (marqueur === 0xda) return undefined;
    i += 2 + longueur;
  }
  return undefined;
}

const UNITES_MM: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, "": 25.4 / 96 };

/** Attributs width/height d'un SVG → taille en mm (undefined si en % ou absents). */
export function tailleDepuisSvg(texte: string): [number, number] | undefined {
  const lire = (attr: string) => {
    const m = new RegExp(attr + "\\s*=\\s*[\"']\\s*([0-9.]+)\\s*([a-z%]*)", "i").exec(texte.slice(0, 3000));
    if (!m || m[2] === "%") return undefined;
    return Number(m[1]) * (UNITES_MM[m[2]!.toLowerCase()] ?? 25.4 / 96);
  };
  const l = lire("width");
  const h = lire("height");
  return l && h ? [l, h] : undefined;
}
