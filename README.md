# Lirkod (לרקוד)

Lirkod is a Hebrew-first web platform for Israel's folk-dancing community. It brings dance events, schedule changes, venue information, and instructor tools into one accessible place instead of scattering them across WhatsApp groups, Facebook pages, and separate websites.

[Live demo](https://lirkod-ten.vercel.app)

## Current capabilities

- Browse upcoming folk-dance events without creating an account
- Explore events on an interactive Google Map or in a schedule view
- Search by distance using a PostGIS proximity query
- See cancelled events and one-off venue changes without losing the original event
- Sign in with phone OTP for identity-dependent actions
- Save favorite dances and manage a personal profile
- Create recurring dances as an instructor
- Manage individual nights, venues, dance attributes, and event flyers
- Use role-aware interfaces for dancers and instructors
- Store purchase and promotion data behind restrictive database policies

Payment processing, push notifications, carpooling, and instructor analytics remain future work.

## Technology

| Area | Stack |
|---|---|
| Frontend | Next.js App Router, React, TypeScript |
| Backend | Next.js Route Handlers and Server Actions |
| Database | Supabase, PostgreSQL, PostGIS |
| Authentication | Supabase Auth with phone OTP |
| Maps | Google Maps JavaScript API and Google Places |
| Security | Row Level Security, Cloudflare Turnstile, bounded public queries |
| Testing | Vitest, Testing Library, Playwright, PostgreSQL/RLS integration tests |
| Hosting | Vercel |

## Engineering highlights

### Spatial search in PostgreSQL

Nearby events are queried in Postgres with PostGIS and `ST_DWithin`. The application sends only the requested location and radius, while the database applies distance, time-window, and row-count bounds. The API uses `POST` for precise user coordinates so they do not appear in URLs, browser history, or referrer headers.

### Recurring events with per-night overrides

Recurring dances are materialized as event-occurrence rows. A specific night can be cancelled, rescheduled, or moved to another venue without changing the entire series. This keeps schedule history explicit and makes exceptional nights visible to anonymous visitors.

### Authorization tested at the database boundary

Every application table uses Row Level Security. Dedicated integration tests verify anonymous read access, role restrictions, instructor ownership, favorites, purchases, venue management, recurring-event publishing, and other policy-sensitive flows.

### Accessible Hebrew-first interface

The interface is RTL-first and designed for an audience that includes older and less technical users. Core browsing requires no login. The project enforces large tap targets, relative font sizing, keyboard-accessible map markers, plain Hebrew labels, and visible status text instead of color-only indicators.

### Documented agent-assisted workflow

The repository includes explicit engineering constraints, architectural decision records, and separate unit, end-to-end, and RLS test suites. Coding agents are used within these documented boundaries, while changes remain reviewable through small commits, typed interfaces, database migrations, and automated tests.

## Project structure

```text
src/app/              Next.js routes, Route Handlers, and Server Actions
src/components/       UI components
src/lib/domain/       Framework-independent business logic
src/lib/db/           Typed Supabase queries
src/lib/maps/         Map adapters and location utilities
supabase/migrations/  Versioned schema, functions, grants, and RLS policies
tests/unit/            Unit and component tests
tests/e2e/             Playwright browser tests
tests/rls/             Database authorization tests
docs/decisions/        Architectural decision records
```

## Local setup

Requirements:

- Node.js
- A container runtime such as Docker Desktop, Colima, or OrbStack
- Supabase CLI

```bash
npm install
cp .env.example .env.local
npm run db:start
npm run db:reset
npm run db:types
npm run dev
```

The local Supabase command prints the URL and keys required in `.env.local`. See `.env.example` for the complete configuration and safe placeholders.

## Quality checks

```bash
npm run typecheck
npm run lint
npm test
npm run test:rls
npm run test:e2e
npm run build
```

Database and RLS tests require a running, recently reset local Supabase stack. Playwright requires Chromium, which can be installed with `npx playwright install chromium`.
