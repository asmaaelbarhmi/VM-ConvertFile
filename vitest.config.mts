import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // Les tests lisent les sources directement, sans compilation préalable
    alias: {
      "@atelier/stitch-core": src("./packages/stitch-core/src/index.ts"),
      "@atelier/image": src("./packages/image/src/index.ts"),
    },
  },
  test: { include: ["packages/*/test/**/*.test.ts", "web/test/**/*.test.ts"] },
});
