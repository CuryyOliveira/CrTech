/**
 * Homologação local: app REAL (V1 e V2.1) + Supabase local. Ver tests/homologacao/README.md.
 * Nunca roda contra produção (ambiente.ts recusa URLs que não sejam locais).
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "../../test-results/homologacao.json" }]],
  use: {
    locale: "pt-BR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "../../test-results/homologacao",
});
