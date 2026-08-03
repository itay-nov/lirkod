import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noPhysicalRtlProperties from "./eslint-rules/no-physical-rtl-properties.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: {
      local: {
        rules: {
          "no-physical-rtl-properties": noPhysicalRtlProperties,
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
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
