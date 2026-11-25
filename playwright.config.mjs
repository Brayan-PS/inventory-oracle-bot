import { defineConfig } from "@playwright/test";

// Pruebas de extremo a extremo con el servidor compilado (npm run build) y una base PostgreSQL
// de PRUEBA (variables PG* o DATABASE_URL). Las pruebas borran la tabla decisions de esa base,
// por eso exigen E2E_ALLOW_DB_RESET=1.
const PORT = Number(process.env.E2E_PORT ?? 3001);

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 45000,
  globalSetup: "./tests/e2e/global-setup.mjs",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 1000 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  webServer: {
    command: "node .output/server/index.mjs",
    url: `http://localhost:${PORT}/health/ready`,
    reuseExistingServer: false,
    timeout: 60000,
    env: { PORT: String(PORT), HOST: "127.0.0.1", NODE_ENV: "production", GEMINI_API_KEY: "" },
  },
});
