import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Sous-chemin de publication (GitHub Pages : /NomDuDepot/), racine en local
  base: process.env.BASE_URL ?? "/",
  resolve: {
    // Les paquets sont lus directement depuis leurs sources TypeScript
    alias: {
      "@atelier/stitch-core": src("../packages/stitch-core/src/index.ts"),
      "@atelier/image": src("../packages/image/src/index.ts"),
    },
  },
  worker: { format: "es" },
  build: { target: "es2022", outDir: "dist" },
  server: { port: 5173 },
});
