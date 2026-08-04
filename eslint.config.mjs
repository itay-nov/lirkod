import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noPhysicalRtlProperties from "./eslint-rules/no-physical-rtl-properties.mjs";
import noDefaultExport from "./eslint-rules/no-default-export.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: {
      local: {
        rules: {
          "no-physical-rtl-properties": noPhysicalRtlProperties,
          "no-default-export": noDefaultExport,
        },
      },
    },
    rules: {
      // AGENTS.md §6 — `any` is forbidden, use `unknown` and narrow it.
      "@typescript-eslint/no-explicit-any": "error",
      // AGENTS.md §7 — Hebrew-first/RTL app; physical left/right CSS breaks RTL.
      "local/no-physical-rtl-properties": "error",
    },
  },
  {
    // AGENTS.md §6 — no debug console.log, no empty catch, no default
    // exports — scoped to application code under src/.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-console": "error",
      "no-empty": "error",
      "local/no-default-export": "error",
    },
  },
  {
    // Next.js special files that require a default export.
    files: [
      "src/app/**/page.{ts,tsx}",
      "src/app/**/layout.{ts,tsx}",
      "src/app/**/route.{ts,tsx}",
      "src/app/**/error.{ts,tsx}",
      "src/app/**/loading.{ts,tsx}",
      "src/app/**/not-found.{ts,tsx}",
      "src/middleware.{ts,tsx}",
    ],
    rules: {
      "local/no-default-export": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    // Scratch space the Supabase CLI writes on `supabase start` — generated,
    // gitignored, and not ours to lint.
    "supabase/.temp/**",
  ]),
]);

export default eslintConfig;
