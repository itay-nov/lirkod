# 0010 — Anonymous raw-table reads stay open, but are time-bounded; only find_dances_near is radius-bounded

## Status

Accepted.

## Context

Migration `0003` bounded `find_dances_near`: radius clamped to 50km, a 60-day
horizon, a 200-row limit. A security review of `main@b9e2e21` pointed out that none
of that is a bound on the *data*, only on that one function. `anon` also holds a
plain `select` privilege on `venues`, `dance_events` and `event_occurrences`, and
`0001`'s policies on all three read `using (true)`. So:

```
GET /rest/v1/event_occurrences?select=*
```

returned the table — every future night, in one anonymous request, with the anon key
that ships in the JavaScript bundle. The RPC's limits were a front door on a building
with the side door propped open.

Two obvious-looking fixes are both closed off:

- **Make `find_dances_near` `security definer` and revoke the raw `select`.** This
  reverses [0005](./0005-proximity-query-as-rpc.md), whose whole point is that the
  function runs as the caller and can therefore reach exactly what RLS already allows
  `anon` — no more. A definer function is a second, privileged read path that has to
  be audited on its own terms forever. Not doing this.
- **Require a session to read.** Directly forbidden by AGENTS.md §2.2, and it is the
  product premise: a link tapped inside WhatsApp shows the map, with no account.

## Decision

Raw table access for `anon` stays. It is bounded on the one axis RLS can express
without a parameter — time — and `find_dances_near` remains the only surface that is
bounded by radius.

- `event_occurrences` gets a windowed anon `select` policy (migration `0005`):
  `starts_at` from one day ago to 60 days ahead. The forward bound mirrors the RPC's
  horizon; the backward one exists because past occurrences accumulate forever, so a
  policy open at that end would grow without limit as the product ages — the same
  unbounded result set `0003` set out to prevent, only arriving slowly. The one-day
  grace, rather than the RPC's `starts_at >= now()`, keeps a dance that started at
  20:00 readable at 21:00; cutting at `now()` would make tonight's row and its
  "בוטל"/"הועבר" status vanish mid-evening, which AGENTS.md §10 forbids.
- `authenticated` keeps an unbounded read, as its own policy. An instructor needs
  their own past nights, and reaching that role costs a real phone number and an SMS
  OTP — a bound of a different kind from an anon key that is public by construction.
- PostgREST's `db-max-rows` drops from 1000 to 200 (`supabase/config.toml`), matching
  `find_dances_near`'s own `LIMIT`, so the two read paths cap at the same number.

## Full parity is not achievable at the raw-table level, and here is why

This does not make the raw tables equivalent to the RPC. Saying so plainly:

- **Radius cannot be enforced in RLS.** A policy is a boolean over the row; it takes
  no arguments. `ST_DWithin` needs a query point, which is per-request, and there is
  nowhere for a policy to receive one. (A GUC set by the client — `current_setting` —
  is not a bound: the caller would be supplying the value being checked against.)
- **So `venues` remains fully enumerable by `anon`.** Every hall in the country, with
  coordinates, in one request. That is public information — an address and a name —
  and AGENTS.md §8's data-minimisation rule is what keeps it that way. It has no time
  dimension to bound, so nothing here narrows it.
- **`dance_events` likewise.** A series has no date of its own; its dates live on
  `event_occurrences`. Bounding it would mean an `exists` subquery against the
  occurrence window on every row read — the radius problem in a different shape, and
  a per-row join on the hero screen's read path. Not worth it: a `dance_events` row
  is a price and a venue reference, and the same information is already on the map.
- **`db-max-rows` is one value for the whole connection, not per role.** Verified
  against the local stack: `pgrst.db_max_rows` set on the `anon` role is ignored,
  set on `authenticator` it takes effect. So `anon` cannot be tightened separately,
  and 200 applies to `service_role` reads through PostgREST too — a truncation, not
  an error, which a future server-side job needing more rows must handle by
  paginating.

What is actually bought: the unbounded read that mattered — every future night, for
ever, in one call — is now a 61-day window, and no single response exceeds 200 rows.
What remains reachable is a static, public catalogue of halls and series, which is
not what the review flagged.

## Consequences

- `find_dances_near` is unaffected. Its own filter sits strictly inside the new
  window, so the same rows come back; `docs/decisions/0005` stands unchanged and the
  function keeps its `SECURITY INVOKER` behaviour.
- Any future anonymous feature that needs an occurrence outside the window — a
  dancer's attendance history, a review of a dance three months ago — does not get to
  widen this policy quietly. It needs a session, or its own decision.
- `tests/rls/fixtures.ts` now creates occurrences relative to `now()`. Fixed calendar
  dates would have drifted out of the window and turned this policy into a suite that
  fails months later for reasons unrelated to any change.
- Rate limiting is still not addressed anywhere. Bounding a response is not bounding
  how many responses a caller can ask for, and nothing in this repo limits that yet.
