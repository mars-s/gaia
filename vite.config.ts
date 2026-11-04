import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
const serverPort = Number(process.env.GAIA_PORT ?? 4318);
export default defineConfig({
  root: "apps/web",
  resolve: {
    alias: { "@": fileURLToPath(new URL("./apps/web", import.meta.url)) },
  },
  server: {
    port: Number(process.env.GAIA_WEB_PORT ?? 4317),
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${serverPort}`,
      "/healthz": `http://127.0.0.1:${serverPort}`,
    },
  },
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
