# 0008 — Favorites merges into /profile instead of staying a fourth tab

## Status

Accepted. Corrects docs/decisions/0007, not a new feature.

## Context

docs/decisions/0007 shipped a four-tab bar (מפה, לוח, מועדפים, שלי) and flagged,
as a known rough edge, that "מועדפים" wraps mid-word at 200% text size on a
375px phone — its column is 94px and the word needs ~130px on one line, and no
amount of padding tuning changes that arithmetic. This corrects the shape of
the bar rather than continuing to patch around that constraint.

## Decision

Favorites is no longer its own route or tab. `/favorites` is deleted. TabBar
drops to three items: מפה, לוח, שלי. `/profile` renders a labeled "מועדפים"
section (an `<h2>`) alongside its own existing placeholder content (an `<h1>`).

## Why this, not a smaller fix

The 200% failure was arithmetic, not styling: four roughly-equal-width Hebrew
labels in a 375px bar leaves ~94px per column, and "מועדפים" needs more than
that on one line no matter the font-size floor (§5 already fixes body text at a
non-negotiable 18px/`1.125rem`) or the padding around it. Shrinking the tab
count is what actually resolves it — three labels give each column ~125px,
comfortably enough for the widest of the three ("מפה" included) even at 200%.
Measured directly against a live instance (Range.getClientRects() per label,
the same method that first surfaced the four-tab wrap): every label now renders
as exactly one line at 200% on a 375px viewport, and `document.documentElement
.scrollWidth === clientWidth` — no wrap, no horizontal scroll.

Favorites and Profile are also naturally adjacent from a product standpoint —
both are "your stuff" screens, both need identity — so folding one into the
other as a section is not a forced pairing.

## Auth boundary — restated, not decided here

`/profile` (now also carrying favorites) stays in `(public)`. AGENTS.md §2.2
requires auth only for actions that need identity, not for reading; a route-group
redirect would bounce an anonymous visitor away before the page — which could
explain what the screen is and offer to sign in — ever renders. Phone-OTP auth
(§2.3) does not exist yet, so no session check is implemented; a comment in
`src/app/(public)/profile/page.tsx` marks where an inline "is there a session?"
check belongs once it does. This is the same reasoning §2.2 already implies, not
a new call — restated here because merging favorites in makes the page's
eventual identity requirement more visible, not because the requirement changed.

## Consequences

- `he.nav.favorites` is removed (no longer a nav label). `he.favorites.heading`
  stays — it is now the `<h2>` for the merged section.
- `tests/e2e/navigation.spec.ts`'s 200%-text test now asserts zero wrapped
  labels directly (via `Range.getClientRects().length`), not only "not
  clipped" — the four-tab wrap was never a clipping bug, which is why the
  original clipping-only check passed straight through it undetected.
- Whether `/profile`'s two sections eventually become two routes again once
  each has real content (a dedicated `/favorites` once there is something to
  paginate or filter, say) is an open question, not decided by this ADR either
  way — this is about fixing today's fixed-viewport bug, not a permanent
  information-architecture commitment.
