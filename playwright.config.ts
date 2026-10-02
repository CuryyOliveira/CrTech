/**
 * Testes E2E da conferência V2 (Chromium real, IndexedDB real, Postgres de TESTE).
 *   PG_ADMIN_URL=... npx playwright test
 * O servidor de teste (tests/e2e/servidor.ts) é iniciado automaticamente.
 */
import { defineConfig, devices } from "@playwright/test";

const PORTA = Number(process.env.E2E_PORTA ?? 4173);

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORTA}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  },
  projects: [
    {
      name: "celular",
      use: { ...devices["Pixel 5"], browserName: "chromium" },
      testIgnore: /desktop\.spec\.ts/,
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 800 } },
      testMatch: /desktop\.spec\.ts/,
    },
  ],
  webServer: {
    command:
      "npx vite build --config tests/e2e/vite.harness.config.ts && npx vite-node tests/e2e/servidor.ts",
    url: `http://localhost:${PORTA}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
  },
});
