# 0005 — The proximity query is a Postgres function, not a view or a client-side join

## Status

Accepted.

## Context

`findDancesNear(lat, lng, radiusMeters)` needs to return, in one anonymous read: the
occurrence, its status, the *resolved* venue (docs/decisions/0003 —
`coalesce(override_venue_id, dance_events.venue_id)`, not a plain join on
`dance_events.venue_id`), the instructor's public name, and the dance's price — filtered
by `ST_DWithin` against a caller-supplied point and radius.

## Decision

`public.find_dances_near(p_lat, p_lng, p_radius_meters)`, a `language sql stable`
function, called via `client.rpc(...)` from `src/lib/db/dances.ts`. It carries no
`security definer` — it runs as the caller (`anon` from the public map), so it reaches
exactly the rows RLS already allows that role to read, no more.

## Why not a view

A view has no parameters. The radius and the query point are per-request, so a plain
view would need every caller to re-supply the `ST_DWithin` filter through PostgREST's
query string — but PostgREST's filter syntax has no spatial operators, and building the
`coalesce(override_venue_id, venue_id)` join is not expressible as a `.select()` chain
either. A function is the only place both the join and the parameters can live together.

## Why not fetch-then-filter in JS

Explicitly forbidden by AGENTS.md §9. It would also mean shipping every future
occurrence's row to the client just to discard most of them, on the product's
performance-budgeted hero screen (§9, §2.9).

## Consequences

- `src/types/database.ts` must be regenerated (`npm run db:types`) whenever this
  function's signature or return columns change — it is schema, same as a table.
- The function is unfiltered by `status` on purpose: a cancelled or moved night still
  has to reach an anonymous visitor with its status intact, so the map can render the
  required "בוטל"/"הועבר" label instead of silently vanishing (§10).
