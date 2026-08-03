# Lirkod (לרקוד)

A platform for the Israeli folk-dancing (ריקודי עם) community. See `AGENTS.md` for
the full product context, constraints, and coding standards — read it before making
changes.

This is currently a project skeleton: no Supabase, database, or map integration yet.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in real values once they exist
```

## Commands

```bash
npm run dev          # local dev server
npm run build        # production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # vitest (unit)
npm run test:e2e     # playwright (e2e) — starts the dev server automatically
```

`npm run test:e2e` uses Chromium, installed via `npx playwright install chromium`.
