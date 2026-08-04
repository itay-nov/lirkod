import path from "node:path";
import { defineConfig } from "vitest/config";

// Separate from vitest.config.ts on purpose: these tests need a running local
// Supabase stack (`npm run db:start`), so they must not be part of the hermetic
// `npm test` loop. Run them with `npm run test:rls`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rls/**/*.test.ts"],
    // One shared Postgres — parallel files would let fixtures collide.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
