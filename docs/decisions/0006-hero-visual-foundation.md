# 0006 — Hero screen visual foundation: tokens, fonts, and a non-prerendered route

## Status

Accepted.

## Context

Phase 2.1 puts the first real screen in front of a dancer: a design-token palette,
a second typeface for headings, and the home route wired to `findDancesNear()`. The
map itself is a later task. A handful of choices here were not specified and will be
inherited by every screen built afterwards, so they are worth writing down.

## Decisions

### Colour tokens are named for their role, not their hue

`--color-surface`, `--color-ink`, `--color-accent`, `--color-secondary`,
`--color-highlight`, plus a derived `--color-muted`. Components reference the role.
The literal hexes appear exactly once, in `src/app/globals.css`, each with its
measured contrast ratio against the surface in the comment above it.

Two of them **fail** 4.5:1 as text colours and this is recorded next to the values so
the next person does not have to re-measure: `--color-highlight` (gold, 2.2:1) is a
fill to put ink on top of, never a text colour; `--color-muted` (3.6:1) is for
non-text strokes only. The "הועבר" badge is gold-filled with ink text (6.5:1); the
cancelled ring is muted, but its "בוטל" label is ink.

### No dark mode

The scaffold's `prefers-color-scheme` block is removed rather than extended. The
palette is a warm paper look that a naive inversion wrecks, and a second theme
doubles the surface that must be verified at 200% text size (AGENTS.md §2.4). One
theme that is actually checked beats two that are not. Revisit deliberately, not by
adding a `@media` block to an existing screen.

### Rubik for headings, vendored like Heebo

Loaded with `next/font/local` from `src/app/fonts/`, not `next/font/google` — same
reason as Heebo in docs/decisions/0001: the build must never need network access.
Rubik has a real Hebrew design rather than a Latin face with a fallback, which is the
same reason Heebo was chosen for body text. Its licence sits beside it as
`Rubik-OFL.txt`; `OFL.txt` was renamed to `Heebo-OFL.txt` now that two fonts share
the directory.

### The home route is `force-dynamic`

A cancellation or a venue change is the product's most important moment (AGENTS.md
§10). A build-time prerender of the occurrence list would show a cancelled dance as
still on for as long as the deployment lives — the exact failure docs/decisions/0003
built a database constraint to prevent. The route is therefore never statically
generated. It also keeps `npm run build` from needing a database.

### The map area is empty, not decorated

The placeholder is a flat region with a label and no sample pins. A pin's position on
a map is data; fake pins would put wrong geography on the hero screen, and the rings
below already show the real query result.

## Consequences

- `tests/e2e/home.spec.ts` now needs a running, recently-reset local Supabase stack,
  unlike the rest of `test:e2e`. Noted in the spec file and in the README.
- `supabase/seed.sql` gained one `moved` and one `cancelled` occurrence so the three
  ring states can be checked against real rows. They are placed where
  `tests/db/proximity.test.ts` cannot see a behaviour change — see the comment in the
  seed file.
- Nothing on this screen ships JavaScript: `DanceRing` is a Server Component with no
  `"use client"`. That is deliberate headroom against the §2.9 performance budget,
  and wiring the ring to the dance detail route should not spend it — a link or a
  server action, not a client-side handler, if that is possible then.

## Open

The ring list scrolls horizontally, which AGENTS.md §2.7 ("no swipe-only navigation")
sits uncomfortably close to. Mitigated for now by sizing rings so the next one is
half-visible, which is the cue that there is more; a visible previous/next control is
the honest fix if this audience is observed missing dances past the fold.
