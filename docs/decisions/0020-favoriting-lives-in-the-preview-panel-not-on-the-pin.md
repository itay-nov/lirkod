# 0020 — Favoriting lives in the map's preview panel, not on the pin itself

## Status

Accepted. Resolves, for this feature, one of the two items [0011](./0011-live-map-and-pin-preview.md)
left open.

## Context

Phase 4.5 asks for a heart toggle "on the map pin, the schedule card, and the dance
detail". This codebase has no dedicated dance-detail route — 0011 explicitly left open
"whether the preview panel becomes the dance detail route
(`(public)/dance/[occurrenceId]`), or stays an inline summary that links to it." There
is still no such route. The preview panel — opened by tapping or activating a pin — is
the only surface today that shows one dance's full information on its own, which makes
it the closest thing to "the dance detail" this codebase has.

## Decision

The heart lives in the preview panel. Tapping a pin opens the panel; the heart is in it,
next to the status pill. Nothing is added to the pin's own SVG.

Read literally, the task names three locations. In this codebase they collapse to two:
the schedule row (`DanceRow`), and the panel, which serves as both "the map pin" (it is
what tapping the pin opens) and "the dance detail" (it is the only per-dance detail
surface that exists).

## Why not the pin itself

The pin is an `AdvancedMarkerElement` with `gmpClickable: true` — the whole content
element is one focusable, Enter/Space-activatable control (0011). Nesting a second real
`<button>` inside that content would mean a button inside a button: invalid ARIA, and
broken for a keyboard user specifically, since there is no second tab stop for an inner
control the library did not put there — Enter on the marker fires `gmp-click` for the
whole element, not for whichever sub-region a pointer happened to land on.

It also fails on size before it fails on semantics. Pins are 52×66 CSS px — already only
just over the 48px tap-target floor (AGENTS.md §5) as ONE control. A second, smaller
interactive region inside that footprint has no room to also clear 48px, and 0011
already documents that two pins at the same coordinates already fight over one pointer
target; adding a second control inside a single pin's already-cramped hit area is the
same failure mode one level down.

None of this is specific to hearts — it is why the pin has exactly one job today and the
panel exists at all.

## Consequences

- A guest tapping a pin still reaches a heart — inside the panel, after the tap that
  already opens it — so nothing about the favoriting flow is harder to reach than before
  this decision; it is one panel-open away from the pin, same as every other pin action
  (Waze, Google Maps, close).
- `MapDance` and `NearbyDance` both gained `eventId` (migration 0012's `find_dances_near`
  and the new `find_favorite_nights` both return it) — favoriting acts on the SERIES
  (`dance_events`), never the occurrence, so a favorite keeps meaning "this recurring
  dance" as the generator materialises nights ahead of it (docs/decisions/0002).
- This does not resolve 0011's open question about a real detail route. If one is built
  later, the heart's natural place moves there with it — nothing here is written as if
  the panel is permanent.
- `DanceRow` gains an optional `action` slot (Phase 4.5) rather than becoming interactive
  on its own account. It stays exactly the non-interactive component 0009/0011 describe
  when a caller does not pass one; the schedule page is the only caller that does, and
  what it passes — a `FavoriteButton` — is a real, fully-functional control, not the
  premature "detail route" button that comment on `DanceRing` warns against building
  again before there is somewhere for it to go.
