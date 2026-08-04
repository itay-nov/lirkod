# 0003 — `status = 'moved'` and `override_venue_id` both exist, and a CHECK keeps them honest

## Status

Accepted.

## Context

On `event_occurrences`, `status = 'moved'` and a non-null `override_venue_id` encode
overlapping information. Left alone, they can disagree, and one of the two ways they can
disagree is the worst bug this product can have.

## Decision

Both columns stay, with a split of authority and a `CHECK` constraint that makes the
dangerous combination unrepresentable.

- **`override_venue_id` is authoritative for *where*.** The address a dancer is sent to
  is always `coalesce(occurrence.override_venue_id, dance_events.venue_id)`. Nothing
  reads `status` to decide a location.
- **`status` is authoritative for *what the dancer is told*.** It drives the visible
  label — "בוטל" / "הועבר" — which AGENTS.md §2.6 requires as a word, not a colour.
  Nothing derives an address from it.

They answer different questions, so both earn their place. What they must not be is two
independent sources of truth, so:

```sql
check (
     (status = 'scheduled' and override_venue_id is null)
  or (status = 'moved'     and override_venue_id is not null)
  or (status = 'cancelled')
)
```

## Why this shape

- **`scheduled` + a non-null override is forbidden** — this is the whole point. That row
  means the venue changed but the UI shows no "הועבר" badge and no alert fires: a dancer
  drives to the old hall. AGENTS.md §10 calls venue changes the product's most important
  moment; this combination is that moment failing silently, so the database refuses it
  rather than trusting every future writer to remember.
- **`moved` + a null override is forbidden** — there is no time-override column, so a
  "move" that doesn't name a new venue says nothing. (If a time-only move is ever needed,
  it needs its own column and a new migration relaxing this constraint.)
- **`cancelled` is left unconstrained on purpose.** A dance can be moved on Monday and
  cancelled on Tuesday; forcing `override_venue_id` back to null on cancellation would
  erase the fact that it had moved, which matters when a dancer asks why.

## Alternatives rejected

- **Drop `'moved'` from the enum and derive it from `override_venue_id is not null`.**
  Genuinely the cleanest — one source of truth, no constraint needed. Rejected because
  the three-value enum is an explicit part of the task spec, and dropping a specified
  column value is not mine to decide. Worth revisiting: it would make this ADR
  unnecessary.
- **Leave both columns unconstrained and reconcile in application code.** Rejected:
  every writer would have to remember, and the failure is silent and safety-critical.
