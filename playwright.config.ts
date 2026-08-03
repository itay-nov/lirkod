import { defineConfig, devices } from "@playwright/test";

// One git worktree per task (AGENTS.md §12) means several dev servers can be
// running on this machine at once. Default to 3000, but let each worktree
// override via PORT so Playwright never attaches to another branch's server.
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
