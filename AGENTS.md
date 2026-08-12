# AGENTS.md — Lirkod (לרקוד)

Read this file fully before your first edit in a session. If a rule here conflicts
with a task instruction, follow this file and say so in your response.

---

## 1. What this project is

Lirkod is a platform for the Israeli folk-dancing (ריקודי עם) community. It has two
distinct user types with different needs:

- **Dancers (רוקדים)** — find a dance happening near them tonight, know instantly if it
  was cancelled or moved, arrange a ride and a partner, pay in advance instead of cash
  at the door, collect loyalty points.
- **Instructors (מרקידים)** — see how many dancers are likely to come, get demand and
  rating data, collect entrance fees through the platform instead of cash.

The problem we replace: today this information is scattered across dozens of separate
WhatsApp groups, Facebook pages, and instructor websites, and payment is cash-only.

---

## 2. Who we build for — non-negotiable constraints

**The primary dancer audience is roughly 50+ with low tech-literacy.** This is not a
soft preference; it is the main design constraint on the entire product. Every UI
decision you make is judged against it.

Hard rules:

1. **No install required for core flows.** A user must be able to tap a link inside
   WhatsApp and immediately see the map with dances near them. Do not put login,
   onboarding, or an install prompt in front of the map.
2. **Anonymous browsing first.** Auth is required only for actions that need identity:
   paying, joining a carpool, reviewing, saving favorites. Never gate reading.
3. **Phone-number (OTP) auth only.** No email/password flows. No social login.
4. **Respect OS font scaling.** Use relative units (`rem`) and never disable user zoom.
   The layout must remain usable at 200% browser text size — verify this before
   claiming a screen is done.
5. **Minimum tap target 48×48 CSS px. Minimum body text 18px.** Not 14px, not 16px.
   18px is a floor, not a literal CSS value — express it as `1.125rem` (relative to a
   16px root), never a hardcoded `px` font-size. A `px` value overrides the user's
   browser font-size setting, which violates rule 4 above.
6. **Contrast ratio ≥ 4.5:1** for all text. Never convey state by color alone (a
   cancelled dance says "בוטל", not just red).
7. **No hover-only affordances, no long-press-only actions, no swipe-only navigation.**
   Every action has a visible, tappable control.
8. **Plain Hebrew, no jargon, no English words in UI strings.** "מרקיד" not "מארגן",
   "הרקדה" not "אירוע". Match the community's own vocabulary.
9. **Performance budget:** first contentful paint under 2.5s on a mid-range Android
   over 4G. Ship less JS rather than adding a loading skeleton.

When a task is ambiguous, choose the option with fewer steps for the user, even if it
means more work for us.

---

## 3. Tech stack

Do not introduce a different framework, ORM, state manager, or UI kit without an
explicit instruction. If you believe a new dependency is necessary, stop and ask.

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router) + React + TypeScript (strict) |
| Styling | Tailwind CSS |
| Backend / DB | Supabase — Postgres + PostGIS, Row Level Security, Realtime, Storage |
| Server logic | Next.js Route Handlers / Server Actions; Supabase Edge Functions for webhooks |
| Auth | Supabase Auth, phone OTP |
| Maps | Google Maps JavaScript API; navigation handoff via deep link to Waze / Google Maps |
| Payments | Israeli gateway with hosted payment page (see §8) |
| Push | Web Push (VAPID) via service worker, with SMS fallback for critical alerts |
| Native shell (later phase) | Capacitor wrapping the same web app |
| Hosting | Vercel |
| Tests | Vitest (unit), Playwright (e2e) |

**Because a native wrap is planned, keep all business logic and data access out of React
components.** Domain logic lives in `src/lib/` and must be importable without a DOM.

---

## 4. Repository layout

