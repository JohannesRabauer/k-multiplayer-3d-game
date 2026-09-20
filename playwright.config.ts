import { defineConfig, devices } from "@playwright/test";

const port = 4173;
const basePath = "/k-multiplayer-3d-game/";

export default defineConfig({
  testDir: "./tests/smoke",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI === undefined ? 0 : 2,
  reporter: process.env.CI === undefined ? "list" : "github",
  use: {
    baseURL: `http://127.0.0.1:${String(port)}${basePath}`,
    trace: "on-first-retry"
  },
  webServer: {
    command: `node scripts/serve-pages-preview.mjs ${String(port)}`,
    port,
    reuseExistingServer: process.env.CI === undefined,
    timeout: 30_000
  },
  projects: [
    {
      name: "mobile-chromium",
      testMatch: "pages.spec.ts",
      use: {
        ...devices["Pixel 7"],
        isMobile: true,
        viewport: { width: 915, height: 412 }
      }
    },
    {
      name: "desktop-chromium",
      testMatch: "desktop.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 }
      }
    }
  ]
});
