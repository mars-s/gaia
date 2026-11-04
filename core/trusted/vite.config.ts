import { resolve } from "node:path";
import { defineConfig } from "vite";
export default defineConfig({
  root: resolve("apps/web"),
  resolve: { alias: { "@": resolve("apps/web") } },
  build: { outDir: resolve("dist/web"), emptyOutDir: true },
});
