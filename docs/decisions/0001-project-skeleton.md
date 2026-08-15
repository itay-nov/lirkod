# 0001 — Project skeleton choices

## Status

Accepted. The "no `next/font`" decision below is historical — see Update.

## Context

Initial scaffold of the Next.js app (App Router, TS strict, Tailwind), before any
Supabase, database, or map code exists. A few choices weren't specified by the task
or by AGENTS.md and needed a decision to move forward.

## Decisions

- **RTL lint rule is a local custom ESLint rule** (`eslint-rules/no-physical-rtl-properties.mjs`),
  not a published plugin — no existing plugin flags physical Tailwind utilities
  (`ml-`, `mr-`, `left-`, `right-`) and physical inline `style` keys together. It only
  inspects string/template literals directly in `className`/`class` JSX attributes and
  object literals passed to a `style` attribute — it does not trace `clsx()`/`cn()`
  calls, variables, or `.css` files.
- **No `next/font` / Google Fonts** in the root layout. The default create-next-app
  template wires up Geist via `next/font/google`, which fetches at build time; removed
  to keep the skeleton dependency-free and avoid a network requirement during build.
  `font-family` falls back to the system sans stack in `globals.css`.
- **`src/lib/i18n/he.ts`** was added (a subdirectory of the already-specified `src/lib/`)
  to hold the one placeholder string, per AGENTS.md §7 ("No hardcoded Hebrew in
  components"). It only has one key so far — this is not a full i18n solution.
- **Test layout**: `tests/unit/` for Vitest, `tests/e2e/` for Playwright. AGENTS.md §4
  lists a bare `tests/` directory without specifying substructure.
- **Playwright's `webServer` runs `npm run dev`**, not a production build, so
  `test:e2e` stays fast. This should be revisited once there's a real CI pipeline
  that wants to test against a production build.

## Update

docs/decisions/0006 brought a second typeface (Rubik) in via `next/font/local`,
vendored the same way as Heebo. This does not reopen the decision above: the
objection was to `next/font/google` fetching at build time, not to `next/font`
itself, and `next/font/local` needs no network access. Recorded here so the two
ADRs don't read as contradictory.
