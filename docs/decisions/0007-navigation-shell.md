# 0007 — Navigation shell: app-shell layout, one client boundary, per-route rendering

## Status

Accepted. Partially superseded — see Update.

## Context

Phase 2.2 turns the single hero screen into four real routes behind a persistent
header and bottom tab bar. The routing itself is ordinary App Router work; four
choices around it were not specified and will be inherited by every screen added
later.

## Decisions

### The bar is pinned by layout, not by `position: fixed`

`src/app/(public)/layout.tsx` is a `h-dvh` flex column: header, a `flex-1
overflow-y-auto` main, then the nav. The obvious alternative — `position: fixed`
on the nav plus matching bottom padding on the content — needs a padding value
equal to the bar's height. That height is in `rem`, so it changes the moment a
user raises their text size, the hardcoded padding stops matching, and whatever
sits at the end of the page slides underneath the bar. This is precisely the
failure AGENTS.md §2.4 exists to prevent, and it fails silently.

As siblings in a flex column the two regions cannot overlap at any text size.
`tests/e2e/navigation.spec.ts` asserts the gap between them is `>= 0` rather
than trusting it.

The cost: the page body no longer scrolls, so mobile browsers keep their URL bar
expanded. That is a fair trade for a tab-bar app, and it is closer to how the
planned Capacitor shell (AGENTS.md §3) will behave anyway.

### `force-dynamic` stays on the map page, not on the shared layout

Route segment config is inherited, so putting it on `(public)/layout.tsx` would
drag `/schedule`, `/favorites` and `/profile` into per-request rendering for no
reason. It stays on `(public)/page.tsx`, where docs/decisions/0006 put it and for
the same reason — a build-time snapshot must never freeze a cancelled dance as
still on. Verified in the build output: `/` is `ƒ`, the other three are `○`.

A client component calling `usePathname` in the layout does **not** opt the group
out of static rendering; the three placeholder routes still prerender.

### TabBar is the only new client boundary, and takes its labels as props

The active tab has to follow the real path, so TabBar needs `usePathname` and
must be a Client Component. Everything else in the shell — AppHeader, the
placeholder screens, the whole map page — stays server-rendered.

Labels arrive as props instead of TabBar importing `he` directly. Importing the
dictionary would pull all of it into the client bundle, since a bundler cannot
tree-shake individual properties off an object literal, and that dictionary only
grows. This is the same split `DanceRingScroller` already uses (§13: follow the
existing pattern), and it keeps §2.9's "ship less JS" honest.

The route-matching rule itself lives in `src/lib/domain/navigation.ts`, not in the
component: it decides what `aria-current="page"` claims, which is a correctness
question, and §3 wants that kind of logic testable without a DOM.

### Inactive tabs are `--color-secondary`, not `--color-muted`

The task called for "a muted tone derived from the existing token set". The token
literally named `--color-muted` is 3.6:1 on surface and **fails** the 4.5:1 text
minimum — globals.css already documents it as non-text-only. `--color-secondary`
(8.9:1) is the muted-relative-to-accent tone that is actually legal for text.

Active state is additionally carried by a bar above the tab and a bolder label,
so it survives greyscale — §2.6 forbids state carried by colour alone, and that
applies to "which screen am I on" as much as to a cancelled dance.

## Consequences

- At 200% text on a 375px screen, "מועדפים" wraps mid-word. Its column is 94px
  and the word needs ~130px on one line, so it cannot fit however the padding is
  tuned. `overflow-wrap: anywhere` (not `break-word`, which browsers ignore when
  computing min-content) is what keeps it wrapping instead of pushing the whole
  page sideways. Shrinking the label below the §5 18px floor and dropping labels
  for icons alone were both rejected — §2 requires the word. A two-line label is
  the least-bad option, but it is a real cosmetic rough edge, not a clean result.
- `next.config.ts` moves the dev-tools badge to `top-left`. It defaults to
  bottom-left, directly over the last tab, where it intercepted clicks in
  `npm run dev` and `test:e2e`. Dev-only; the build is unaffected.
- `/favorites` and `/profile` sit in `(public)` and are reachable without a
  session. That matches §2.2 ("never gate reading") for now, but both will hold
  per-user data, and the question of whether they move to `(auth)` or stay public
  with an inline sign-in prompt is open — it should be decided when they get real
  content, not silently at that point.

## Update

Two things described above as current state have since changed:

- **`/favorites` no longer exists.** docs/decisions/0008 merged it into `/profile`
  as a section, dropping the tab bar to three items, to fix the 200%-text wrap
  called out as a rough edge above.
- **`/schedule` is no longer static.** docs/decisions/0009 made it `force-dynamic`
  for the same §10 cancellation-freshness reason `/` already was — so `/profile`
  is now the only public route that still prerenders, not one of three.

The reasoning above (flex-column shell, `force-dynamic` placement, TabBar as the
sole client boundary, `--color-secondary` for inactive tabs) still holds; only the
route inventory it describes is out of date.
