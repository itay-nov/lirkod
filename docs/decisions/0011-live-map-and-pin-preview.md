# 0011 — The hero map: one lazy client boundary, focusable pins, and a preview panel

## Status

Accepted.

## Context

Phase 2.4 replaces the flat placeholder from [0006](./0006-hero-visual-foundation.md)
with a live Google map: real pins for the dances `findDancesNear()` already returns, a
preview when a pin is chosen, navigation handed off to Waze, and geolocation behind an
explicit control. The map is the product's hero screen (AGENTS.md §9), and the audience
it is for (§2) rules out several implementations that would otherwise be obvious.

## Decisions

### `DanceMap` is the only new client boundary, and it receives strings, not data

Same discipline as `TabBar` and `DanceRingScroller` ([0007](./0007-navigation-shell.md)).
Everything else on the route — the heading, the ring list, the schedule — stays
server-rendered.

Labels arrive as props rather than by importing `he`, because a bundler cannot
tree-shake individual properties off an object literal. The dances arrive as `MapDance`
(`src/lib/maps/mapDance.ts`), a view model where the time is already formatted, the
status word already resolved and both navigation URLs already built. So the browser
ships no `Intl` formatter setup, no dictionary, and no URL builders — and, more
usefully, the map page and the "near me" route handler produce that shape through the
same function, so the two paths cannot drift.

### The API is fetched after first paint, and the map is an enhancement

`loadGoogleMaps` injects the script from an effect scheduled with `requestIdleCallback`
(2s timeout backstop), not from the document head and not via a pre-hydration
`next/script`. Several hundred kilobytes of third-party JavaScript on the critical path
is exactly what §2.9's 2.5s budget on a mid-range Android forbids.

A missing key, a blocked script or a dead network leaves the region saying so in Hebrew
with every dance still listed below. The map is never a precondition for the screen —
unlike the Supabase client, which throws, because without dances there is nothing to
show at all.

### Pins are `AdvancedMarkerElement`, which is why a keyboard can use them

`gmpClickable: true` is what puts a marker in the tab order with `role="button"` and
makes Enter/Space raise `gmp-click`. That one flag is the whole difference between a map
anyone can use and a mouse-only one, and §2.7 does not allow the second. The listener is
`addEventListener("gmp-click", …)`: the library warns that the older `click` is legacy,
and `gmp-click` is the event it raises for keyboard activation.

The cost is real and worth stating: advanced markers refuse to render without a **Map
ID**. `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` is new, and unset it falls back to Google's public
`DEMO_MAP_ID`, which works but carries no cloud styling and is not meant for production.
A project-owned id belongs there before launch.

### Status is carried by silhouette, edge and words — never by colour

`pinAppearance.ts` deliberately mirrors `danceStatusAppearance.ts` rather than inventing
a second visual language: gold with a dashed edge means "הועבר" on the map exactly as it
does on the rings and the schedule, ink-on-paper means "בוטל" in both. Three non-colour
cues carry the state (§2.6): the glyph inside the pin (none / arrow / X), the dashed
versus solid edge, and the marker's accessible name, which spells the status out in
words. Any one survives a greyscale screenshot.

Pins are 52x66 CSS px — over the 48px tap-target floor (§5) on their own, in fixed px
rather than rem, because this is a graphic sized for a thumb rather than text that must
double at 200%.

### The preview is our own panel, not a Google InfoWindow

An InfoWindow anchored to the pin is the more obvious choice and was rejected. It is
Google's DOM inside Google's overlay, sized against the map viewport — and this app has
to stay usable at 200% text on a 375px screen (§2.4), where a bubble that grows
vertically inside a 40dvh map is exactly the thing that gets clipped. A panel in normal
flow below the map has none of that risk, gives us real 48px controls, real focus
management and ordinary RTL layout.

What the panel gives up is the spatial tie between bubble and pin. That is paid back by
the selected pin getting a ring, and by focus moving into the panel when a pin is
activated — a keyboard user lands on what just opened rather than being left on the map
while content appears somewhere below. Closing returns focus to the pin.

