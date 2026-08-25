# 0026 — One read window out of the payments schema, and the boost is applied outside it

## Status

Accepted. Extends docs/decisions/0025.

## Context

A paid sponsored promotion should lift its dance up the public schedule. Two facts make
that harder than it sounds.

**The data is locked.** docs/decisions/0025 established that the payments tables have no
client grant at all: `anon` holds nothing on `public.sponsored_promotions`, and
`authenticated` reaches only an instructor's own rows. The schedule is anonymous
(AGENTS.md §2.2), so it cannot read the table, and must not be handed a way to.

**The schedule is not a ranking.** The task described the boost as affecting
"location/proximity search results," suggesting a virtual distance reduction. The
schedule has no such thing: `find_dances_near` returns `order by starts_at` (migration
0003), `groupDancesByDay` preserves that order, and no distance is ever returned or
ranked on — only `venue_lat`/`venue_lng`, for drawing pins. There is no distance to
reduce.

**The map and the schedule are the same query.** `(public)/page.tsx`, the
`/api/dances/near` route handler, and `(public)/schedule/page.tsx` all call
`findDancesNear`. The confirmed product decision is that the map's order does not change,
so the boost cannot live in that RPC.

**There is no shared notion of an area.** Migration 0016's `sponsored_promotions.area` is
free text compared with `=`. Nothing on the read side has an area string: `public.venues`
carries name, address, `place_id` and a geography point, and no area or city column. The
schedule asks by (lat, lng, radius).

## Decision

**One SECURITY DEFINER function, returning one column.**
`public.get_active_promoted_event_ids(p_area text default null)` returns `event_id` and
nothing else — no price, order id, buyer, instructor, payout, fee, window, or area. It is
`language sql`, a single `SELECT`, and `stable`, so Postgres itself refuses to let it
write and there is no statement list a later edit can quietly extend. `search_path` is
pinned; `EXECUTE` is revoked from `PUBLIC` (and therefore `service_role`, per 0006's
reasoning) and granted to `anon` and `authenticated`.

The `RETURNS TABLE` is the allowlist, and `tests/rls/promotedBoost.test.ts` asserts the
returned row's keys are exactly `["event_id"]`, so widening it fails a test rather than
shipping a price in a network response.

**The ids it returns are already public.** `dance_events_select_public` is `using (true)`
and `anon` holds SELECT, so every uuid this can emit is one an anonymous caller can
already read from PostgREST. The genuinely new disclosure is one bit per public dance:
promoted, or not. That bit is the feature.

**Paid, not merely live — deliberately stricter than the cap.** Migration 0016's area cap
counts a promotion whose order is still `pending_provider_confirmation`, because a
promotion holds its slot from checkout so a slot cannot be sold twice while the provider
decides. This function requires `o.status = 'paid'`. Reserving a slot and buying
placement are different questions; if pending earned the boost, the boost would be free —
start a checkout, never finish, keep the placement.

**`p_area` reuses 0016's comparison and defaults to "any".** Exact `=`, no normalisation,
no prefix or `ILIKE` match. It defaults to `NULL` meaning every area, and `NULL` is what
the only caller passes, because nothing on the read side has an area string and deriving
one from a free-text address would be inventing the geographic area model 0016 explicitly
deferred. The parameter is kept as the seam that redesign will use.

**The boost is applied in the schedule page, not in SQL.** `boostPromotedWithinDay` sorts
a promoted dance as though it started 90 minutes earlier — a bounded nudge expressed in
the currency the list actually sorts in. Displayed times never change. It runs *after*
`groupDancesByDay`, per day group, which is a correctness property rather than a
convenience: applied to the flat list, a 90-minute shift could pull a dance backwards past
midnight and render it under the previous day's heading.

Ninety minutes is chosen against the data: these evenings start on the hour or half hour,
mostly 19:00–21:30. It lifts a promoted 21:00 past a 21:30 and a 22:00 — two or three
places on a busy night — while leaving it below the 19:00 that opened the evening. A
promotion that always led the list would read as an advertisement, and the same product
decision that forbids a "ממומן" label forbids the placement that would look like one.

### Rejected: taking the caller's candidate event ids and returning the intersection

A tighter-looking signature — `get_active_promoted_event_ids(p_event_ids uuid[])`, returning
only the promoted subset of what the caller is already showing — was considered and rejected.
It buys no confidentiality. `dance_events` is anonymously readable in full
(`dance_events_select_public`, migration 0001), so an attacker can enumerate every event id
for free and simply pass all of them, arriving at exactly the answer the no-argument call
gives. What it does buy is a larger request payload on every schedule render and a second
way to call the same function. The friction would land entirely on the legitimate caller.

The honest framing is that "which public dances are promoted" is not a secret this function
can keep while also doing its job — it is the one bit the feature exists to publish. What
must stay secret is everything attached to it, and that is enforced by the single-column
`RETURNS TABLE`, not by the argument list.

## Consequences

- `find_dances_near` is untouched, so the map and the "near me" route are provably
  unaffected. Anyone changing that later has to change a shared query with three callers.
- The boost can only reorder what the query already returned. `find_dances_near` caps at
  200 rows ordered by `starts_at`, so a promoted dance beyond that cap does not surface;
  the boost is a reordering, never a retrieval.
- A promotion whose order is later refunded or reversed stops boosting on the next render,
  with no sweeper — the function reads `orders.status` live.
- Passing `NULL` for the area does not let a promotion bought for one part of the country
  boost a dance somewhere else, even though the read is area-blind. A promotion names one
  `event_id`, that dance has one venue, and the schedule only ever contains dances already
  inside its own radius — so an out-of-area promotion has nothing to lift. Geography is
  enforced by the dance, not by the area string, which is a large part of why the
  area-blind read is safe to ship ahead of the real area model.
- **Known, accepted disclosure:** because `p_area` is grantable to `anon`, a caller can
  probe area strings and learn how the promoted set partitions across them. Today that
  reveals only that some already-public dances share an area bucket. If area becomes
  commercially sensitive, drop the parameter from the anon grant rather than widening it.
- This is the third SECURITY DEFINER function over the payments schema and the first read.
  0025's rule stands: each one is a deliberate, audited hole, and the burden is on the
  function. A fourth needs the same argument made again in writing.
