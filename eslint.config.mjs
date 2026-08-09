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
    //
    // "**/", not a bare ".next/**": in ESLint flat config, an ignores pattern
    // with no "**/" prefix is anchored to the config root, so it only ever
    // matched a .next sitting directly there. Any nested checkout — e.g. a
    // sibling git worktree under .claude/worktrees/ with its own .next from a
    // dev/build run — fell straight through it and got linted as source,
    // compiled JS bundles included (18k+ bogus problems, confirmed live).
    "**/.next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    // Isolate worktrees: nothing in another task's isolated working directory
    // should ever be scanned from the main repo, regardless of what build tool
    // or CLI (supabase, next, vitest, playwright, …) puts what there.
    ".claude/worktrees/**",
    // Scratch space the Supabase CLI writes on `supabase start` — generated,
    // gitignored, and not ours to lint. Needed in ADDITION to the pattern
    // above: that one excludes *other* worktrees' scratch space when linting
    // from the main repo checkout, but it does not match THIS worktree's own
    // `supabase/.temp/**`, which sits directly under its root rather than
    // nested inside a `.claude/worktrees/**` path relative to itself. Dropped
    // once already (accidentally, alongside the fix that added the pattern
    // above) and confirmed to reintroduce ~150 bogus problems from a Deno
    // runtime bundle the moment `supabase start` has run in this checkout.
    "supabase/.temp/**",
  ]),
]);

export default eslintConfig;