### Geolocation is asked for by a button, and the answer never reaches a URL

Nothing on this screen touches `navigator.geolocation` until a dancer presses "הצגת
הרקדות לידי" (§9 — never block first render on a permission prompt; this never prompts
at all until asked). Refusal, an unavailable sensor and a timeout all produce one plain
sentence, because they differ only in a cause the dancer cannot act on.

Granting re-queries through `POST /api/dances/near`. A route handler because §6 keeps
queries out of components; **POST** rather than GET because the body carries the person's
actual position, and on a GET that lands in browser history, the `Referer` header and
every access log in between. It adds no exposure — `anon` may already call
`find_dances_near` directly, bounded by migration 0003 — it is just the same query
reached without writing someone's location into a URL.

The map and schedule now expose the same four radius choices: 5, 15, 30 and 50km.
The current choice is preserved when location is granted, so the dancer — rather than
the application — decides how far is reasonable. The precise position still travels
only in the existing POST body and never in the URL. Migration 0003's independent
50km clamp, 60-day horizon and 200-row cap remain the security boundary.

### The Maps type surface is hand-written

`src/types/google-maps.d.ts` declares the two dozen members we touch instead of adding
`@types/google.maps`. The package would be dev-only and harmless, but declaring the
surface locally means reaching for an API that is not in it fails to compile, so what we
depend on cannot grow silently. If that file ever becomes real maintenance, swapping to
DefinitelyTyped is a one-line change.

### The map is constructed through a `ResizeObserver`

Found the hard way, and worth recording because the failure is silent. The library
measures its container once at construction and never recovers if that measurement was
zero — tiles paint fine once the box gets its size, so the map *looks* right, but it
never finishes initialising and not a single marker is ever attached. Verified on a live
map reporting `renderingType: UNINITIALIZED` with four markers created and none of them
in the document.

A 0x0 container is not exotic: it is what a background tab reports, and a link tapped in
WhatsApp — the product's main entry point (§2.1) — can land in exactly that state.
Observing the container and building on the first non-zero size covers both that and the
ordinary case in one path.

## Consequences

- New env var `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`, documented in `.env.example`.
- `tests/e2e/map.spec.ts` drives the real Maps library, so it needs the dev server on an
  origin the API key's HTTP-referrer allowlist includes. Port 3000 is the repository
  default and its exact localhost origin is allowlisted. A deliberate `PORT` override
  also needs its exact origin added to that allowlist.
- **Two dances at one hall put two pins at identical coordinates, and the upper one
  takes every tap meant for the lower.** Keyboard reaches both — they are separate tab
  stops — but a pointer cannot. Clustering or fanning out co-located pins is its own
  task and is not attempted here; `topPin()` in the spec exists because of it.
- `he.dance.ringLabel`, removed when `DanceRing` stopped being a control, is back as
  `he.dance.mapPinLabel`. A pin is a real control that announces as one thing, which is
  the condition that made the string worth having in the first place.
- The default region is still framed from the pins via `fitBounds`, so a dense area and
  a sparse one both arrive usable. Nothing here changes the query, its 60-day horizon or
  its 200-row cap.

## Open

- Co-located pins, above.
- Whether the preview panel becomes the dance detail route
  (`(public)/dance/[occurrenceId]`) or stays an inline summary that links to it. The
  panel deliberately carries only what a dancer needs to decide whether to go and how to
  get there; price, dance types and everything else were left out rather than guessed at.
- Nothing rate-limits the map's API usage. The key's referrer restriction is the only
  control today, and it is configuration rather than code. (The *proximity query* has
  since gained a partial per-IP limit on its route —
  [0012](./0012-partial-rate-limiting-on-the-near-route.md) — which does not cover
  Google's API at all.)
- `DanceMap` does not own the dances it draws. `NearbyDances` does, and hands the same
  array to the map and to the ring list, because a located result that reached only one
  of them left the two describing different regions. The map is a renderer here, not a
  store.