```
src/
  app/                 Next.js routes (App Router)
    (public)/          Routes usable without auth — map, dance detail
    (auth)/            Routes requiring a session
    api/               Route handlers, including payment webhooks
  components/          Presentational React components only — no data fetching
  lib/
    db/                Supabase client + typed queries
    domain/            Pure business logic. No React, no fetch, no env access.
    maps/              Map adapters and deep-link builders
    payments/          Gateway adapter (interface + one implementation)
    notifications/     Push and SMS senders
  types/               Generated DB types + shared domain types
supabase/
  migrations/          SQL migrations — the only way schema changes
  functions/           Edge functions
tests/
docs/
  decisions/           ADRs — one markdown file per architectural decision
eslint-rules/          Local custom ESLint rules (no plugin package for these exists)
```

Never create a new top-level directory without asking.

---

## 5. Commands

```bash
npm run dev          # local dev server
npm run build        # production build — must pass before any task is done
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # vitest
npm run test:e2e     # playwright
npm run db:types     # regenerate src/types/database.ts from the schema
```

After any schema change, run `npm run db:types` and commit the regenerated types in the
same commit as the migration.

---

## 6. Coding standards

- TypeScript `strict`. **`any` is forbidden** — use `unknown` and narrow it. If you
  genuinely cannot type something, add `// TODO(types):` with an explanation.
- No default exports in `src/`, except Next.js special files that require one (`page`,
  `layout`, `route`, `error`, `loading`, `not-found`, `middleware`). Tooling config at
  the repo root (`next.config.ts`, `eslint.config.mjs`, etc.) is outside this rule's
  scope. Lint-enforced (`local/no-default-export`).
- Server Components by default. Add `"use client"` only when you need state, effects, or
  browser APIs — and put the smallest possible subtree in the client component.
- **Never fetch data inside a component.** Queries live in `src/lib/db/`, are typed, and
  are called from Server Components or Route Handlers.
- Functions do one thing. If a function exceeds ~50 lines, split it.
- Errors: never swallow. Either handle meaningfully or let it propagate to an error
  boundary. `catch {}` with an empty body is a bug. **Lint-enforced (`no-empty`) in
  `src/`.**
- Comments explain *why*, never *what*. Do not add comments that restate the code.
- Do not leave commented-out code, debug `console.log`, or scaffolding files behind.
  **No `console.log` (or other `console.*`) in `src/`. Lint-enforced (`no-console`).**

---

## 7. Hebrew, RTL, dates, money

- The app is **Hebrew-first and RTL**. `<html lang="he" dir="rtl">`.
- Use CSS logical properties everywhere: `margin-inline-start`, `padding-inline-end`,
  `inset-inline-start`. **Never `margin-left` / `right: 0`** — they break RTL.
- All user-facing strings go through the i18n layer. **No hardcoded Hebrew in
  components.** Keys live in `src/lib/i18n/he.ts`.
- Icons that imply direction (back, next, arrows) must mirror in RTL.
- **Times:** store `timestamptz` in UTC. Display in `Asia/Jerusalem`. Never do date math
  with raw `Date` arithmetic across DST — use the date library configured in the repo.
- **Money:** store integers in agorot (`price_agorot int`). **Never floats for money.**
  Format for display only at the edge.
- Phone numbers: store E.164 (`+9725...`). Accept common Israeli input formats and
  normalize on the way in.

---

## 8. Data, security, payments

- **Row Level Security is enabled on every table.** A new table without RLS policies is
  an incomplete task. Write the policies in the same migration.
- The `service_role` key is server-only. If you find it reachable from client code, stop
  and report it before doing anything else.
- Never trust a price, a user id, or a fee amount that arrived from the client. Re-read
  them from the database on the server.
- **Payments:** the client never talks to the payment gateway API directly. The flow is:
  server creates a payment intent → user is redirected to the gateway's hosted page →
  the gateway calls our webhook → **the webhook is the only thing that marks a payment
  as paid.** A returning user landing on a success URL proves nothing.
- Webhooks must verify the signature, be idempotent (dedupe on the gateway transaction
  id), and store the raw payload.
- Payment gateway access lives behind the adapter interface in `src/lib/payments/`.
  Gateway-specific types must not leak into domain code — we expect to change providers.
