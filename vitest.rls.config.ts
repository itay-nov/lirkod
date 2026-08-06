import path from "node:path";
import { defineConfig } from "vitest/config";

// Separate from vitest.config.ts on purpose: these tests need a running local
// Supabase stack (`npm run db:start`), so they must not be part of the hermetic
// `npm test` loop. Run them with `npm run test:rls`.
//
// tests/db/** lives here too, not because it tests RLS policies, but because it
// needs the same live stack — including the seed data loaded by `db reset`.
// `db:start` alone is NOT enough for tests/db/**: those assert against rows from
// supabase/seed.sql, which is only (re)loaded by `npm run db:reset`. Run
// `npm run db:reset` before `npm run test:rls` if you haven't recently, or if tests
// in tests/db/** start failing — the seeded occurrences' starts_at values are only a
// few days in the future, so a failure days after the last reset is stale seed data
// aging past `now()`, not a regression.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rls/**/*.test.ts", "tests/db/**/*.test.ts"],
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
