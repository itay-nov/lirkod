# 0022 — Map visual pass: ring-pins and a bottom-sheet preview card

## Status

Accepted.

## Context

Phase 4.6c is a presentation-only pass over the map hero for this product's primary
audience (AGENTS.md §2 — 50+, low tech-literacy): the generic Google marker and the
plain bordered preview panel needed to feel warm and distinctive without changing any
behaviour, data, or the actions the panel already carries (favorite, Waze, Google Maps,
WhatsApp share, add-to-calendar — Phase 4.5 and 4.6a).

## Decisions

### The pin gains a ring and a centre dot, not a new silhouette

`pinAppearance.ts`'s existing circle-with-tail `SILHOUETTE`, its ink `OUTLINE`, and its
per-status glyphs (arrow for "moved", cross for "cancelled") already carry every
accessibility guarantee AGENTS.md §2.6 requires — three different silhouettes, survivable
in greyscale. Redrawing that geometry from scratch risked those guarantees for a purely
cosmetic goal. Instead, two new constants — `RING` (a paper-coloured circle stroke) and
`CENTER_DOT` (a small paper-filled circle, scheduled pins only) — are appended to all
three status bodies. `tests/unit/pinAppearance.test.ts` already asserts the three
silhouettes stay distinct and that `<path>` glyph counts stay 1/2/2 (scheduled/moved/
cancelled); both hold unchanged, because circles never touch that count.

### The selected pin is scaled and shadowed in CSS, not redrawn larger in SVG

`pinSvg()`'s own header comment is explicit that it returns a closed set of
argument-free constants — safe to assign to `innerHTML` only because nothing is ever
interpolated into it. Growing the selected pin inside that function would have meant a
fourth, size-varying dimension breaking that guarantee. `applySelectionStyle()`
(`DanceMap.tsx`) instead sets `transform: scale(1.18)` with `transform-origin: 50% 100%`
(the container's bottom-centre, which is also where `AdvancedMarkerElement` anchors its
content — see the note on `pinElement`) and a `drop-shadow` on the container `<div>`
itself. The anchor point does not move; only the pin's apparent size and depth do.

The shadow colour is `color-mix(in srgb, var(--color-ink) 35%, transparent)` rather than
a literal `rgba(43, 36, 32, 0.35)` — the exact same colour, expressed as a function of
the `ink` token instead of a fourth hex value entering the codebase.

### The action cluster: one wide pill, three tinted squares, one fallback link

The task named exactly three tinted squares — navigate, share, calendar — but the panel
already carried FIVE actions (favorite, Waze, Google Maps, share, calendar) before this
pass, and none of them could be dropped without changing behaviour. The resolution:
Waze becomes the "navigate" square (AGENTS.md §9 — it is the default for this audience
in Israel, and was already first), Google Maps keeps its own row as a plain underlined
text link below the squares — a fallback for a dancer with no Waze installed, not one of
the three primary actions. Every control keeps its existing full-sentence `aria-label`
(`wazeLabel`, `shareLabel`, `calendarLabel` — unchanged strings from Phase 4.6a) as its
accessible name; only the *visible* caption is new and short
(`he.map.preview.navigateShort`/`shareShort`/`calendarShort`). That is what let nearly
every existing `getByRole("link", { name: ... })` assertion in
`tests/unit/DanceMap.test.tsx` and `tests/e2e/map.spec.ts` keep passing unmodified — the
accessibility tree did not change, only the paint.

Two tests needed real updates, not because a guarantee weakened but because a count grew:
`tests/unit/DanceMap.test.tsx`'s and `tests/e2e/map.spec.ts`'s "Waze before Google Maps"
checks asserted `links[0]`/`links[1]` when the panel had exactly two links. It now has
five (or four, cancelled nights); both were rewritten to search by href for Waze's and
Google Maps' positions specifically and assert Waze precedes Google Maps, which is the
guarantee AGENTS.md §9 actually cares about.

### `FavoriteButton` gains a `variant` prop rather than a second component

The map panel wanted a wide filled pill; `DanceRow` and the `/profile` favorites list
still want the small round icon Phase 4.5 built. `FavoriteButton`'s own header comment
is explicit that it is "One component for all three so a filled heart means the same
thing, drawn the same way, everywhere it appears" — a second component would have broken
that on day one. `variant?: "icon" | "pill"` (default `"icon"`, so every existing call
site is unaffected) shares every line of state, the click handler, the sign-in prompt and
the error message; only the two `return` branches differ.

### The preview panel is a bottom sheet, and shares its shape with the ring list below it

Rounded top corners only, no border, edge-to-edge width, a shadow that lifts it off
whatever sits above — `rounded-t-3xl bg-surface ... shadow-[0_-2px_12px_...]` is not a
new convention: it is the exact shape `NearbyDances.tsx`'s ring-list section already
draws directly below the map. When a pin is selected, a dancer now sees two consistently
shaped "sheets" stacked with a gap, rather than the panel introducing a second visual
language of its own.

### Distance is left out; the type/level tag slot remains unused

The task asked for "venue + distance with a pin icon," but no distance-to-dancer value
exists anywhere in this pipeline — `MapDance` carries a venue's absolute coordinates, and
the `center` prop `DanceMap` receives is the DEFAULT REGION centre until a dancer
successfully locates themselves, not their real position. Computing a "distance" against
that default centre would have shown a number that reads as "how far this is from you"
while actually meaning "how far this is from Tel Aviv" — worse than showing nothing, per
the same standard the task itself set for the (also omitted) type/level tag: don't invent
data that doesn't exist. The venue line shows the pin icon and the venue name only.

## Consequences

- `MapDance` gained two fields: `danceTitle` (`he.dance.title(instructor)`, already used
  for the Phase 4.6a calendar SUMMARY, now also the panel's heading) and `timeRangeText`
  (`"weekday, start–end"`, extending `timeText` rather than replacing it — other callers
  still use the start-time-only field).
- `DanceMapLabels` gained three static fields (`navigateShort`/`shareShort`/
  `calendarShort`); `NearbyDancesLabels` gained `tagline`, threaded from
  `(public)/page.tsx` the same way every other label already is.
- `he.favorites` gained `saveShort`/`removeShort` for the pill's visible text, alongside
  the existing `add`/`remove` (unchanged, still each control's `aria-label`).
- The live-Maps-key visual verification (real pins, the preview card, RTL, 200%/375px,
  keyboard) was run and passed via Playwright's real browser (not jsdom) — screenshots
  and a keyboard Tab-order walk confirmed the ring-pin design, the selected pin's
  `scale(1.18)` + shadow, the panel's full content order, and a real 4px focus outline on
  every control. See the session's own report for the specifics; this ADR records the
  design decisions, not the verification run.
