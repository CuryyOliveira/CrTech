/** Build da página harness dos testes E2E (sem TanStack Start/Nitro; mesmos componentes). */
import path from "node:path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

const raiz = path.resolve(__dirname, "../..");

export default defineConfig({
  root: path.join(raiz, "tests/e2e/harness"),
  base: "/",
  plugins: [tailwindcss(), react()],
  resolve: { alias: { "@": path.join(raiz, "src") } },
  define: { "import.meta.env.VITE_CONFERENCE_V2": JSON.stringify("1") },
  build: {
    outDir: path.join(raiz, "dist-harness"),
    emptyOutDir: true,
    // WebViews mais antigos (emuladores Android): sintaxe rebaixada.
    target: ["es2017", "chrome58"],
  },
});
