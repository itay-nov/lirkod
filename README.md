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

## Ports across worktrees

AGENTS.md §12 uses one git worktree per task, so several dev servers can be
running on this machine at once. Each worktree must use its own `PORT` —
never rely on the shared default of 3000, or Playwright in one worktree may
silently attach to a dev server started by another branch's task instead of
its own.

```bash
PORT=3001 npm run dev
PORT=3001 npm run test:e2e
```

