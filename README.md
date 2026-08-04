# Lirkod (לרקוד)

A platform for the Israeli folk-dancing (ריקודי עם) community. See `AGENTS.md` for
the full product context, constraints, and coding standards — read it before making
changes.

The schema for the core read path exists (migration `0001`). No map or UI integration yet.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in real values
```

The local Supabase stack runs in containers, so you need a container runtime. Any of
Colima, Docker Desktop, or OrbStack works — with Colima:

```bash
brew install colima docker
colima start --cpu 4 --memory 8 --disk 60   # once per machine; re-run after a reboot
```

Then:

```bash
npm run db:start     # supabase start — prints the local API URL and keys
npm run db:types     # regenerate src/types/database.ts from the running schema
```

Copy the `API_URL` and `anon key` it prints into `.env.local`.

## Commands

```bash
npm run dev          # local dev server
npm run build        # production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # vitest (unit) — hermetic, no database needed
npm run test:e2e     # playwright (e2e) — starts the dev server automatically
npm run test:rls     # RLS policy tests — needs the local stack running
npm run db:start     # start the local Supabase stack
npm run db:stop      # stop it
npm run db:reset     # drop, recreate, and re-apply every migration
npm run db:types     # regenerate src/types/database.ts
```

`npm run test:e2e` uses Chromium, installed via `npx playwright install chromium`.

## Database

`npm run test:rls` is deliberately **not** part of `npm test`. It needs a running
Postgres, and `npm test` should stay hermetic and fast. Run it after any change to a
migration, a policy, or a grant — it is the only thing that proves an anonymous
visitor can still read the map (AGENTS.md §2.2) and that one instructor still cannot
cancel another instructor's dance.

After any schema change: write a **new** migration (never edit an applied one),
then `npm run db:reset && npm run db:types && npm run test:rls`, and commit the
regenerated types alongside the migration.

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

