import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // Default to "node" so a global jsdom can't hide a src/lib/domain file
    // that accidentally depends on the DOM (AGENTS.md §3). Component tests
    // opt into jsdom individually via a `// @vitest-environment jsdom`
    // docblock at the top of the file.
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/unit/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