- Loyalty points are an **append-only ledger**, never a mutable counter on the user row.
  Balance is derived. This matters for refunds and disputes.
- Personal data minimization: we store what a feature needs and nothing more. Do not add
  fields "for later".

---

## 9. Maps

- The map is the hero screen. Treat its performance as a product requirement.
- Proximity queries run in Postgres using PostGIS (`geography(Point, 4326)`, GIST index,
  `ST_DWithin`). **Do not fetch all dances and filter in JavaScript.**
- Never block the first render on a geolocation permission prompt. Render a sensible
  default region first, then refine if permission is granted.
- Turn-by-turn navigation is delegated, not built. Offer Waze and Google Maps deep links
  — Waze first; it is the default for this audience in Israel.

---

## 10. Realtime and notifications

- Cancellations and venue changes are the product's most important moment. Treat that
  path as critical: it must work even if push delivery fails.
- Subscribe to Supabase Realtime for open dance detail and map views; always reconcile
  against a fresh fetch on reconnect rather than trusting accumulated events.
- Web Push has real platform limits (notably on iOS, where it requires the PWA to be
  installed to the home screen). Assume push may not reach a given user, and keep the
  in-app state correct on its own. Critical alerts fall back to SMS.

---

## 11. Definition of done

A task is not done until **all** of these pass. Run them yourself; do not report back
before you have.

1. `npm run typecheck` — clean
2. `npm run lint` — clean
3. `npm test` — passing, including tests you added
4. `npm run build` — succeeds
5. New domain logic has unit tests. New user-facing flows have at least one Playwright test.
6. New tables have RLS policies and a migration.
7. You checked the screen at 200% text size and RTL.
8. You wrote a one-paragraph summary of what changed and anything you were unsure about.

If something fails and you cannot fix it, say so explicitly. **Never report a task as
complete when a check is failing.** A clear "this is blocked because X" is more useful
than a confident wrong answer.

---

## 12. Git workflow

- One task = one branch = one git worktree. Never switch branches inside a worktree
  another agent may be using.
- Each worktree uses its own `PORT`; never share port 3000. A shared port lets a dev
  server or `npm run test:e2e` in one worktree silently attach to another branch's
  running server.
- Branch naming: `feat/<short-slug>`, `fix/<short-slug>`, `chore/<short-slug>`.
- Conventional commits: `feat(map): filter dances by radius`.
- Never commit directly to `main`. Never force-push a shared branch.
- Never commit `.env*`, keys, or credentials. If you need a new env var, add it to
  `.env.example` with a placeholder and mention it in your summary.
- Keep the diff scoped to the task. Unrelated refactors, formatting sweeps, and
  dependency bumps belong in their own task — do not bundle them.

---

## 13. Working style for agents

- **Prefer the smallest change that solves the problem.** Do not redesign surrounding
  code because you would have written it differently.
- Read before you write. Look at how a similar feature is already implemented and follow
  that pattern rather than inventing a second one.
- If the task is underspecified in a way that changes the design, ask instead of
  guessing. If it is underspecified in a small way, choose, proceed, and flag the choice
  in your summary.
- Do not invent product requirements. If a feature detail is not in the task or in this
  file, it is an open question, not something to fill in.
- Record architectural decisions as a short ADR in `docs/decisions/` when you make one.

### Never do

- Never disable a lint rule, a type check, or a failing test to make a task pass.
- Never add a dependency to solve something the stack already does.
- Never modify `supabase/migrations/` files that are already applied — write a new migration.
- Never change payment, auth, or RLS code as a side effect of an unrelated task.
- Never delete or rewrite tests you did not understand.

---

## 14. Open questions

These are unresolved. Do not implement around them silently — flag them if a task
touches them.

- Final payment gateway choice, and the legal structure for collecting fees on behalf of
  instructors (regulatory question, not a technical one).
- Recurring dances: whether occurrences are materialized rows or computed from an RRULE.
- Whether instructor analytics get their own dashboard surface or live inside the
  existing instructor screens.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
