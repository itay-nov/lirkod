import { defineConfig, devices } from "@playwright/test";

// Port 3000 is the shared default because it is the origin allowlisted for the
// browser Maps key. PORT remains an explicit escape hatch for parallel worktrees;
// reuseExistingServer=false makes an accidental collision fail instead of testing
// whichever branch happened to start first.
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
