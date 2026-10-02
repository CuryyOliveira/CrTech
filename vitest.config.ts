import path from "node:path";
import { defineConfig } from "vitest/config";

// Testes automatizados (independentes do build do app, que usa vite.config.ts).
//   npm test            -> unitários + banco (o banco precisa de PG_ADMIN_URL)
//   npm run test:unit   -> só unitários
//   npm run test:db     -> só banco (RLS, isolamento, integridade, regressão, idempotência)
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/db/global-setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
