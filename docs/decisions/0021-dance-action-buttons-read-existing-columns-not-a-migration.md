# 0021 — WhatsApp share, navigate and add-to-calendar read existing columns, not a new migration

## Status

Accepted.

## Context

Phase 4.6a adds three action buttons to the map's preview panel (the surface
[0020](./0020-favoriting-lives-in-the-preview-panel-not-on-the-pin.md) already
established as this product's per-dance detail): a WhatsApp share message, the
Waze/Google Maps navigation already there, and an add-to-calendar entry for the
specific night.

The share message and the calendar entry need two fields `NearbyDance` did not
carry: the venue's street address and the occurrence's end time. Both already
exist in the schema — `venues.address` and `event_occurrences.ends_at` — but
neither `find_dances_near` nor `find_favorite_nights` (migration 0012) returns
them, and the task explicitly ruled out a new migration.

## Decision

`findDancesNear` and `findFavoriteNights` (`src/lib/db/dances.ts`) each run one
extra batched step after the RPC: `attachNightDetails` looks up `venues.address`
by the distinct venue ids in the result and `event_occurrences.ends_at` by the
occurrence ids, and merges both onto `NearbyDance`. Two more bounded,
primary-key-indexed queries, not a fetch-then-filter — the row counts are the
same 200-row cap `find_dances_near` already carries, and neither table gains a
policy it did not already have: `venues_select_public` and
`event_occurrences_select_anon_horizon`/`_select_authenticated` already let an
anonymous or signed-in caller read exactly these columns directly.

## Why not widen the RPCs instead

`find_dances_near`'s `RETURNS TABLE` cannot be widened with `CREATE OR REPLACE`
— migration 0012 itself had to `DROP` and recreate the function for the same
reason when it added `event_id`. That is a migration, which this task's scope
explicitly excludes ("NO new DB, NO migration, NO write path"). The two extra
queries are the version of "read data already on the dance/night" that fits
inside that constraint.

## Consequences

- `MapDance` gained `shareUrl`/`shareLabel` and `icsUrl`/`icsFilename`/
  `calendarLabel`, built server-side in `toMapDance` the same way `wazeUrl` and
  `googleMapsUrl` already are — the client renders plain links, no formatting
  or Hebrew string assembly happens in the browser (the same discipline the
  file's own header comment describes).
- `venueAddress` and the raw `endsAt` instant are consumed inside `toMapDance`
  and never appear on `MapDance` itself — `tests/unit/mapDance.test.ts` already
  asserts that no raw ISO timestamp survives onto that shape, and this holds it
  for the new fields too.
- A cancelled night gets `icsUrl: null` — DanceMap.tsx does not render the
  calendar link at all when it is null, rather than emitting a calendar entry
  for a dance that is off. The WhatsApp share link is unaffected: the message
  still names the cancellation in words (`he.dance.status.cancelled`), and
  telling someone a night is off is still a reason to share it.
- If the map ever needs more columns this way, the same `attachNightDetails`
  pattern is the one to extend — a third batched-by-id query, not a third
  ad-hoc fetch scattered elsewhere.
